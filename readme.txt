=== Etch Core Block Editor ===
Contributors: miles
Tags: etch, gutenberg, blocks, editor
Requires at least: 5.9
Tested up to: 6.9
Requires PHP: 8.1
Stable tag: 1.3.1
License: GPLv2 or later

Display, edit, insert, and convert core Gutenberg blocks directly inside the Etch visual editor.

== Description ==

Etch Core Block Editor enhances the Etch page builder by making core WordPress blocks (paragraphs, headings, lists, images, etc.) visible and editable within the Etch editor canvas.

Features:
* View and inline-edit core block content in the Etch canvas
* Insert new core blocks (paragraph, headings, buttons) without leaving Etch
* Convert etch/element blocks to core Gutenberg blocks (p, h1-h6, img, ul, ol)
* Batch convert all convertible blocks on a page

== Changelog ==

= 1.3.1 =
* Version bump test

= 1.3.0 =
* Initial public release
* View and edit core blocks in Etch canvas
* Insert core blocks from settings bar
* Convert etch elements to core blocks with nested element support
* Security hardened (wp_kses_post, per-post authorization, payload limits)
