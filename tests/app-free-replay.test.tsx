// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

const chartMocks = vi.hoisted(() => ({
  barsInLogicalRange: vi.fn(() => ({ barsBefore: 100, barsAfter: 100 })),
  coordinateToPrice: vi.fn(() => 110),
  /** createChart 入参（11/03：断言回溯复盘关闭 shiftVisibleRangeOnNewBar）。 */
  createChartOptions: [] as Array<Record<string, unknown>>,
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
  getVisibleRange: vi.fn(),
  /** 最近一次 series.setData 调用捕获（10-30 整窗替换：断言渲染数据无跨空洞缝）。 */
  setData: vi.fn(),
  priceScaleApplyOptions: vi.fn(),
  setVisibleLogicalRange: vi.fn(),
  setVisibleRange: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
  timeToIndex: vi.fn(() => 150),
  timeScaleOptions: vi.fn(() => ({ barSpacing: 6 })),
  /** Trade-marker primitives attached to the candlestick series (11/02:
   * Free Replay 的开平仓点集断言走 primitive，不再用内置箭头标记）。 */
  primitives: [] as { currentPoints: () => readonly unknown[] }[],
  attachPrimitive: vi.fn((primitive: { currentPoints: () => readonly unknown[] }) => {
    chartMocks.primitives.push(primitive);
  }),
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: (_element: unknown, options: Record<string, unknown>) => {
    chartMocks.createChartOptions.push(options);
    return ({
      addSeries: () => ({ setData: chartMocks.setData, priceToCoordinate: vi.fn(), attachPrimitive: chartMocks.attachPrimitive, coordinateToPrice: chartMocks.coordinateToPrice, barsInLogicalRange: chartMocks.barsInLogicalRange }),
      remove: vi.fn(),
      priceScale: () => ({ applyOptions: chartMocks.priceScaleApplyOptions }),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      timeScale: () => ({
        timeToCoordinate: vi.fn(() => null),
        coordinateToTime: vi.fn(),
        getVisibleLogicalRange: chartMocks.getVisibleLogicalRange,
        getVisibleRange: chartMocks.getVisibleRange,
        options: chartMocks.timeScaleOptions,
        setVisibleLogicalRange: chartMocks.setVisibleLogicalRange,
        setVisibleRange: chartMocks.setVisibleRange,
        subscribeVisibleLogicalRangeChange: chartMocks.subscribeVisibleLogicalRangeChange,
        subscribeVisibleTimeRangeChange: vi.fn(),
        timeToIndex: chartMocks.timeToIndex,
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleTimeRangeChange: vi.fn(),
      }),
    });
  },
}));

/** Points currently held by the newest mounted chart's marker primitive. */
function markerPoints(): readonly unknown[] {
  const primitive = chartMocks.primitives[chartMocks.primitives.length - 1];
  return primitive ? primitive.currentPoints() : [];
}

