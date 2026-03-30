/**
 * Block Converter — converts etch/element blocks to core Gutenberg blocks.
 * Two modes:
 *   - Convert Selected: converts the currently selected etch/element
 *   - Convert All: converts ALL leaf etch/element p/h1-h6 blocks on the page
 */

const CONVERTIBLE_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'ul', 'ol'];

// Tags that are structural containers — never convert these
const CONTAINER_TAGS = ['section', 'div', 'main', 'header', 'footer', 'nav', 'article', 'aside', 'span'];

// Generators receive raw innerHTML (already escaped/built), not plain text
const TAG_TO_CORE_BLOCK = {
    'p': (html) => `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`,
    'h1': (html) => `<!-- wp:heading {"level":1} -->\n<h1 class="wp-block-heading">${html}</h1>\n<!-- /wp:heading -->`,
    'h2': (html) => `<!-- wp:heading -->\n<h2 class="wp-block-heading">${html}</h2>\n<!-- /wp:heading -->`,
    'h3': (html) => `<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">${html}</h3>\n<!-- /wp:heading -->`,
    'h4': (html) => `<!-- wp:heading {"level":4} -->\n<h4 class="wp-block-heading">${html}</h4>\n<!-- /wp:heading -->`,
    'h5': (html) => `<!-- wp:heading {"level":5} -->\n<h5 class="wp-block-heading">${html}</h5>\n<!-- /wp:heading -->`,
    'h6': (html) => `<!-- wp:heading {"level":6} -->\n<h6 class="wp-block-heading">${html}</h6>\n<!-- /wp:heading -->`,
    'img': null, // handled specially via buildImageBlock
    'ul': null,  // handled specially via buildListBlock
    'ol': null,  // handled specially via buildListBlock
};

function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a core/image block from etch/element img attributes.
 * Custom classes go on <figure>, not <img> (Gutenberg validates this).
 */
function buildImageBlock(attrs) {
    const src = attrs.src || '';
    const alt = attrs.alt || '';
    const cls = attrs.class || '';

    // img tag — only src and alt (Gutenberg is strict about img attributes)
    const imgAttrs = ['src="' + escapeAttr(src) + '"', 'alt="' + escapeAttr(alt) + '"'];

    // figure classes — wp-block-image is required, add custom class if present
    const figureClasses = ['wp-block-image'];
    if (cls) figureClasses.push(escapeAttr(cls));

    return `<!-- wp:image -->\n<figure class="${figureClasses.join(' ')}"><img ${imgAttrs.join(' ')}/></figure>\n<!-- /wp:image -->`;
}

/**
 * Build a core/list block from etch/element ul/ol with li children.
 * Works from gutBlock data (getSelectedGutenbergBlock) or from parsed content.
 */
function buildListBlock(tag, listItems) {
    const ordered = tag === 'ol';
    const listTag = ordered ? 'ol' : 'ul';
    const attrsStr = ordered ? ' {"ordered":true}' : '';

    // listItems are already HTML (may contain links etc.)
    const items = listItems.map(html =>
        `<!-- wp:list-item -->\n<li>${html}</li>\n<!-- /wp:list-item -->`
    ).join('\n');

    return `<!-- wp:list${attrsStr} -->\n<${listTag} class="wp-block-list">${items}</${listTag}>\n<!-- /wp:list -->`;
}

/**
 * Extract list item HTML from a gutBlock's innerBlocks (li > etch/text + nested elements).
 */
function getListItemsFromGutBlock(gutBlock) {
    const items = [];
    if (gutBlock.innerBlocks) {
        for (const li of gutBlock.innerBlocks) {
            if (li.blockName === 'etch/element' && li.attrs?.tag?.toLowerCase() === 'li') {
                items.push(buildInnerHTML(li));
            }
        }
    }
    return items;
}

/**
 * Reconstruct innerHTML from raw etch block markup in post_content.
 * Parses etch/text content values and nested etch/element tags to build HTML.
 *
 * Input: <!-- wp:etch/element {"tag":"p"} -->
 *          <!-- wp:etch/text {"content":"Hello "} /-->
 *          <!-- wp:etch/element {"tag":"a","attributes":{"href":"#"}} -->
 *            <!-- wp:etch/text {"content":"link"} /-->
 *          <!-- /wp:etch/element -->
 *        <!-- /wp:etch/element -->
 *
 * Output: "Hello <a href="#">link</a>"
 */
