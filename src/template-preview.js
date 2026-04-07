/**
 * Template Preview — shows the surrounding template context (header, footer, etc.)
 * when editing a post, and provides an "Edit Template" navigation button.
 *
 * Strategy: fetch the real rendered frontend page HTML, parse it, swap the
 * content marker with the live editable nodes (move, not clone — preserves
 * all event listeners and Svelte bindings), and replace the iframe body.
 *
 * On disable: pull editable nodes back out to body root and remove template.
 */

const STORAGE_KEY = 'etch-core-template-preview';

let templateHtmlCache = null;
let isPreviewActive = false;

export function initTemplatePreview() {
    const config = window.etchCoreBlockEditor || {};
    const { postId, restUrl, nonce, isTemplate } = config;

    if (!postId) return;
    if (isTemplate) return;

    waitForEtchControls().then(() => {
        addTemplateButtons(postId, restUrl, nonce);
    });
}

function waitForEtchControls(timeout = 15000) {
    return new Promise((resolve, reject) => {
        if (window.etchControls?.builder?.settingsBar?.top?.addAfter) {
            return resolve();
        }
        const start = Date.now();
        const check = setInterval(() => {
            if (window.etchControls?.builder?.settingsBar?.top?.addAfter) {
                clearInterval(check);
                resolve();
            } else if (Date.now() - start > timeout) {
                clearInterval(check);
                reject(new Error('etchControls not available'));
            }
        }, 200);
    });
}

function addTemplateButtons(postId, restUrl, nonce) {
    addEditTemplateButton(postId, restUrl, nonce);
    addTemplateToggle(postId, restUrl, nonce);
}

// ---- Edit Template Button ----

async function addEditTemplateButton(postId, restUrl, nonce) {
    const templateInfo = await fetchTemplateInfo(postId, restUrl, nonce);
    if (!templateInfo?.templateId) return;

    window.etchControls.builder.settingsBar.top.addAfter({
        icon: 'ph:file-arrow-up-duotone',
        tooltip: `Edit Template: ${templateInfo.templateTitle || templateInfo.templateSlug}`,
        id: 'etch-core-edit-template',
        callback: () => {
            window.location.href = templateInfo.editUrl;
        },
    });
}

// ---- Template Preview Toggle ----

function addTemplateToggle(postId, restUrl, nonce) {
    const savedState = localStorage.getItem(STORAGE_KEY) === 'true';

    window.etchControls.builder.settingsBar.top.addAfter({
        icon: 'ph:layout-duotone',
        tooltip: 'Toggle Template Preview',
        id: 'etch-core-template-toggle',
        callback: () => {
            if (isPreviewActive) {
                disablePreview();
            } else {
                enablePreview(postId, restUrl, nonce);
            }
        },
    });

    if (savedState) {
        waitForIframe().then(() => {
            enablePreview(postId, restUrl, nonce);
        });
    }
}

async function enablePreview(postId, restUrl, nonce) {
    const etchIframe = document.getElementById('etch-iframe');
    if (!etchIframe?.contentDocument?.body) return;

    if (!templateHtmlCache) {
        const shellInfo = await fetchTemplateShell(postId, restUrl, nonce);
        if (!shellInfo?.permalink) {
            showNotice('No template found for this post');
            return;
        }

        try {
            const resp = await fetch(shellInfo.permalink, { credentials: 'same-origin' });
            if (!resp.ok) { showNotice('Failed to load template preview'); return; }
            templateHtmlCache = await resp.text();
        } catch (err) {
            console.error('[etch-core-block-editor] Failed to fetch template page:', err);
            showNotice('Failed to load template preview');
            return;
        }
    }

    isPreviewActive = true;
    localStorage.setItem(STORAGE_KEY, 'true');

    injectTemplate(etchIframe.contentDocument);
    updateToggleButton(true);
}