describe('App Free Replay', () => {
  beforeEach(() => {
    chartMocks.barsInLogicalRange.mockClear();
    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 100, barsAfter: 100 });
    chartMocks.createChartOptions.length = 0;
    chartMocks.coordinateToPrice.mockClear();
    chartMocks.coordinateToPrice.mockReturnValue(110);
    chartMocks.getVisibleRange.mockReturnValue({ from: 1000, to: 2000 });
    chartMocks.getVisibleLogicalRange.mockClear();
    chartMocks.getVisibleLogicalRange.mockReturnValue({ from: 0, to: 160 });
    chartMocks.priceScaleApplyOptions.mockClear();
    chartMocks.primitives.length = 0;
    chartMocks.setData.mockClear();
    chartMocks.setVisibleLogicalRange.mockClear();
    chartMocks.setVisibleRange.mockClear();
    chartMocks.subscribeVisibleLogicalRangeChange.mockClear();
    chartMocks.timeToIndex.mockClear();
    chartMocks.timeToIndex.mockReturnValue(150);
    chartMocks.timeScaleOptions.mockClear();
    chartMocks.timeScaleOptions.mockReturnValue({ barSpacing: 6 });
  });

  it('keeps the workspace rendered after starting Free Replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());
    expect(screen.queryByText('选择交易对和开始时间，开始回溯复盘')).not.toBeInTheDocument();
    // 11/03：头部不再提供进行中会话的行情源切换 —— 源只在新会话创建时选。
    expect(screen.queryByLabelText('切换行情源')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
  });

  it('keeps initial candles visible through StrictMode effect replay', async () => {
    stubFreeReplayFetch({
      onCandles: () => Response.json({ candles: [
        makeCandle('2024-05-21T09:55:00+08:00'),
        makeCandle('2024-05-21T10:00:00+08:00'),
        makeCandle('2024-05-21T10:05:00+08:00'),
      ] }),
    });

    render(<StrictMode><App /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());
    await waitFor(() => expect(lastSetDataRealTimes().length).toBeGreaterThan(0));
  });

  it('collapses the whole sidebar via the explicit collapse button', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T10:00:00+08:00')] }));
      }
      return new Response(JSON.stringify({}));
    }));

    const { container } = render(<App />);

    fireEvent.click(screen.getByLabelText('收起侧边栏'));
    expect(container.querySelector('.sidebar.collapsed')).not.toBeNull();
    expect(screen.queryByLabelText('收起侧边栏')).not.toBeInTheDocument();

    window.localStorage.clear();
  });

  it('supports a paper trading market open and close during Free Replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    await waitFor(() => expect(screen.getAllByText('+100.00 USDT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('10.00%').length).toBeGreaterThan(0);
  });

  it('scrolls the Free Replay viewport without changing zoom when advancing the cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
            makeCandle('2024-05-21T10:10:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());
    chartMocks.setVisibleRange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    const nextCursor = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: nextCursor - 1000 + 3000,
      to: nextCursor + 3000,
    }));
  });

  it('leaves the viewport untouched while the cursor stays inside the view', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
            makeCandle('2024-05-21T10:10:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    // A viewport the user positioned themselves (pinned/zoomed however they
    // like), with the cursor well inside it: the session starts at 09:55 and
    // one reveal reaches 10:00.
    const initialCursor = Date.parse('2024-05-21T09:55:00+08:00') / 1000;
    chartMocks.getVisibleRange.mockReturnValue({ from: initialCursor - 4000, to: initialCursor + 6000 });
    chartMocks.setVisibleRange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '上一根 K 线' }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    // 10/28: stepping next/previous inside the comfort zone must not re-anchor
    // the viewport at all — no yanking of a view the user positioned.
    expect(chartMocks.setVisibleRange).not.toHaveBeenCalled();
  });

  it('re-anchors with left-edge padding when the cursor falls out the left side of the view', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
            makeCandle('2024-05-21T10:10:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    // The viewport sits to the RIGHT of the cursor (the user rewound or panned
    // ahead): the reveal cursor has fallen out the LEFT edge.
    const nextCursor = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    const from = nextCursor + 1;
    const to = nextCursor + 13200;
    chartMocks.getVisibleRange.mockReturnValue({ from, to });
    chartMocks.setVisibleRange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    // Mirror of the right-edge invariant: the cursor lands 10 steps from the
    // LEFT edge, span preserved.
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: nextCursor - 3000,
      to: nextCursor - 3000 + (to - from),
    }));
  });

  it('starts Free Replay with the cursor visible and right-side padding', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T00:00:00+08:00'),
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    const cursor = Date.parse('2024-05-21T09:55:00+08:00') / 1000;
    const step = 5 * 60;
    void cursor;
    void step;
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
  });

  it('toggles Free Replay paper trade open/close points through the marker primitive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    // 11/02：开/平点是 TradeMarkerPrimitive 画布圆点（交割单复盘同一套）。
    // 开仓完成于 10:00 → 锚到 09:55 蜡烛；平仓完成于 10:05 → 锚到 10:00 蜡烛。
    await waitFor(() => {
      const points = markerPoints() as Array<{ kind: string; price: number }>;
      expect(points.some((point) => point.kind === 'open' && point.price === 100)).toBe(true);
      expect(points.some((point) => point.kind === 'close' && point.price === 110)).toBe(true);
    });

    // 眼睛隐藏态：无焦点单 → 没有可保留的单子，全隐（交割单复盘语义）。
    fireEvent.click(screen.getByLabelText('隐藏开平仓标记'));
    await waitFor(() => expect(markerPoints()).toHaveLength(0));

    fireEvent.click(screen.getByLabelText('显示开平仓标记'));
    await waitFor(() => expect((markerPoints() as unknown[]).length).toBeGreaterThanOrEqual(2));
  });

  it('keeps only the focused order points when the markers are hidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    // 两个回合：开/平、再开/再平（都在同一根已揭示蜡烛上）。
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    await waitFor(() => expect((markerPoints() as unknown[]).length).toBe(4));

    // 单子 Tab：点第二回合的成交行 → 焦点单。
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const orderRows = screen.getAllByTitle('跳到开仓点');
    expect(orderRows).toHaveLength(2);
    fireEvent.click(orderRows[1]);

    // 眼睛隐藏后只留焦点单：回合二的开仓点（position-4）+ 它自己的平仓点（fill-6）。
    fireEvent.click(screen.getByLabelText('隐藏开平仓标记'));
    await waitFor(() => {
      const points = markerPoints() as Array<{ kind: string; tradeId: string }>;
      expect(points).toHaveLength(2);
      expect(new Set(points.map((point) => point.tradeId))).toEqual(new Set(['position-4', 'fill-6']));
    });

    // 再点恢复全部四点。
    fireEvent.click(screen.getByLabelText('显示开平仓标记'));
    await waitFor(() => expect((markerPoints() as unknown[]).length).toBe(4));
  });

  it('disables shiftVisibleRangeOnNewBar on the Free Replay chart (11/03 focus drag drift fix)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')] }));
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(chartMocks.createChartOptions.length).toBeGreaterThan(0));

    const options = chartMocks.createChartOptions[chartMocks.createChartOptions.length - 1];
    expect((options.timeScale as { shiftVisibleRangeOnNewBar?: boolean }).shiftVisibleRangeOnNewBar).toBe(false);
  });

  it('does not page later while the focus window already reaches the reveal boundary (no request storm)', async () => {
    const candleRequests: string[] = [];
    let initialFetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        // 游标窗口：光标 10:00 前方留足 24 根（> 预取阈值 20），不触发预取。
        const cursorWindow = ['09:55', '10:00', '10:05', '10:10', '10:15', '10:20', '10:25', '10:30', '10:35', '10:40', '10:45', '10:50', '10:55', '11:00', '11:05', '11:10', '11:15', '11:20', '11:25', '11:30', '11:35', '11:40', '11:45', '11:50', '11:55'].map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
        if (mode === 'initial') {
          initialFetchCount += 1;
          // 第二次 initial = 焦点取窗：窗口右缘恰在揭示边界上（刚平的单，
          // 游标 = 完成于开始时刻的 09:55 那根）。
          return new Response(JSON.stringify({ candles: initialFetchCount === 1 ? cursorWindow : [makeCandle('2024-05-21T09:45:00+08:00'), makeCandle('2024-05-21T09:50:00+08:00'), makeCandle('2024-05-21T09:55:00+08:00')] }));
        }
        // earlier（历史回填）/ later：返回空，断言全靠 candleRequests 记录。
        return new Response(JSON.stringify({ candles: [] }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    // 点成交行进焦点态，等焦点窗口（[09:45, 09:50, 09:55]）落地成渲染数据。
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getAllByTitle('跳到开仓点')[0]);
    await waitFor(() => {
      const lastCall = chartMocks.setData.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
      expect(lastCall.filter((item) => 'open' in item).map((item) => item.time)).toEqual([
        Date.parse('2024-05-21T09:45:00+08:00') / 1000,
        Date.parse('2024-05-21T09:50:00+08:00') / 1000,
        Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      ]);
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    // 向右拖到焦点窗口右缘（barsAfter < 50），连续三个不同 logical range 的拖动帧：
    // 揭示边界闸关闭（焦点窗口右缘 == cursorTime），零 mode=later 请求（修复前
    // 每帧都会再取一页 —— 请求风暴）。
    expect(candleRequests.filter((url) => url.includes('mode=later'))).toEqual([]);
    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 100, barsAfter: 5 });
    const handler = chartMocks.subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    expect(handler).toBeTypeOf('function');
    handler?.({ from: 0, to: 160 });
    handler?.({ from: 1, to: 161 });
    handler?.({ from: 2, to: 162 });
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(candleRequests.filter((url) => url.includes('mode=later'))).toEqual([]);
  });

  it('still pages later when the focus window right edge falls behind the cursor', async () => {
    const candleRequests: string[] = [];
    let initialFetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        // 游标窗口：光标 09:55 前方留足 24 根（> 预取阈值 20），不触发预取。
        const cursorWindow = ['09:55', '10:00', '10:05', '10:10', '10:15', '10:20', '10:25', '10:30', '10:35', '10:40', '10:45', '10:50', '10:55', '11:00', '11:05', '11:10', '11:15', '11:20', '11:25', '11:30', '11:35', '11:40', '11:45', '11:50', '11:55'].map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
        if (mode === 'initial') {
          initialFetchCount += 1;
          // 第二次 initial = 焦点取窗：老单场景，窗口整体早于游标（09:55）。
          return new Response(JSON.stringify({ candles: initialFetchCount === 1
            ? cursorWindow
            : [makeCandle('2024-05-21T09:00:00+08:00'), makeCandle('2024-05-21T09:05:00+08:00'), makeCandle('2024-05-21T09:10:00+08:00')] }));
        }
        if (mode === 'later') {
          return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:15:00+08:00'), makeCandle('2024-05-21T09:20:00+08:00')] }));
        }
        return new Response(JSON.stringify({ candles: [] }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    // 焦点窗口（[09:00, 09:05, 09:10]）落地。
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getAllByTitle('跳到开仓点')[0]);
    await waitFor(() => {
      const lastCall = chartMocks.setData.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
      expect(lastCall.filter((item) => 'open' in item).map((item) => item.time)).toEqual([
        Date.parse('2024-05-21T09:00:00+08:00') / 1000,
        Date.parse('2024-05-21T09:05:00+08:00') / 1000,
        Date.parse('2024-05-21T09:10:00+08:00') / 1000,
      ]);
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    // 右缘拖动 → 恰一次 mode=later，锚在焦点窗口最后一根（09:10）。
    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 100, barsAfter: 5 });
    const handler = chartMocks.subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    expect(handler).toBeTypeOf('function');
    handler?.({ from: 0, to: 160 });
    await waitFor(() => expect(candleRequests.filter((url) => url.includes('mode=later')).length).toBe(1));
    const laterRequest = candleRequests.find((url) => url.includes('mode=later')) ?? '';
    expect(laterRequest).toContain(`anchor=${Date.parse('2024-05-21T09:10:00+08:00')}`);

    // 同一 logical range 再拖不重发（既有去重不破）。
    handler?.({ from: 0, to: 160 });
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(candleRequests.filter((url) => url.includes('mode=later')).length).toBe(1);
  });

  // 11/04：拖动进行中的追加型 setData 会让 LWC 的拖动快照撤销视口补偿（见
  // research/findings.md）—— 指针按住期间的右缘翻页/补洞只更新数据层，渲染
  // 推迟到 pointerup。以下三例覆盖推迟/释放 flush/补洞/非拖动对照。
  it('defers the focused later page render while the pointer is down, then flushes on release', async () => {
    const laterCandles = [makeCandle('2024-05-21T09:15:00+08:00'), makeCandle('2024-05-21T09:20:00+08:00')];
    stubFocusPagingFetch(laterCandles);

    await startReplayCloseTradeAndFocus();
    expect(lastSetDataRealTimes()).toEqual(focusPageTimes());

    const chartWrap = document.querySelector('.free-replay-workspace .chart-wrap') as HTMLElement;
    // 指针按住（拖动中）→ 右缘翻页落地。
    fireEvent.pointerDown(chartWrap);
    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 100, barsAfter: 5 });
    triggerLaterLoad({ from: 0, to: 160 });
    await waitFor(() => expect(laterRequests().length).toBe(1));
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    // 渲染未发生：仍是焦点窗口那一页（本次拖动中零 setData）。
    expect(lastSetDataRealTimes()).toEqual(focusPageTimes());

    // 松手 → flush → 渲染追加后的合并结果（相邻恒等于一个 5m step）。
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([...focusPageTimes(), ...laterCandles.map((candle) => candle.timestamp / 1000)]));

    // R4：翻页闸读的是数据层（指针按住时已合并），拖到新位置能继续预载下一页
    // —— 锚点就是刚落地那页的最后一根，不重演旧锚请求风暴。
    triggerLaterLoad({ from: 40, to: 200 });
    await waitFor(() => expect(laterRequests().length).toBe(2));
    expect(laterRequests().at(-1) ?? '').toContain(`anchor=${laterCandles[laterCandles.length - 1].timestamp}`);
  });

  it('renders the focused later page immediately when the pointer is not down', async () => {
    const laterCandles = [makeCandle('2024-05-21T09:15:00+08:00'), makeCandle('2024-05-21T09:20:00+08:00')];
    stubFocusPagingFetch(laterCandles);

    await startReplayCloseTradeAndFocus();
    expect(lastSetDataRealTimes()).toEqual(focusPageTimes());

    // 对照：无 pointerdown（滑鼠滚轮/键盘/程序化平移）→ 照常立即渲染（11/03 语义）。
    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 100, barsAfter: 5 });
    triggerLaterLoad({ from: 0, to: 160 });
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([...focusPageTimes(), ...laterCandles.map((candle) => candle.timestamp / 1000)]));
  });

  it('defers the gap-heal window render while the pointer is down, then flushes on release', async () => {
    // 游标窗口自带中段洞（09:15 → 09:45 缺 6 根 5m），洞在光标（10:00）之前，
    // 补上的蜡烛会真的进渲染。洞补齐窗的响应由本用例手动放行，以便在它
    // 落在「指针按住」窗口时观察推迟。
    let releaseHeal: (() => void) | null = null;
    stubFreeReplayFetch({
      onCandles: (url) => {
        if (String(url).includes('entryTime=2024-05-21+10%3A00')) {
          return Response.json({ candles: ['09:00', '09:05', '09:10', '09:15', '09:45', '09:50', '09:55']
            .map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`)) });
        }
        // 洞补齐窗（ISO entryTime，中心在缺口内 = UTC 01:3x）。
        if (String(url).includes('entryTime=2024-05-21T01%3A')) {
          return new Promise<Response>((resolve) => {
            releaseHeal = () => resolve(Response.json({ candles: ['09:20', '09:25', '09:30', '09:35', '09:40']
              .map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`)) }));
          });
        }
        return Response.json({ candles: [] });
      },
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    // 首屏（含洞）渲染完成。
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:00', '09:05', '09:10', '09:15', '09:45', '09:50', '09:55']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));
    // 洞自愈请求已发出（响应被本用例暂扣）。
    await waitFor(() => expect(releaseHeal).not.toBeNull());
    chartMocks.setData.mockClear();

    // 指针按住时洞窗落地：数据层合并、渲染推迟 → 本次没有任何 setData。
    const chartWrap = document.querySelector('.free-replay-workspace .chart-wrap') as HTMLElement;
    fireEvent.pointerDown(chartWrap);
    releaseHeal!();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    // 渲染载荷仍是「洞还开着」的那份：合并后的补洞蜡烛一根都没进 series。
    expect(lastSetDataRealTimes()).toEqual(['09:00', '09:05', '09:10', '09:15', '09:45', '09:50', '09:55']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000));

    // 松手 → flush 渲染补洞后的连续数据。
    fireEvent.pointerUp(window);
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:00', '09:05', '09:10', '09:15', '09:20', '09:25', '09:30', '09:35', '09:40', '09:45', '09:50', '09:55']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));
  });

  it('sets a stop loss and closes automatically when the next revealed candle touches it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:00:00+08:00', { low: 94, high: 101, close: 96 }),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.change(screen.getByLabelText('仓1 止损价'), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: '设仓1止损' }));

    expect(screen.getByLabelText('仓1 止损价')).toHaveValue('95');

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    await waitFor(() => expect(screen.getAllByText('-50.00 USDT').length).toBeGreaterThan(0));
    expect(screen.queryByLabelText(/删除仓1止损/)).not.toBeInTheDocument();
  });

  it('shows Free Replay hover percentage from the latest revealed candle close', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:00:00+08:00', { close: 120 }),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    const chartWrap = document.querySelector('.free-replay-workspace .chart-wrap') as HTMLElement;
    fireEvent.pointerMove(chartWrap, { clientY: 24 });

    expect(await screen.findByText('+10.00%')).toBeInTheDocument();
    expect(chartMocks.coordinateToPrice).toHaveBeenCalled();

    fireEvent.pointerLeave(chartWrap);

    expect(screen.queryByText('+10.00%')).not.toBeInTheDocument();
  });

  it('defaults the Free Replay price scale to log and toggles back to normal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00')] }));
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 1, autoScale: true })));

    chartMocks.priceScaleApplyOptions.mockClear();
    fireEvent.click(screen.getByLabelText('切换对数价格刻度'));
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 0, autoScale: true })));

    chartMocks.priceScaleApplyOptions.mockClear();
    fireEvent.click(screen.getByLabelText('重置价格刻度'));
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 1, autoScale: true })));
  });

  it('remaps Free Replay paper trade points after switching timeframe', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        const timeframe = new URL(`http://localhost${url}`).searchParams.get('timeframe');
        const candles = timeframe === '15m'
          ? [
              makeCandle('2024-05-21T09:45:00+08:00', { close: 100, timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { close: 110, timeframe: '15m' }),
            ]
          : [
              makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
              makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
              makeCandle('2024-05-21T10:10:00+08:00', { close: 115 }),
            ];
        return new Response(JSON.stringify({ candles }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    // 5m：开仓完成于 10:00 → 09:55 蜡烛；平仓完成于 10:05 → 10:00 蜡烛。
    await waitFor(() => {
      const points = markerPoints() as Array<{ kind: string; time: number }>;
      expect(points).toHaveLength(2);
      expect(points.map((point) => point.time)).toEqual([
        Date.parse('2024-05-21T09:55:00+08:00') / 1000,
        Date.parse('2024-05-21T10:00:00+08:00') / 1000,
      ]);
    });

    fireEvent.click(screen.getByRole('button', { name: '15m' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
    // 15m：开仓重锚到 09:45 蜡烛；平仓属于 10:00-10:15 蜡烛，而 15m 光标
    // （progress 10:05）只到 09:45 —— 未揭示，不画。旧实现的“下推一根”恰好
    // 把平仓也画在 09:45 上，那是 2023.3 BTC 复盘里错位的根源。
    await waitFor(() => {
      const points = markerPoints() as Array<{ kind: string; time: number }>;
      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({ kind: 'open', time: Date.parse('2024-05-21T09:45:00+08:00') / 1000 });
    });

    // 揭示下一根 15m（10:00 蜡烛收线）后，平仓点出现在它自己的蜡烛上。
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => {
      const points = markerPoints() as Array<{ kind: string; time: number }>;
      expect(points).toHaveLength(2);
      expect(points[1]).toMatchObject({ kind: 'close', time: Date.parse('2024-05-21T10:00:00+08:00') / 1000 });
    });
  });

  it('keeps Free Replay progress across large timeframe switches without revealing unfinished candles', async () => {
    const candleRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const timeframe = new URL(`http://localhost${url}`).searchParams.get('timeframe');
        const candles = timeframe === '4H'
          ? [
              makeCandle('2024-05-21T04:00:00+08:00', { timeframe: '4H' }),
              makeCandle('2024-05-21T08:00:00+08:00', { timeframe: '4H' }),
              makeCandle('2024-05-21T12:00:00+08:00', { timeframe: '4H' }),
            ]
          : [
              makeCandle('2024-05-21T10:25:00+08:00'),
              makeCandle('2024-05-21T10:30:00+08:00'),
              makeCandle('2024-05-21T10:35:00+08:00'),
              makeCandle('2024-05-21T11:55:00+08:00'),
            ];
        return new Response(JSON.stringify({ candles }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:35' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    chartMocks.setVisibleRange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '4H' }));

    const fourHourRequest = await waitFor(() => {
      const request = candleRequests.find((url) => url.includes('timeframe=4H'));
      expect(request).toBeTruthy();
      return request ?? '';
    });
    const params = new URL(`http://localhost${fourHourRequest}`).searchParams;
    expect(Date.parse(params.get('entryTime') ?? '')).toBe(Date.parse('2024-05-21T10:35:00+08:00'));

    const fourHourCursor = Date.parse('2024-05-21T04:00:00+08:00') / 1000;
    const fourHourStep = 4 * 60 * 60;
    void fourHourCursor;
    void fourHourStep;
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));

    chartMocks.setVisibleRange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    const nextFourHourCursor = Date.parse('2024-05-21T08:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith(expect.objectContaining({
      to: nextFourHourCursor + fourHourStep * 10,
    })));

    candleRequests.length = 0;
    chartMocks.setVisibleRange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '5m' }));

    const fiveMinuteRequest = await waitFor(() => {
      const request = candleRequests.find((url) => url.includes('timeframe=5m'));
      expect(request).toBeTruthy();
      return request ?? '';
    });
    const fiveMinuteParams = new URL(`http://localhost${fiveMinuteRequest}`).searchParams;
    expect(Date.parse(fiveMinuteParams.get('entryTime') ?? '')).toBe(Date.parse('2024-05-21T12:00:00+08:00'));

    const fiveMinuteCursor = Date.parse('2024-05-21T11:55:00+08:00') / 1000;
    void fiveMinuteCursor;
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
  });

  it('backfills earlier history after switching timeframe with a preserved zoomed-out viewport', async () => {
    const candleRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const params = new URL(`http://localhost${url}`).searchParams;
        const timeframe = params.get('timeframe');
        const mode = params.get('mode');
        if (timeframe === '15m' && mode === 'earlier') {
          const anchor = Number(params.get('anchor'));
          const firstInitial = Date.parse('2024-05-21T09:45:00+08:00');
          return new Response(JSON.stringify({
            candles: anchor === firstInitial ? [
              makeCandle('2024-05-21T09:00:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T09:15:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T09:30:00+08:00', { timeframe: '15m' }),
            ] : [],
          }));
        }
        const candles = timeframe === '15m'
          ? [
              makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:15:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:30:00+08:00', { timeframe: '15m' }),
            ]
          : [
              makeCandle('2024-05-21T10:20:00+08:00'),
              makeCandle('2024-05-21T10:25:00+08:00'),
              makeCandle('2024-05-21T10:30:00+08:00'),
              makeCandle('2024-05-21T10:35:00+08:00'),
            ];
        return new Response(JSON.stringify({ candles }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:35' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    chartMocks.getVisibleLogicalRange.mockReturnValue({ from: 0, to: 260 });
    fireEvent.click(screen.getByRole('button', { name: '15m' }));

    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: -100, to: 160 }));
    await waitFor(() => expect(candleRequests.some((url) => url.includes('timeframe=15m') && url.includes('mode=earlier'))).toBe(true));
    const earlierRequest = candleRequests.find((url) => url.includes('timeframe=15m') && url.includes('mode=earlier')) ?? '';
    const earlierParams = new URL(`http://localhost${earlierRequest}`).searchParams;
    expect(Number(earlierParams.get('anchor'))).toBe(Date.parse('2024-05-21T09:45:00+08:00'));
  });

  it('loads earlier history on left scroll without restoring an old visible time range', async () => {
    const candleRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        const candles = mode === 'earlier'
          ? [makeCandle('2024-05-21T09:40:00+08:00'), makeCandle('2024-05-21T09:45:00+08:00')]
          : [makeCandle('2024-05-21T09:50:00+08:00'), makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')];
        return new Response(JSON.stringify({ candles }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:05' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());
    await waitFor(() => expect(candleRequests.some((url) => url.includes('mode=initial'))).toBe(true));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const handler = chartMocks.subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    expect(handler).toBeTypeOf('function');

    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 100 });
    chartMocks.setVisibleRange.mockClear();
    handler?.({ from: 0, to: 160 });

    await waitFor(() => expect(candleRequests.some((url) => url.includes('mode=earlier'))).toBe(true));
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    expect(chartMocks.setVisibleRange).not.toHaveBeenCalled();
  });

  it('auto-saves the session with the advanced cursor after a reveal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
            makeCandle('2024-05-21T10:10:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    const revealedCursor = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => {
      const bodies = sessionPutBodies();
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies.at(-1)?.cursorTime).toBe(revealedCursor);
      expect(bodies.at(-1)?.timeframe).toBe('5m');
    });
  });

  it('auto-saves the paper trading session after a paper trading action', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));

    await waitFor(() => {
      const bodies = sessionPutBodies();
      expect(bodies.at(-1)?.paperTrading).toMatchObject({ active: true, startedAtCursorTime: expect.any(Number) });
    });
  });

  it('restores a saved session from history with timeframe, cursor, and paper trading state', async () => {
    const seeded = [makeSeededSession()];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: seeded }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        const timeframe = new URL(`http://localhost${url}`).searchParams.get('timeframe');
        const candles = timeframe === '15m'
          ? [
              makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
            ]
          : [makeCandle('2024-05-21T09:55:00+08:00')];
        return new Response(JSON.stringify({ candles }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));

    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT/ }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '15m' }).className).toContain('selected');
    expect(screen.getByLabelText('市价开仓')).toBeInTheDocument();

    const restoredCursor = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
    await waitFor(() => {
      const bodies = sessionPutBodies();
      expect(bodies.at(-1)?.cursorTime).toBe(restoredCursor);
      expect(bodies.at(-1)?.timeframe).toBe('15m');
    });
  });

  // 10/28 现场：Binance 不可达（旧会话源 = binance-only），后续 K 线 502。点
  // 下一根不前进是预期的（没数据）；但恢复出来的持仓必须仍在面板上，且自动
  // 保存不得丢掉 position —— 仓位丢失只能来自状态重置，不能来自加载失败。
  // 11/02 现场反馈：从 2023.5 的 BTC 复盘切到 2023.3 后单子 Tab 没跟着换。面板
  // 列表由 props 驱动本会更新，但需要回归钉住；面板本地状态（Tab/方向/限价
  // 输入/平仓比例）也不得跨会话残留（key 重挂）。
  // 11/02：自动保存曾漏 candleSource —— 10/21 后新建的 Bitget 会话第一次落盘就丢源，
  // 恢复时被 ?? LEGACY 兑底静默切回 Binance（库里全部会话 candle_source 为 null 即其实锤）。
  it('persists the session candle source in the auto-save payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')] }));
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByText('回溯复盘 2024-05-21 10:00')).toBeInTheDocument());

    await waitFor(() => {
      const bodies = sessionPutBodies();
      expect(bodies.at(-1)?.candleSource).toBe('bitget');
    });
  });

  it('selects the candle source before starting a replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) {
        const source = new URL(url, 'http://localhost').searchParams.get('source') ?? '';
        return new Response(JSON.stringify({ instruments: source === 'okx' ? ['BTC-USDT-SWAP'] : ['BTCUSDT'] }));
      }
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00')] }));
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));

    // 选 OKX 源：交易对列表换成 OKX 词汇，选中项重置。
    fireEvent.click(screen.getByRole('button', { name: 'OKX' }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/free-replay/instruments?source=okx'));
      expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP');
    });

    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => {
      // 会话记录所选源；蜡烛请求带 source=okx 且直接用 OKX 词汇标的。
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('source=okx'));
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('instrument=BTC-USDT-SWAP'));
      const bodies = sessionPutBodies();
      expect(bodies.at(-1)?.candleSource).toBe('okx');
      expect(bodies.at(-1)?.instrument).toBe('BTC-USDT-SWAP');
    });
  });

  it('heals a middle gap in the loaded candles with one centered window fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        // 首次加载（entryTime 为原始开始串）：带中段洞（10:00 → 10:45 缺 8 根 5m）。
        if (String(url).includes('entryTime=2024-05-21+10%3A00')) {
          return new Response(JSON.stringify({
            candles: [
              makeCandle('2024-05-21T09:55:00+08:00'),
              makeCandle('2024-05-21T10:00:00+08:00'),
              makeCandle('2024-05-21T10:45:00+08:00'),
              makeCandle('2024-05-21T10:50:00+08:00'),
            ],
          }));
        }
        // 洞补齐窗（ISO entryTime，中心在 02:22Z = 北京 10:22）：返回洞内 8 根。
        if (String(url).includes('entryTime=2024-05-21T02%3A2')) {
          return new Response(JSON.stringify({
            candles: Array.from({ length: 8 }, (_, i) => makeCandle(`2024-05-21T02:${String(5 + i * 5).padStart(2, '0')}:00Z`)),
          }));
        }
        return new Response(JSON.stringify({ candles: [] }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByText('回溯复盘 2024-05-21 10:00')).toBeInTheDocument());

    // 看见洞 → 对洞中心发一次 initial 窗请求（ISO entryTime 在洞区间内，UTC 02:2x）。
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('entryTime=2024-05-21T02%3A2'));
    });
  });

  it('follows the paper trading panel when switching between two saved sessions', async () => {
    const seeded = [
      makeSeededSession({ paperTrading: seededPaperTrading(100, 'fill-3', 'position-1') }),
      makeSeededSession({ startTime: '2024-05-20 10:00', dataAnchorTime: '2024-05-20 10:00', paperTrading: seededPaperTrading(200, 'fill-9', 'position-8') }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: seeded }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')] }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));

    // 恢复会话 A（2024-05-21，成交价 100）。
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT2024-05-21/ }));
    await waitFor(() => expect(screen.getByText('回溯复盘 2024-05-21 10:00')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    await waitFor(() => expect(document.querySelectorAll('.paper-trade-row')).toHaveLength(1));
    expect(document.querySelector('.paper-order-list')?.textContent).toContain('100');

    // 切到会话 B（2024-05-20，成交价 200）：面板按会话身份 key 重挂，本地状态
    // （Tab 选择）复位到操作 —— 不路跨会话残留。
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT2024-05-20/ }));
    await waitFor(() => expect(screen.getByText('回溯复盘 2024-05-20 10:00')).toBeInTheDocument());
    expect(document.querySelector('.paper-tabs .selected')?.textContent).toContain('操作');

    // 再进单子 Tab：列表换成 B 的成交。
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    await waitFor(() => expect(document.querySelector('.paper-order-list')?.textContent).toContain('200'));
    expect(document.querySelector('.paper-order-list')?.textContent).not.toContain('100');
  });

  it('keeps the restored position on the panel and in the auto-save when later candle loads fail', async () => {
    const seeded = [makeSeededSession({
      paperTrading: {
        active: true,
        startedAtCursorTime: Date.parse('2024-05-21T10:05:00+08:00') / 1000,
        nextId: 39,
        pendingEntry: null,
        pendingExit: null,
        pendingStopLoss: null,
        position: {
          id: 'position-37',
          direction: 'long',
          originPrice: 27097,
          originTime: Date.parse('2024-05-21T09:25:00+08:00'),
          entryPrice: 27097,
          entryTime: Date.parse('2024-05-21T09:25:00+08:00'),
          quantity: 0.369,
          margin: 500,
          notional: 10000,
          leverage: 20,
          legs: [{
            id: 'leg-37',
            entryPrice: 27097,
            entryTime: Date.parse('2024-05-21T09:25:00+08:00'),
            quantity: 0.369,
            margin: 500,
            notional: 10000,
            leverage: 20,
            stopPrice: 27011,
          }],
        },
        trades: [],
      } as unknown as ReturnType<typeof makeSeededSession>['paperTrading'],
    })];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: seeded }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'initial') {
          return new Response(JSON.stringify({
            candles: [
              makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
            ],
          }));
        }
        return new Response(JSON.stringify({ error: 'Binance request failed: fetch failed' }), { status: 502 });
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());

    // The position card renders from the restored state, independent of candle
    // availability.
    expect(screen.getByText('持仓')).toBeInTheDocument();
    expect(screen.getByText('均价 27097')).toBeInTheDocument();

    // Stepping hits the end of loaded candles: the reveal cannot advance (no
    // data), the later-candle fetch 502s — the app must survive it all.
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.getByText('持仓')).toBeInTheDocument();
    expect(screen.getByText('均价 27097')).toBeInTheDocument();
    const bodies = sessionPutBodies();
    const lastPosition = bodies.at(-1) && (bodies.at(-1) as { paperTrading?: { position?: unknown } }).paperTrading?.position;
    expect(lastPosition).not.toBeNull();
  });

  it('resumes an existing session when starting the same instrument and start time', async () => {
    const seeded = [makeSeededSession()];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: seeded }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        const timeframe = new URL(`http://localhost${url}`).searchParams.get('timeframe');
        const candles = timeframe === '15m'
          ? [
              makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
            ]
          : [makeCandle('2024-05-21T09:55:00+08:00')];
        return new Response(JSON.stringify({ candles }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '15m' }).className).toContain('selected');
    expect(screen.getByLabelText('市价开仓')).toBeInTheDocument();
  });

  it('deletes the active session, stops replay, and does not re-save it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
            makeCandle('2024-05-21T10:05:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    await waitFor(() => expect(screen.getByLabelText('删除会话 BTCUSDT 2024-05-21 10:00')).toBeInTheDocument());

    const beforeDelete = sessionPutBodies().length;
    fireEvent.click(screen.getByLabelText('删除会话 BTCUSDT 2024-05-21 10:00'));

    await waitFor(() => expect(screen.getByText('选择交易对和开始时间，开始回溯复盘')).toBeInTheDocument());
    expect(screen.queryByLabelText('开始模拟交易')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('删除会话 BTCUSDT 2024-05-21 10:00')).not.toBeInTheDocument();

    await new Promise((resolve) => window.setTimeout(resolve, 700));
    expect(sessionPutBodies().length).toBe(beforeDelete);
  });

  it('restores the session window around the saved cursor, not around the session start', async () => {
    const cursorTime = Date.parse('2024-05-22T10:00:00+08:00') / 1000;
    const seeded = [makeSeededSession({ cursorTime, dataAnchorTime: '2024-05-21 10:00' })];
    const candleRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: seeded }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        return new Response(JSON.stringify({ candles: [makeCandle('2024-05-22T10:00:00+08:00', { timeframe: '15m' })] }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT/ }));

    await waitFor(() => expect(candleRequests.some((url) => url.includes('mode=initial'))).toBe(true));
    const initialParams = new URL(`http://localhost${candleRequests.find((url) => url.includes('mode=initial'))}`).searchParams;
    expect(initialParams.get('entryTime')).toBe(new Date(cursorTime * 1000).toISOString());
  });

  it('keeps prefetching later candlesticks so revealing can run past the initial window', async () => {
    const candleRequests: string[] = [];
    let laterCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'later') {
          laterCalls += 1;
          return new Response(JSON.stringify({
            candles: laterCalls === 1
              ? [makeCandle('2024-05-21T10:05:00+08:00'), makeCandle('2024-05-21T10:10:00+08:00')]
              : [makeCandle('2024-05-21T10:15:00+08:00'), makeCandle('2024-05-21T10:20:00+08:00')],
          }));
        }
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:50:00+08:00'),
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    const laterAnchors = () => candleRequests
      .filter((url) => url.includes('mode=later'))
      .map((url) => Number(new URL(`http://localhost${url}`).searchParams.get('anchor')));

    await waitFor(() => expect(laterCalls).toBeGreaterThanOrEqual(1));

    for (const revealed of ['10:00', '10:05', '10:10']) {
      fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
      await waitFor(() => expect(sessionPutBodies().at(-1)?.cursorTime).toBe(Date.parse(`2024-05-21T${revealed}:00+08:00`) / 1000));
    }

    // Prefetching must continue from the new end of the loaded range: while the
    // loaded state stayed frozen on the initial window every request kept the
    // same anchor, so the replay ran out of candlesticks for good.
    await waitFor(() => expect(laterAnchors().at(-1)).toBeGreaterThan(Date.parse('2024-05-21T10:00:00+08:00')));

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => expect(sessionPutBodies().at(-1)?.cursorTime).toBe(Date.parse('2024-05-21T10:15:00+08:00') / 1000));
  });

  it('retries the later candlestick fetch after a prefetch failure', async () => {
    let laterCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'later') {
          laterCalls += 1;
          if (laterCalls === 1) throw new Error('network down');
          return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T10:05:00+08:00')] }));
        }
        return new Response(JSON.stringify({
          candles: [makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText('后续 K 线加载失败')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => expect(sessionPutBodies().at(-1)?.cursorTime).toBe(Date.parse('2024-05-21T10:00:00+08:00') / 1000));

    // Nothing further to reveal: the retry must re-request the later candles
    // instead of leaving the click with no effect at all.
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => expect(laterCalls).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => expect(sessionPutBodies().at(-1)?.cursorTime).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000));
  });

  it('shows the server-provided candle failure reason instead of the generic load text', async () => {
    const serverError = 'Binance request failed: HTTP 418 (Binance IP auto-banned; retry after ~1659s)';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ error: serverError }), { status: 502 });
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    await waitFor(() => expect(screen.getByText(serverError)).toBeInTheDocument());
  });

  it('requests every Free Replay candle window from Bitget, never OKX (10/21)', async () => {
    const candleRequests: string[] = [];
    let laterCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        candleRequests.push(url);
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'later') {
          laterCalls += 1;
          return new Response(JSON.stringify({ candles: laterCalls === 1 ? [makeCandle('2024-05-21T10:05:00+08:00')] : [] }));
        }
        if (mode === 'earlier') return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:50:00+08:00')] }));
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:50:00+08:00'),
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => expect(laterCalls).toBeGreaterThanOrEqual(1));

    // Without an explicit `source` the server falls through to OKX, which
    // charts a different price scale for the same instrument — the QNT case
    // (OKX 46.5 vs Binance 263.5) that motivated this binding.
    expect(candleRequests.length).toBeGreaterThan(0);
    for (const request of candleRequests) {
      const params = new URL(`http://localhost${request}`).searchParams;
      expect(params.get('source')).toBe('bitget');
      expect(params.get('instrument')).toBe('BTCUSDT');
    }
    expect(candleRequests.map((r) => new URL(`http://localhost${r}`).searchParams.get('mode'))).toContain('initial');
  });

  it('opens the other-coin panel on the replay source inside Free Replay', async () => {
    const panelOpens: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT', 'ETHUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        const params = new URL(`http://localhost${url}`).searchParams;
        // Both the main chart and the panel open BTCUSDT, so requests are
        // counted per source instead: the panel must never reach for OKX.
        panelOpens.push(`${params.get('source') ?? 'okx'}:${params.get('mode')}`);
        return new Response(JSON.stringify({
          candles: [makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')],
        }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());
    const beforePanel = panelOpens.length;

    fireEvent.click(screen.getByRole('button', { name: '其他币' }));

    // The panel issues its own initial load; those requests must be Binance too.
    await waitFor(() => expect(panelOpens.length).toBeGreaterThan(beforePanel));
    for (const request of panelOpens) {
      expect(request.split(':')[0]).toBe('bitget');
    }
  });

  // 11/05：恢复的会话必须是面板的唯一真相。面板曾用 `replayCandleSource(null)`
  // 猜源 → 默认 Bitget：OKX / 旧 Binance 会话的主图对、其他币面板错，仪表盘
  // 的日界也跟着错。四条路径都要钉住（Bitget 为不变对照组）。
  it('makes the other-coin panel inherit the restored session source and grid', async () => {
    const cases = [
      { label: 'OKX', instrument: 'BTC-USDT-SWAP', candleSource: 'okx' as const, requestSource: 'okx', venue: 'okx' },
      { label: 'Bitget', instrument: 'BTCUSDT', candleSource: 'bitget' as const, requestSource: 'bitget', venue: 'bitget' },
      { label: 'explicit binance-only', instrument: 'BTCUSDT', candleSource: 'binance-only' as const, requestSource: 'binance-only', venue: 'binance' },
      { label: 'legacy session without a source', instrument: 'BTCUSDT', candleSource: undefined, requestSource: 'binance-only', venue: 'binance' },
    ];

    for (const testCase of cases) {
      const seeded = [{ ...makeSeededSession(), instrument: testCase.instrument, ...(testCase.candleSource ? { candleSource: testCase.candleSource } : {}) }];
      const candleSources: string[] = [];
      const listSources: string[] = [];

      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
        if (url.startsWith('/api/free-replay/instruments')) {
          listSources.push(new URL(`http://localhost${url}`).searchParams.get('source') ?? '');
          return new Response(JSON.stringify({ instruments: ['BTCUSDT', 'BTC-USDT-SWAP'] }));
        }
        if (url.startsWith('/api/free-replay/sessions')) {
          if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
          if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
          return new Response(JSON.stringify({ sessions: seeded }));
        }
        if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
        if (url.startsWith('/api/candles')) {
          candleSources.push(new URL(`http://localhost${url}`).searchParams.get('source') ?? '');
          return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00'), makeCandle('2024-05-21T10:00:00+08:00')] }));
        }
        return new Response(JSON.stringify({}));
      }));

      const { unmount } = render(<App />);

      fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
      await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));

      const restoreRow = await screen.findByRole('button', { name: new RegExp(`^${testCase.instrument}`) });
      fireEvent.click(restoreRow);
      await waitFor(() => expect(screen.getByRole('heading', { name: testCase.instrument })).toBeInTheDocument());

      // Main chart: every candle request carries the session's request source.
      await waitFor(() => expect(candleSources.length).toBeGreaterThan(0));
      for (const source of candleSources) expect(source).toBe(testCase.requestSource);

      const listsBefore = listSources.length;
      const candlesBefore = candleSources.length;

      fireEvent.click(screen.getByRole('button', { name: '其他币' }));

      // Only requests issued AFTER the panel opens decide the panel's source.
      await waitFor(() => expect(listSources.length).toBeGreaterThan(listsBefore));
      expect(listSources.slice(listsBefore)[0]).toBe(testCase.venue);
      await waitFor(() => expect(candleSources.length).toBeGreaterThan(candlesBefore));
      for (const source of candleSources.slice(candlesBefore)) expect(source).toBe(testCase.requestSource);
      // No default-source request may sneak in beside a non-Bitget session.
      if (testCase.requestSource !== 'bitget') {
        expect(listSources.slice(listsBefore)).not.toContain('bitget');
        expect(candleSources.slice(candlesBefore)).not.toContain('bitget');
      }

      unmount();
    }
  });

  // 10/29 R1：面板分 Tab。默认落在「操作」；已完成交易行只在「单子」Tab。
  it('splits the paper trading panel into 操作/单子 tabs', async () => {
    stubFreeReplayFetch({
      onCandles: () => new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
        ],
      })),
    });

    await startReplayAndCloseTrade();

    // 默认「操作」Tab：开仓控件在，已完成交易行不在
    expect(screen.getByRole('tab', { name: '操作' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '市价开仓' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开 05-21 10:00/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));

    expect(screen.getByRole('button', { name: /开 05-21 10:00/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '市价开仓' })).not.toBeInTheDocument();
    // 统计行在两个 Tab 都常显
    expect(screen.getAllByText('+100.00 USDT').length).toBeGreaterThan(0);
  });

  // 10/29 R2：点已完成交易行 → 视口锚到开仓点（±150 根）；每点击一次定位一次，
  // 之后用户平移不被拽回；重复点同一行重新定位。
  it('anchors the viewport on the order entry when clicking a completed trade row', async () => {
    stubFreeReplayFetch({
      onCandles: () => new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
        ],
      })),
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 10:00/ });
    chartMocks.setVisibleRange.mockClear();

    fireEvent.click(row);

    const openSec = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 300,
      to: openSec + 150 * 300,
    }));
    expect(chartMocks.setVisibleRange).toHaveBeenCalledTimes(1);
    expect(row.className).toContain('active');

    // 用户平移（逻辑区间变化）不触发重新锚定
    const handler = chartMocks.subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    handler?.({ from: 10, to: 170 });
    expect(chartMocks.setVisibleRange).toHaveBeenCalledTimes(1);

    // 重复点同一行 → 重新归位
    fireEvent.click(row);
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledTimes(2));
  });

  // 11/04 R1/R2：切周期清焦点单 → 视口回光标右缘（不再把焦点锚到新周期开仓点）；
  // 行高亮与剪刀态一并复位。这也是「再点一次行重新归位」的前提。
  it('clears order focus and anchors to cursor on timeframe switch', async () => {
    stubFreeReplayFetch({
      onCandles: (url) => {
        const params = new URL(`http://localhost${url}`).searchParams;
        const candles = params.get('timeframe') === '15m'
          ? [
              makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:15:00+08:00', { timeframe: '15m' }),
            ]
          : [
              makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
              makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
              makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
            ];
        return new Response(JSON.stringify({ candles: params.get('mode') === 'earlier' ? [] : candles }));
      },
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 10:00/ });
    fireEvent.click(row);

    const openSec = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 300,
      to: openSec + 150 * 300,
    }));

    chartMocks.setVisibleRange.mockClear();
    chartMocks.setVisibleLogicalRange.mockClear();
    chartMocks.timeToIndex.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '15m' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
    // 回光标右缘：cursorTime 按新周期重算（进度 10:05 → 15m 填充前一根 = 09:45），
    // 右侧留 10 根缓冲（getVisibleLogicalRange mock = 160 根）。
    const switchCursorSec = Date.parse('2024-05-21T09:45:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.timeToIndex).toHaveBeenCalledWith(switchCursorSec, true));
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
    // 焦点锚定（±150 根开仓窗）不再发生
    expect(chartMocks.setVisibleRange).not.toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    });
    expect(screen.getByRole('button', { name: /开 05-21 10:00/ }).className).not.toContain('active');
    expect(screen.queryByRole('button', { name: /开仓点后的 K 线/ })).not.toBeInTheDocument();
  });

  // 11/04 AC2：首锚只认本 rangeKey 的数据。旧周期数据还在 series 里时不消费首锚
  // （旧周期回看/翻页越多，索引偏移越大），等新周期数据落地才锚定。
  it('waits for the new timeframe data before anchoring the viewport', async () => {
    let resolve15m: ((response: Response) => void) | null = null;
    stubFreeReplayFetch({
      onCandles: (url) => {
        const params = new URL(`http://localhost${url}`).searchParams;
        if (params.get('timeframe') === '15m') {
          // 只有「游标初始窗」推迟落地（翻页/预取照常回空，避免抢占 resolve）。
          if (params.get('mode') !== 'initial') return new Response(JSON.stringify({ candles: [] }));
          // 切周期后新周期数据故意晚落地：中间那几帧渲染的还是 5m 数据。
          return new Promise<Response>((resolve) => { resolve15m = resolve; });
        }
        return new Response(JSON.stringify({
          candles: [
            makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
            makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
          ],
        }));
      },
    });

    await startReplayAndCloseTrade();
    chartMocks.setVisibleRange.mockClear();
    chartMocks.setVisibleLogicalRange.mockClear();
    chartMocks.timeToIndex.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '15m' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
    // 旧 5m 数据的过渡帧已经渲染过（setData 照常跑，不闪空白），但不得锚定：
    // 首锚被 rangeKey 守卫推迟（旧周期索引套到新周期上是错位的根因）。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chartMocks.timeToIndex).not.toHaveBeenCalled();
    expect(chartMocks.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(chartMocks.setVisibleRange).not.toHaveBeenCalled();

    // 新周期数据落地：series 先换成 15m 数据，再一次锚定到新周期光标索引。
    const anchorData: number[][] = [];
    chartMocks.setVisibleLogicalRange.mockImplementation(() => { anchorData.push(lastSetDataRealTimes()); });
    resolve15m!(new Response(JSON.stringify({
      candles: [
        makeCandle('2024-05-21T09:30:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
      ],
    })));

    const switchCursorSec = Date.parse('2024-05-21T09:45:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
    expect(chartMocks.timeToIndex).toHaveBeenCalledWith(switchCursorSec, true);
    // 锚定那一刻 series 里已是新周期数据（09:30 只存在于 15m 窗口）。
    expect(anchorData[0]).toEqual([
      Date.parse('2024-05-21T09:30:00+08:00') / 1000,
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
    ]);
  });

  // 10/29 用户现场复现：点单锚定 → 切周期 → 再点单子，必须重新归位（交割单复盘式）。
  it('re-anchors when clicking an order row again after a timeframe switch', async () => {
    stubFreeReplayFetch({
      onCandles: (url) => {
        const params = new URL(`http://localhost${url}`).searchParams;
        const candles = params.get('timeframe') === '15m'
          ? [
              makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
              makeCandle('2024-05-21T10:15:00+08:00', { timeframe: '15m' }),
            ]
          : [
              makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
              makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
              makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
            ];
        return new Response(JSON.stringify({ candles: params.get('mode') === 'earlier' ? [] : candles }));
      },
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 10:00/ });
    fireEvent.click(row);

    const openSec = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 300,
      to: openSec + 150 * 300,
    }));

    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    // 11/04：切周期先清焦点回光标右缘（不再把焦点带到新周期）。
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: /开仓点后的 K 线/ })).not.toBeInTheDocument());

    // 切完周期再点同一行：token 递增，必须在 15m 窗口重新归位
    chartMocks.setVisibleRange.mockClear();
    fireEvent.click(row);
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    }));
  });

  // 11/03 R1：开始模拟交易后回退与成单时间线互斥 —— 按钮置灰 + 键盘 ← 同步
  // 堵死（订阅 effect deps 补 paperTrading.active，闭包不陈旧）；重置后恢复。
  it('disables rewind once paper trading starts and re-enables after reset', async () => {
    stubFreeReplayFetch({
      onCandles: () => new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
        ],
      })),
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeEnabled());

    // 正向对照：未开模拟时键盘 ← 能回退（游标变化 → 舒适区跟随效应销定）。
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    chartMocks.setVisibleRange.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());

    const rewind = screen.getByRole('button', { name: '上一根 K 线' });
    expect(rewind).toBeDisabled();
    expect(rewind).toHaveAttribute('title', '开始模拟交易后不能回退 K 线');
    // 步进不受影响。
    expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeEnabled();

    // 键盘 ← 同步堵死：函数级守卫拦截，游标不动、无任何视口销定。
    chartMocks.setVisibleRange.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(chartMocks.setVisibleRange).not.toHaveBeenCalled();

    // 重置模拟交易后回退恢复可用。
    fireEvent.click(screen.getByRole('button', { name: '重置模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '上一根 K 线' })).toBeEnabled());
  });

  // 11/03 R2：焦点单「开仓点前」视图 —— 剪刀按钮隐藏开仓点之后的 K 线（严格
  // 小于 positionOpenTime：同周期成交时开仓点 candle 完成于 10:00，其下一根
  // 恰从 10:00 开档），开启瞬间把开仓 candle 锚到右缘（右畱10根），再点恢复。
  it('hides candles after the focused order open point and restores them', async () => {
    let initialFetchCount = 0;
    const focusWindow = ['09:45', '09:50', '09:55', '10:00', '10:05', '10:10'].map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
    stubFreeReplayFetch({
      onCandles: (url) => {
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'initial') {
          initialFetchCount += 1;
          return new Response(JSON.stringify({ candles: initialFetchCount === 1
            ? [makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }), makeCandle('2024-05-21T10:00:00+08:00', { close: 110 })]
            : focusWindow }));
        }
        return new Response(JSON.stringify({ candles: [] }));
      },
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));

    // 焦点窗落地（揭示边界 = 游标 10:00 → 10:00 及之前全量可览）。
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      Date.parse('2024-05-21T10:00:00+08:00') / 1000,
    ]));

    fireEvent.click(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' }));

    // 开仓完成于 10:00 → 截止开仓 candle（09:55，含）；10:00 及之后是未来。
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
    ]));
    // 开启瞬间：开仓 candle 贴右缘右畱 10 根缓冲（与回光标同款锚定形状）。
    const entrySec = Date.parse('2024-05-21T09:55:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: entrySec - 150 * 300,
      to: entrySec + 10 * 300,
    }));

    fireEvent.click(screen.getByRole('button', { name: '显示开仓点后的 K 线' }));
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      Date.parse('2024-05-21T10:00:00+08:00') / 1000,
    ]));
  });

  // 11/03 R2：隐藏态右缘翻页闸 —— 揭示边界换轨到开仓点后，焦点窗口右缘
  // （10:00）已越过闸边界（开仓 candle 09:55），零 mode=later 请求（否则
  // 隐藏使渲染数组永不增长 → barsAfter 恒 < 阈值 → 每个拖动帧都重发请求）。
  it('does not page later in the pre-entry view (no request storm)', async () => {
    const candleRequests: string[] = [];
    let initialFetchCount = 0;
    // 游标窗：光标 10:05 前方留足 22 根（> 预取阈值 20），不触发预取。
    const cursorWindow = ['09:55', '10:00', ...Array.from({ length: 22 }, (_, index) => {
      const minute = 5 + index * 5;
      const hour = 10 + Math.floor(minute / 60);
      return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    })].map((clock, index) => makeCandle(`2024-05-21T${clock}:00+08:00`, index === 0 ? { close: 100 } : index === 1 ? { close: 110 } : {}));
    stubFreeReplayFetch({
      onCandles: (url) => {
        candleRequests.push(url);
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'initial') {
          initialFetchCount += 1;
          return new Response(JSON.stringify({ candles: initialFetchCount === 1
            ? cursorWindow
            // 焦点窗右缘 10:00 < 游标 10:05（旧闸会放行翻页），但已越过
            // 开仓 candle 09:55（新闸关闭）。
            : ['09:40', '09:45', '09:50', '09:55', '10:00'].map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`)) }));
        }
        return new Response(JSON.stringify({ candles: [] }));
      },
    });

    await startReplayAndCloseTrade();
    // 步进到 10:05，让焦点窗右缘 (10:00) 落在游标与开仓点之间。
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:40:00+08:00') / 1000,
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      Date.parse('2024-05-21T10:00:00+08:00') / 1000,
    ]));

    fireEvent.click(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' }));
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:40:00+08:00') / 1000,
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
    ]));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    // 右缘拖动（barsAfter < 50）三个不同 logical range 的帧：零 mode=later。
    chartMocks.barsInLogicalRange.mockReturnValue({ barsBefore: 100, barsAfter: 5 });
    const handler = chartMocks.subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    expect(handler).toBeTypeOf('function');
    handler?.({ from: 0, to: 160 });
    handler?.({ from: 1, to: 161 });
    handler?.({ from: 2, to: 162 });
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    expect(candleRequests.filter((request) => request.includes('mode=later'))).toEqual([]);
  });

  // 11/03 R2：退出焦点即复位「开仓点前」视图 —— 步进清 orderFocus，剪刀按钮
  // 消失；重新点单后隐藏态为关（不残留上一单的开关）。
  it('resets the pre-entry view when leaving the order focus', async () => {
    let initialFetchCount = 0;
    const focusWindow = ['09:45', '09:50', '09:55', '10:00', '10:05'].map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
    stubFreeReplayFetch({
      onCandles: (url) => {
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode === 'initial') {
          initialFetchCount += 1;
          return new Response(JSON.stringify({ candles: initialFetchCount === 1
            ? [makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }), makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }), makeCandle('2024-05-21T10:05:00+08:00', { close: 120 })]
            : focusWindow }));
        }
        return new Response(JSON.stringify({ candles: [] }));
      },
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));
    await waitFor(() => expect(lastSetDataRealTimes()).toContain(Date.parse('2024-05-21T10:00:00+08:00') / 1000));

    fireEvent.click(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' }));
    await waitFor(() => expect(lastSetDataRealTimes()).not.toContain(Date.parse('2024-05-21T10:00:00+08:00') / 1000));

    // 步进（下一根）清焦点：剪刀按钮消失，视图回到游标数据集完整揭示。
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /开仓点后的 K 线/ })).not.toBeInTheDocument());
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      Date.parse('2024-05-21T10:00:00+08:00') / 1000,
      Date.parse('2024-05-21T10:05:00+08:00') / 1000,
    ]));

    // 重新点单：隐藏态为关（按钮文案是「隐藏…」而非「显示…」）。
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' })).toBeInTheDocument());
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual([
      Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      Date.parse('2024-05-21T09:50:00+08:00') / 1000,
      Date.parse('2024-05-21T09:55:00+08:00') / 1000,
      Date.parse('2024-05-21T10:00:00+08:00') / 1000,
      Date.parse('2024-05-21T10:05:00+08:00') / 1000,
    ]));
  });

  // 10/29 解除条款：点单锚定后，步进清除焦点（行高亮消失）。
  it('clears the order anchor when stepping to the next candle', async () => {
    stubFreeReplayFetch({
      onCandles: () => new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
          makeCandle('2024-05-21T10:10:00+08:00', { close: 130 }),
        ],
      })),
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 10:00/ });
    fireEvent.click(row);
    expect(row.className).toContain('active');

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    expect(row.className).not.toContain('active');
  });

  // 11/04 R7：剪刀是单笔单子的审读工具，非跨单粘性模式 —— 点亮剪刀后切到
  // 另一笔单，新单回到揭示内完整窗口且剪刀复位为关；同单重复点击（重定位）
  // 剪刀态保留。反转 11/03「换焦点单不清，连续审单」决策（用户报障）。
  it('resets the pre-entry view when switching to a different order', async () => {
    // 两笔单：单 1 开在游标 10:00（02:00Z），步进三根后单 2 开在 10:20（02:20Z），
  // 平仓时游标 10:25。焦点窗按 entryTime ISO 分支，单 2 的窗含开仓点之后的
  // 蜡烛（用来区分「复位后按游标渲染」与「未复位仍按开仓点截断」）。
    const cursorWindow = ['09:55', '10:00', '10:05', '10:10', '10:15', '10:20', '10:25', '10:30']
      .map((clock, index) => makeCandle(`2024-05-21T${clock}:00+08:00`, index === 0 ? { close: 100 } : index === 1 ? { close: 110 } : {}));
    const focusWindowTrade1 = ['09:45', '09:50', '09:55', '10:00', '10:05', '10:10']
      .map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
    const focusWindowTrade2 = ['10:05', '10:10', '10:15', '10:20', '10:25', '10:30']
      .map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
    stubFreeReplayFetch({
      onCandles: (url) => {
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode !== 'initial') return new Response(JSON.stringify({ candles: [] }));
        const entryTime = String(new URL(`http://localhost${url}`).searchParams.get('entryTime'));
        if (entryTime.includes('T02:00')) return new Response(JSON.stringify({ candles: focusWindowTrade1 }));
        if (entryTime.includes('T02:20')) return new Response(JSON.stringify({ candles: focusWindowTrade2 }));
        return new Response(JSON.stringify({ candles: cursorWindow }));
      },
    });

    await startReplayAndCloseTrade();
    // 单 2：步进到 10:20 开仓 → 步进到 10:25 平仓（游标窗已含足够蜡烛可推进）。
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:45', '09:50', '09:55', '10:00', '10:05', '10:10']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));

    fireEvent.click(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' }));
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:45', '09:50', '09:55']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));

    // 换单：剪刀必须复位（按钮文案回到「隐藏…」），新单按游标 10:20 渲染完整窗口
    //（10:25/10:30 在揭示边界外被滤）；未修复时按钮是「显示…」且数据只剩 [10:05,10:10,10:15]。
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:20/ }));
    expect(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '显示开仓点后的 K 线' })).not.toBeInTheDocument();
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['10:05', '10:10', '10:15', '10:20']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));
  });

  it('keeps the pre-entry view when re-clicking the same order', async () => {
    const cursorWindow = ['09:55', '10:00', '10:05', '10:10']
      .map((clock, index) => makeCandle(`2024-05-21T${clock}:00+08:00`, index === 0 ? { close: 100 } : index === 1 ? { close: 110 } : {}));
    const focusWindow = ['09:45', '09:50', '09:55', '10:00', '10:05', '10:10']
      .map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
    stubFreeReplayFetch({
      onCandles: (url) => {
        const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
        if (mode !== 'initial') return new Response(JSON.stringify({ candles: [] }));
        const entryTime = String(new URL(`http://localhost${url}`).searchParams.get('entryTime'));
        if (entryTime.includes('T')) return new Response(JSON.stringify({ candles: focusWindow }));
        return new Response(JSON.stringify({ candles: cursorWindow }));
      },
    });

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));
    // 开始 10:00 → 初始游标 09:55；helper 内一次步进 → 游标 10:00。
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:45', '09:50', '09:55', '10:00']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));

    fireEvent.click(screen.getByRole('button', { name: '隐藏开仓点后的 K 线' }));
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:45', '09:50', '09:55']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));

    // 同单重复点击（token 递增重定位）：剪刀态保留，重取窗后仍按开仓点截断。
    fireEvent.click(screen.getByRole('button', { name: /开 05-21 10:00/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '显示开仓点后的 K 线' })).toBeInTheDocument());
    await waitFor(() => expect(lastSetDataRealTimes()).toEqual(['09:45', '09:50', '09:55']
      .map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000)));
  });

  // 10/29 解除条款：点当前持仓行 → 回到光标（清除焦点）。
  it('returns to the cursor when clicking the open position row', async () => {
    stubFreeReplayFetch({
      onCandles: () => new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
          makeCandle('2024-05-21T10:10:00+08:00', { close: 130 }),
        ],
      })),
    });

    await startReplayAndCloseTrade();
    // 再开一笔持仓（最新未平仓单）
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));

    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const tradeRow = screen.getByRole('button', { name: /开 05-21 10:00/ });
    fireEvent.click(tradeRow);
    expect(tradeRow.className).toContain('active');

    fireEvent.click(screen.getByRole('button', { name: /持仓中/ }));

    expect(tradeRow.className).not.toContain('active');
  });

  // 10/29 R2 追页：开仓点早于已加载窗口时自动向前翻页，覆盖后再定位。
  // 10/30：点单取数改为交割单复盘模式 —— 开仓点在窗口外时发一次 mode=initial
  // 窗口（±150 根）合并后直接锚定，绝不逐页追；请求必须带会话自带的 venue
  // （旧会话 = binance-only，10/21 契约）。
  it('fetches one window around the focused order entry instead of paging', async () => {
    const openMs = Date.parse('2024-05-21T08:00:00+08:00');
    const seeded = [makeSeededSession({
      paperTrading: {
        active: true,
        startedAtCursorTime: Date.parse('2024-05-21T08:00:00+08:00') / 1000,
        nextId: 2,
        pendingEntry: null,
        pendingExit: null,
        position: null,
        trades: [{
          id: 'fill-1',
          positionId: 'position-1',
          direction: 'long',
          entryPrice: 95,
          entryTime: openMs,
          positionOpenPrice: 95,
          positionOpenTime: openMs,
          exitPrice: 100,
          exitTime: Date.parse('2024-05-21T09:30:00+08:00'),
          quantity: 1,
          margin: 95,
          notional: 95,
          leverage: 1,
          pnl: 5,
          returnRate: 0.0526,
        }],
      },
    })];
    const candleRequests: string[] = [];
    stubFreeReplayFetch({
      sessions: seeded,
      onCandles: (url) => {
        candleRequests.push(url);
        const params = new URL(`http://localhost${url}`).searchParams;
        // 焦点取窗的 entryTime = 开仓点 ISO；会话恢复的 initial 窗口 entryTime =
        // 光标 ISO，两者不同，按它区分。
        if (params.get('entryTime') === '2024-05-21T00:00:00.000Z') {
          return new Response(JSON.stringify({ candles: [
            makeCandle('2024-05-21T08:00:00+08:00', { timeframe: '15m' }),
            makeCandle('2024-05-21T08:15:00+08:00', { timeframe: '15m' }),
          ] }));
        }
        return new Response(JSON.stringify({ candles: [
          makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
          makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
        ] }));
      },
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 08:00/ });
    chartMocks.setVisibleRange.mockClear();
    fireEvent.click(row);

    const openSec = openMs / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    }));
    // 一次取窗到位：只有一条以开仓点为锚的 initial 请求，无逐页 earlier。
    const focusWindowRequests = candleRequests.filter((url) => new URL(`http://localhost${url}`).searchParams.get('entryTime') === '2024-05-21T00:00:00.000Z');
    expect(focusWindowRequests).toHaveLength(1);
    const focusParams = new URL(`http://localhost${focusWindowRequests[0]}`).searchParams;
    expect(focusParams.get('mode')).toBe('initial');
    expect(focusParams.get('source')).toBe('binance-only');
    expect(candleRequests.some((url) => url.includes('mode=earlier'))).toBe(false);
    expect(row.className).toContain('active');
  });

  // ─── 10-30 整窗替换：点单焦点窗口不再与游标窗口 merge ───────────────────
  // 共享场景：15m 会话，游标 10:00，一笔已完成单开仓 08:00（远离游标窗口）。
  // 旧实现把焦点窗口 merge 进游标窗口，两段不相邻数据在索引型时间轴上拼出缝
  // （用户现场：15m 下 9-7 → 9-30 跨越 + 洞内开平仓点全挤在缝左缘那一根）。
  const distantOpenMs = Date.parse('2024-05-21T08:00:00+08:00');

  function seedSessionWithDistantTrade() {
    return [makeSeededSession({
      cursorTime: Date.parse('2024-05-21T10:00:00+08:00') / 1000,
      paperTrading: {
        active: true,
        startedAtCursorTime: Date.parse('2024-05-21T08:00:00+08:00') / 1000,
        nextId: 2,
        pendingEntry: null,
        pendingExit: null,
        position: null,
        trades: [{
          id: 'fill-1',
          positionId: 'position-1',
          direction: 'long',
          entryPrice: 95,
          entryTime: distantOpenMs,
          positionOpenPrice: 95,
          positionOpenTime: distantOpenMs,
          exitPrice: 100,
          exitTime: Date.parse('2024-05-21T09:30:00+08:00'),
          quantity: 1,
          margin: 95,
          notional: 95,
          leverage: 1,
          pnl: 5,
          returnRate: 0.0526,
        }],
      },
    })];
  }

  /** 连续 15m 序列：焦点窗（锚 08:00）与游标窗（锚 10:00）互不重叠。 */
  function distantTradeCandleStub(url: string): Response {
    const params = new URL(`http://localhost${url}`).searchParams;
    const entryTime = params.get('entryTime');
    if (params.get('mode') === 'initial' && entryTime === new Date(distantOpenMs).toISOString()) {
      return new Response(JSON.stringify({ candles: [
        makeCandle('2024-05-21T07:00:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T07:15:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T07:30:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T07:45:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T08:00:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T08:15:00+08:00', { timeframe: '15m' }),
      ] }));
    }
    if (params.get('mode') === 'initial') {
      return new Response(JSON.stringify({ candles: [
        makeCandle('2024-05-21T09:00:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T09:15:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T09:30:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T10:00:00+08:00', { timeframe: '15m' }),
        makeCandle('2024-05-21T10:15:00+08:00', { timeframe: '15m' }),
      ] }));
    }
    return new Response(JSON.stringify({ candles: [] }));
  }

  async function restoreSeededSessionAndFocus() {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 08:00/ });
    fireEvent.click(row);
    const openSec = distantOpenMs / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    }));
    return row;
  }

  it('renders one contiguous window after focusing a distant order, never a stitched seam', async () => {
    stubFreeReplayFetch({ sessions: seedSessionWithDistantTrade(), onCandles: distantTradeCandleStub });
    await restoreSeededSessionAndFocus();

    // 核心回归：最后一次 setData 的真实蜡烛两两相邻恒等于一个 15m step。
    // 旧 merge 实现下 08:15 → 09:00 的相邻对会把缝暴露出来（2700 ≠ 900）。
    const times = lastSetDataRealTimes();
    expect(times.length).toBeGreaterThan(1);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index] - times[index - 1]).toBe(900);
    }
    // 焦点窗口里必须能看到该单的开仓点（10-30 回归：点集锚定活动数据集 ——
    // 游标数据集不含焦点窗口，锚错数据集会让最老的单子丢开/平仓点）。
    const points = markerPoints() as Array<{ timeMs?: number; kind?: string }>;
    expect(points.some((point) => point.timeMs === distantOpenMs && point.kind === 'open')).toBe(true);
  });

  it('keeps market-open available while an order is focused (cursor dataset still feeds the app)', async () => {
    stubFreeReplayFetch({ sessions: seedSessionWithDistantTrade(), onCandles: distantTradeCandleStub });
    await restoreSeededSessionAndFocus();

    // R2：焦点态下 currentCursorCandle 仍由游标数据集供给 —— 市价开仓不禁用。
    fireEvent.click(screen.getByRole('tab', { name: '操作' }));
    expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled();
  });

  it('restores the cursor window with cursor candles on screen after stepping out of focus', async () => {
    stubFreeReplayFetch({ sessions: seedSessionWithDistantTrade(), onCandles: distantTradeCandleStub });
    const row = await restoreSeededSessionAndFocus();

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    // R3：步进退出焦点 → 活动数据集切回游标窗口，图上立刻有游标附近 K 线
    // （游标 10:00 → 步进到 10:15，而不是空窗）。
    const steppedCursorSec = Date.parse('2024-05-21T10:15:00+08:00') / 1000;
    await waitFor(() => expect(lastSetDataRealTimes()).toContain(steppedCursorSec));
    expect(row.className).not.toContain('active');
    // 视口跟随回游标（10/28 舒适区契约）：mock 视口 span=1000、pad=10×15m=9000
    // → followsForward 锚 { from: cursor-span+pad, to: cursor+pad }。
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: steppedCursorSec - 1000 + 9000,
      to: steppedCursorSec + 9000,
    }));
  });

  // 11/04 R2：焦点单不跨周期 —— 切周期清焦点，活动数据集回到游标窗口，视口回
  // 光标右缘（不再取开仓点窗口、不再取 08:00 的旧周期数据）。
  it('clears the focused order on a timeframe switch and returns to the cursor window', async () => {
    stubFreeReplayFetch({
      sessions: seedSessionWithDistantTrade(),
      onCandles: (url) => {
        const params = new URL(`http://localhost${url}`).searchParams;
        if (params.get('timeframe') === '5m') {
          // 只回游标附近的 5m 窗口：开仓点（08:00）的焦点窗口绝不应被取。
          return new Response(JSON.stringify({ candles: [
            makeCandle('2024-05-21T09:50:00+08:00'),
            makeCandle('2024-05-21T09:55:00+08:00'),
            makeCandle('2024-05-21T10:00:00+08:00'),
          ] }));
        }
        return distantTradeCandleStub(url);
      },
    });
    const row = await restoreSeededSessionAndFocus();

    chartMocks.setVisibleRange.mockClear();
    chartMocks.setVisibleLogicalRange.mockClear();
    chartMocks.timeToIndex.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '5m' }));

    // 新周期数据落地后回光标右缘（timeToIndex=150，visibleBars=160 → {0,160}）。
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
    // 焦点锚定（08:00 开仓点 ±150 根 5m）不再发生。
    const openSec = distantOpenMs / 1000;
    expect(chartMocks.setVisibleRange).not.toHaveBeenCalledWith({
      from: openSec - 150 * 300,
      to: openSec + 150 * 300,
    });
    expect(row.className).not.toContain('active');
    expect(screen.queryByRole('button', { name: /开仓点后的 K 线/ })).not.toBeInTheDocument();
    // 渲染数据是单一 5m 游标窗口：无跨周期/跨窗口缝。
    const times = lastSetDataRealTimes();
    expect(times.length).toBeGreaterThan(1);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index] - times[index - 1]).toBe(300);
    }
  });

  // 10/30：开平仓提交/点持仓行后视口跳回光标（光标锚定，与初始同款），
  // 且焦点清除；步进不经此（舒适区契约另有用例）。
  it('returns the viewport to the cursor after a paper trading action or a position-row click', async () => {
    stubFreeReplayFetch({
      onCandles: () => new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
          makeCandle('2024-05-21T10:10:00+08:00', { close: 130 }),
        ],
      })),
    });

    await startReplayAndCloseTrade();
    // 再开一笔持仓（用于后面点持仓行）；该提交本身也会触发回光标。
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));

    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    const row = screen.getByRole('button', { name: /开 05-21 10:00/ });
    fireEvent.click(row);
    const openSec = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 300,
      to: openSec + 150 * 300,
    }));

    // 点持仓行 → 清焦点 + 跳回光标（timeToIndex=150，visibleBars=160 → {0,160}）
    chartMocks.setVisibleLogicalRange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /持仓中/ }));
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
    expect(row.className).not.toContain('active');

    // 重新锚定后再提交平仓 → 同样回光标
    fireEvent.click(row);
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 300,
      to: openSec + 150 * 300,
    }));
    chartMocks.setVisibleLogicalRange.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: '操作' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
  });

  // 11/04：回放内单子行支持回合批注（标签/笔记/收藏）。批注粒度是回合，
  // 所以同一回合的多行共享同一份 `paper:{instrument}:{startTime}:{positionId}` 数据。
  it('annotates a paper round from the in-replay order rows', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/paper/rounds')) return new Response(JSON.stringify({ rounds: [], sessions: [], tags: [], tagCounts: {} }));
      if (url.startsWith('/api/reviews')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { tradeId: string; tags: string[]; note: string; starred: boolean };
        return new Response(JSON.stringify({
          review: { ...body, updatedAt: '2024-05-21T12:00:00.000Z' },
          tags: body.tags,
          tagCounts: Object.fromEntries(body.tags.map((tag) => [tag, 1])),
        }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({ candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
        ] }));
      }
      return new Response(JSON.stringify({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    fireEvent.click(screen.getByRole('button', { name: /批注 position-1/ }));
    fireEvent.change(screen.getByLabelText('模拟单备注'), { target: { value: '追高进的，回踩没等到' } });
    fireEvent.click(screen.getByRole('button', { name: '保存批注' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/reviews', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"tradeId":"paper:BTCUSDT:2024-05-21 10:00:position-1"'),
    })));
    // 保存请求必须带 paper 作用域，标签计数才不会混进真实单。
    expect(String(fetchMock.mock.calls.find(([url]) => String(url) === '/api/reviews')?.[1]?.body)).toContain('"module":"paper"');
    await waitFor(() => expect(screen.getByLabelText('模拟单备注')).toHaveValue('追高进的，回踩没等到'));
  });

  it('keeps one round annotation shared by its partial-close rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/paper/rounds')) return new Response(JSON.stringify({ rounds: [], sessions: [], tags: [], tagCounts: {} }));
      if (url.startsWith('/api/reviews')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { tradeId: string; tags: string[]; note: string; starred: boolean };
        return new Response(JSON.stringify({
          review: { ...body, updatedAt: '2024-05-21T12:00:00.000Z' },
          tags: body.tags,
          tagCounts: {},
        }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({ candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
        ] }));
      }
      return new Response(JSON.stringify({}));
    }));

    await startReplayAndCloseTrade();
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    // 星标是单击直写：不先展开编辑器。
    fireEvent.click(screen.getByRole('button', { name: /收藏 position-1/ }));
    expect(screen.queryByLabelText('模拟单备注')).not.toBeInTheDocument();

    // 收藏写的是回合 id，不是成交 id —— 回合的多行因此共享同一个星标状态。
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/reviews', expect.objectContaining({
      body: expect.stringContaining('"tradeId":"paper:BTCUSDT:2024-05-21 10:00:position-1"'),
    })));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /取消收藏 position-1/ }).length).toBeGreaterThan(0));
  });

  it('annotates every fill row of the same round from one editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        return new Response(JSON.stringify({ sessions: [] }));
      }
      if (url.startsWith('/api/paper/rounds')) return new Response(JSON.stringify({ rounds: [], sessions: [], tags: [], tagCounts: {} }));
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({ candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
          makeCandle('2024-05-21T10:10:00+08:00', { close: 130 }),
        ] }));
      }
      return new Response(JSON.stringify({}));
    }));

    await startReplayAndCloseTrade();
    // 第二笔：同一回合的另一次部分平仓（50% → 剩下的 100%）。
    fireEvent.click(screen.getByRole('tab', { name: '操作' }));
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));

    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    // 同一回合的两个成交行共享一个批注入口：批注按钮按 positionId 命名，
    // 所以两行只能打开同一份批注数据（此处断言入口数量与回合数一致）。
    await waitFor(() => expect(document.querySelectorAll('.paper-trade-row')).toHaveLength(2));
    expect(screen.getAllByLabelText(/批注 position-\d+/)).toHaveLength(2);
  });
  // 11/04：库行点击 = 恢复来源会话 + 焦点定位回合末笔成交（R7）。这是设计里
  // 最容易坏的一环（恢复清 candles/orderFocus，焦点要等会话就位）。
  it('restores the source session from a library row and focuses its round', async () => {
    const session = makeSeededSession({
      paperTrading: {
        active: true,
        startedAtCursorTime: Date.parse('2024-05-21T10:00:00+08:00') / 1000,
        nextId: 3,
        pendingEntry: null,
        pendingExit: null,
        position: null,
        trades: [{
          id: 'fill-1',
          positionId: 'position-1',
          direction: 'long',
          entryPrice: 100,
          entryTime: Date.parse('2024-05-21T10:00:00+08:00'),
          positionOpenPrice: 100,
          positionOpenTime: Date.parse('2024-05-21T10:00:00+08:00'),
          exitPrice: 110,
          exitTime: Date.parse('2024-05-21T10:15:00+08:00'),
          quantity: 1,
          margin: 500,
          notional: 5000,
          leverage: 10,
          pnl: 10,
          returnRate: 0.02,
        }],
      },
    });

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
      if (url.startsWith('/api/free-replay/sessions')) {
        if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
        return new Response(JSON.stringify({ sessions: [session] }));
      }
      if (url.startsWith('/api/paper/rounds')) {
        return new Response(JSON.stringify({
          rounds: [{
            id: 'paper:BTCUSDT:2024-05-21 10:00:position-1',
            positionId: 'position-1',
            instrument: 'BTCUSDT',
            startTime: '2024-05-21 10:00',
            direction: 'long',
            entryPrice: 100,
            entryTime: Date.parse('2024-05-21T10:00:00+08:00'),
            exitPrice: 110,
            exitTime: Date.parse('2024-05-21T10:15:00+08:00'),
            positionOpenPrice: 100,
            positionOpenTime: Date.parse('2024-05-21T10:00:00+08:00'),
            quantity: 1,
            margin: 500,
            notional: 5000,
            leverage: 10,
            pnl: 10,
            returnRate: 0.02,
            fillCount: 1,
            tradeIds: ['fill-1'],
          }],
          sessions: [{ instrument: 'BTCUSDT', startTime: '2024-05-21 10:00', updatedAt: '2024-05-21T12:00:00+08:00', roundCount: 1 }],
          tags: [],
          tagCounts: {},
        }));
      }
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) {
        return new Response(JSON.stringify({ candles: [
          makeCandle('2024-05-21T09:55:00+08:00', { close: 100 }),
          makeCandle('2024-05-21T10:00:00+08:00', { close: 110 }),
          makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }),
        ] }));
      }
      return new Response(JSON.stringify({}));
    }));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /模拟单库/ })).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('回到该回合'));

    // 会话被恢复（工作区标题出现），且焦点落在这回合上：单子行的 active 态。
    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTCUSDT' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
    await waitFor(() => expect(screen.getAllByTitle('跳到开仓点')[0].className).toContain('active'));
  });
});

