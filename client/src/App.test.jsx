import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

// Mock window.matchMedia for react-slick and other components
beforeAll(() => {
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

  // Mock window.URL and window.URL.createObjectURL for webidl-conversions/whatwg-url
  if (!window.URL) {
    window.URL = class {
      constructor(url) {
        this.href = url;
      }
      static createObjectURL() { return 'blob:mock'; }
      static revokeObjectURL() {}
    };
  }
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = () => 'blob:mock';
  }
  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = () => {};
  }
});

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeDefined();
  });
});
