import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // The React app tests mount App under jsdom and are CPU-bound. With the whole
    // suite running in parallel on 8 cores, wall-clock alone can exceed Vitest's
    // 5s default (no assertion is involved) — app-tag-management sits right on
    // that line. 20s keeps the suite reliable without weakening any assertion.
    testTimeout: 20_000,
  },
});