function makeCandle(time: string, overrides = {}) {
  return {
    instrument: 'BTCUSDT',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    ...overrides,
  };
}

/** 一次已平仓成交的完整 paper 会话（11/02 会话切换回归用）。 */
function seededPaperTrading(entryPrice: number, fillId: string, positionId: string): unknown {
  const cursorTime = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
  const openMs = Date.parse('2024-05-21T09:30:00+08:00');
  return {
    active: true,
    startedAtCursorTime: cursorTime,
    nextId: 10,
    pendingEntry: null,
    pendingExit: null,
    position: null,
    trades: [{
      id: fillId,
      positionId,
      direction: 'long',
      entryPrice,
      entryTime: openMs,
      positionOpenPrice: entryPrice,
      positionOpenTime: openMs,
      exitPrice: entryPrice + 10,
      exitTime: Date.parse('2024-05-21T09:45:00+08:00'),
      quantity: 1,
      margin: 500,
      notional: 5000,
      leverage: 10,
      pnl: 10,
      returnRate: 0.02,
    }],
  };
}

function makeSeededSession(overrides: Partial<Record<'startTime' | 'dataAnchorTime' | 'timeframe', string> & { cursorTime: number; paperTrading: unknown }> = {}) {
  const cursorTime = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
  return {
    instrument: 'BTCUSDT',
    startTime: '2024-05-21 10:00',
    dataAnchorTime: '2024-05-21 10:00',
    startCursorTime: Date.parse('2024-05-21T09:45:00+08:00') / 1000,
    startProgressTime: Date.parse('2024-05-21T10:00:00+08:00') / 1000,
    progressTime: Date.parse('2024-05-21T10:10:00+08:00') / 1000,
    cursorTime,
    timeframe: '15m',
    paperTrading: {
      active: true,
      startedAtCursorTime: cursorTime,
      nextId: 1,
      pendingEntry: null,
      pendingExit: null,
      pendingStopLoss: null,
      position: null,
      trades: [],
    },
    updatedAt: '2024-05-21T12:00:00+08:00',
    ...overrides,
  };
}

