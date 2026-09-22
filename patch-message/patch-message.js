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

    function getSecurityAdvisories(doc) {
        // No stable id on this panel - locate it by its heading text and
        // read every row of its (single-column) table. The whole panel is
        // omitted from the DOM entirely when the update isn't a security fix.
        const heading = [...doc.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Security Advisories');
        const panel = heading ? heading.closest('.x_panel') : null;
        if (!panel) return [];
        return [...panel.querySelectorAll('tbody tr td')]
            .map(td => td.textContent.trim())
            .filter(Boolean);
    }

    // Anything under "webapps/<portal>/" or "jaggeryapps/<portal>/" is a UI
    // change to that portal, regardless of what kind of file it is (bundle,
    // package.json, jsp page, jsx source, ...).
    const PORTAL_MARKERS = [
        [/(?:webapps|jaggeryapps)\/devportal\//, 'Developer'],
        [/(?:webapps|jaggeryapps)\/publisher\//, 'Publisher'],
        [/(?:webapps|jaggeryapps)\/admin\//, 'Admin'],
    ];

    function getFileRows(doc) {
        // The same file change is listed once per applicable product
        // profile (wso2am, wso2am-tm, ...) - dedupe across profiles.
        // Each product also has a separate "Bundles Info Changes" table
        // (id="budlesInfoChanges" - a WSO2 typo, not "bundles") listing
        // bundles.info rows keyed by jar name/version, not File/Operation -
        // exclude it, we only want the file-changes table.
        const seen = new Map();
        getProductDivs(doc).forEach(div => {
            div.querySelectorAll('table:not(#budlesInfoChanges) tbody tr').forEach(tr => {
                const cells = [...tr.children].map(td => td.textContent.trim());
                if (!cells[0]) return;
                const key = `${cells[1] || ''}::${cells[0]}`;
                if (!seen.has(key)) seen.set(key, { file: cells[0], operation: cells[1] || '' });
            });
        });
        return [...seen.values()];
    }

    // Splits every changed file into: portal UI changes (summarized as
    // "UI(<portal> portal)"), .jar/.war deliverables, and everything else
    // (config/xml/scripts/...), which needs manual handling on the box.
    function classifyRows(doc) {
        const portals = new Set();
        const deliverableRows = [];
        const manualRows = [];

        getFileRows(doc).forEach(row => {
            const marker = PORTAL_MARKERS.find(([pattern]) => pattern.test(row.file));
            if (marker) {
                portals.add(marker[1]);
            } else if (/\.(jar|war)$/i.test(row.file)) {
                deliverableRows.push(row);
            } else {
                manualRows.push(row);
            }
        });

        return { portals, deliverableRows, manualRows };
    }

    // Groups rows into "<label>:" bullet lists, in a fixed label order,
    // skipping any that are empty. `labelFor` maps a row's raw DOM
    // operation (Modified/Added/Removed) to the display label to group by.
    function groupRowsByOperation(rows, orderedLabels, labelFor) {
        const byLabel = new Map();
        rows.forEach(row => {
            const label = labelFor(row.operation);
            if (!byLabel.has(label)) byLabel.set(label, []);
            byLabel.get(label).push(row.file);
        });
        const allLabels = [
            ...orderedLabels,
            ...[...byLabel.keys()].filter(label => !orderedLabels.includes(label)),
        ];
        return allLabels
            .filter(label => byLabel.has(label))
            .map(label => `${label}:\n${byLabel.get(label).map(file => `  - ${file}`).join('\n')}`);
    }

    function getDeliverables({ portals, deliverableRows }) {
        const sections = groupRowsByOperation(deliverableRows, ['Modified', 'Added', 'Removed'], op => op || 'Other');
        if (portals.size > 0) sections.push(`UI(${[...portals].join(', ')} portal)`);
        return sections.length ? sections.join('\n') : null;
    }

    function getManualFiles({ manualRows }) {
        const sections = groupRowsByOperation(
            manualRows,
            ['Modified', 'Added', 'Deleted'],
            op => (op === 'Removed' ? 'Deleted' : op || 'Other'),
        );
        return sections.length ? sections.join('\n') : null;
    }

    function getClosestEta(doc) {
        // Best/Most Likely/Worst Case are three estimates for the same
        // event - only show the soonest one that hasn't already passed
        // (falling through to the next if it has). If all three are
        // already in the past, fall back to the latest of them.
        const candidates = [
            { label: 'Best Case', date: getInputValue(doc, 'bestCase') },
            { label: 'Most Likely', date: getInputValue(doc, 'mostLikely') },
            { label: 'Worst Case', date: getInputValue(doc, 'worstCase') },
        ].filter(c => c.date);
        if (candidates.length === 0) return null;

        candidates.sort((a, b) => new Date(a.date) - new Date(b.date));

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return candidates.find(c => new Date(c.date) >= today) || candidates[candidates.length - 1];
    }

    function getLifecycleStatus(doc) {
        // Staging build status isn't a separate DOM field - it's read off
        // the current lifecycle badge (the last ".wum_badge" span right
        // before the lifecycle-history button).
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

        const securityAdvisories = getSecurityAdvisories(doc);
        if (securityAdvisories.length === 1) {
            lines.push(`Security Advisory: ${securityAdvisories[0]}`);
        } else if (securityAdvisories.length > 1) {
            lines.push('Security Advisory:');
            securityAdvisories.forEach(name => lines.push(`  - ${name}`));
        }

        const publicIssues = getPublicIssues(doc);
        if (publicIssues.length === 1) {
            lines.push(`Public Issue: ${publicIssues[0]}`);
        } else if (publicIssues.length > 1) {
            lines.push('Public Issue:');
            publicIssues.forEach(url => lines.push(`  - ${url}`));
        }

        const classifiedRows = classifyRows(doc);

        const deliverables = getDeliverables(classifiedRows);
        if (deliverables) {
            lines.push('Deliverables:');
            lines.push(deliverables);
        }

        const manualFiles = getManualFiles(classifiedRows);
        if (manualFiles) {
            lines.push('Manual Files:');
            lines.push(manualFiles);
        }

        const eta = getClosestEta(doc);
        if (eta) lines.push(`${eta.label} ETA: ${eta.date}`);

        const status = getLifecycleStatus(doc);
        if (status) {
            lines.push(`Staging build status: ${status}`);
            lines.push('Manual Testing: PENDING');
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