function buildInnerHTMLFromMarkup(blockMarkup) {
    // Extract the inner portion (between the outer open and close tags)
    const firstClose = blockMarkup.indexOf('-->');
    if (firstClose === -1) return '';
    const inner = blockMarkup.substring(firstClose + 3);

    let html = '';
    let pos = 0;

    while (pos < inner.length) {
        // Find next block comment
        const nextComment = inner.indexOf('<!--', pos);
        if (nextComment === -1) break;

        const commentEnd = inner.indexOf('-->', nextComment);
        if (commentEnd === -1) break;
        const comment = inner.substring(nextComment, commentEnd + 3);

        // etch/text — extract content
        if (comment.includes('wp:etch/text')) {
            const contentMatch = comment.match(/"content"\s*:\s*"([^"]*?)"/);
            if (contentMatch) {
                html += escapeHtml(contentMatch[1]);
            }
            pos = commentEnd + 3;
            continue;
        }

        // Nested etch/element open — extract tag and attributes, recurse
        if (comment.includes('wp:etch/element {') && !comment.includes('/wp:etch/element') && !comment.trimEnd().endsWith('/-->')) {
            const tagMatch = comment.match(/"tag"\s*:\s*"([^"]+)"/);
            const nestedTag = tagMatch ? tagMatch[1].toLowerCase() : 'span';

            // Extract attributes
            let attrStr = '';
            const attrsMatch = comment.match(/"attributes"\s*:\s*\{([^}]*)\}/);
            if (attrsMatch) {
                const pairs = attrsMatch[1].matchAll(/"([^"]+)"\s*:\s*"([^"]*?)"/g);
                for (const p of pairs) {
                    attrStr += ' ' + escapeAttr(p[1]) + '="' + escapeAttr(p[2]) + '"';
                }
            }

            // Find the matching close for this nested element
            const nestedStart = commentEnd + 3;
            const nestedCloseTag = '<!-- /wp:etch/element -->';
            const nestedCloseIdx = inner.indexOf(nestedCloseTag, nestedStart);
            if (nestedCloseIdx === -1) break;

            // Get the nested content and recurse
            const nestedBlock = inner.substring(nextComment, nestedCloseIdx + nestedCloseTag.length);
            const childHTML = buildInnerHTMLFromMarkup(nestedBlock);

            const selfClosingTags = ['img', 'br', 'hr', 'input'];
            if (selfClosingTags.includes(nestedTag)) {
                html += '<' + nestedTag + attrStr + '/>';
            } else {
                html += '<' + nestedTag + attrStr + '>' + childHTML + '</' + nestedTag + '>';
            }

            pos = nestedCloseIdx + nestedCloseTag.length;
            continue;
        }

        // Close tag or unrecognized — skip
        pos = commentEnd + 3;
    }

    return html;
}

/**
 * Extract list item HTML from raw block markup in post_content.
 * Finds each li etch/element and builds its innerHTML.
 */
function getListItemsFromMarkup(blockMarkup) {
    const items = [];
    const openPrefix = '<!-- wp:etch/element ';
    const closeTag = '<!-- /wp:etch/element -->';

    let pos = 0;
    while (true) {
        const openIdx = blockMarkup.indexOf(openPrefix, pos);
        if (openIdx === -1) break;

        const openLineEnd = blockMarkup.indexOf('-->', openIdx);
        if (openLineEnd === -1) break;
        const openLine = blockMarkup.substring(openIdx, openLineEnd + 3);

        if (openLine.trimEnd().endsWith('/-->')) {
            pos = openIdx + openLine.length;
            continue;
        }

        const tagMatch = openLine.match(/"tag"\s*:\s*"([^"]+)"/);
        if (tagMatch && tagMatch[1].toLowerCase() === 'li') {
            const afterOpen = openIdx + openLine.length;
            const liCloseIdx = blockMarkup.indexOf(closeTag, afterOpen);
            if (liCloseIdx !== -1) {
                const liBlock = blockMarkup.substring(openIdx, liCloseIdx + closeTag.length);
                items.push(buildInnerHTMLFromMarkup(liBlock));
                pos = liCloseIdx + closeTag.length;
                continue;
            }
        }

        pos = openLineEnd + 3;
    }

    return items;
}

