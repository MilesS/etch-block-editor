=== Etch Block Editor ===
Contributors: miles
Tags: etch, gutenberg, blocks, editor
Requires at least: 5.9
Tested up to: 6.9
Requires PHP: 8.1
Stable tag: 1.6.2
License: GPLv2 or later

Display, edit, insert, and convert core Gutenberg blocks directly inside the Etch visual editor.

== Description ==

Etch Core Block Editor enhances the Etch page builder by making core WordPress blocks (paragraphs, headings, lists, images, etc.) visible and editable within the Etch editor canvas.

Features:
* View and inline-edit core block content in the Etch canvas
* Insert new core blocks (paragraph, headings, buttons, post navigation links) without leaving Etch
* Convert etch/element blocks to core Gutenberg blocks (p, h1-h6, img, ul, ol)
* Batch convert all convertible blocks on a page
* Toggle template preview to see header/footer/layout context while editing posts
* Navigate directly to a post's template for editing

== Changelog ==

= 1.6.2 =
* Remove opacity dimming from template preview — template parts now render at full fidelity

= 1.6.1 =
* Fix template preview content marker not appearing (priority conflict with Etch ContentWrapper)
* Fix template preview rendering — fetch real frontend page for accurate styles and nesting
* Fix editability preservation — move original nodes instead of cloning

= 1.6.0 =
* Add template preview toggle — show header/footer/layout context while editing posts
* Add "Edit Template" button to navigate directly to the post's template
* New REST endpoints for template resolution and shell rendering
* Template hierarchy support (single-{type}, single, singular, page, index)
* Preview state persisted in localStorage

= 1.5.1 =
* Fix block enhancement for wp_template post types (pass raw content from PHP)

= 1.5.0 =
* Add core/post-navigation-link support with dynamic preview
* Insert previous/next post navigation links from the block inserter
* Dynamic block preview system for server-rendered blocks

= 1.4.1 =
* Remove hardcoded styles from preview, inherit from site

= 1.4.0 =
* Add custom post type support

= 1.3.3 =
* Add plugin icon

= 1.3.2 =
* Rename to Etch Block Editor

= 1.3.1 =
* Version bump test

= 1.3.0 =
* Initial public release
* View and edit core blocks in Etch canvas
* Insert core blocks from settings bar
* Convert etch elements to core blocks with nested element support
* Security hardened (wp_kses_post, per-post authorization, payload limits)
