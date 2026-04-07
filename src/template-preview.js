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

/**
 * Strategy: NEVER move the original editable content nodes — Etch's Svelte
 * bindings and event listeners are attached to them and break if moved.
 *
 * Instead we:
 * 1. Parse the fetched frontend page
 * 2. Find the #etch-content-marker
 * 3. Walk up from the marker to <body> to get the wrapper chain (e.g. body > main#main > div.entry-content > marker)
 * 4. For each level in that chain, collect sibling nodes that come before/after the relevant child
 * 5. In the iframe: recreate the wrapper chain around the existing content, inject siblings at each level
 *
 * Result: original editable nodes stay in place, but get wrapped in the correct
 * template DOM structure with header/footer/sidebar as siblings.
 */

function injectTemplateShell(iframeDoc, shell) {
    removeTemplateShell(iframeDoc);
    injectPreviewStyles(iframeDoc);

    // Parse the fetched full page HTML
    const parser = new DOMParser();
    const fetchedDoc = parser.parseFromString(shell.html, 'text/html');

    // Inject all stylesheets from the fetched page
    const headStyles = fetchedDoc.querySelectorAll('link[rel="stylesheet"], style');
    headStyles.forEach(el => {
        const clone = iframeDoc.importNode(el, true);
        clone.setAttribute('data-etch-template-style', 'true');
        iframeDoc.head.appendChild(clone);
    });

    // Find the content marker
    const marker = fetchedDoc.getElementById('etch-content-marker');
    if (!marker) {
        console.warn('[etch-core-block-editor] No content marker found in template page');
        return;
    }

    // Build the wrapper chain from marker up to body
    // Each entry: { element, beforeSiblings[], afterSiblings[] }
    const wrapperChain = [];
    let current = marker;
    while (current.parentElement && current.parentElement !== fetchedDoc.body) {
        const parent = current.parentElement;
        const before = [];
        const after = [];
        let foundCurrent = false;

        for (const sibling of parent.childNodes) {
            if (sibling === current) {
                foundCurrent = true;
                continue;
            }
            if (!foundCurrent) {
                before.push(sibling);
            } else {
                after.push(sibling);
            }
        }

        wrapperChain.push({
            tag: parent.tagName.toLowerCase(),
            attrs: Array.from(parent.attributes),
            before,
            after,
        });

        current = parent;
    }

    // Collect body-level siblings (before/after the outermost wrapper ancestor)
    const bodyBefore = [];
    const bodyAfter = [];
    if (current !== fetchedDoc.body) {
        let foundCurrent = false;
        for (const sibling of fetchedDoc.body.childNodes) {
            if (sibling === current) {
                foundCurrent = true;
                continue;
            }
            if (!foundCurrent) {
                bodyBefore.push(sibling);
            } else {
                bodyAfter.push(sibling);
            }
        }
    }

    // Now build the structure in the iframe body.
    // Collect existing editable children (keep references — don't clone)
    const editableChildren = Array.from(iframeDoc.body.childNodes);

    // Clear the body
    while (iframeDoc.body.firstChild) {
        iframeDoc.body.removeChild(iframeDoc.body.firstChild);
    }

    // Inject body-level "before" siblings (e.g. header)
    for (const node of bodyBefore) {
        const imported = iframeDoc.importNode(node, true);
        imported.setAttribute?.('data-etch-template-part', 'true');
        iframeDoc.body.appendChild(imported);
    }

    // Build the wrapper chain from outermost to innermost
    // wrapperChain is ordered inner-to-outer, so reverse it
    let innermost = null;
    let outermost = null;

    for (let i = wrapperChain.length - 1; i >= 0; i--) {
        const level = wrapperChain[i];
        const wrapper = iframeDoc.createElement(level.tag);

        // Copy attributes (id, class, style, data-* etc.)
        for (const attr of level.attrs) {
            wrapper.setAttribute(attr.name, attr.value);
        }
        wrapper.setAttribute('data-etch-template-wrapper', 'true');

        // Inject "before" siblings at this level
        for (const node of level.before) {
            const imported = iframeDoc.importNode(node, true);
            imported.setAttribute?.('data-etch-template-part', 'true');
            wrapper.appendChild(imported);
        }

        // Create a slot for the next level (or the content)
        const slot = iframeDoc.createElement('div');
        slot.id = 'etch-template-content-slot';
        slot.setAttribute('data-etch-template-slot', 'true');
        wrapper.appendChild(slot);

        // Inject "after" siblings at this level
        for (const node of level.after) {
            const imported = iframeDoc.importNode(node, true);
            imported.setAttribute?.('data-etch-template-part', 'true');
            wrapper.appendChild(imported);
        }

        if (!outermost) {
            outermost = wrapper;
        }
        if (innermost) {
            // Replace the slot in the previous (outer) wrapper with this wrapper
            const prevSlot = innermost.querySelector('#etch-template-content-slot');
            if (prevSlot) {
                prevSlot.replaceWith(wrapper);
            }
        }
        innermost = wrapper;
    }

    // Find the innermost slot and put the editable content there
    if (innermost) {
        const finalSlot = innermost.querySelector('#etch-template-content-slot');
        if (finalSlot) {
            // Move (not clone!) original editable children into the slot
            for (const child of editableChildren) {
                finalSlot.appendChild(child);
            }
        }
        iframeDoc.body.appendChild(outermost);
    } else {
        // No wrapper chain — just put content back
        for (const child of editableChildren) {
            iframeDoc.body.appendChild(child);
        }
    }

    // Inject body-level "after" siblings (e.g. footer)
    for (const node of bodyAfter) {
        const imported = iframeDoc.importNode(node, true);
        imported.setAttribute?.('data-etch-template-part', 'true');
        iframeDoc.body.appendChild(imported);
    }
}

function removeTemplateShell(iframeDoc) {
    const previewStyles = iframeDoc.getElementById('etch-template-preview-styles');
    if (previewStyles) previewStyles.remove();

    // Remove injected template stylesheets from head
    iframeDoc.head.querySelectorAll('[data-etch-template-style]').forEach(el => el.remove());

    // Pull editable content out of the slot and restore to body root
    const slot = iframeDoc.getElementById('etch-template-content-slot');
    if (slot) {
        const children = Array.from(slot.childNodes);

        // Remove all template injected content
        while (iframeDoc.body.firstChild) {
            iframeDoc.body.removeChild(iframeDoc.body.firstChild);
        }

        // Restore the editable children directly to body
        for (const child of children) {
            iframeDoc.body.appendChild(child);
        }
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
