import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

// Routes are code-split (React.lazy): the first visit to a page waits for its
// chunk, which Vite transforms on demand in tests. Give findBy* room for that.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no ResizeObserver; Radix radio groups measure their items with it.
// Nothing resizes in jsdom, so observing can do nothing.
if (!('ResizeObserver' in globalThis)) {
  const noop = () => undefined;
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    },
  });
}

afterEach(() => {
  cleanup();
});
