import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearBitgetKeys, loadBitgetKeys, saveBitgetKeys } from '../src/server/bitget-keys';

const tmpPaths: string[] = [];

function tempKeyPath(): string {
  const file = path.join(os.tmpdir(), `bitget-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpPaths.push(file);
  return file;
}

afterEach(() => {
  for (const file of tmpPaths) clearBitgetKeys(file);
  tmpPaths.length = 0;
});

describe('Bitget keys file', () => {
  it('round-trips a key config through the file', () => {
    const keysPath = tempKeyPath();
    expect(loadBitgetKeys(keysPath)).toBeNull();
    saveBitgetKeys({ apiKey: 'k', secret: 's', passphrase: 'p' }, keysPath);
    expect(loadBitgetKeys(keysPath)).toEqual({ apiKey: 'k', secret: 's', passphrase: 'p' });
    expect(fs.existsSync(keysPath)).toBe(true);
  });

  it('rejects a config with missing fields', () => {
    expect(() => saveBitgetKeys({ apiKey: 'k', secret: '', passphrase: 'p' }, tempKeyPath())).toThrow();
  });

  it('clears the config', () => {
    const keysPath = tempKeyPath();
    saveBitgetKeys({ apiKey: 'k', secret: 's', passphrase: 'p' }, keysPath);
    clearBitgetKeys(keysPath);
    expect(loadBitgetKeys(keysPath)).toBeNull();
    expect(fs.existsSync(keysPath)).toBe(false);
  });

  it('treats a corrupt file as not configured', () => {
    const keysPath = tempKeyPath();
    fs.writeFileSync(keysPath, '{not json', 'utf8');
    expect(loadBitgetKeys(keysPath)).toBeNull();
  });
});
