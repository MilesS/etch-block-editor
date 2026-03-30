import { parseBlocksFromContent } from './block-parser';

/**
 * Sanitize HTML — strip scripts, iframes, event handlers.
 * Used for content from WP REST API and from contentEditable output.
 */
function sanitizeHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, iframe, object, embed, form').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes]) {
            if (attr.name.startsWith('on') || attr.name === 'srcdoc') {
                el.removeAttribute(attr.name);
            }
        }
    });
    return doc.body.innerHTML;
}

// Track all pending edits for the current session
const pendingEdits = new Map();

// Track currently active editing session so we can flush on save
let activeEditSession = null;

/**
 * Main enhancer — observes the Etch iframe for passthrough blocks
 * and replaces them with editable content previews.
 */
export function initPassthroughEnhancer(iframe) {
    const iframeDoc = iframe.contentDocument;
    const config = window.etchCoreBlockEditor || {};
    const { postId, restUrl, nonce } = config;

    if (!postId) {
        console.warn('[etch-core-block-editor] No post_id found');
        return;
    }

    injectIframeStyles(iframeDoc);
    fetchAndEnhance(iframeDoc, postId, restUrl, nonce);

    // Intercept Cmd+S / Ctrl+S to flush edits before Etch saves
    const handleSaveShortcut = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            if (activeEditSession) {
                // Flush the current edit immediately
                const { element, preview, blockData } = activeEditSession;
                exitEditMode(element, preview, blockData, postId, restUrl, nonce);
            }
        }
    };
    document.addEventListener('keydown', handleSaveShortcut, true);
    iframeDoc.addEventListener('keydown', handleSaveShortcut, true);

    // Also flush when Etch's Save button is clicked
    const saveBtn = document.querySelector('button:has(> span)');
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
        if (btn.textContent.trim() === 'Save') {
            btn.addEventListener('mousedown', () => {
                if (activeEditSession) {
                    const { element, preview, blockData } = activeEditSession;
                    exitEditMode(element, preview, blockData, postId, restUrl, nonce);
                }
            }, true);
            break;
        }
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    const passthroughs = node.classList?.contains('etch-passthrough-block')
                        ? [node]
                        : Array.from(node.querySelectorAll?.('.etch-passthrough-block') || []);

                    if (passthroughs.length > 0) {
                        fetchAndEnhance(iframeDoc, postId, restUrl, nonce);
                    }
                }
            }
        }
    });

    observer.observe(iframeDoc.body, { childList: true, subtree: true });
}

async function fetchAndEnhance(iframeDoc, postId, restUrl, nonce) {
    try {
        const restBase = window.etchCoreBlockEditor?.restBase || 'posts';
        const response = await fetch(`${restUrl}wp/v2/${restBase}/${postId}?context=edit`, {
            headers: { 'X-WP-Nonce': nonce }
        });
        const data = response.ok ? await response.json() : null;

        if (!data?.content?.raw) {
            console.warn('[etch-core-block-editor] Could not fetch post content');
            return;
        }

        const rawContent = data.content.raw;
        const parsedBlocks = parseBlocksFromContent(rawContent);

        const passthroughs = Array.from(iframeDoc.querySelectorAll('.etch-passthrough-block'));

        // Group parsed blocks by type
        const blocksByType = {};
        for (const block of parsedBlocks) {
            if (!blocksByType[block.blockName]) {
                blocksByType[block.blockName] = [];
            }
            blocksByType[block.blockName].push(block);
        }

        // Group passthrough elements by block name shown in text
        const passthroughsByType = {};
        for (const el of passthroughs) {
            // Get the original text (before we enhanced it)
            const typeName = el.dataset.etchBlockType || el.textContent.trim();
            if (!passthroughsByType[typeName]) {
                passthroughsByType[typeName] = [];
            }
            passthroughsByType[typeName].push(el);
        }

        for (const [typeName, elements] of Object.entries(passthroughsByType)) {
            const blocks = blocksByType[typeName] || [];

            elements.forEach((el, index) => {
                if (index < blocks.length && !el.dataset.etchEnhanced) {
                    enhanceBlock(el, blocks[index], postId, restUrl, nonce);
                }
            });
        }

    } catch (err) {
        console.error('[etch-core-block-editor] Error enhancing blocks:', err);
    }
}

