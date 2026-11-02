// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

const chartMocks = vi.hoisted(() => ({
  barsInLogicalRange: vi.fn(() => ({ barsBefore: 100, barsAfter: 100 })),
  coordinateToPrice: vi.fn(() => 110),
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
  getVisibleRange: vi.fn(),
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
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn(), attachPrimitive: chartMocks.attachPrimitive, coordinateToPrice: chartMocks.coordinateToPrice, barsInLogicalRange: chartMocks.barsInLogicalRange }),
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
  }),
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
    chartMocks.coordinateToPrice.mockClear();
    chartMocks.coordinateToPrice.mockReturnValue(110);
    chartMocks.getVisibleRange.mockReturnValue({ from: 1000, to: 2000 });
    chartMocks.getVisibleLogicalRange.mockClear();
    chartMocks.getVisibleLogicalRange.mockReturnValue({ from: 0, to: 160 });
    chartMocks.priceScaleApplyOptions.mockClear();
    chartMocks.primitives.length = 0;
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

    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
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

  it('switches the active session candle source from the header and translates the instrument', async () => {
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
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:45:00+08:00', { timeframe: '15m' })] }));
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));

    // 恢复旧会话（无 candleSource → binance-only）。
    fireEvent.click(screen.getByRole('button', { name: /^BTCUSDT2024-05-21/ }));
    await waitFor(() => expect(screen.getByText('回溯复盘 2024-05-21 10:00')).toBeInTheDocument());
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('source=binance-only')));

    // 头部切到 OKX：新源请求 + 标的按 OKX 词汇翻译（BTCUSDT → BTC-USDT-SWAP）。
    fireEvent.change(screen.getByLabelText('切换行情源'), { target: { value: 'okx' } });
    await waitFor(() => {
      const okxCalls = (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls.filter(([callUrl]) => String(callUrl).includes('/api/candles') && String(callUrl).includes('source=okx'));
      expect(okxCalls.length).toBeGreaterThan(0);
      expect(okxCalls.some(([callUrl]) => String(callUrl).includes('instrument=BTC-USDT-SWAP'))).toBe(true);
    });

    // 会话身份不变，但新源落盘；单子/进度保留（PUT instrument 不变）。
    await waitFor(() => {
      const bodies = sessionPutBodies();
      expect(bodies.at(-1)?.candleSource).toBe('okx');
      expect(bodies.at(-1)?.instrument).toBe('BTCUSDT');
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

  // 10/29 R3：焦点单存活于切周期 —— 新周期下视口重新锚到该单开仓点，
  // 且初始化不再锚光标（setVisibleLogicalRange 不被调用）。
  it('keeps the order anchor across timeframe switches', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '15m' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    }));
    expect(chartMocks.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(row.className).toContain('active');
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
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    }));

    // 切完周期再点同一行：token 递增，必须在 15m 窗口重新归位
    chartMocks.setVisibleRange.mockClear();
    fireEvent.click(row);
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: openSec - 150 * 900,
      to: openSec + 150 * 900,
    }));
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

/** 10/29 新用例的共享 fetch 桩：基线路由 + 调用方给 candles 应答。 */
function stubFreeReplayFetch(options: { sessions?: unknown[]; onCandles: (url: string) => Response }) {
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
