// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

// Stub the chart like app-tag-management.test.tsx does; this test exercises the
// Bitget module flow, not chart rendering.
vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn() }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      coordinateToTime: vi.fn(),
      getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
      getVisibleRange: vi.fn(() => ({ from: 1000, to: 2000 })),
      options: vi.fn(() => ({ barSpacing: 6 })),
      setVisibleLogicalRange: vi.fn(),
      setVisibleRange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      timeToIndex: vi.fn(() => 150),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    }),
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
}));

function makeFetch(options: { configured: boolean; syncResult?: unknown; bitgetTrades?: unknown[] }) {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/api/bitget/config' && !init?.method) {
      return new Response(JSON.stringify({ configured: options.configured }));
    }
    if (url === '/api/bitget/config' && init?.method === 'POST') {
      return new Response(JSON.stringify({ configured: true }));
    }
    if (url === '/api/bitget/config' && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ configured: false }));
    }
    if (url === '/api/bitget/sync') {
      return new Response(JSON.stringify(options.syncResult ?? { fetchedRows: 0, uniqueRows: 0 }));
    }
    if (url.startsWith('/api/bitget/trades')) {
      return new Response(JSON.stringify({ trades: options.bitgetTrades ?? [], instruments: [], configured: options.configured, tags: [], tagCounts: {} }));
    }
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({ trades: [], instruments: [], tags: [], tagCounts: {} }));
    }
    if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [] }));
    if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
    if (url.startsWith('/api/free-replay/sessions')) return new Response(JSON.stringify({ sessions: [] }));
    if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: [] }));
    if (url === '/api/reviews') return new Response(init?.body ?? '{}');
    return new Response(JSON.stringify({}));
  });
}

function makeBitgetTrade() {
  return {
    id: 'bg-1',
    sequence: 1,
    instrument: 'BTC-USDT-SWAP',
    direction: '多',
    leverage: null,
    margin: null,
    entryPrice: 60000,
    exitPrice: 62000,
    returnRate: null,
    profit: 200,
    turnover: null,
    size: 0.1,
    maxPositionValue: null,
    fee: 1.2,
    entryTime: '2024-05-21T10:00:00+08:00',
    exitTime: '2024-05-21T11:00:00+08:00',
    holdingMinutes: 60,
    amplitude: null,
    sourceNote: 'bitget:history-position',
    review: null,
  };
}

describe('Bitget review module', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows the key setup form before a key is configured', async () => {
    const fetchMock = makeFetch({ configured: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '个人交割单复盘' }));
    await waitFor(() => expect(screen.getByPlaceholderText('API Key')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Secret')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Passphrase')).toBeInTheDocument();
    expect(screen.getByText(/只读权限/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('saving a key then syncing refreshes the queue', async () => {
    const fetchMock = makeFetch({ configured: false, syncResult: { fetchedRows: 2, uniqueRows: 2 } });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '个人交割单复盘' }));
    await waitFor(() => expect(screen.getByPlaceholderText('API Key')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'key' } });
    fireEvent.change(screen.getByPlaceholderText('Secret'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByPlaceholderText('Passphrase'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '同步仓位' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '同步仓位' }));
    await waitFor(() => expect(screen.getByText(/同步完成：拉取 2 条/)).toBeInTheDocument());
    // The trade queue endpoint for the Bitget source was hit.
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/bitget/trades'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('clears the stored key from the sync bar', async () => {
    const fetchMock = makeFetch({ configured: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '个人交割单复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '同步仓位' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '清除密钥' }));
    await waitFor(() => expect(screen.getByPlaceholderText('API Key')).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/bitget/config' && init?.method === 'DELETE')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('loads Binance candlesticks for a personal-review trade (source=binance)', async () => {
    const fetchMock = makeFetch({ configured: true, bitgetTrades: [makeBitgetTrade()] });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '个人交割单复盘' }));
    // The personal-review chart fetches its candlesticks from the Binance source.
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => {
        const target = String(url);
        return target.startsWith('/api/candles') && target.includes('source=binance');
      })).toBe(true);
    });
    vi.unstubAllGlobals();
  });
});
