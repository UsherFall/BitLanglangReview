import { describe, expect, it } from 'vitest';
import { freeReplayInstrumentPayload } from '../src/server/free-replay-instruments';

describe('Free Replay Instruments', () => {
  it('returns the Binance symbols the candle route can actually resolve', async () => {
    const instrumentService = {
      listTradableUsdtSymbols: async () => ['BTCUSDT', 'ETHUSDT'],
    };

    await expect(freeReplayInstrumentPayload(instrumentService)).resolves.toEqual({
      instruments: ['BTCUSDT', 'ETHUSDT'],
    });
  });

  it('propagates a metadata outage instead of reporting an empty instrument list', async () => {
    const instrumentService = {
      listTradableUsdtSymbols: async () => {
        throw new Error('币安合约信息不可用，暂时无法列出可复盘的交易对');
      },
    };

    // An empty list would read as "nothing is replayable" and strand the
    // reviewer, so the outage has to surface.
    await expect(freeReplayInstrumentPayload(instrumentService)).rejects.toThrow('币安合约信息不可用');
  });
});