function sessionPutBodies(): Array<Record<string, unknown>> {
  const fetchMock = fetch as unknown as { mock: { calls: Array<[unknown, RequestInit | undefined]> } };
  return fetchMock.mock.calls
    .filter(([, callInit]) => callInit?.method === 'PUT')
    .map(([, callInit]) => JSON.parse(String(callInit?.body)) as Record<string, unknown>);
}

/** 11/04 焦点翻页用例的共享 fetch 桩：游标窗口 24 根 + 焦点窗口 [09:00, 09:05, 09:10]。 */
function stubFocusPagingFetch(laterCandles: ReturnType<typeof makeCandle>[]) {
  stubFreeReplayFetch({
    onCandles: (url) => {
      const mode = new URL(`http://localhost${url}`).searchParams.get('mode');
      if (mode === 'initial') return Response.json({ candles: focusPageStubCandles(url) });
      if (mode === 'later') return Response.json({ candles: laterCandles });
      return Response.json({ candles: [] });
    },
  });
}

/** 5m 会话焦点窗口：主题标 [09:00, 09:05, 09:10]（老单，整体早于光标）。 */
function focusPageStubCandles(url: string): ReturnType<typeof makeCandle>[] {
  // 焦点取窗的 entryTime 是 ISO（`2024-05-21T02:00:00.000Z`），游标初始加载是
  // 原始开始串（`2024-05-21 10:00`）—— 用大写 T 区分两者。
  const isFocusWindow = new URL(`http://localhost${url}`).searchParams.get('entryTime')?.includes('T');
  if (isFocusWindow) {
    return ['09:00', '09:05', '09:10'].map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
  }
  return ['09:55', '10:00', '10:05', '10:10', '10:15', '10:20', '10:25', '10:30', '10:35', '10:40', '10:45', '10:50', '10:55', '11:00', '11:05', '11:10', '11:15', '11:20', '11:25', '11:30', '11:35', '11:40', '11:45', '11:50', '11:55']
    .map((clock) => makeCandle(`2024-05-21T${clock}:00+08:00`));
}

