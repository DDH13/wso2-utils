# zsh functions

Personal zsh functions for WSO2 API Manager / Identity Server pack management,
support branch workflows, and local dev environments.

## Installation

These files are plain zsh function definitions (one function per file, `kube.zsh`,
`tokens.zsh` and `newbranch` are exceptions — see below). They're wired up in
`~/.zshrc`:

```zsh
fpath=(~/.zsh/functions $fpath)
autoload -U ~/.zsh/functions/*(:t)

# Explicitly sourced because they define more than one function, or need to
# run immediately (e.g. to register a compdef):
source ~/.zsh/functions/tokens.zsh
source ~/.zsh/functions/kube.zsh
source ~/.zsh/functions/newbranch
```

Everything else (`freshPack`, `patch-apim`, `restart-gateway`, etc.) is picked
up lazily via `autoload` — no explicit `source` needed, as long as the
filename matches the function name.

To add a new function: drop a file named exactly like the function into this
directory. If it defines a single function, `autoload` picks it up
automatically on next shell start. If it defines multiple functions (like
`tokens.zsh`) or needs to run top-level code at shell startup (like
`newbranch`'s `compdef`), add an explicit `source` line to `.zshrc`.

## Prerequisites

### WSO2 update tool credentials (Keychain)

`freshPack`, `freshPackDs`, `freshISPack`, `checkManualFiles`,
`checkManualFilesDs`, `originalPack`, `updatePack` and `updatePackDs` all
shell out to WSO2's `wso2update_darwin` / `wso2update_darwin_arm64` tool,
which needs your WSO2 update credentials. These are read from macOS Keychain,
not prompted for — save them once:

```zsh
security add-generic-password -a "dinethh@wso2.com" -s "wso2-update" -w "YOUR_PASSWORD"
```

The account defaults to `dinethh@wso2.com`, overridable per-shell via
`APIM_EMAIL`.

### Environment variables (optional overrides)

| Variable | Default | Used by |
|---|---|---|
| `APIM_EMAIL` | `dinethh@wso2.com` | all functions that run the update tool |
| `APIM_ORIGINAL_DIR` | `/Users/dineth/Code/APIM-packs-original` | `originalPack` |
| `APIM_PATCHES_DIR` | `/Users/dineth/Code/APIM-packs-patches` | `originalPack` |
| `GO_BUILD_PARALLELISM` | `6` | `restart-gateway --hard` |

### Expected folder structure

All the pack-management functions assume a fixed layout under
`/Users/dineth/Code/`. Paths are hardcoded (not derived from `$PWD`) except
where a function checks it's being run from a specific directory.

```
/Users/dineth/Code/
├── APIM-packs-original/
│   └── wso2am-<version>.zip                  # pristine, untouched packs (source for originalPack)
├── APIM-packs-patches/
│   ├── wso2am-<version>.zip                  # working copy zips (freshPack/updatePack unzip+rezip these)
│   ├── wso2am-<version>/                     # unzipped pack (created/replaced by freshPack)
│   ├── wso2is-<version>.zip
│   ├── wso2is-<version>/
│   ├── backups/
│   │   └── wso2am-<version>-<name>.zip        # backupPack snapshots
│   └── Distributed-Setup/
│       └── <major.minor>/                     # e.g. 4.7 (VERSION with the patch component stripped)
│           ├── wso2am-acp-<version>.zip
│           ├── wso2am-tm-<version>.zip
│           └── wso2am-universal-gw-<version>.zip
├── apim-distributed-dev-setup/
│   └── components/                            # target for `freshPackDs --prep` (acp/tm/gw, version-suffix stripped)
├── is-km-stuff/
│   └── wso2is.notification.event.handlers-<jar_version>.jar   # required by configureIS7
├── apictls/
│   └── apictl-<version>*.tar.gz                # source tarballs for switch-apictl
├── apictl/                                      # switch-apictl's extraction target
├── gateway-controllers/
│   └── policies/<folder>/                       # source for movePolicy
├── api-platform/
│   └── gateway/                                 # restart-gateway's docker-compose project; dev-policies/<folder> is movePolicy's default destination
├── wso2-support/
│   └── support-api-platform/
│       └── gateway/                             # restart-gateway -s / movePolicy -s target
└── product-apim/
    └── all-in-one-apim/modules/distribution/product/target/
        └── wso2am-4.7.0-SNAPSHOT.zip            # freshPackMaster's local build output
```

Other requirements:
- `git`, `unzip`/`zip`, `keytool` (JDK), `kubectl`, `jq`, `docker compose`, and
  `apictl` on `$PATH` depending on which functions you use.
- A `git` remote named `upstream` with `support-<N>.x-full` branches, for
  `newbranch`.
- `docker compose` project files (`docker-compose.yaml`, `scripts/setup.sh`)
  present in the gateway dirs above, for `restart-gateway`.

## Functions

### Pack management (WSO2 APIM / IS)

#### `freshPack <version> [--staging]`
Unzips `wso2am-<version>.zip` in `APIM-packs-patches/` (wiping any existing
unzipped copy), runs the WSO2 update tool against it (auto-detects
`wso2update_darwin` vs `_arm64` by version, ≥4.6.0 uses arm64), handles the
tool's own self-update, and `cd`s into the pack's `bin/`. With `--staging`,
re-runs the tool a second time against the `TESTING` update level after a
successful normal run.

#### `freshPackDs <version> [--staging] [--prep]`
Same as `freshPack` but for the three distributed-setup packs (`acp`, `tm`,
`gw`) under `Distributed-Setup/<major.minor>/`. Unzips and preps all three in
parallel, then runs the update tool for `acp` first alone (to resolve any
tool self-update safely against the shared `~/.wso2-updates` cache), copies
its now-current tool binary to `tm`/`gw`, then runs those two in parallel with
live prefixed log streaming. `--prep` additionally copies the three updated
packs (version suffix stripped) into
`apim-distributed-dev-setup/components/`.

#### `freshISPack <version>`
Unzips `wso2is-<version>.zip` in `APIM-packs-patches/` and runs
`wso2update_darwin` against it.

#### `originalPack <version>`
Copies `wso2am-<version>.zip` from `APIM-packs-original/` into
`APIM-packs-patches/`, unzips it fresh, and runs the update tool — i.e. reset
a patched pack back to a clean base before re-patching. Uses
`APIM_ORIGINAL_DIR` / `APIM_PATCHES_DIR` if set.

#### `freshPackMaster`
Copies the locally built `wso2am-4.7.0-SNAPSHOT.zip` from a
`product-apim` Maven build output directory into `APIM-packs-patches/`,
unzips it, and `cd`s into `bin/`. Filename/version is hardcoded.

#### `updatePack <version>`
Runs `freshPack`, then re-zips the resulting pack directory back into
`wso2am-<version>.zip` in `APIM-packs-patches/` (replacing the original).

#### `updatePackDs <version>`
Same as `updatePack` but for the distributed setup: runs `freshPackDs`, then
re-zips all three (`acp`/`tm`/`gw`) packs in place.

#### `checkManualFiles <version>`
Runs `freshPack`, then interactively prompts for a list of file paths
(relative to the pack root) that are manually maintained and shouldn't
silently change when the update tool runs at the `TESTING` staging level.
Snapshots those files, runs the update tool against `TESTING`, then diffs
before/after and reports which manually tracked files changed.

#### `checkManualFilesDs <version>`
Same idea as `checkManualFiles`, but checks the given paths across all three
distributed-setup packs (`acp`/`tm`/`gw`) at once.

#### `backupPack <name>` / `backupPack -r <name>`
Must be run from inside `APIM-packs-patches/wso2am-<version>/bin`. Zips the
whole pack directory to `APIM-packs-patches/backups/wso2am-<version>-<name>.zip`
(refuses to overwrite an existing backup of the same name). `-r` restores a
named backup over the current pack directory.

#### `patch-apim [-t] <version> <file...>`
Deploys built `.jar`/`.war` artifacts into
`APIM-packs-patches/wso2am-<version>/repository/components/...`. `.jar` files
go to `dropins/` by default (removing any matching old JAR from `plugins/`
first); with `-t`, directly replaces the matching JAR in `plugins/` in place
instead. `.war` files are deployed to `webapps/`, removing any previously
unpacked directory of the same name.

#### `configureIS7 <is_version> <am_version>`
One-time wiring between a WSO2 IS and APIM pack pair in
`APIM-packs-patches/`: appends OAuth/event-listener config to IS's
`deployment.toml`, copies the IS notification event-handler JAR (from
`is-km-stuff/`, version selected by IS version) into IS's `dropins/`, and
exchanges TLS certificates so each product trusts the other
(`wso2carbon` keystore/truststore in both directions).

### Git / branch workflow

#### `newbranch [-f] <issue_number> <branch_number>`
Fetches `upstream`, then creates/checks out
`support-<branch_number>.x-full.<issue_number>` from
`upstream/support-<branch_number>.x-full`. `-f` force-checks-out, discarding
local changes. Includes tab-completion for known APIM branch numbers.

### Gateway / dev environment

#### `restart-gateway [--hard] [--skip-tests] [-s] [--profile <name>]...`
Runs `docker compose down/up` for the gateway project at
`~/Code/api-platform/gateway` (or `~/Code/wso2-support/support-api-platform/gateway`
with `-s`), then tails logs. On first run (no `api-platform.env`) or with
`--hard`, runs `scripts/setup.sh` first to provision admin credentials/certs.
`--hard` also rebuilds `gateway-builder`, `gateway-runtime` and
`gateway-controller` locally before starting (builder and runtime build in
parallel; `--skip-tests` skips each Makefile's `test` target).
`--profile <name>` (repeatable) enables docker-compose profiles (e.g.
tracing/logging/metrics) via `COMPOSE_PROFILES`.

#### `movePolicy [-s] <folder>`
Copies `gateway-controllers/policies/<folder>/*` into
`api-platform/gateway/dev-policies/<folder>/` (or the `wso2-support` gateway
with `-s`), wiping the destination folder first.

#### `switch-apictl <version>`
Finds `apictl-<version>*.tar.gz` in `~/Code/apictls/`, extracts it, replaces
`~/Code/apictl/` with it, and logs into the `dev` environment as
`admin/admin`.

### Kubernetes

#### `kshell <partial-pod-name>`
Finds the first pod whose name matches `<partial-pod-name>` (via
`kubectl get pods`) and opens an interactive shell in it (`/bin/bash`,
falling back to `/bin/sh`).

### OAuth / tokens

#### `gettoken`
Requests a client-credentials token from a hardcoded WSO2 IdP endpoint
(`idp.am.wso2.com`) with `apk:api_create` scope, prints the raw response, and
exports the access token as `$ACCESS_TOKEN`. Requires `jq`.

#### `introspect [token]`
Introspects an OAuth2 token against `https://localhost:9443/oauth2/introspect`
using `admin:admin` basic auth. Uses `$1` if given, otherwise falls back to
`$ACCESS_TOKEN`.