export function initBlockConverter() {
    const config = window.etchCoreBlockEditor || {};
    const { postId, restUrl, nonce } = config;

    if (!postId) return;

    waitForEtchControls().then(() => {
        addConverterButton(postId, restUrl, nonce);
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

function addConverterButton(postId, restUrl, nonce) {
    let dropdownVisible = false;
    let dropdownEl = null;

    window.etchControls.builder.settingsBar.top.addAfter({
        icon: 'ph:swap-duotone',
        tooltip: 'Convert to Core Block',
        id: 'etch-core-block-converter',
        callback: () => {
            if (dropdownVisible) {
                hideDropdown();
            } else {
                showDropdown(postId, restUrl, nonce);
            }
        },
    });

    function showDropdown(postId, restUrl, nonce) {
        if (dropdownEl) dropdownEl.remove();

        dropdownEl = document.createElement('div');
        dropdownEl.id = 'etch-core-converter-dropdown';
        dropdownEl.style.cssText = [
            'position: fixed',
            'top: 50px',
            'left: 10px',
            'background: var(--e-background-color, #1e1e2e)',
            'border: 1px solid var(--e-border-color, rgba(255,255,255,0.1))',
            'border-radius: 8px',
            'padding: 6px',
            'z-index: 99999',
            'min-width: 220px',
            'box-shadow: 0 8px 24px rgba(0,0,0,0.3)',
            'font-family: var(--e-font-interface, -apple-system, BlinkMacSystemFont, sans-serif)',
            'font-size: 13px',
        ].join(';');

        const title = document.createElement('div');
        title.textContent = 'Convert to Core Block';
        title.style.cssText = [
            'padding: 6px 10px',
            'font-size: 11px',
            'text-transform: uppercase',
            'letter-spacing: 0.5px',
            'color: var(--e-foreground-color-muted, rgba(255,255,255,0.4))',
        ].join(';');
        dropdownEl.appendChild(title);

        // Convert Selected option
        addDropdownItem(dropdownEl, 'Convert Selected', () => {
            hideDropdown();
            showConfirmDialog('Convert the selected block to a core block? Make sure you have saved any changes first.', () => {
                convertSelectedBlock(postId, restUrl, nonce);
            });
        });

        // Divider
        const divider = document.createElement('div');
        divider.style.cssText = 'height: 1px; background: var(--e-border-color, rgba(255,255,255,0.1)); margin: 4px 6px;';
        dropdownEl.appendChild(divider);

        // Convert All option
        addDropdownItem(dropdownEl, 'Convert All', () => {
            hideDropdown();
            showConfirmDialog('Convert ALL etch paragraphs and headings to core blocks? Save your work first — this reads from the last saved version.', () => {
                convertAllBlocks(postId, restUrl, nonce);
            });
        });

        document.body.appendChild(dropdownEl);
        dropdownVisible = true;

        setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick);
        }, 0);
    }

    function addDropdownItem(parent, label, onClick) {
        const item = document.createElement('button');
        item.textContent = label;
        item.style.cssText = [
            'display: block',
            'width: 100%',
            'padding: 8px 10px',
            'background: none',
            'border: none',
            'color: var(--e-foreground-color, #e0e0e0)',
            'text-align: left',
            'cursor: pointer',
            'border-radius: 4px',
            'font-size: 13px',
            'font-family: inherit',
        ].join(';');
        item.addEventListener('mouseenter', () => {
            item.style.background = 'var(--e-background-color-hover, rgba(255,255,255,0.08))';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = 'none';
        });
        item.addEventListener('click', onClick);
        parent.appendChild(item);
    }

    function hideDropdown() {
        if (dropdownEl) {
            dropdownEl.remove();
            dropdownEl = null;
        }
        dropdownVisible = false;
        document.removeEventListener('mousedown', onOutsideClick);
    }

    function onOutsideClick(e) {
        if (dropdownEl && !dropdownEl.contains(e.target)) {
            hideDropdown();
        }
    }
}

// ---- Fetch helper ----

async function fetchPostContent(restUrl, nonce, postId) {
    const restBase = window.etchCoreBlockEditor?.restBase || 'posts';
    try {
        const response = await fetch(restUrl + 'wp/v2/' + restBase + '/' + postId + '?context=edit', {
            headers: { 'X-WP-Nonce': nonce }
        });
        if (response.ok) {
            const data = await response.json();
            return { content: data.content?.raw, restBase };
        }
    } catch (e) {
        // fall through
    }
    return { content: null, restBase };
}