function enhanceBlock(element, blockData, postId, restUrl, nonce) {
    element.dataset.etchEnhanced = 'true';
    element.dataset.etchBlockType = blockData.blockName;

    // Store the DB version of the markup — this is what we'll match against in save_post
    blockData.dbMarkup = blockData.originalMarkup;

    element.innerHTML = '';

    const preview = document.createElement('div');
    preview.className = 'etch-core-preview';
    preview.innerHTML = sanitizeHTML(blockData.innerHTML);
    element.appendChild(preview);

    const label = document.createElement('span');
    label.className = 'etch-core-label';
    label.textContent = blockData.blockName.replace('core/', '');
    element.appendChild(label);

    element.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        enterEditMode(element, preview, blockData, postId, restUrl, nonce);
    });
}

function enterEditMode(element, preview, blockData, postId, restUrl, nonce) {
    if (element.dataset.etchEditing === 'true') return;

    element.dataset.etchEditing = 'true';
    element.classList.add('etch-core-editing');
    preview.contentEditable = 'true';
    preview.focus();

    // Track active session so save shortcut can flush
    activeEditSession = { element, preview, blockData };

    const stopProp = (e) => {
        if (e.key === 'Escape') {
            exitEditMode(element, preview, blockData, postId, restUrl, nonce);
            return;
        }
        e.stopPropagation();
    };

    preview.addEventListener('keydown', stopProp, true);
    preview.addEventListener('keypress', (e) => e.stopPropagation(), true);
    preview.addEventListener('input', (e) => e.stopPropagation(), true);

    element._editCleanup = () => {
        preview.removeEventListener('keydown', stopProp, true);
    };

    const doc = element.ownerDocument;
    const outsideClick = (e) => {
        if (!element.contains(e.target)) {
            doc.removeEventListener('mousedown', outsideClick, true);
            exitEditMode(element, preview, blockData, postId, restUrl, nonce);
        }
    };
    doc.addEventListener('mousedown', outsideClick, true);
}

