/**
 * WSO2 UMT Patch Message Generator
 *
 * Save as a Chrome DevTools Snippet (Sources > Snippets) and run it while the
 * active tab is the relevant update's page:
 *   https://umt.wso2.com/update?updateId=<id>&type=viewUpdate
 *
 * Builds a standardized patch status message from whatever is currently on
 * that page, logs it, and copies it to the clipboard for pasting into chat.
 */
(function () {
    const NA_VALUES = new Set(['', 'N/A', 'n/a']);

    function isNA(value) {
        return value == null || NA_VALUES.has(value.trim());
    }

    function getUpdateId(doc) {
        const fromUrl = new URLSearchParams(location.search).get('updateId');
        if (fromUrl) return fromUrl;
        for (const script of doc.querySelectorAll('script')) {
            const match = script.textContent.match(/var\s+updateId\s*=\s*"(\d+)"/);
            if (match) return match[1];
        }
        return 'UNKNOWN';
    }

    function getInputValue(doc, id) {
        const value = doc.querySelector(`input#${id}`)?.value?.trim();
        return isNA(value) ? null : value;
    }

    function getPublicIssues(doc) {
        return [...doc.querySelectorAll('tbody#issueList a')]
            .map(a => a.href)
            .filter(href => href && !isNA(href) && !/\/N\/A$/i.test(href));
    }

    function getProductDivs(doc) {
        return [...doc.querySelectorAll('#compatibleProducts > div[name]')];
    }

    const WEBAPP_LABELS = { publisher: 'Publisher', devportal: 'Developer', admin: 'Admin' };

    function getDeliverables(doc) {
        // The same file change is listed once per applicable product
        // profile (wso2am, wso2am-tm, ...) - dedupe across profiles.
        const seen = new Map();
        getProductDivs(doc).forEach(div => {
            div.querySelectorAll('table tbody tr').forEach(tr => {
                const cells = [...tr.children].map(td => td.textContent.trim());
                if (!cells[0]) return;
                const key = `${cells[1] || ''}::${cells[0]}`;
                if (!seen.has(key)) seen.set(key, { file: cells[0], operation: cells[1] || '' });
            });
        });
        const rows = [...seen.values()];
        if (rows.length === 0) return null;

        // Portal UI updates touch dozens of files under "webapps/<app>/..."
        // (bundles, package.json, locales, jsp pages) - summarize those as
        // "UI(<portal> portal)" instead of listing every row.
        const webapps = new Set();
        const allWebapp = rows.every(row => {
            const match = row.file.match(/webapps\/([^/]+)\//);
            if (match) webapps.add(match[1]);
            return !!match;
        });

        if (allWebapp && webapps.size > 0) {
            const labels = [...webapps].map(name => WEBAPP_LABELS[name] || (name.charAt(0).toUpperCase() + name.slice(1)));
            return `UI(${labels.join(', ')} portal)`;
        }

        return rows.map(row => `${row.operation} ${row.file}`.trim()).join('\n');
    }

    function getLifecycleStatus(doc) {
        // Staging build status / Manual testing aren't separate DOM fields -
        // both are read off the current lifecycle badge (the last
        // ".wum_badge" span right before the lifecycle-history button).
        const anchor = doc.getElementById('btnShowLifecycleStateChangeLogModal');
        let el = anchor ? anchor.previousElementSibling : null;
        while (el && !el.classList.contains('wum_badge')) el = el.previousElementSibling;
        const state = el ? el.textContent.trim() : null;
        if (!state) return null;

        const STATE_STATUS_MAP = { Staging: 'PENDING', UATStaging: 'SUCCESS', Completed: 'SUCCESS' };
        return STATE_STATUS_MAP[state] || state.toUpperCase();
    }

    const COMPONENT_LABELS = [
        ['wso2am', 'AIO'],
        ['wso2am-acp', 'ACP'],
        ['wso2am-tm', 'TM'],
        ['wso2am-universal-gw', 'UGW'],
    ];

    function getApplicableComponents(doc) {
        const names = new Set(getProductDivs(doc).map(div => div.getAttribute('name')));
        if (names.size <= 1) return null; // only the default AIO pack - not worth calling out
        const labels = COMPONENT_LABELS.filter(([name]) => names.has(name)).map(([, label]) => label);
        return labels.length ? labels.join(', ') : null;
    }

    function buildPatchMessage(doc = document) {
        const lines = [`U2: ${getUpdateId(doc)}`];

        const internalIssue = getInputValue(doc, 'internalGitIssue');
        if (internalIssue) lines.push(`Internal Issue: ${internalIssue}`);

        const securityIssue = getInputValue(doc, 'securityInternalGitIssue');
        if (securityIssue) lines.push(`Security Internal Issue: ${securityIssue}`);

        const publicIssues = getPublicIssues(doc);
        if (publicIssues.length === 1) {
            lines.push(`Public Issue: ${publicIssues[0]}`);
        } else if (publicIssues.length > 1) {
            lines.push('Public Issue:');
            publicIssues.forEach(url => lines.push(`  - ${url}`));
        }

        const deliverables = getDeliverables(doc);
        if (deliverables) {
            lines.push('Deliverables:');
            lines.push(deliverables);
        }

        const bestCase = getInputValue(doc, 'bestCase');
        if (bestCase) lines.push(`Best Case ETA: ${bestCase}`);

        const mostLikely = getInputValue(doc, 'mostLikely');
        if (mostLikely) lines.push(`Most Likely ETA: ${mostLikely}`);

        const worstCase = getInputValue(doc, 'worstCase');
        if (worstCase) lines.push(`Worst Case ETA: ${worstCase}`);

        const status = getLifecycleStatus(doc);
        if (status) {
            lines.push(`Staging build status: ${status}`);
            lines.push(`Manual Testing: ${status}`);
        }

        const components = getApplicableComponents(doc);
        if (components) lines.push(`Applicable components: ${components}`);

        return lines.join('\n');
    }

    function copyToClipboard(text) {
        // Snippets usually run without the document itself focused (DevTools
        // has focus instead), which makes navigator.clipboard.writeText
        // reject with "Document is not focused". Fall back to the older
        // execCommand('copy'), which tolerates that better.
        function fallbackCopy() {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                document.execCommand('copy');
                console.log('%cCopied to clipboard.', 'color: #2ecc71');
            } catch (err) {
                console.error('Could not copy to clipboard:', err);
            } finally {
                document.body.removeChild(textarea);
            }
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => console.log('%cCopied to clipboard.', 'color: #2ecc71'))
                .catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    }

    // Expose for ad-hoc re-runs from the console without re-pasting the snippet.
    window.buildPatchMessage = buildPatchMessage;

    const message = buildPatchMessage();
    console.log(message);
    copyToClipboard(message);
})();