async function saveAndReload(restUrl, nonce, postId, restBase, newContent) {
    const saveResp = await fetch(restUrl + 'wp/v2/' + restBase + '/' + postId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': nonce,
        },
        body: JSON.stringify({ content: newContent }),
    });

    if (saveResp.ok) {
        window.location.reload();
    } else {
        showNotice('Failed to save');
    }
}

// ---- Convert Selected ----

async function convertSelectedBlock(postId, restUrl, nonce) {
    const gutBlock = window.etchControls?.builder?.getSelectedGutenbergBlock?.();

    if (!gutBlock) {
        showNotice('No block selected');
        return;
    }

    if (gutBlock.blockName !== 'etch/element') {
        showNotice('Select an etch element (p, h2, h3...) to convert');
        return;
    }

    const tag = gutBlock.attrs?.tag?.toLowerCase();

    if (!CONVERTIBLE_TAGS.includes(tag)) {
        showNotice('Cannot convert <' + tag + '> — only p, h1-h6, img, ul, ol supported');
        return;
    }

    let coreBlockMarkup;
    let textContent;
    if (tag === 'img') {
        coreBlockMarkup = buildImageBlock(gutBlock.attrs?.attributes || {});
        textContent = '';
    } else if (tag === 'ul' || tag === 'ol') {
        const listItems = getListItemsFromGutBlock(gutBlock);
        coreBlockMarkup = buildListBlock(tag, listItems);
        textContent = listItems[0] || '';
    } else {
        const generator = TAG_TO_CORE_BLOCK[tag];
        const innerHTMLContent = buildInnerHTML(gutBlock);
        textContent = getTextFromGutBlock(gutBlock); // plain text for matching in post_content
        coreBlockMarkup = generator(innerHTMLContent);
    }

    const { content, restBase } = await fetchPostContent(restUrl, nonce, postId);
    if (!content) {
        showNotice('Could not fetch post content');
        return;
    }

    const blockAttrs = gutBlock.attrs?.attributes || {};
    const newContent = replaceSingleEtchBlock(content, tag, textContent, coreBlockMarkup, blockAttrs);

    if (newContent === content) {
        showNotice('Could not find the block in post content');
        return;
    }

    await saveAndReload(restUrl, nonce, postId, restBase, newContent);
}

// ---- Convert All ----

async function convertAllBlocks(postId, restUrl, nonce) {
    const { content, restBase } = await fetchPostContent(restUrl, nonce, postId);
    if (!content) {
        showNotice('Could not fetch post content');
        return;
    }

    const result = replaceAllEtchBlocks(content);

    if (result.count === 0) {
        showNotice('No convertible etch elements found');
        return;
    }

    showNotice('Converting ' + result.count + ' block' + (result.count > 1 ? 's' : '') + '...');
    await saveAndReload(restUrl, nonce, postId, restBase, result.content);
}

// ---- Block replacement (single) ----

function replaceSingleEtchBlock(content, tag, textContent, replacement, blockAttrs) {
    const closeTag = '<!-- /wp:etch/element -->';
    const openPrefix = '<!-- wp:etch/element ';

    let searchStart = 0;
    while (true) {
        const openIdx = content.indexOf(openPrefix, searchStart);
        if (openIdx === -1) break;

        const openLineEnd = content.indexOf('-->', openIdx);
        if (openLineEnd === -1) break;
        const openLine = content.substring(openIdx, openLineEnd + 3);
        const isSelfClosing = openLine.trimEnd().endsWith('/-->');

        const tagMatch = openLine.match(/"tag"\s*:\s*"([^"]+)"/);
        if (!tagMatch || tagMatch[1].toLowerCase() !== tag) {
            searchStart = openIdx + openLine.length;
            continue;
        }

        // Self-closing blocks (img, etc.)
        if (isSelfClosing) {
            if (tag === 'img') {
                // Match by src attribute in the JSON
                const srcMatch = openLine.match(/"src"\s*:\s*"([^"]*?)"/);
                const blockSrc = srcMatch ? srcMatch[1] : '';
                const wantSrc = blockAttrs?.src || '';

                if (blockSrc === wantSrc || (!wantSrc && !blockSrc)) {
                    return content.substring(0, openIdx) + replacement + content.substring(openIdx + openLine.length);
                }
            }
            searchStart = openIdx + openLine.length;
            continue;
        }

        // Non-self-closing blocks — always use depth-counted matching
        // (blocks like <p> can contain nested <a>, <span> etc.)
        const afterOpen = openIdx + openLine.length;
        const blockEndIdx = findMatchingCloseTag(content, afterOpen, openPrefix, closeTag);

        if (blockEndIdx === -1) break;

        const fullBlock = content.substring(openIdx, blockEndIdx + closeTag.length);
        const contentMatch = fullBlock.match(/"content"\s*:\s*"([^"]*?)"/);
        const blockText = contentMatch ? contentMatch[1] : '';

        if (blockText === textContent || (!textContent && !blockText)) {
            return content.substring(0, openIdx) + replacement + content.substring(blockEndIdx + closeTag.length);
        }

        searchStart = blockEndIdx + closeTag.length;
    }

    return content;
}

