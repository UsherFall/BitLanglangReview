import fs from 'node:fs';
import path from 'node:path';
import { resolveDataPath } from './data-root';

export type BitgetKeyConfig = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

const DEFAULT_KEYS_PATH = resolveDataPath('bitget-keys.json');

export function loadBitgetKeys(keysPath = DEFAULT_KEYS_PATH): BitgetKeyConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(keysPath, 'utf8');
  } catch {
    return null; // Missing file == not configured.
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BitgetKeyConfig>;
    return isKeyConfig(parsed) ? { apiKey: parsed.apiKey, secret: parsed.secret, passphrase: parsed.passphrase } : null;
  } catch {
    return null;
  }
}

export function saveBitgetKeys(config: BitgetKeyConfig, keysPath = DEFAULT_KEYS_PATH): void {
  if (!isKeyConfig(config)) throw new Error('apiKey, secret, and passphrase are all required');
  fs.mkdirSync(path.dirname(keysPath), { recursive: true });
  fs.writeFileSync(keysPath, JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export function clearBitgetKeys(keysPath = DEFAULT_KEYS_PATH): void {
  try {
    fs.rmSync(keysPath, { force: true });
  } catch {
    // Already gone or unremovable — treat as cleared.
  }
}

function isKeyConfig(config: Partial<BitgetKeyConfig>): config is BitgetKeyConfig {
  return typeof config.apiKey === 'string' && config.apiKey.length > 0
    && typeof config.secret === 'string' && config.secret.length > 0
    && typeof config.passphrase === 'string' && config.passphrase.length > 0;
}
