import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveDataPath } from '../src/server/data-root';

// The test file lives in <root>/tests, so the project root is one level up.
const expectedDataDir = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  'data',
);

describe('resolveDataPath', () => {
  it('resolves under the project data dir regardless of cwd', () => {
    const previous = process.cwd();
    try {
      // Launching the server from anywhere else must not create a fresh empty
      // data/ next to that directory (the "keys and trades lost after restart"
      // failure mode).
      process.chdir(os.tmpdir());
      expect(process.cwd()).not.toBe(path.dirname(expectedDataDir));
      expect(resolveDataPath('review.sqlite')).toBe(path.join(expectedDataDir, 'review.sqlite'));
      expect(resolveDataPath('bitget-keys.json')).toBe(path.join(expectedDataDir, 'bitget-keys.json'));
    } finally {
      process.chdir(previous);
    }
  });

  it('resolves an empty call to the data directory itself', () => {
    expect(resolveDataPath()).toBe(expectedDataDir);
  });
});
