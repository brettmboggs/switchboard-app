// ESLint, kept small: no plugins, no style rules. It catches what a browser only
// finds at click time (a name nothing defines) and what should never be in this
// code (eval). Two kinds of file: the Node side (ES modules) and the page's
// scripts (plain scripts sharing one scope; their shared names come from
// scripts/page-globals.json, written by scripts/page-globals.mjs).
import { readFileSync } from 'node:fs';

const page = JSON.parse(readFileSync(new URL('./scripts/page-globals.json', import.meta.url), 'utf8'));
const ro = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));
const rw = (names) => Object.fromEntries(names.map((n) => [n, 'writable']));

// What Node 22 provides without an import. Listed by hand rather than through the
// `globals` package: one fewer dependency, and this is all the code uses.
const NODE = ro(['process', 'Buffer', 'console', 'globalThis', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone', 'fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'crypto', 'performance', 'atob', 'btoa',
  'Event', 'EventTarget', 'WebSocket', 'ReadableStream', 'WritableStream', 'TransformStream', 'MessageChannel', 'BroadcastChannel', 'navigator']);
// A Cloudflare Worker: the web platform plus its own few.
const WORKER = { ...NODE, ...ro(['WebSocketPair', 'WebSocketRequestResponsePair', 'caches', 'addEventListener', 'HTMLRewriter', 'scheduler']) };
// The page: the browser, the vendored xterm scripts, and the names the page scripts share.
const BROWSER = ro(['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB', 'console', 'globalThis', 'self',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'crypto', 'performance', 'atob', 'btoa', 'alert', 'confirm', 'prompt', 'open', 'close', 'focus', 'scrollTo', 'scrollBy', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio', 'screen', 'visualViewport',
  'matchMedia', 'getComputedStyle', 'getSelection', 'Notification', 'Audio', 'Image', 'Option', 'DOMParser', 'XMLSerializer', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'InputEvent', 'ClipboardEvent', 'DragEvent', 'FocusEvent', 'TouchEvent', 'WheelEvent',
  'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'Node', 'NodeList', 'Text', 'Range', 'Selection', 'DocumentFragment', 'CSS',
  'WebSocket', 'EventSource', 'Worker', 'MediaRecorder', 'AudioContext', 'webkitAudioContext', 'SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis', 'SpeechSynthesisUtterance',
  'ClipboardItem', 'caches', 'Intl', 'parent', 'top', 'frames', 'frameElement', 'name', 'status', 'onresize', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'NodeFilter', 'AudioWorkletNode',
  // public/vendor: xterm.js and its add-ons define these.
  'Terminal', 'FitAddon', 'WebglAddon',
  // calc.js hands itself to the tests with `if (typeof module !== 'undefined') module.exports = ...`.
  'module']);

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error'
};

export default [
  { ignores: ['node_modules/**', '**/node_modules/**', '.claude/**', '.wrangler/**', '**/.wrangler/**', 'desktop/build/**', 'desktop/src-tauri/**', 'desktop/frontend/**', 'public/vendor/**', 'public/sw.js'] },
  {
    files: ['server.js', 'lib/**/*.js', 'bin/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', 'desktop/sidecar/**/*.{js,mjs}', 'desktop/scripts/**/*.{js,mjs}', 'test/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: NODE },
    rules
  },
  {
    files: ['sync-worker/src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: WORKER },
    rules
  },
  {
    // test/sanitize.test.js runs functions inside the page (page.evaluate), where sanitize.js is loaded.
    files: ['test/sanitize.test.js'],
    languageOptions: { globals: { sanitizeHtml: 'readonly' } }
  },
  {
    // test/webboard-e2e.test.js checks the page from inside it (page.evaluate, waitForFunction).
    files: ['test/webboard-e2e.test.js'],
    languageOptions: { globals: { S: 'readonly', api: 'readonly', location: 'readonly', document: 'readonly', window: 'readonly' } }
  },
  {
    // The web board's modules (public/js/web/): the browser, as ES modules; tests also run them in Node.
    files: ['public/js/web/**/*.js', 'public/js/shared/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: BROWSER },
    rules
  },
  {
    files: ['public/js/*.js', 'public/setup.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...BROWSER, ...rw(page.names) } },
    // A top-level name in one page script is used from another, so only local unused names count here.
    rules: { ...rules, 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }] }
  }
];
