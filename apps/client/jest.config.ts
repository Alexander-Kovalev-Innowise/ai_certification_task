import type { Config } from 'jest';
import nextJest from 'next/jest.js';

// Task 10.3 — first task in Phase 10 that needs a real test runner (Phase 0
// only wired the `test` npm script, never a config). Uses `next/jest`
// (Next.js's official Jest transformer) rather than a hand-rolled ts-jest
// setup: it auto-mocks `next/font/local` (needed once component tests import
// anything that pulls in app/layout.tsx's font objects, Task 10.8) and CSS/
// image imports, using the same SWC compiler as `next dev`/`next build`, so
// tests never drift from the app's own compilation.
const createJestConfig = nextJest({
  dir: './',
});

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
};

export default createJestConfig(config);
