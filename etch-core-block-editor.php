<?php
/**
 * Plugin Name: Etch Block Editor
 * Plugin URI: https://github.com/MilesS/etch-block-editor
 * Description: Display and edit core Gutenberg blocks inside the Etch visual editor.
 * Version: 1.6.2
 * Requires PHP: 8.1
 * Author: Miles Sebesta
 * Author URI: https://milessebesta.com
 * License: GPLv2 or later
 * Update URI: https://github.com/MilesS/etch-block-editor
 */

if (!defined('ABSPATH')) {
    exit;
}

// Auto-updater via GitHub Releases
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';

    $updateChecker = YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
        'https://github.com/MilesS/etch-block-editor/',
        __FILE__,
        'etch-core-block-editor'
    );

    // Use GitHub releases for updates
    $updateChecker->getVcsApi()->enableReleaseAssets();

    // Plugin icon from GitHub
    $updateChecker->addResultFilter(function ($pluginInfo) {
        $pluginInfo->icons = [
            '1x' => 'https://raw.githubusercontent.com/MilesS/etch-block-editor/main/assets/icon-128x128.png',
            '2x' => 'https://raw.githubusercontent.com/MilesS/etch-block-editor/main/assets/icon-256x256.png',
        ];
        return $pluginInfo;
    });
}

// Enqueue frontend scripts in Etch builder context
add_action('wp_enqueue_scripts', function () {
    if (!isset($_GET['etch']) || $_GET['etch'] !== 'magic') {
        return;
    }

    // Finding 10: capability check before enqueuing scripts/nonce
    if (!current_user_can('edit_posts')) {
        return;
    }

    $asset_file = plugin_dir_path(__FILE__) . 'build/index.asset.php';
    if (!file_exists($asset_file)) {
        return;
    }

    $asset = require $asset_file;

    wp_enqueue_script(
        'etch-core-block-editor',
        plugin_dir_url(__FILE__) . 'build/index.js',
        $asset['dependencies'],
        $asset['version'],
        true
    );

    // Finding 9: validate post_id against user capability before localizing
    $post_id = isset($_GET['post_id']) ? absint($_GET['post_id']) : 0;
    if ($post_id && !current_user_can('edit_post', $post_id)) {
        $post_id = 0;
    }

    // Detect the post type's REST base for API calls
    $rest_base = 'posts';
    if ($post_id) {
        $post_type = get_post_type($post_id);
        if ($post_type) {
            $type_obj = get_post_type_object($post_type);
            if ($type_obj && !empty($type_obj->rest_base)) {
                $rest_base = $type_obj->rest_base;
            } elseif ($post_type === 'page') {
                $rest_base = 'pages';
            }
        }
    }

    // Pass raw post content directly — avoids REST API issues with
    // post types that use non-numeric IDs (e.g. wp_template)
    $raw_content = '';
    if ($post_id) {
        $post_obj = get_post($post_id);
        if ($post_obj) {
            $raw_content = $post_obj->post_content;
        }
    }

    $original_post_id = isset($_GET['original_post_id']) ? absint($_GET['original_post_id']) : 0;
    if ($original_post_id && !current_user_can('edit_post', $original_post_id)) {
        $original_post_id = 0;
    }

    $is_template = false;
    if ($post_id) {
        $is_template = in_array(get_post_type($post_id), ['wp_template', 'wp_template_part'], true);
    }

    wp_localize_script('etch-core-block-editor', 'etchCoreBlockEditor', [
        'postId' => $post_id,
        'originalPostId' => $original_post_id,
        'isTemplate' => $is_template,
        'restUrl' => rest_url(),
        'restBase' => $rest_base,
        'nonce' => wp_create_nonce('wp_rest'),
        'rawContent' => $raw_content,
    ]);

    wp_enqueue_style(
        'etch-core-block-editor',
        plugin_dir_url(__FILE__) . 'build/index.css',
        [],
        $asset['version']
    );
});

// REST endpoint: get template info for a post
add_action('rest_api_init', function () {
    register_rest_route('etch-core-block-editor/v1', '/post-template/(?P<post_id>\d+)', [
        'methods' => 'GET',
        'callback' => function (WP_REST_Request $request) {
            $post_id = absint($request->get_param('post_id'));
            $post = get_post($post_id);

            if (!$post) {
                return new WP_Error('invalid_post', 'Post not found', ['status' => 404]);
            }

            $post_type = $post->post_type;

            // Don't resolve templates for template post types
            if (in_array($post_type, ['wp_template', 'wp_template_part'], true)) {
                return new WP_REST_Response(['templateId' => null, 'reason' => 'already_template'], 200);
            }

            // Find the matching template for this post
            $template = etch_core_resolve_template_for_post($post);

            if (!$template) {
                return new WP_REST_Response(['templateId' => null, 'reason' => 'no_template_found'], 200);
            }

            return new WP_REST_Response([
                'templateId' => $template->wp_id,
                'templateSlug' => $template->slug,
                'templateTitle' => $template->title,
                'editUrl' => add_query_arg([
                    'etch' => 'magic',
                    'post_id' => $template->wp_id,
                    'original_post_id' => $post_id,
                ], home_url('/')),
            ], 200);
        },
        'permission_callback' => function (WP_REST_Request $request) {
            $post_id = absint($request->get_param('post_id'));
            return current_user_can('edit_post', $post_id);
        },
    ]);

    register_rest_route('etch-core-block-editor/v1', '/template-shell/(?P<post_id>\d+)', [
        'methods' => 'GET',
        'callback' => function (WP_REST_Request $request) {
            $post_id = absint($request->get_param('post_id'));
            $post = get_post($post_id);

            if (!$post) {
                return new WP_Error('invalid_post', 'Post not found', ['status' => 404]);
            }

            if (in_array($post->post_type, ['wp_template', 'wp_template_part'], true)) {
                return new WP_REST_Response(['permalink' => '', 'reason' => 'already_template'], 200);
            }

            $template = etch_core_resolve_template_for_post($post);
            $permalink = get_permalink($post_id);

            if (!$permalink) {
                return new WP_REST_Response(['permalink' => '', 'reason' => 'no_permalink'], 200);
            }

            // Add marker param so our filter wraps the post content
            $preview_url = add_query_arg('etch_template_preview', '1', $permalink);

            return new WP_REST_Response([
                'templateId' => $template ? $template->wp_id : null,
                'templateSlug' => $template ? $template->slug : null,
                'permalink' => $preview_url,
            ], 200);
        },
        'permission_callback' => function (WP_REST_Request $request) {
            $post_id = absint($request->get_param('post_id'));
            return current_user_can('edit_post', $post_id);
        },
    ]);
});

