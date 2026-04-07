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

    if (!templateShellCache?.before && !templateShellCache?.after) {
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

function injectTemplateShell(iframeDoc, shell) {
    removeTemplateShell(iframeDoc);
    injectPreviewStyles(iframeDoc);

    if (shell.before) {
        const beforeEl = iframeDoc.createElement('div');
        beforeEl.id = 'etch-template-before';
        beforeEl.className = 'etch-template-shell';
        // Content is server-rendered template HTML from our own endpoint (do_blocks output)
        beforeEl.innerHTML = shell.before; // eslint-disable-line no-unsanitized/property
        iframeDoc.body.insertBefore(beforeEl, iframeDoc.body.firstChild);
    }

    if (shell.after) {
        const afterEl = iframeDoc.createElement('div');
        afterEl.id = 'etch-template-after';
        afterEl.className = 'etch-template-shell';
        // Content is server-rendered template HTML from our own endpoint (do_blocks output)
        afterEl.innerHTML = shell.after; // eslint-disable-line no-unsanitized/property
        iframeDoc.body.appendChild(afterEl);
    }
}

function removeTemplateShell(iframeDoc) {
    const before = iframeDoc.getElementById('etch-template-before');
    const after = iframeDoc.getElementById('etch-template-after');
    const styles = iframeDoc.getElementById('etch-template-preview-styles');

    if (before) before.remove();
    if (after) after.remove();
    if (styles) styles.remove();
}

function injectPreviewStyles(iframeDoc) {
    if (iframeDoc.getElementById('etch-template-preview-styles')) return;

    const style = iframeDoc.createElement('style');
    style.id = 'etch-template-preview-styles';
    style.textContent = `
        .etch-template-shell {
            pointer-events: none;
            opacity: 0.6;
            position: relative;
            transition: opacity 0.2s ease;
        }

        .etch-template-shell:hover {
            opacity: 0.8;
        }

        .etch-template-shell::after {
            content: 'TEMPLATE';
            position: absolute;
            top: 8px;
            right: 8px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: rgba(100, 100, 255, 0.6);
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: rgba(255, 255, 255, 0.9);
            padding: 2px 6px;
            border-radius: 3px;
            pointer-events: none;
            z-index: 10;
        }

        #etch-template-before {
            border-bottom: 2px dashed rgba(100, 100, 255, 0.3);
            padding-bottom: 4px;
            margin-bottom: 4px;
        }

        #etch-template-after {
            border-top: 2px dashed rgba(100, 100, 255, 0.3);
            padding-top: 4px;
            margin-top: 4px;
        }

        .etch-template-shell a,
        .etch-template-shell button {
            pointer-events: none !important;
        }

        .etch-template-shell img { max-width: 100%; height: auto; }
        .etch-template-shell video { max-width: 100%; height: auto; }
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
