import { describe, expect, it, vi } from 'vitest';
import { OkxInstrumentService } from '../src/server/okx-instrument-service';

describe('OKX Instrument Service', () => {
  it('loads sorted SWAP instruments from OKX public instruments', async () => {
    const fetchJson = vi.fn(async (_url: string) => ({
      data: [
        { instId: 'ETH-USDT-SWAP' },
        { instId: 'BTC-USDT-SWAP' },
      ],
    }));
    const service = new OkxInstrumentService(fetchJson);

    await expect(service.listSwapInstruments()).resolves.toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]?.[0]).toBe('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
  });
});
