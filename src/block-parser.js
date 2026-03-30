/**
 * Parse WordPress block markup from raw post_content.
 * Extracts core/* blocks with their attributes, innerHTML, and original markup.
 */
export function parseBlocksFromContent(rawContent) {
    const blocks = [];

    // Two-pass approach:
    // 1. Match self-closing blocks: <!-- wp:blockname {"attrs"} /-->
    // 2. Match blocks with content: <!-- wp:blockname {"attrs"} --> content <!-- /wp:blockname -->

    // Self-closing blocks
    const selfClosingRegex = /<!-- wp:(\S+?)(\s+(\{[^}]*\}))?\s*\/-->/g;
    let match;
    while ((match = selfClosingRegex.exec(rawContent)) !== null) {
        const blockNameShort = match[1];
        const blockName = blockNameShort.includes('/') ? blockNameShort : `core/${blockNameShort}`;
        if (!blockName.startsWith('core/')) continue;

        let attrs = {};
        if (match[3]) {
            try { attrs = JSON.parse(match[3]); } catch (e) {}
        }

        blocks.push({
            blockName,
            attrs,
            innerHTML: '',
            originalMarkup: match[0],
            index: match.index,
        });
    }

    // Blocks with content — use a function to find matching close tags
    const openRegex = /<!-- wp:(\S+?)(\s+(\{[^}]*\}))?\s*-->/g;
    while ((match = openRegex.exec(rawContent)) !== null) {
        const blockNameShort = match[1];
        const blockName = blockNameShort.includes('/') ? blockNameShort : `core/${blockNameShort}`;
        if (!blockName.startsWith('core/')) continue;

        const openTag = match[0];
        const closeTag = `<!-- /wp:${blockNameShort} -->`;
        const contentStart = match.index + openTag.length;
        const closeIndex = rawContent.indexOf(closeTag, contentStart);

        if (closeIndex === -1) continue; // No closing tag found

        const innerHTML = rawContent.substring(contentStart, closeIndex).trim();
        const fullMatch = rawContent.substring(match.index, closeIndex + closeTag.length);

        let attrs = {};
        if (match[3]) {
            try { attrs = JSON.parse(match[3]); } catch (e) {}
        }

        blocks.push({
            blockName,
            attrs,
            innerHTML,
            originalMarkup: fullMatch,
            index: match.index,
        });
    }

    // Sort by position in content (to maintain order)
    blocks.sort((a, b) => a.index - b.index);

    return blocks;
}

/**
 * Serialize blocks back into WordPress block markup.
 */
export function serializeBlocks(blocks) {
    return blocks.map(block => {
        const shortName = block.blockName.replace('core/', '');
        const attrsStr = block.attrs && Object.keys(block.attrs).length > 0
            ? ' ' + JSON.stringify(block.attrs)
            : '';

        if (!block.innerHTML) {
            return `<!-- wp:${shortName}${attrsStr} /-->`;
        }

        return `<!-- wp:${shortName}${attrsStr} -->\n${block.innerHTML}\n<!-- /wp:${shortName} -->`;
    }).join('\n\n');
}