async function exitEditMode(element, preview, blockData, postId, restUrl, nonce) {
    if (element.dataset.etchEditing !== 'true') return;

    element.dataset.etchEditing = 'false';
    element.classList.remove('etch-core-editing');
    preview.contentEditable = 'false';
    activeEditSession = null;

    if (element._editCleanup) {
        element._editCleanup();
        delete element._editCleanup;
    }

    const newInnerHTML = sanitizeHTML(preview.innerHTML);

    if (newInnerHTML !== blockData.innerHTML) {
        const newBlockMarkup = reconstructBlockMarkup(blockData, newInnerHTML);

        // Always use dbMarkup as the "original" — that's what's in the database
        // and what save_post will try to str_replace against
        pendingEdits.set(blockData, {
            originalMarkup: blockData.dbMarkup,
            newMarkup: newBlockMarkup,
        });

        // Update innerHTML for display, but keep dbMarkup unchanged
        // (it still represents what's in the DB until save completes)
        blockData.innerHTML = newInnerHTML;

        // Push all pending edits to server transient
        const editsArray = Array.from(pendingEdits.values());
        try {
            const response = await fetch(`${restUrl}etch-core-block-editor/v1/pending-edits/${postId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WP-Nonce': nonce,
                },
                body: JSON.stringify(editsArray),
            });
            if (response.ok) {
                console.log('[etch-core-block-editor] Pending edits saved — will apply on next Etch save');
            }
        } catch (err) {
            console.error('[etch-core-block-editor] Failed to save pending edits:', err);
        }
    }
}

function reconstructBlockMarkup(blockData, newInnerHTML) {
    const { blockName, attrs } = blockData;
    const attrsStr = attrs && Object.keys(attrs).length > 0
        ? ' ' + JSON.stringify(attrs)
        : '';

    return `<!-- wp:${blockName.replace('core/', '')}${attrsStr} -->\n${newInnerHTML}\n<!-- /wp:${blockName.replace('core/', '')} -->`;
}

function injectIframeStyles(iframeDoc) {
    if (iframeDoc.getElementById('etch-core-block-editor-styles')) return;

    const style = iframeDoc.createElement('style');
    style.id = 'etch-core-block-editor-styles';
    style.textContent = `
        /* Override ALL Etch Svelte styles on enhanced passthrough blocks */
        .etch-passthrough-block[data-etch-enhanced="true"] {
            background-image: none !important;
            background: transparent !important;
            height: auto !important;
            min-height: 24px !important;
            display: block !important;
            justify-content: initial !important;
            align-items: initial !important;
            text-transform: none !important;
            letter-spacing: normal !important;
            text-align: left !important;
            font-family: inherit !important;
            font-size: inherit !important;
            padding: 0 !important;
            border: none !important;
            outline: 1px dashed rgba(100, 100, 255, 0.4) !important;
            outline-offset: 0px !important;
            border-radius: 4px !important;
            position: relative !important;
            cursor: default !important;
            transition: outline-color 0.15s ease !important;
            color: inherit !important;
        }

        .etch-passthrough-block[data-etch-enhanced="true"]:hover {
            outline-color: rgba(100, 100, 255, 0.6) !important;
            background: rgba(100, 100, 255, 0.03) !important;
        }

        .etch-passthrough-block[data-etch-enhanced="true"].etch-core-editing {
            outline: 2px solid rgba(100, 100, 255, 0.7) !important;
            background: rgba(255, 255, 255, 1) !important;
            z-index: 10 !important;
        }

        /* Also override when selected by Etch */
        .etch-passthrough-block[data-etch-enhanced="true"][data-etch-selected="true"],
        .etch-passthrough-block[data-etch-enhanced="true"]:focus,
        .etch-passthrough-block[data-etch-enhanced="true"]:focus-visible {
            outline: 2px solid rgba(100, 100, 255, 0.5) !important;
            outline-offset: 0px !important;
            background-image: none !important;
        }

        .etch-core-preview {
            min-height: 1em;
            font-size: 16px;
            line-height: 1.6;
            color: #1a1a1a;
        }

        .etch-core-preview:focus {
            outline: none;
        }

        .etch-core-preview p {
            margin: 0 0 0.5em;
            font-size: 16px;
            line-height: 1.6;
        }

        .etch-core-preview p:last-child {
            margin-bottom: 0;
        }

        .etch-core-preview h1, .etch-core-preview h2, .etch-core-preview h3,
        .etch-core-preview h4, .etch-core-preview h5, .etch-core-preview h6 {
            margin: 0 0 0.3em;
            color: #1a1a1a;
        }

        .etch-core-preview ul, .etch-core-preview ol {
            margin: 0 0 0.5em;
            padding-left: 1.5em;
            font-size: 16px;
        }

        .etch-core-preview blockquote {
            margin: 0 0 0.5em;
            padding-left: 1em;
            border-left: 3px solid rgba(100, 100, 255, 0.3);
            font-style: italic;
        }

        .etch-core-preview img { max-width: 100%; height: auto; }
        .etch-core-preview video { max-width: 100%; height: auto; }

        .etch-core-preview .wp-block-button__link {
            display: inline-block;
            padding: 0.5em 1em;
            background: #333;
            color: #fff;
            text-decoration: none;
            border-radius: 3px;
        }

        .etch-core-label {
            position: absolute;
            top: -10px;
            right: 8px;
            font-size: 9px;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            color: rgba(100, 100, 255, 0.6);
            font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
            pointer-events: none;
            line-height: 1;
            background: white;
            padding: 1px 4px;
            border-radius: 2px;
        }
    `;
    iframeDoc.head.appendChild(style);
}
