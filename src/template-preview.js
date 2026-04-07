/**
 * Template Preview — shows the surrounding template context (header, footer, etc.)
 * when editing a post, and provides an "Edit Template" navigation button.
 *
 * Strategy: load the real frontend page in a background iframe positioned behind
 * the Etch iframe. Make the Etch iframe background transparent so the template
 * shows through. Hide the content area in the background iframe so it doesn't
 * double up with the editable content. This never touches the Etch iframe DOM
 * so all Svelte bindings and editability stay intact.
 */

const STORAGE_KEY = 'etch-core-template-preview';

let templatePermalink = null;
let isPreviewActive = false;
let bgIframe = null;

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
    if (!etchIframe) return;

    // Get the permalink for the template preview
    if (!templatePermalink) {
        const shellInfo = await fetchTemplateShell(postId, restUrl, nonce);
        if (!shellInfo?.permalink) {
            showNotice('No template found for this post');
            return;
        }
        templatePermalink = shellInfo.permalink;
    }

    isPreviewActive = true;
    localStorage.setItem(STORAGE_KEY, 'true');

    createBackgroundIframe(etchIframe, templatePermalink);
    makeEtchIframeTransparent(etchIframe);
    updateToggleButton(true);
}

function disablePreview() {
    const etchIframe = document.getElementById('etch-iframe');

    removeBackgroundIframe();
    if (etchIframe) {
        restoreEtchIframe(etchIframe);
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

// ---- Background Iframe ----

function createBackgroundIframe(etchIframe, permalink) {
    removeBackgroundIframe();

    // Find the container that holds the etch iframe
    const container = etchIframe.parentElement;
    if (!container) return;

    bgIframe = document.createElement('iframe');
    bgIframe.id = 'etch-template-bg-iframe';
    bgIframe.src = permalink;
    bgIframe.style.cssText = [
        'position: absolute',
        'top: 0',
        'left: 0',
        'width: 100%',
        'height: 100%',
        'border: none',
        'pointer-events: none',
        'z-index: 0',
    ].join(';');

    // Ensure the container is positioned
    const containerPos = getComputedStyle(container).position;
    if (containerPos === 'static') {
        container.style.position = 'relative';
        container.setAttribute('data-etch-template-positioned', 'true');
    }

    // Insert before the etch iframe so it's behind
    container.insertBefore(bgIframe, etchIframe);

    // Ensure etch iframe is above
    etchIframe.style.position = 'relative';
    etchIframe.style.zIndex = '1';

    // When bg iframe loads, hide the content area and sync scrolling
    bgIframe.addEventListener('load', () => {
        const bgDoc = bgIframe.contentDocument;
        if (!bgDoc) return;

        // Hide the content marker area so it doesn't double up
        const marker = bgDoc.getElementById('etch-content-marker');
        if (marker) {
            marker.style.visibility = 'hidden';
        }

        // Dim template parts slightly
        const style = bgDoc.createElement('style');
        style.textContent = `
            body { opacity: 0.55; }
            #etch-content-marker { visibility: hidden; }
        `;
        bgDoc.head.appendChild(style);

        // Sync scroll position between etch iframe and bg iframe
        setupScrollSync(etchIframe, bgIframe);
    });
}

function removeBackgroundIframe() {
    if (bgIframe) {
        const container = bgIframe.parentElement;
        bgIframe.remove();
        bgIframe = null;

        // Restore container positioning if we set it
        if (container?.hasAttribute('data-etch-template-positioned')) {
            container.style.position = '';
            container.removeAttribute('data-etch-template-positioned');
        }
    }
}

function makeEtchIframeTransparent(etchIframe) {
    const iframeDoc = etchIframe.contentDocument;
    if (!iframeDoc) return;

    // Make body background transparent so bg iframe shows through
    const style = iframeDoc.createElement('style');
    style.id = 'etch-template-transparent-style';
    style.textContent = `
        html, body {
            background: transparent !important;
        }
    `;
    iframeDoc.head.appendChild(style);
}

function restoreEtchIframe(etchIframe) {
    etchIframe.style.position = '';
    etchIframe.style.zIndex = '';

    const iframeDoc = etchIframe.contentDocument;
    if (iframeDoc) {
        const style = iframeDoc.getElementById('etch-template-transparent-style');
        if (style) style.remove();
    }
}

function setupScrollSync(etchIframe, bgIframe) {
    const etchWin = etchIframe.contentWindow;
    const bgWin = bgIframe.contentWindow;
    if (!etchWin || !bgWin) return;

    etchWin.addEventListener('scroll', () => {
        bgWin.scrollTo(etchWin.scrollX, etchWin.scrollY);
    });
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
