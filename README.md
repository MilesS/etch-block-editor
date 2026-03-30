# Etch Block Editor

A WordPress plugin that makes core Gutenberg blocks visible, editable, insertable, and convertible inside the [Etch](https://etchwp.com) visual editor.

Etch is a powerful visual development environment for WordPress, but its editor canvas shows core Gutenberg blocks (paragraphs, headings, lists, images, etc.) as opaque placeholders. This plugin fixes that.

## Features

### View & Edit
Core blocks display their actual content in the Etch canvas instead of showing "core/paragraph" placeholder text. Double-click to enter inline editing, Cmd+S to save.

### Insert Core Blocks
Add new core blocks (paragraph, h1-h6, button) directly from the Etch settings bar without leaving the editor. Click the **+** icon in the left toolbar.

### Convert Etch Elements to Core Blocks
Select an etch/element and convert it to a core Gutenberg block with one click. Click the **swap** icon in the left toolbar.

**Supported conversions:**
- `<p>` with nested links, spans, etc. to `core/paragraph`
- `<h1>` - `<h6>` to `core/heading`
- `<img>` to `core/image`
- `<ul>` / `<ol>` with `<li>` children to `core/list`

**Two modes:**
- **Convert Selected** - converts the currently selected block
- **Convert All** - batch converts every convertible etch/element on the page

## Requirements

- WordPress 5.9+
- PHP 8.1+
- [Etch](https://etchwp.com) plugin installed and active

## Installation

### From GitHub Release (recommended)
1. Download the latest `etch-core-block-editor.zip` from [Releases](https://github.com/MilesS/etch-block-editor/releases)
2. In WordPress admin, go to Plugins > Add New > Upload Plugin
3. Upload the zip file and activate

### From Source
```bash
git clone https://github.com/MilesS/etch-block-editor.git wp-content/plugins/etch-core-block-editor
cd wp-content/plugins/etch-core-block-editor
npm install && npm run build
composer install --no-dev
```

## Auto-Updates

The plugin checks for updates via GitHub Releases. When a new release is published, WordPress will show an update notification in the plugins screen. Updates install like any other plugin update.

## How It Works

Etch's builder is a Svelte application that renders a custom canvas in an iframe. Core WordPress blocks appear as `.etch-passthrough-block` divs with just the block name as text.

This plugin:
1. **Injects into the main page** when `?etch=magic` is detected
2. **Reaches into the iframe** to find passthrough block elements
3. **Fetches post content** via the WP REST API and parses block markup
4. **Renders actual content** inside the passthrough blocks with inline editing support
5. **Saves edits** via a two-phase approach: pending edits stored in `wp_options`, then applied via a `save_post` hook after Etch's own save completes
6. **Converts blocks** by modifying `post_content` directly through the WP REST API

## Development

```bash
# Install dependencies
npm install
composer install

# Development build (watch mode)
npm run start

# Production build
npm run build
```

## Creating a Release

1. Update the version in `etch-core-block-editor.php` and `readme.txt`
2. Commit and push
3. Tag the release: `git tag v1.3.0 && git push origin v1.3.0`
4. GitHub Actions will automatically build and publish the release with a zip asset

## License

GPLv2 or later. See [LICENSE](https://www.gnu.org/licenses/gpl-2.0.html).

## Disclaimer

This plugin is provided as-is with no warranty. It is not affiliated with or endorsed by the Etch team. Use at your own risk. Always back up your site before converting blocks.
