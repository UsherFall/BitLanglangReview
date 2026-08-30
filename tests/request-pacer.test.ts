import { describe, expect, it } from 'vitest';
import { createRequestPacer } from '../src/server/coin-scan-service';

// Jitter 0 keeps the tests deterministic: pace() then waits exactly minIntervalMs.

describe('createRequestPacer', () => {
  it('spaces consecutive request starts at least minIntervalMs apart', async () => {
    const pacer = createRequestPacer(40, 0);
    const t0 = Date.now();
    await pacer.pace();
    await pacer.pace();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it('serializes a concurrent burst into minIntervalMs-spaced starts', async () => {
    const pacer = createRequestPacer(40, 0);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 4 }, () => pacer.pace()));
    // 4 starts land at t0, +40, +80, +120 → the last finishes ~120ms in.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(115);
  });
});
