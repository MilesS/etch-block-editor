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
        templateShellCache = await fetchTemplateShell(postId, restUrl, nonce);
    }

    if (!templateShellCache?.html) {
        showNotice('No template found for this post');
        return;
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

// Store original children so we can restore them on disable
let savedOriginalChildren = null;

function injectTemplateShell(iframeDoc, shell) {
    removeTemplateShell(iframeDoc);
    injectPreviewStyles(iframeDoc);

    // Inject template stylesheets into iframe head
    if (shell.styles) {
        const styleContainer = iframeDoc.createElement('div');
        // Styles are server-rendered <link> and <style> tags from our PHP endpoint
        styleContainer.innerHTML = shell.styles; // eslint-disable-line no-unsanitized/property
        // Move each child into the head, tagged for cleanup
        while (styleContainer.firstChild) {
            const node = styleContainer.firstChild;
            if (node.nodeType === 1) {
                node.setAttribute('data-etch-template-style', 'true');
            }
            iframeDoc.head.appendChild(node);
        }
    }

    // Save the original body children (the editable post content)
    savedOriginalChildren = Array.from(iframeDoc.body.childNodes);

    // Parse the full template HTML — it contains a marker div where content goes
    const wrapper = iframeDoc.createElement('div');
    wrapper.id = 'etch-template-wrapper';
    // Full template HTML from our own PHP endpoint (do_blocks output)
    wrapper.innerHTML = shell.html; // eslint-disable-line no-unsanitized/property

    // Find the marker element
    const markerId = shell.markerId || 'etch-template-content-marker';
    const marker = wrapper.querySelector('#' + markerId);

    if (marker) {
        // Move the original editable content into the marker's position
        const contentContainer = iframeDoc.createElement('div');
        contentContainer.id = 'etch-template-content-slot';
        for (const child of savedOriginalChildren) {
            contentContainer.appendChild(child);
        }
        marker.replaceWith(contentContainer);
    }

    // Mark template portions as non-interactive
    wrapper.querySelectorAll(':scope > *').forEach(el => {
        if (el.id !== 'etch-template-content-slot') {
            // Walk up to find direct children that aren't the content slot
            el.setAttribute('data-etch-template-part', 'true');
        }
    });

    // Also mark nested template parts (everything not inside the content slot)
    markTemplateParts(wrapper, 'etch-template-content-slot');

    // Replace body contents with the wrapped template
    iframeDoc.body.textContent = '';
    while (wrapper.firstChild) {
        iframeDoc.body.appendChild(wrapper.firstChild);
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

    // Restore original children if we saved them
    if (savedOriginalChildren && iframeDoc.body) {
        const contentSlot = iframeDoc.getElementById('etch-template-content-slot');
        if (contentSlot) {
            // Pull children out of the content slot back to body root
            const children = Array.from(contentSlot.childNodes);
            iframeDoc.body.textContent = '';
            for (const child of children) {
                iframeDoc.body.appendChild(child);
            }
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
