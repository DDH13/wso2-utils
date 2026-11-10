/**
 * WSO2 UMT Patch Message Generator
 *
 * Save as a Chrome DevTools Snippet (Sources > Snippets) or use the
 * bookmarklet, and run it while the active tab is the relevant update's page
 * in the One WSO2 UMT UI:
 *   https://one.wso2.com/engineering/umt/updates/<id>
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
        const fromPath = location.pathname.match(/\/updates\/(\d+)/);
        if (fromPath) return fromPath[1];
        const fromQuery = new URLSearchParams(location.search).get('updateId');
        if (fromQuery) return fromQuery;
        return 'UNKNOWN';
    }

    // Header fields render as <div><p class="MuiTypography-body2">Label</p>
    // <value element/></div> - the value is a <p>, a <div> (e.g. Worst Case
    // Date, which carries a history icon) or an <a> for GitHub issues.
    function getFieldValueElement(doc, label) {
        const labelEl = [...doc.querySelectorAll('main p.MuiTypography-body2')]
            .find(p => p.textContent.trim() === label);
        return labelEl ? labelEl.nextElementSibling : null;
    }

    function getField(doc, label) {
        const value = getFieldValueElement(doc, label)?.textContent?.trim();
        return isNA(value) ? null : value;
    }

    function getFieldLink(doc, label) {
        const el = getFieldValueElement(doc, label);
        if (!el) return null;
        const link = el.tagName === 'A' ? el : el.querySelector('a');
        if (link && link.href) return link.href;
        const value = el.textContent.trim();
        return isNA(value) ? null : value;
    }

    // Each page section is an <h5> title plus an MUI DataGrid. Walk up from
    // the title to the first ancestor holding a grid - but stop if that
    // ancestor also holds another section title, since an empty section has
    // no grid of its own and would otherwise pick up the next section's.
    function getSectionGrids(doc, title) {
        const main = doc.querySelector('main') || doc.body;
        const heading = [...main.querySelectorAll('h5')].find(h => h.textContent.trim() === title);
        if (!heading) return [];
        for (let el = heading.parentElement; el && el !== main.parentElement; el = el.parentElement) {
            if ([...el.querySelectorAll('h5')].some(h => h !== heading)) return [];
            const grids = el.querySelectorAll('.MuiDataGrid-root');
            if (grids.length) return [...grids];
        }
        return [];
    }

    // Read cells only - a grid's own textContent includes injected <style>.
    function gridRows(grid) {
        const rows = [...grid.querySelectorAll('.MuiDataGrid-row[data-id]')].map(row => {
            const cells = {};
            row.querySelectorAll('[role=gridcell][data-field]').forEach(cell => {
                cells[cell.getAttribute('data-field')] = cell.textContent.trim();
            });
            return cells;
        });
        const expected = Number(grid.querySelector('[role=grid]')?.getAttribute('aria-rowcount')) - 1;
        if (expected > rows.length) {
            console.warn(`patch-message: grid shows ${rows.length} of ${expected} rows - some may be missing.`);
        }
        return rows;
    }

    function gridHasColumn(grid, field) {
        return !!grid.querySelector(`[role=columnheader][data-field="${field}"]`);
    }

    function getSectionValues(doc, title, field) {
        return getSectionGrids(doc, title)
            .flatMap(gridRows)
            .map(row => row[field])
            .filter(value => !isNA(value));
    }

    function getPublicIssues(doc) {
        return getSectionValues(doc, 'Public GitHub Issues', 'value');
    }

    function getSecurityAdvisories(doc) {
        // The whole section is omitted when the update isn't a security fix.
        return getSectionValues(doc, 'Security Advisories', 'security-advisory');
    }

    // "Product Analysis Results" has one block per applicable product: an
    // <h6> "<product> - <version>" with a sibling "Fully Applicable" /
    // "Partially Applicable" chip, followed by that product's file-change grid.
    function getProductBlocks(doc) {
        const main = doc.querySelector('main') || doc.body;
        const sectionHeading = [...main.querySelectorAll('h5')]
            .find(h => h.textContent.trim() === 'Product Analysis Results');
        if (!sectionHeading) return [];
        return [...main.querySelectorAll('h6')]
            .filter(h6 => sectionHeading.compareDocumentPosition(h6) & Node.DOCUMENT_POSITION_FOLLOWING)
            .map(h6 => {
                const match = h6.textContent.trim().match(/^(\S+)\s+-\s+(\S+)$/);
                if (!match) return null;
                const chip = h6.parentElement.querySelector('.MuiChip-root')?.textContent?.trim() || '';
                const block = h6.parentElement.parentElement;
                return {
                    name: match[1],
                    version: match[2],
                    partial: /partial/i.test(chip),
                    grids: [...block.querySelectorAll('.MuiDataGrid-root')],
                };
            })
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
        // profile (wso2am, wso2am-tm, ...) - dedupe across profiles. Only
        // grids with a File column count, which skips any bundles-info style
        // table keyed by jar name/version instead.
        const seen = new Map();
        getProductBlocks(doc).forEach(product => {
            product.grids.filter(grid => gridHasColumn(grid, 'file')).forEach(grid => {
                gridRows(grid).forEach(row => {
                    const file = row.file;
                    if (!file) return;
                    const operation = row.operation || '';
                    const key = `${operation}::${file}`;
                    if (!seen.has(key)) seen.set(key, { file, operation });
                });
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
    // skipping any that are empty. `labelFor` maps a row's raw
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

    // The new UI shows dates like "19 Nov 2026" / "03 Sept 2026" - print
    // them as YYYY-MM-DD, like the old UI did.
    function formatDate(date) {
        const pad = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function parseDate(text) {
        if (!text) return null;
        let date = new Date(text);
        if (isNaN(date)) date = new Date(text.replace(/\bSept\b/, 'Sep'));
        return isNaN(date) ? null : date;
    }

    function getClosestEta(doc) {
        // Best/Most Likely/Worst Case are three estimates for the same
        // event - only show the soonest one that hasn't already passed
        // (falling through to the next if it has). If all three are
        // already in the past, fall back to the latest of them.
        const candidates = [
            { label: 'Best Case', date: parseDate(getField(doc, 'Best Case Date')) },
            { label: 'Most Likely', date: parseDate(getField(doc, 'Most Likely Date')) },
            { label: 'Worst Case', date: parseDate(getField(doc, 'Worst Case Date')) },
        ].filter(c => c.date);
        if (candidates.length === 0) return null;

        candidates.sort((a, b) => a.date - b.date);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const chosen = candidates.find(c => c.date >= today) || candidates[candidates.length - 1];
        return { label: chosen.label, date: formatDate(chosen.date) };
    }

    function hasLifecycleState(doc) {
        // Staging build status / Manual Testing always print PENDING (they
        // get updated by hand once actually verified) - this just gates
        // whether to show those lines at all. The header chips next to the
        // "Update #<id>" title are [type, lifecycle, state].
        const title = doc.querySelector('main h2');
        const header = title ? title.parentElement.parentElement : null;
        if (!header) return false;
        const chips = [...header.querySelectorAll('.MuiChip-root')]
            .map(chip => chip.textContent.trim())
            .filter(text => !/applicable/i.test(text));
        return chips.length >= 3 && !!chips[2];
    }

    const COMPONENT_LABELS = [
        ['wso2am', 'AIO'],
        ['wso2am-acp', 'ACP'],
        ['wso2am-tm', 'TM'],
        ['wso2am-universal-gw', 'UGW'],
    ];

    // The AIO/ACP/TM/UGW product split only exists from APIM 4.5.0 onward -
    // earlier updates only ever shipped the single wso2am pack, so calling
    // out "applicable components" there would be meaningless noise. Every
    // product block shares the same major.minor.patch - only the trailing
    // build number differs per component.
    function meetsMinApimVersion(products, minMajor, minMinor) {
        const product = products.find(p => p.name.startsWith('wso2am'));
        const match = product && product.version.match(/^(\d+)\.(\d+)/);
        if (!match) return false;
        const [major, minor] = [Number(match[1]), Number(match[2])];
        return major > minMajor || (major === minMajor && minor >= minMinor);
    }

    function getApplicableComponents(doc) {
        const products = getProductBlocks(doc);
        if (!meetsMinApimVersion(products, 4, 5)) return null;
        const fullNames = new Set(products.filter(p => !p.partial).map(p => p.name));
        const partialNames = new Set(products.filter(p => p.partial).map(p => p.name));
        if (fullNames.size <= 1 && partialNames.size === 0) return null; // only the default AIO pack - not worth calling out
        const fullLabels = COMPONENT_LABELS.filter(([name]) => fullNames.has(name)).map(([, label]) => label);
        const partialLabels = COMPONENT_LABELS.filter(([name]) => partialNames.has(name))
            .map(([, label]) => `${label} (Partially Applicable)`);
        const labels = [...fullLabels, ...partialLabels];
        return labels.length ? labels.join(', ') : null;
    }

    function buildPatchMessage(doc = document) {
        const lines = [`U2: ${getUpdateId(doc)}`];

        const internalIssue = getFieldLink(doc, 'Internal GitHub Issue');
        if (internalIssue) lines.push(`Internal Issue: ${internalIssue}`);

        const securityIssue = getFieldLink(doc, 'Security Internal GitHub Issue');
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

        if (hasLifecycleState(doc)) {
            lines.push('Staging build status: PENDING');
            lines.push('Manual Testing: PENDING');
        }

        const components = getApplicableComponents(doc);
        if (components) lines.push(`Applicable components: ${components}`);

        return lines.join('\n');
    }

    // Avoid percent signs in this file: the bookmarklet is pasted into a
    // Chrome site-search URL, which percent-decodes it.
    const TOAST_ID = 'patch-message-toast';

    function showToast(message, color) {
        document.getElementById(TOAST_ID)?.remove();
        const toast = document.createElement('div');
        toast.id = TOAST_ID;
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed', top: '16px', right: '16px',
            zIndex: '2147483647', padding: '10px 16px', borderRadius: '6px', background: color, color: '#fff',
            font: '14px/1.4 sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,.4)', cursor: 'pointer',
        });
        document.body.appendChild(toast);
        return toast;
    }

    // Synchronous execCommand copy - returns whether it actually worked
    // (it returns false rather than throwing when Chrome refuses).
    function execCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            return document.execCommand('copy');
        } catch (err) {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }

    function tryCopy(text) {
        if (execCopy(text)) return Promise.resolve();
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        return Promise.reject(new Error('Clipboard unavailable'));
    }

    function copyToClipboard(text) {
        function onCopied() {
            console.log('Copied to clipboard.');
            const toast = showToast('Patch message copied to clipboard', '#2e7d32');
            setTimeout(() => toast.remove(), 2500);
        }

        // Chrome only allows clipboard writes right after a user gesture on
        // the page. Run from the address bar (or a DevTools snippet) there
        // often isn't one, and both copy methods are refused. In that case,
        // copy on the next click/keypress anywhere on the page instead.
        function copyOnNextGesture() {
            console.warn('Clipboard write was blocked - click anywhere on the page to copy.');
            showToast('Click anywhere on the page to copy the patch message', '#e65100');
            const events = ['pointerup', 'keydown'];
            const handler = () => {
                events.forEach(type => document.removeEventListener(type, handler, true));
                tryCopy(text).then(onCopied).catch(err => {
                    console.error('Could not copy to clipboard:', err);
                    showToast('Could not copy - copy the message from the console', '#c62828');
                });
            };
            events.forEach(type => document.addEventListener(type, handler, true));
        }

        tryCopy(text).then(onCopied).catch(copyOnNextGesture);
    }

    // Expose for ad-hoc re-runs from the console without re-pasting the snippet.
    window.buildPatchMessage = buildPatchMessage;

    const message = buildPatchMessage();
    console.log(message);
    copyToClipboard(message);
})();