function disablePreview() {
    const etchIframe = document.getElementById('etch-iframe');
    if (etchIframe?.contentDocument) {
        removeTemplate(etchIframe.contentDocument);
    }

    isPreviewActive = false;
    localStorage.setItem(STORAGE_KEY, 'false');
    updateToggleButton(false);
}

function updateToggleButton(active) {
    const btn = document.getElementById('etch-core-template-toggle');
    if (btn) {
        btn.style.opacity = active ? '1' : '0.5';
    }
}

// ---- Template Injection ----

function injectTemplate(iframeDoc) {
    removeTemplate(iframeDoc);

    // Grab references to the live editable nodes BEFORE detaching
    const editableNodes = Array.from(iframeDoc.body.childNodes);

    // Parse the fetched page
    const parser = new DOMParser();
    const fetchedDoc = parser.parseFromString(templateHtmlCache, 'text/html');

    // Inject stylesheets from fetched page into iframe head
    fetchedDoc.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
        const clone = iframeDoc.importNode(el, true);
        clone.setAttribute('data-etch-template-style', 'true');
        iframeDoc.head.appendChild(clone);
    });

    // Import the fetched body content into the iframe's document
    // (importNode with deep=true to bring all template nodes across)
    const importedBody = iframeDoc.importNode(fetchedDoc.body, true);

    // Find the content marker in the imported tree
    const marker = importedBody.querySelector('#etch-content-marker');

    // Clear the iframe body
    while (iframeDoc.body.firstChild) {
        // Detach but keep references in editableNodes
        iframeDoc.body.removeChild(iframeDoc.body.firstChild);
    }

    // Copy body classes from fetched page
    if (fetchedDoc.body.className) {
        iframeDoc.body.setAttribute('data-etch-template-body-class', iframeDoc.body.className);
        iframeDoc.body.className = fetchedDoc.body.className;
    }

    // Move all imported children into the iframe body
    while (importedBody.firstChild) {
        iframeDoc.body.appendChild(importedBody.firstChild);
    }

    // Now find the marker in the live iframe body and replace with editable nodes
    const liveMarker = iframeDoc.getElementById('etch-content-marker');
    if (liveMarker) {
        // Insert each editable node before the marker (this MOVES them, preserving bindings)
        for (const node of editableNodes) {
            liveMarker.parentNode.insertBefore(node, liveMarker);
        }
        // Remove the marker itself
        liveMarker.remove();
    }

    // Mark template parts (everything except editable nodes and their ancestors)
    const editableSet = new Set(editableNodes.filter(n => n.nodeType === 1));
    iframeDoc.body.querySelectorAll('*').forEach(el => {
        // Skip if it's one of the editable nodes or inside one
        for (const editable of editableSet) {
            if (el === editable || editable.contains(el)) return;
        }
        // Skip ancestors of editable nodes
        for (const editable of editableSet) {
            if (el.contains(editable)) return;
        }
        el.setAttribute('data-etch-template-part', 'true');
    });

    // Inject our preview styles
    injectPreviewStyles(iframeDoc);
}

