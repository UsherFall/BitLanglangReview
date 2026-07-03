import { describe, expect, it } from 'vitest';
import { freeReplayInstrumentPayload } from '../src/server/free-replay-instruments';

describe('Free Replay Instruments', () => {
  it('returns selectable instruments for Free Replay', async () => {
    const instrumentService = {
      listSwapInstruments: async () => ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
    };

    await expect(freeReplayInstrumentPayload(instrumentService)).resolves.toEqual({
      instruments: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
    });
  });
});
