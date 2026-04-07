/**
 * Template Preview — shows the surrounding template context (header, footer, etc.)
 * when editing a post, and provides an "Edit Template" navigation button.
 */

const STORAGE_KEY = 'etch-core-template-preview';

let templateShellCache = null;
let isPreviewActive = false;

export function initTemplatePreview() {
    const config = window.etchCoreBlockEditor || {};
    const { postId, restUrl, nonce, isTemplate } = config;

    if (!postId) return;

    // Don't show template controls when already editing a template
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
    const iframe = document.getElementById('etch-iframe');
    if (!iframe?.contentDocument?.body) return;

    const iframeDoc = iframe.contentDocument;

    if (!templateShellCache) {
        // Step 1: get the preview permalink from our REST endpoint
        const shellInfo = await fetchTemplateShell(postId, restUrl, nonce);
        if (!shellInfo?.permalink) {
            showNotice('No template found for this post');
            return;
        }

        // Step 2: fetch the actual rendered frontend page
        try {
            const pageResponse = await fetch(shellInfo.permalink, {
                credentials: 'same-origin',
            });
            if (!pageResponse.ok) {
                showNotice('Failed to load template preview');
                return;
            }
            const pageHtml = await pageResponse.text();
            templateShellCache = { html: pageHtml, ...shellInfo };
        } catch (err) {
            console.error('[etch-core-block-editor] Failed to fetch template page:', err);
            showNotice('Failed to load template preview');
            return;
        }
    }

    isPreviewActive = true;
    localStorage.setItem(STORAGE_KEY, 'true');

    injectTemplateShell(iframeDoc, templateShellCache);
    updateToggleButton(true);
}

function disablePreview() {
    const iframe = document.getElementById('etch-iframe');
    if (iframe?.contentDocument) {
        removeTemplateShell(iframe.contentDocument);
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

// ---- Template Shell Injection ----

// Store original body children so we can restore on disable
let savedOriginalChildren = null;

function injectTemplateShell(iframeDoc, shell) {
    removeTemplateShell(iframeDoc);
    injectPreviewStyles(iframeDoc);

    // Parse the fetched full page HTML
    const parser = new DOMParser();
    const fetchedDoc = parser.parseFromString(shell.html, 'text/html');

    // Inject all <link rel="stylesheet"> and <style> tags from the fetched page
    const headStyles = fetchedDoc.querySelectorAll('link[rel="stylesheet"], style');
    headStyles.forEach(el => {
        const clone = iframeDoc.importNode(el, true);
        clone.setAttribute('data-etch-template-style', 'true');
        iframeDoc.head.appendChild(clone);
    });

    // Save the original body children (the editable post content)
    savedOriginalChildren = Array.from(iframeDoc.body.childNodes);

    // Find the content marker in the fetched page body
    const marker = fetchedDoc.getElementById('etch-content-marker');
    const fetchedBody = fetchedDoc.body;

    if (marker) {
        // Replace the marker contents with the editable content
        const contentSlot = iframeDoc.createElement('div');
        contentSlot.id = 'etch-template-content-slot';
        for (const child of savedOriginalChildren) {
            contentSlot.appendChild(child);
        }
        marker.replaceWith(contentSlot);
    }

    // Copy body attributes (classes, etc.) from the fetched page
    for (const attr of fetchedBody.attributes) {
        if (attr.name !== 'data-etch-template-body') {
            iframeDoc.body.setAttribute('data-etch-tpl-' + attr.name, attr.value);
        }
    }

    // Move all fetched body children into the iframe body
    // (importNode to cross document boundaries)
    const bodyChildren = Array.from(fetchedBody.childNodes);
    iframeDoc.body.textContent = '';
    for (const child of bodyChildren) {
        iframeDoc.body.appendChild(iframeDoc.importNode(child, true));
    }

    // If we had a content slot, the importNode created a copy — we need to
    // re-insert the real editable content (not the cloned version)
    const importedSlot = iframeDoc.getElementById('etch-template-content-slot');
    if (importedSlot && savedOriginalChildren) {
        importedSlot.textContent = '';
        for (const child of savedOriginalChildren) {
            importedSlot.appendChild(child);
        }
    }

    // Mark template parts as non-interactive
    if (importedSlot) {
        markTemplateParts(iframeDoc.body, 'etch-template-content-slot');
    }
}

/**
 * Mark all elements that are NOT ancestors/descendants of the content slot
 * as template parts (non-interactive).
 */
function markTemplateParts(root, contentSlotId) {
    const contentSlot = root.querySelector('#' + contentSlotId);
    if (!contentSlot) return;

    // Build set of ancestor elements from content slot to root
    const ancestors = new Set();
    let el = contentSlot;
    while (el && el !== root) {
        ancestors.add(el);
        el = el.parentElement;
    }

    // Walk all elements — anything not an ancestor of or inside the content slot is template
    root.querySelectorAll('*').forEach(node => {
        if (node.id === contentSlotId) return;
        if (ancestors.has(node)) return;
        if (contentSlot.contains(node)) return;
        node.setAttribute('data-etch-template-part', 'true');
    });
}

function removeTemplateShell(iframeDoc) {
    const previewStyles = iframeDoc.getElementById('etch-template-preview-styles');
    if (previewStyles) previewStyles.remove();

    // Remove injected template stylesheets from head
    iframeDoc.head.querySelectorAll('[data-etch-template-style]').forEach(el => el.remove());

    // Remove body attribute copies
    for (const attr of [...iframeDoc.body.attributes]) {
        if (attr.name.startsWith('data-etch-tpl-')) {
            iframeDoc.body.removeAttribute(attr.name);
        }
    }

    // Restore original children if we saved them
    if (savedOriginalChildren && iframeDoc.body) {
        const contentSlot = iframeDoc.getElementById('etch-template-content-slot');
        const children = contentSlot
            ? Array.from(contentSlot.childNodes)
            : savedOriginalChildren;

        iframeDoc.body.textContent = '';
        for (const child of children) {
            iframeDoc.body.appendChild(child);
        }
        savedOriginalChildren = null;
    }
}

function injectPreviewStyles(iframeDoc) {
    if (iframeDoc.getElementById('etch-template-preview-styles')) return;

    const style = iframeDoc.createElement('style');
    style.id = 'etch-template-preview-styles';
    style.textContent = `
        /* Template parts are non-interactive and visually dimmed */
        [data-etch-template-part] {
            pointer-events: none !important;
            opacity: 0.55;
            transition: opacity 0.2s ease;
            position: relative;
        }

        [data-etch-template-part]:hover {
            opacity: 0.75;
        }

        [data-etch-template-part] a,
        [data-etch-template-part] button {
            pointer-events: none !important;
            cursor: default !important;
        }

        [data-etch-template-part] img { max-width: 100%; height: auto; }
        [data-etch-template-part] video { max-width: 100%; height: auto; }

        /* Content slot separator */
        #etch-template-content-slot {
            position: relative;
            border-top: 2px dashed rgba(100, 100, 255, 0.25);
            border-bottom: 2px dashed rgba(100, 100, 255, 0.25);
            padding: 4px 0;
        }
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
