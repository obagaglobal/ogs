import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

// Routes are code-split (React.lazy): the first visit to a page waits for its
// chunk, which Vite transforms on demand in tests. Give findBy* room for that.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
