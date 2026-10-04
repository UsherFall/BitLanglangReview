// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OtherCoinChart } from '../src/ui/OtherCoinChart';

const chartMocks = vi.hoisted(() => ({
  setData: vi.fn(),
  setVisibleRange: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: () => ({
    addSeries: () => ({
      setData: chartMocks.setData,
      priceToCoordinate: vi.fn(),
      coordinateToPrice: vi.fn(),
      barsInLogicalRange: vi.fn(() => ({ barsBefore: 100, barsAfter: 100 })),
    }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      timeToCoordinate: vi.fn(() => null),
      coordinateToTime: vi.fn(),
      getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
      getVisibleRange: vi.fn(),
      options: vi.fn(() => ({ barSpacing: 6 })),
      setVisibleLogicalRange: vi.fn(),
      setVisibleRange: chartMocks.setVisibleRange,
      subscribeVisibleLogicalRangeChange: chartMocks.subscribeVisibleLogicalRangeChange,
      subscribeVisibleTimeRangeChange: vi.fn(),
      timeToIndex: vi.fn(() => 150),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    }),
  }),
}));

const CURSOR_1000 = Date.parse('2024-05-21T10:00:00+08:00') / 1000;

function makeCandle(iso: string, close = 100) {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(iso),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  };
}

function makeSeries(from: string, stepMinutes: number, count: number) {
  const start = Date.parse(from);
  const step = stepMinutes * 60_000;
  return Array.from({ length: count }, (_, index) => makeCandle(new Date(start + index * step).toISOString(), 100 + index));
}

type CandleRequest = { mode: string; anchor: number | null; entryTime: string; instrument: string; source?: string };

function stubFetch(handler: (request: CandleRequest) => { candles: unknown[] } | Promise<{ candles: unknown[] }>) {
  const requests: CandleRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const parsed = new URL(`http://localhost${url}`);
    if (parsed.pathname === '/api/free-replay/instruments') {
      return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'] }));
    }
    if (parsed.pathname === '/api/candles') {
      const request: CandleRequest = {
        mode: parsed.searchParams.get('mode') ?? 'initial',
        anchor: parsed.searchParams.get('anchor') ? Number(parsed.searchParams.get('anchor')) : null,
        entryTime: parsed.searchParams.get('entryTime') ?? '',
        instrument: parsed.searchParams.get('instrument') ?? '',
        source: parsed.searchParams.get('source') ?? 'okx',
      };
      requests.push(request);
      return new Response(JSON.stringify(await handler(request)));
    }
    return new Response(JSON.stringify({}));
  }));
  return requests;
}

/** The bar times (in seconds) of the most recent `setData` call. */
function renderedBarTimes(): number[] {
  const calls = chartMocks.setData.mock.calls;
  const last = calls.at(-1)?.[0] as { time: number }[] | undefined;
  return (last ?? []).map((item) => Number(item.time));
}

