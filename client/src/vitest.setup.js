// vitest.setup.js
// Mocks for browser APIs needed by Vitest and dependencies

// window.matchMedia mock
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// More complete URL mock for window and globalThis
class MockURL {
  constructor(url) {
    this.href = url;
    this.protocol = url.split(':')[0] + ':';
    this.host = 'localhost';
    this.hostname = 'localhost';
    this.port = '';
    this.pathname = '/';
    this.search = '';
    this.hash = '';
  }
  static createObjectURL() { return 'blob:mock'; }
  static revokeObjectURL() {}
}
if (!window.URL) window.URL = MockURL;
if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:mock';
if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};
if (!globalThis.URL) globalThis.URL = MockURL;
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:mock';
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};

// window.location mock
if (!window.location) {
  window.location = {
    href: '',
    protocol: 'http:',
    host: 'localhost',
    hostname: 'localhost',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
    assign: () => {},
    reload: () => {},
    replace: () => {},
  };
}

// window.document mock
if (!window.document) {
  window.document = {
    createElement: () => ({ style: {} }),
    getElementsByTagName: () => [],
    getElementById: () => null,
    body: {},
    get: () => {}, // Added mock for document.get
  };
}
if (!window.document.body) {
  window.document.body = {};
}
if (!window.document.get) {
  window.document.get = () => {};
}
