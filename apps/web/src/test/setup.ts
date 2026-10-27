import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are disabled, so Testing Library cannot register its implicit
// afterEach cleanup hook. Explicit cleanup prevents pending React work from
// leaking across jsdom teardown and producing window-is-undefined failures.
afterEach(() => cleanup());
