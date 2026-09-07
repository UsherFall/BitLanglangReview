// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketHeatResult } from '../src/domain/market-heat';
import { MarketHeatPanel } from '../src/ui/MarketHeatPanel';

const ENTRY = '2024-06-12T04:00:00.000Z';

const sample: MarketHeatResult = {
  tier: 'hot',
  stats: { poolSize: 80, coveredCount: 78, medianChangePct: 2.4, upCount: 61, downCount: 17, volatileCount: 12 },
  topGainers: [{ instrument: 'BTCUSDT', changePct: 6.2, windowQuoteVolume: 5_000_000_000, isReviewCoin: false }],
  topLosers: [{ instrument: 'NEARUSDT', changePct: -4.1, windowQuoteVolume: 100_000_000, isReviewCoin: false }],
  reviewCoin: { instrument: 'BTCUSDT', changePct: 6.2, windowQuoteVolume: 5_000_000_000, isReviewCoin: true },
  skipped: { closedCount: 3, noDataCount: 2, unmappedReviewInstrument: false },
  warnings: [],
};

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('MarketHeatPanel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and renders the tier, numbers, and boards for the entry anchor', async () => {
    const fetchMock = vi.fn(async (_url: string) => okResponse(sample));
    vi.stubGlobal('fetch', fetchMock);

    render(<MarketHeatPanel instrument="BTC-USDT-SWAP" entryTime={ENTRY} onClose={vi.fn()} />);

    expect(fetchMock).toHaveBeenCalledWith(`/api/market-heat?anchor=${Date.parse(ENTRY)}&instrument=BTC-USDT-SWAP`);
    await waitFor(() => expect(screen.getByText('热市')).toBeInTheDocument());
    expect(screen.getByText('涨幅榜')).toBeInTheDocument();
    expect(screen.getByText('跌幅榜')).toBeInTheDocument();
    // The reviewed coin row carries the review marker.
    expect(screen.getByText(/· 复盘币/)).toBeInTheDocument();
    // Skip summary joins closed + no-data members.
    expect(screen.getByText(/已跳过 3 个休市标的；2 个当时无行情/)).toBeInTheDocument();
    expect(screen.getByText(/锚点 2024-06-12 04:00/)).toBeInTheDocument();
    // There is no entry/exit anchor toggle.
    expect(screen.queryByRole('button', { name: '离场' })).not.toBeInTheDocument();
  });

  it('shows the server error message without a tier when the request fails', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ error: "币安 IP 被封(HTTP 418)，请稍后重试" }), { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MarketHeatPanel instrument="BTC-USDT-SWAP" entryTime={ENTRY} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('币安 IP 被封(HTTP 418)，请稍后重试')).toBeInTheDocument());
    expect(screen.queryByText('热市')).not.toBeInTheDocument();
  });
});