function focusPageTimes(): number[] {
  return ['09:00', '09:05', '09:10'].map((clock) => Date.parse(`2024-05-21T${clock}:00+08:00`) / 1000);
}

/** 11/04：开仓 → 下一根 → 平仓 → 点成交行进焦点态，等到焦点窗口渲染完成。 */
async function startReplayCloseTradeAndFocus() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
  await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
  fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
  fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
  fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));
  fireEvent.click(screen.getByRole('tab', { name: /单子/ }));
  fireEvent.click(screen.getAllByTitle('跳到开仓点')[0]);
  await waitFor(() => expect(lastSetDataRealTimes()).toEqual(focusPageTimes()));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** 触发已订阅的右缘翻页 handler（拖动一帧）。 */
function triggerLaterLoad(range: { from: number; to: number } = { from: 0, to: 160 }) {
  const handler = chartMocks.subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
  expect(handler).toBeTypeOf('function');
  handler?.(range);
}

function laterRequests(): string[] {
  const fetchMock = fetch as unknown as { mock: { calls: Array<[unknown, RequestInit | undefined]> } };
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/api/candles') && url.includes('mode=later'));
}

/** 最后一次 series.setData 载荷里的真实蜡烛时间（秒；过滤两端各 200 根补白）。 */
function lastSetDataRealTimes(): number[] {
  const calls = chartMocks.setData.mock.calls;
  const data = (calls.at(-1)?.[0] ?? []) as Array<{ time: number | string; open?: number }>;
  return data.filter((item) => item.open !== undefined).map((item) => Number(item.time));
}

/** 10/29 新用例的共享 fetch 桩：基线路由 + 调用方给 candles 应答。 */
function stubFreeReplayFetch(options: { sessions?: unknown[]; onCandles: (url: string) => Response | Promise<Response> }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
    if (url.startsWith('/api/free-replay/instruments')) return new Response(JSON.stringify({ instruments: ['BTCUSDT'] }));
    if (url.startsWith('/api/free-replay/sessions')) {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
      return new Response(JSON.stringify({ sessions: options.sessions ?? [] }));
    }
    if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
    if (url.startsWith('/api/candles')) return options.onCandles(url);
    return new Response(JSON.stringify({}));
  }));
}

/** 10/29 新用例的共享流程：5m 会话 10:00 开始，开一笔 → 下一根 → 平仓。 */
async function startReplayAndCloseTrade() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
  await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
  fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
  fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
  fireEvent.click(screen.getByRole('button', { name: '市价平仓' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /单子/ })).toHaveTextContent('1'));
}