// ---- Block replacement (all convertible) ----

function replaceAllEtchBlocks(content) {
    const closeTag = '<!-- /wp:etch/element -->';
    const openPrefix = '<!-- wp:etch/element ';

    const replacements = [];

    let searchStart = 0;
    while (true) {
        const openIdx = content.indexOf(openPrefix, searchStart);
        if (openIdx === -1) break;

        const openLineEnd = content.indexOf('-->', openIdx);
        if (openLineEnd === -1) break;
        const openLine = content.substring(openIdx, openLineEnd + 3);
        const isSelfClosing = openLine.trimEnd().endsWith('/-->');

        const tagMatch = openLine.match(/"tag"\s*:\s*"([^"]+)"/);
        const tag = tagMatch ? tagMatch[1].toLowerCase() : null;

        if (!tag || !CONVERTIBLE_TAGS.includes(tag)) {
            searchStart = openIdx + openLine.length;
            continue;
        }

        // Self-closing blocks (img)
        if (isSelfClosing) {
            if (tag === 'img') {
                const srcMatch = openLine.match(/"src"\s*:\s*"([^"]*?)"/);
                const altMatch = openLine.match(/"alt"\s*:\s*"([^"]*?)"/);
                const classMatch = openLine.match(/"class"\s*:\s*"([^"]*?)"/);
                const loadingMatch = openLine.match(/"loading"\s*:\s*"([^"]*?)"/);

                const imgBlock = buildImageBlock({
                    src: srcMatch ? srcMatch[1] : '',
                    alt: altMatch ? altMatch[1] : '',
                    class: classMatch ? classMatch[1] : '',
                    loading: loadingMatch ? loadingMatch[1] : 'lazy',
                });

                replacements.push({
                    start: openIdx,
                    end: openIdx + openLine.length,
                    replacement: imgBlock,
                });
            }
            searchStart = openIdx + openLine.length;
            continue;
        }

        // Non-self-closing blocks — always use depth-counted matching
        const afterOpen = openIdx + openLine.length;
        const blockEndIdx = findMatchingCloseTag(content, afterOpen, openPrefix, closeTag);

        if (blockEndIdx === -1) break;

        const fullBlock = content.substring(openIdx, blockEndIdx + closeTag.length);
        const isListTag = (tag === 'ul' || tag === 'ol');

        if (isListTag) {
            const listItems = getListItemsFromMarkup(fullBlock);
            replacements.push({
                start: openIdx,
                end: blockEndIdx + closeTag.length,
                replacement: buildListBlock(tag, listItems),
            });
        } else {
            const generator = TAG_TO_CORE_BLOCK[tag];
            if (generator) {
                const innerHTMLContent = buildInnerHTMLFromMarkup(fullBlock);
                replacements.push({
                    start: openIdx,
                    end: blockEndIdx + closeTag.length,
                    replacement: generator(innerHTMLContent),
                });
            }
        }

        searchStart = blockEndIdx + closeTag.length;
    }

    // Apply replacements in reverse order to preserve indices
    let result = content;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        result = result.substring(0, r.start) + r.replacement + result.substring(r.end);
    }

    return { content: result, count: replacements.length };
}

// ---- Helpers ----

/**
 * Find the matching close tag accounting for nesting depth.
 */