function removeTemplate(iframeDoc) {
    // Remove preview styles
    const previewStyles = iframeDoc.getElementById('etch-template-preview-styles');
    if (previewStyles) previewStyles.remove();

    // Remove injected stylesheets
    iframeDoc.head.querySelectorAll('[data-etch-template-style]').forEach(el => el.remove());

    // Find editable nodes (everything NOT marked as template part, direct or nested)
    const allNodes = Array.from(iframeDoc.body.childNodes);
    const editableNodes = [];

    function collectEditableNodes(parent) {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeType !== 1) {
                // Text/comment nodes at body level — skip template whitespace
                if (node.parentElement === iframeDoc.body && node.nodeType === 3 && !node.textContent.trim()) {
                    continue;
                }
                if (!node.parentElement?.hasAttribute('data-etch-template-part')) {
                    editableNodes.push(node);
                }
                continue;
            }
            if (!node.hasAttribute('data-etch-template-part')) {
                editableNodes.push(node);
            } else if (node.querySelector(':not([data-etch-template-part])')) {
                // This template part contains editable descendants — recurse
                collectEditableNodes(node);
            }
        }
    }

    collectEditableNodes(iframeDoc.body);

    // If no editable nodes found, don't wipe the body
    if (editableNodes.length === 0) return;

    // Restore original body class
    const savedClass = iframeDoc.body.getAttribute('data-etch-template-body-class');
    if (savedClass !== null) {
        iframeDoc.body.className = savedClass;
        iframeDoc.body.removeAttribute('data-etch-template-body-class');
    }

    // Clear body and restore only editable nodes
    while (iframeDoc.body.firstChild) {
        iframeDoc.body.removeChild(iframeDoc.body.firstChild);
    }
    for (const node of editableNodes) {
        iframeDoc.body.appendChild(node);
    }
}

function injectPreviewStyles(iframeDoc) {
    if (iframeDoc.getElementById('etch-template-preview-styles')) return;

    const style = iframeDoc.createElement('style');
    style.id = 'etch-template-preview-styles';
    style.textContent = `
        [data-etch-template-part] {
            pointer-events: none !important;
        }

        [data-etch-template-part] a,
        [data-etch-template-part] button {
            pointer-events: none !important;
            cursor: default !important;
        }

        [data-etch-template-part] img { max-width: 100%; height: auto; }
        [data-etch-template-part] video { max-width: 100%; height: auto; }
    `;
    iframeDoc.head.appendChild(style);
}

// ---- API Calls ----

async function fetchTemplateInfo(postId, restUrl, nonce) {
    try {
        const response = await fetch(
            `${restUrl}etch-core-block-editor/v1/post-template/${postId}`,
            { headers: { 'X-WP-Nonce': nonce } }
        );
        return response.ok ? await response.json() : null;
    } catch (err) {
        console.error('[etch-core-block-editor] Failed to fetch template info:', err);
        return null;
    }
}

async function fetchTemplateShell(postId, restUrl, nonce) {
    try {
        const response = await fetch(
            `${restUrl}etch-core-block-editor/v1/template-shell/${postId}`,
            { headers: { 'X-WP-Nonce': nonce } }
        );
        return response.ok ? await response.json() : null;
    } catch (err) {
        console.error('[etch-core-block-editor] Failed to fetch template shell:', err);
        return null;
    }
}

// ---- Helpers ----

function waitForIframe(timeout = 30000) {
    return new Promise((resolve, reject) => {
        const iframe = document.getElementById('etch-iframe');
        if (iframe?.contentDocument?.body) return resolve(iframe);

        const observer = new MutationObserver(() => {
            const iframe = document.getElementById('etch-iframe');
            if (iframe?.contentDocument?.body) {
                observer.disconnect();
                resolve(iframe);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            const iframe = document.getElementById('etch-iframe');
            if (iframe?.contentDocument?.body) {
                resolve(iframe);
            } else {
                reject(new Error('Timeout waiting for etch-iframe'));
            }
        }, timeout);
    });
}

function showNotice(message) {
    const existing = document.getElementById('etch-core-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'etch-core-toast';
    toast.textContent = message;
    toast.style.cssText = [
        'position: fixed',
        'bottom: 60px',
        'left: 50%',
        'transform: translateX(-50%)',
        'background: var(--e-background-color, #1e1e2e)',
        'color: var(--e-foreground-color, #e0e0e0)',
        'border: 1px solid var(--e-border-color, rgba(255,255,255,0.1))',
        'padding: 10px 20px',
        'border-radius: 6px',
        'font-family: var(--e-font-interface, -apple-system, sans-serif)',
        'font-size: 13px',
        'z-index: 99999',
        'box-shadow: 0 4px 12px rgba(0,0,0,0.3)',
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