/**
 * Resolve the block template that applies to a given post.
 */
function etch_core_resolve_template_for_post(WP_Post $post): ?WP_Block_Template {
    $post_type = $post->post_type;

    // Check for a custom template assignment
    $custom_template = get_page_template_slug($post);

    $slugs_to_try = [];

    if ($custom_template) {
        $slugs_to_try[] = $custom_template;
    }

    // Build template hierarchy based on post type
    if ($post_type === 'page') {
        $slugs_to_try[] = 'page-' . $post->post_name;
        $slugs_to_try[] = 'page-' . $post->ID;
        $slugs_to_try[] = 'page';
    } else {
        $slugs_to_try[] = 'single-' . $post_type . '-' . $post->post_name;
        $slugs_to_try[] = 'single-' . $post_type;
        $slugs_to_try[] = 'single';
    }

    $slugs_to_try[] = 'singular';
    $slugs_to_try[] = 'index';

    $all_templates = get_block_templates([], 'wp_template');

    $templates_by_slug = [];
    foreach ($all_templates as $tpl) {
        $templates_by_slug[$tpl->slug] = $tpl;
    }

    foreach ($slugs_to_try as $slug) {
        if (isset($templates_by_slug[$slug])) {
            return $templates_by_slug[$slug];
        }
    }

    return null;
}

// When ?etch_template_preview=1, wrap the post content area with a marker
// so the JS can find it and replace it with editable content.
// Priority 20 runs after Etch's ContentWrapper (priority 10) which strips the outer div.
add_filter('render_block_core/post-content', function ($block_content, $block) {
    if (!isset($_GET['etch_template_preview']) || $_GET['etch_template_preview'] !== '1') {
        return $block_content;
    }
    return '<div id="etch-content-marker">' . $block_content . '</div>';
}, 20, 2);

// REST endpoint: store pending core block edits
add_action('rest_api_init', function () {
    register_rest_route('etch-core-block-editor/v1', '/pending-edits/(?P<post_id>\d+)', [
        'methods' => 'POST',
        'callback' => function (WP_REST_Request $request) {
            $post_id = absint($request->get_param('post_id'));
            $edits = $request->get_json_params();

            if (!$post_id || !is_array($edits)) {
                return new WP_Error('invalid_data', 'Invalid data', ['status' => 400]);
            }

            // Finding 7: verify post exists
            if (!get_post($post_id)) {
                return new WP_Error('invalid_post', 'Post not found', ['status' => 404]);
            }

            // Finding 7: payload size limit (64KB)
            $json_size = strlen(wp_json_encode($edits));
            if ($json_size > 65536) {
                return new WP_Error('payload_too_large', 'Edit payload too large', ['status' => 413]);
            }

            update_option("etch_core_edits_{$post_id}", $edits, false);

            return new WP_REST_Response(['saved' => true], 200);
        },
        // Finding 2: per-post authorization
        'permission_callback' => function (WP_REST_Request $request) {
            $post_id = absint($request->get_param('post_id'));
            return current_user_can('edit_post', $post_id);
        },
    ]);
});

// After Etch saves, apply pending core block edits to post_content.
// Priority 999 ensures this runs after Etch's own save_post hooks.
add_action('save_post', function ($post_id, $post, $update) {
    static $applying = [];
    if (isset($applying[$post_id])) {
        return;
    }

    // Finding 3: skip autosaves and revisions
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (wp_is_post_revision($post_id)) {
        return;
    }

    // Finding 3: verify current user can edit this post
    if (!current_user_can('edit_post', $post_id)) {
        delete_option("etch_core_edits_{$post_id}");
        return;
    }

    $edits = get_option("etch_core_edits_{$post_id}", false);
    if (!$edits || !is_array($edits)) {
        return;
    }

    // Re-read fresh from DB to get Etch's serialized content
    wp_cache_delete($post_id, 'posts');
    $fresh_post = get_post($post_id);
    $content = $fresh_post->post_content;

    if (empty($content)) {
        return;
    }

    $changed = false;
    foreach ($edits as $edit) {
        $old_markup = $edit['originalMarkup'] ?? '';
        // Finding 1: sanitize newMarkup to prevent stored XSS
        $new_markup = wp_kses_post($edit['newMarkup'] ?? '');

        if ($old_markup && $new_markup && str_contains($content, $old_markup)) {
            $content = str_replace($old_markup, $new_markup, $content);
            $changed = true;
        }
    }

    if ($changed) {
        $applying[$post_id] = true;
        wp_update_post([
            'ID' => $post_id,
            'post_content' => wp_slash($content),
        ]);
        unset($applying[$post_id]);
    }

    delete_option("etch_core_edits_{$post_id}");
}, 999, 3);