describe('OtherCoinChart in Free Replay', () => {
  beforeEach(() => {
    chartMocks.setData.mockClear();
    chartMocks.setVisibleRange.mockClear();
    chartMocks.subscribeVisibleLogicalRangeChange.mockClear();
  });

  it('renders nothing past the replay cursor', async () => {
    const candles = makeSeries('2024-05-21T09:50:00+08:00', 5, 5); // 09:50 .. 10:10
    stubFetch(({ mode }) => ({ candles: mode === 'later' ? [] : candles }));

    render(<OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />);

    await waitFor(() => expect(chartMocks.setData).toHaveBeenCalled());
    expect(renderedBarTimes()).toEqual([
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      Date.parse('2024-05-21T10:00:00+08:00') / 1000,
    ]);
  });

  it('reveals a candlestick when the cursor advances, without reloading the window', async () => {
    const candles = makeSeries('2024-05-21T09:50:00+08:00', 5, 5);
    const requests = stubFetch(({ mode }) => ({ candles: mode === 'later' ? [] : candles }));

    const { rerender } = render(
      <OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />,
    );
    await waitFor(() => expect(chartMocks.setData).toHaveBeenCalled());
    const initialRequests = requests.filter((request) => request.mode === 'initial').length;

    rerender(
      <OtherCoinChart
        entryTime="2024-05-21T10:05:00.000Z"
        timeframe="5m"
        cursorTime={CURSOR_1000 + 300}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(renderedBarTimes().at(-1)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000));
    // The moving cursor must not re-download the +/-150 window on every reveal.
    expect(requests.filter((request) => request.mode === 'initial').length).toBe(initialRequests);
  });

  it('hides candlesticks again when the cursor rewinds', async () => {
    const candles = makeSeries('2024-05-21T09:50:00+08:00', 5, 5);
    stubFetch(({ mode }) => ({ candles: mode === 'later' ? [] : candles }));

    const { rerender } = render(
      <OtherCoinChart entryTime="2024-05-21T10:05:00.000Z" timeframe="5m" cursorTime={CURSOR_1000 + 300} onClose={() => {}} />,
    );
    await waitFor(() => expect(renderedBarTimes().at(-1)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000));

    rerender(
      <OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />,
    );

    await waitFor(() => expect(renderedBarTimes().at(-1)).toBe(Date.parse('2024-05-21T10:00:00+08:00') / 1000));
  });

  it('prefetches later candlesticks into the loaded set without revealing them', async () => {
    const loaded = makeSeries('2024-05-21T09:50:00+08:00', 5, 3); // 09:50 .. 10:00
    const future = makeSeries('2024-05-21T10:05:00+08:00', 5, 2); // 10:05, 10:10
    const requests = stubFetch(({ mode }) => ({ candles: mode === 'later' ? future : loaded }));

    render(<OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />);

    // The cursor sits on the last loaded bar, so a later prefetch must fire.
    await waitFor(() => expect(requests.filter((request) => request.mode === 'later').length).toBeGreaterThan(0));
    // ...but the prefetched future stays invisible until the cursor reaches it.
    expect(renderedBarTimes().at(-1)).toBe(Date.parse('2024-05-21T10:00:00+08:00') / 1000);
  });

  it('retries the prefetch after a failure instead of freezing at the loaded edge', async () => {
    const loaded = makeSeries('2024-05-21T09:50:00+08:00', 5, 3);
    const future = makeSeries('2024-05-21T10:05:00+08:00', 5, 2);
    let laterCalls = 0;
    const requests = stubFetch(({ mode }) => {
      if (mode !== 'later') return { candles: loaded };
      laterCalls += 1;
      if (laterCalls === 1) throw new Error('network down');
      return { candles: future };
    });

    const { rerender } = render(
      <OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />,
    );
    await waitFor(() => expect(laterCalls).toBe(1));
    await waitFor(() => expect(screen.getByText('K 线加载失败')).toBeInTheDocument());

    // A failed prefetch must not leave a sticky guard: moving the cursor gives
    // the same position another chance.
    await act(async () => {
      rerender(
        <OtherCoinChart
          entryTime="2024-05-21T10:05:00.000Z"
          timeframe="5m"
          cursorTime={CURSOR_1000 + 300}
          onClose={() => {}}
        />,
      );
    });

    await waitFor(() => expect(requests.filter((request) => request.mode === 'later').length).toBeGreaterThan(1));
  });

  it('re-anchors on the cursor when the reviewed instrument changes', async () => {
    const candles = makeSeries('2024-05-21T09:50:00+08:00', 5, 5);
    const requests = stubFetch(({ mode }) => ({ candles: mode === 'later' ? [] : candles }));

    const { rerender } = render(
      <OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />,
    );
    await waitFor(() => expect(requests.filter((request) => request.mode === 'initial').length).toBe(1));

    // Move the cursor before switching instruments, so an anchor captured at
    // mount time would be stale and visibly wrong.
    rerender(
      <OtherCoinChart
        entryTime="2024-05-21T10:05:00.000Z"
        timeframe="5m"
        cursorTime={CURSOR_1000 + 300}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(renderedBarTimes().at(-1)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000));

    const search = screen.getByPlaceholderText('搜索其他币，如 ETH');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'ETH');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const ethButton = await screen.findByRole('button', { name: 'ETH-USDT-SWAP' });
    await act(async () => {
      ethButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    await waitFor(() => {
      const ethRequests = requests.filter((request) => request.instrument === 'ETH-USDT-SWAP' && request.mode === 'initial');
      expect(ethRequests.length).toBe(1);
      expect(ethRequests[0].entryTime).toBe('2024-05-21T10:05:00.000Z');
    });
  });

  it('opens on an instrument its own source can resolve', async () => {
    const requests: CandleRequest[] = [];
    stubFetch((request) => {
      requests.push(request);
      return { candles: makeSeries('2026-05-21T09:50:00+08:00', 5, 3) };
    });

    // Replay mode is bound to Binance, so its opening instrument must be a
    // Binance symbol. Defaulting to the OKX name made the panel's first load
    // fail outright (`Binance request failed: HTTP 400`).
    const { unmount } = render(
      <OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" cursorTime={CURSOR_1000} onClose={() => {}} />,
    );
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests[0].instrument).toBe('BTCUSDT');
    expect(requests[0].instrument).not.toContain('-');
    unmount();

    // Trade review keeps the OKX default, which that source carries.
    const tradeRequests: CandleRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(`http://localhost${url}`);
      if (parsed.pathname === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: [] }));
      tradeRequests.push({
        mode: parsed.searchParams.get('mode') ?? 'initial',
        anchor: null,
        entryTime: '',
        instrument: parsed.searchParams.get('instrument') ?? '',
      });
      return new Response(JSON.stringify({ candles: makeSeries('2026-05-21T09:50:00+08:00', 5, 3) }));
    }));
    render(<OtherCoinChart entryTime="2024-05-21T10:00:00+08:00" timeframe="5m" onClose={() => {}} />);
    await waitFor(() => expect(tradeRequests.length).toBeGreaterThan(0));
    expect(tradeRequests[0].instrument).toBe('BTC-USDT-SWAP');
  });

  it('reads the venue it is told to, so the panel matches the chart beside it', async () => {
    // Personal review's main chart runs on the Binance candidate chain while
    // 交割单复盘's runs on OKX. A panel that ignored this showed QNT at 46 next
    // to a main chart at 263 — two venues on one screen.
    const personal: CandleRequest[] = [];
    stubFetch((request) => {
      personal.push(request);
      return { candles: makeSeries('2024-05-21T09:50:00+08:00', 5, 3) };
    });

    const { unmount } = render(
      <OtherCoinChart entryTime="2024-05-21T10:00:00+08:00" timeframe="5m" candleSource="binance" onClose={() => {}} />,
    );
    await waitFor(() => expect(personal.length).toBeGreaterThan(0));
    // `binance-only`, not the candidate chain: the panel already holds a native
    // Binance symbol from the instrument list, and the chain only matches
    // `*-USDT-SWAP`, so it would answer with an empty window.
    expect(personal[0].source).toBe('binance-only');
    // The Binance panel must open on a Binance symbol, not the OKX default.
    expect(personal[0].instrument).toBe('BTCUSDT');
    unmount();

    const workbook: CandleRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(`http://localhost${url}`);
      if (parsed.pathname === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: [] }));
      workbook.push({
        mode: parsed.searchParams.get('mode') ?? 'initial',
        anchor: null,
        entryTime: '',
        instrument: parsed.searchParams.get('instrument') ?? '',
        source: parsed.searchParams.get('source') ?? 'okx',
      });
      return new Response(JSON.stringify({ candles: makeSeries('2024-05-21T09:50:00+08:00', 5, 3) }));
    }));
    render(<OtherCoinChart entryTime="2024-05-21T10:00:00+08:00" timeframe="5m" onClose={() => {}} />);
    await waitFor(() => expect(workbook.length).toBeGreaterThan(0));
    expect(workbook[0].source).toBe('okx');
    expect(workbook[0].instrument).toBe('BTC-USDT-SWAP');
  });

  it('offers instruments its own source can actually load', async () => {
    // The regression this guards: the panel listed Binance symbols
    // (`BTCUSDT`) while requesting the candidate chain, which only accepts
    // OKX-style names and answers a Binance symbol with an empty window. The
    // panel rendered blank in 个人交割单复盘 with no error to explain it.
    const listSources: string[] = [];
    const candleSources: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(`http://localhost${url}`);
      if (parsed.pathname === '/api/free-replay/instruments') {
        listSources.push(parsed.searchParams.get('source') ?? 'binance');
        const okx = parsed.searchParams.get('source') === 'okx';
        return new Response(JSON.stringify({ instruments: okx ? ['BTC-USDT-SWAP'] : ['BTCUSDT'] }));
      }
      if (parsed.pathname === '/api/candles') {
        candleSources.push(parsed.searchParams.get('source') ?? 'okx');
        return new Response(JSON.stringify({ candles: makeSeries('2024-05-21T09:50:00+08:00', 5, 3) }));
      }
      return new Response(JSON.stringify({}));
    }));

    // Personal review: main chart on Binance, so the panel must both list and
    // read Binance.
    const { unmount } = render(
      <OtherCoinChart entryTime="2024-05-21T10:00:00+08:00" timeframe="5m" candleSource="binance" onClose={() => {}} />,
    );
    await waitFor(() => expect(candleSources.length).toBeGreaterThan(0));
    expect(listSources).toEqual(['binance']);
    // `binance` (the candidate chain) would swallow a Binance symbol; the
    // panel already knows the native symbol, so it reads Binance directly.
    expect(candleSources[0]).toBe('binance-only');
    expect(listSources[0]).toBe(candleSources[0] === 'binance-only' ? 'binance' : 'okx');
    unmount();

    // Trade review: the panel is OKX-backed, so it needs OKX names.
    const okxLists: string[] = [];
    const okxCandles: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(`http://localhost${url}`);
      if (parsed.pathname === '/api/free-replay/instruments') {
        okxLists.push(parsed.searchParams.get('source') ?? 'binance');
        return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
      }
      if (parsed.pathname === '/api/candles') {
        okxCandles.push(parsed.searchParams.get('source') ?? 'okx');
        return new Response(JSON.stringify({ candles: makeSeries('2024-05-21T09:50:00+08:00', 5, 3) }));
      }
      return new Response(JSON.stringify({}));
    }));
    render(<OtherCoinChart entryTime="2024-05-21T10:00:00+08:00" timeframe="5m" onClose={() => {}} />);
    await waitFor(() => expect(okxCandles.length).toBeGreaterThan(0));
    expect(okxLists).toEqual(['okx']);
    expect(okxCandles[0]).toBe('okx');
  });

  it('shows every loaded candlestick in trade review, where there is no cursor', async () => {
    const candles = makeSeries('2024-05-21T09:50:00+08:00', 5, 5);
    stubFetch(({ mode }) => ({ candles: mode === 'later' ? [] : candles }));

    render(<OtherCoinChart entryTime="2024-05-21T10:00:00.000Z" timeframe="5m" onClose={() => {}} />);

    await waitFor(() => expect(chartMocks.setData).toHaveBeenCalled());
    expect(renderedBarTimes()).toHaveLength(5);
    expect(renderedBarTimes().at(-1)).toBe(Date.parse('2024-05-21T10:10:00+08:00') / 1000);
  });
});