function findMatchingCloseTag(content, startPos, openPrefix, closeTag) {
    let depth = 1;
    let pos = startPos;

    while (depth > 0) {
        const nextOpen = content.indexOf(openPrefix, pos);
        const nextClose = content.indexOf(closeTag, pos);

        if (nextClose === -1) return -1;

        // Check if next open is self-closing
        let isSelfClosing = false;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            const lineEnd = content.indexOf('-->', nextOpen);
            if (lineEnd !== -1) {
                const line = content.substring(nextOpen, lineEnd + 3);
                isSelfClosing = line.trimEnd().endsWith('/-->');
            }
        }

        if (nextOpen !== -1 && nextOpen < nextClose && !isSelfClosing) {
            depth++;
            const lineEnd = content.indexOf('-->', nextOpen);
            pos = lineEnd !== -1 ? lineEnd + 3 : nextOpen + openPrefix.length;
        } else {
            depth--;
            if (depth === 0) return nextClose;
            pos = nextClose + closeTag.length;
        }
    }
    return -1;
}

/**
 * Extract text content from a gutBlock — returns plain text (first etch/text found).
 * Used for matching blocks in post_content.
 */
function getTextFromGutBlock(gutBlock) {
    if (gutBlock.innerBlocks?.length > 0) {
        for (const inner of gutBlock.innerBlocks) {
            if (inner.blockName === 'etch/text' && inner.attrs?.content) {
                return inner.attrs.content;
            }
        }
    }
    return '';
}

/**
 * Recursively build innerHTML from a gutBlock's inner block tree.
 * Handles mixed content: etch/text nodes + nested etch/element (a, span, strong, em, etc.)
 *
 * Example input tree:
 *   etch/element (p)
 *     ├── etch/text "Content "
 *     └── etch/element (a href="#")
 *          └── etch/text "test"
 *
 * Output: "Content <a href="#">test</a>"
 */
function buildInnerHTML(gutBlock) {
    if (!gutBlock.innerBlocks || gutBlock.innerBlocks.length === 0) {
        return '';
    }

    let html = '';
    for (const inner of gutBlock.innerBlocks) {
        if (inner.blockName === 'etch/text') {
            html += escapeHtml(inner.attrs?.content || '');
        } else if (inner.blockName === 'etch/element') {
            const tag = inner.attrs?.tag?.toLowerCase();
            if (!tag) continue;

            // Build attributes string from the block's attributes
            const blockAttrs = inner.attrs?.attributes || {};
            let attrStr = '';
            for (const [key, val] of Object.entries(blockAttrs)) {
                if (val && typeof val === 'string') {
                    attrStr += ' ' + escapeAttr(key) + '="' + escapeAttr(val) + '"';
                }
            }

            // Recurse for children
            const childHTML = buildInnerHTML(inner);

            // Self-closing tags
            const selfClosingTags = ['img', 'br', 'hr', 'input'];
            if (selfClosingTags.includes(tag)) {
                html += '<' + tag + attrStr + '/>';
            } else {
                html += '<' + tag + attrStr + '>' + childHTML + '</' + tag + '>';
            }
        }
    }
    return html;
}

function showConfirmDialog(message, onConfirm) {
    // Remove existing dialog
    const existing = document.getElementById('etch-core-confirm');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'etch-core-confirm';
    overlay.style.cssText = [
        'position: fixed',
        'inset: 0',
        'background: rgba(0,0,0,0.5)',
        'z-index: 999999',
        'display: flex',
        'align-items: center',
        'justify-content: center',
    ].join(';');

    const dialog = document.createElement('div');
    dialog.style.cssText = [
        'background: var(--e-background-color, #1e1e2e)',
        'border: 1px solid var(--e-border-color, rgba(255,255,255,0.1))',
        'border-radius: 10px',
        'padding: 24px',
        'max-width: 380px',
        'font-family: var(--e-font-interface, -apple-system, sans-serif)',
        'font-size: 14px',
        'color: var(--e-foreground-color, #e0e0e0)',
        'box-shadow: 0 12px 40px rgba(0,0,0,0.4)',
        'line-height: 1.5',
    ].join(';');

    const msg = document.createElement('p');
    msg.textContent = message;
    msg.style.cssText = 'margin: 0 0 20px; font-size: 14px;';
    dialog.appendChild(msg);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const btnStyle = [
        'padding: 8px 16px',
        'border-radius: 6px',
        'font-size: 13px',
        'font-family: inherit',
        'cursor: pointer',
        'border: none',
    ].join(';');

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = btnStyle + ';background: var(--e-background-color-hover, rgba(255,255,255,0.08)); color: var(--e-foreground-color, #e0e0e0);';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Convert';
    confirmBtn.style.cssText = btnStyle + ';background: #6366f1; color: white; font-weight: 600;';
    confirmBtn.addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

function showNotice(message) {
    // Remove existing toast
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
