/**
 * Block Inserter — adds a button to Etch's settings bar
 * that lets you insert core Gutenberg blocks without leaving the editor.
 */

const BLOCK_TEMPLATES = {
    'Paragraph': '<!-- wp:paragraph -->\n<p></p>\n<!-- /wp:paragraph -->',
    'Heading H1': '<!-- wp:heading {"level":1} -->\n<h1 class="wp-block-heading"></h1>\n<!-- /wp:heading -->',
    'Heading H2': '<!-- wp:heading -->\n<h2 class="wp-block-heading"></h2>\n<!-- /wp:heading -->',
    'Heading H3': '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading"></h3>\n<!-- /wp:heading -->',
    'Heading H4': '<!-- wp:heading {"level":4} -->\n<h4 class="wp-block-heading"></h4>\n<!-- /wp:heading -->',
    'Heading H5': '<!-- wp:heading {"level":5} -->\n<h5 class="wp-block-heading"></h5>\n<!-- /wp:heading -->',
    'Heading H6': '<!-- wp:heading {"level":6} -->\n<h6 class="wp-block-heading"></h6>\n<!-- /wp:heading -->',
    'Button': '<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button"></a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->',
};

export function initBlockInserter() {
    const config = window.etchCoreBlockEditor || {};
    const { postId, restUrl, nonce } = config;

    if (!postId) return;

    // Wait for etchControls to be available
    waitForEtchControls().then(() => {
        addInserterButton(postId, restUrl, nonce);
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

function addInserterButton(postId, restUrl, nonce) {
    let dropdownVisible = false;
    let dropdownEl = null;

    window.etchControls.builder.settingsBar.top.addAfter({
        icon: 'ph:plus-circle-duotone',
        tooltip: 'Insert Core Block',
        id: 'etch-core-block-inserter',
        callback: () => {
            if (dropdownVisible) {
                hideDropdown();
            } else {
                showDropdown(postId, restUrl, nonce);
            }
        },
    });

    function showDropdown(postId, restUrl, nonce) {
        if (dropdownEl) {
            dropdownEl.remove();
        }

        dropdownEl = document.createElement('div');
        dropdownEl.id = 'etch-core-inserter-dropdown';
        dropdownEl.style.cssText = `
            position: fixed;
            top: 50px;
            left: 10px;
            background: var(--e-background-color, #1e1e2e);
            border: 1px solid var(--e-border-color, rgba(255,255,255,0.1));
            border-radius: 8px;
            padding: 6px;
            z-index: 99999;
            min-width: 180px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            font-family: var(--e-font-interface, -apple-system, BlinkMacSystemFont, sans-serif);
            font-size: 13px;
        `;

        const title = document.createElement('div');
        title.textContent = 'Insert Block';
        title.style.cssText = `
            padding: 6px 10px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--e-foreground-color-muted, rgba(255,255,255,0.4));
        `;
        dropdownEl.appendChild(title);

        for (const [label, markup] of Object.entries(BLOCK_TEMPLATES)) {
            const item = document.createElement('button');
            item.textContent = label;
            item.style.cssText = `
                display: block;
                width: 100%;
                padding: 8px 10px;
                background: none;
                border: none;
                color: var(--e-foreground-color, #e0e0e0);
                text-align: left;
                cursor: pointer;
                border-radius: 4px;
                font-size: 13px;
                font-family: inherit;
            `;
            item.addEventListener('mouseenter', () => {
                item.style.background = 'var(--e-background-color-hover, rgba(255,255,255,0.08))';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = 'none';
            });
            item.addEventListener('click', () => {
                hideDropdown();
                insertBlock(markup, postId, restUrl, nonce);
            });
            dropdownEl.appendChild(item);
        }

        document.body.appendChild(dropdownEl);
        dropdownVisible = true;

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick);
        }, 0);
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

async function insertBlock(blockMarkup, postId, restUrl, nonce) {
    try {
        // Fetch current post content
        let data = null;
        let postType = null;
        for (const type of ['pages', 'posts']) {
            try {
                const response = await fetch(`${restUrl}wp/v2/${type}/${postId}?context=edit`, {
                    headers: { 'X-WP-Nonce': nonce }
                });
                if (response.ok) {
                    data = await response.json();
                    postType = type;
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (!data?.content?.raw) {
            console.error('[etch-core-block-editor] Could not fetch post content for insertion');
            return;
        }

        // Append the new block to the end of existing content
        const newContent = data.content.raw.trim() + '\n\n' + blockMarkup;

        // Save via WP REST API
        const saveResp = await fetch(`${restUrl}wp/v2/${postType}/${postId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': nonce,
            },
            body: JSON.stringify({ content: newContent }),
        });

        if (saveResp.ok) {
            console.log('[etch-core-block-editor] Block inserted, reloading...');
            window.location.reload();
        } else {
            console.error('[etch-core-block-editor] Failed to save new block');
        }
    } catch (err) {
        console.error('[etch-core-block-editor] Insert failed:', err);
    }
}
