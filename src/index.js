import './styles/etch-overrides.css';
import { initPassthroughEnhancer } from './enhancer';
import { initBlockInserter } from './inserter';
import { initBlockConverter } from './converter';

// Wait for DOM ready, then initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function init() {
    console.log('[etch-core-block-editor] Initializing...');

    // Initialize settings bar buttons
    initBlockInserter();
    initBlockConverter();

    // Wait for the Etch iframe to appear
    waitForIframe().then((iframe) => {
        console.log('[etch-core-block-editor] Etch iframe found, starting enhancer');
        initPassthroughEnhancer(iframe);
    }).catch((err) => {
        console.error('[etch-core-block-editor] Failed to find Etch iframe:', err);
    });
}

function waitForIframe(timeout = 30000) {
    return new Promise((resolve, reject) => {
        const iframe = document.getElementById('etch-iframe');
        if (iframe?.contentDocument?.body) {
            return resolve(iframe);
        }

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
            // One final check
            const iframe = document.getElementById('etch-iframe');
            if (iframe?.contentDocument?.body) {
                resolve(iframe);
            } else {
                reject(new Error('Timeout waiting for etch-iframe'));
            }
        }, timeout);
    });
}
