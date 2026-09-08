import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Anchors the local review data directory to the project root instead of the
 * process working directory (`path.resolve('data', …)`).
 *
 * The dev server and tests are normally launched from the project root, but if
 * `npm run dev` starts from anywhere else, cwd-relative paths silently create a
 * fresh empty `data/` — Bitget keys and synced positions then look "lost" after
 * a restart. Resolving from this file's own location (`<root>/src/server`
 * upward) keeps every launch pointing at the same `data/`.
 *
 * `src/server/data-root.ts` → `<root>/src/server` → `<root>`.
 */
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, '..', '..');

/** Absolute path under `<projectRoot>/data`, e.g. resolveDataPath('review.sqlite'). */
export function resolveDataPath(...segments: string[]): string {
  return path.join(projectRoot, 'data', ...segments);
}
