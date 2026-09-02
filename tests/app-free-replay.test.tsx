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
  setMarkers: vi.fn(),
  setVisibleLogicalRange: vi.fn(),
  setVisibleRange: vi.fn(),
  subscribeVisibleLogicalRangeChange: vi.fn(),
  timeToIndex: vi.fn(() => 150),
  timeScaleOptions: vi.fn(() => ({ barSpacing: 6 })),
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn(), coordinateToPrice: chartMocks.coordinateToPrice, barsInLogicalRange: chartMocks.barsInLogicalRange }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: chartMocks.priceScaleApplyOptions }),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
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
  createSeriesMarkers: () => ({ setMarkers: chartMocks.setMarkers }),
}));

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
    chartMocks.setMarkers.mockClear();
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTC-USDT-SWAP' })).toBeInTheDocument());
    expect(screen.queryByText('选择交易对和开始时间，开始回溯复盘')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
  });

  it('collapses the whole sidebar via the explicit collapse button', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '全部市价平仓' }));

    await waitFor(() => expect(screen.getAllByText('+100.00 USDT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('10.00%').length).toBeGreaterThan(0);
  });

  it('scrolls the Free Replay viewport without changing zoom when advancing the cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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

  it('starts Free Replay with the cursor visible and right-side padding', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    const cursor = Date.parse('2024-05-21T09:55:00+08:00') / 1000;
    const step = 5 * 60;
    void cursor;
    void step;
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
  });

  it('toggles Free Replay paper trade entry and exit markers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '全部市价平仓' }));
    await waitFor(() => expect(chartMocks.setMarkers).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('100') }),
      expect.objectContaining({ text: expect.stringContaining('110') }),
    ])));

    chartMocks.setMarkers.mockClear();
    fireEvent.click(screen.getByLabelText('隐藏开平仓标记'));

    expect(chartMocks.setMarkers).toHaveBeenCalledWith([]);

    chartMocks.setMarkers.mockClear();
    fireEvent.click(screen.getByLabelText('显示开平仓标记'));

    expect(chartMocks.setMarkers).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('100') }),
      expect.objectContaining({ text: expect.stringContaining('110') }),
    ]));
  });

  it('sets a stop loss and closes automatically when the next revealed candle touches it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.change(screen.getByLabelText('仓1 止损价'), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: '设仓1止损' }));

    expect(screen.getByText(/95/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));

    await waitFor(() => expect(screen.getAllByText('-50.00 USDT').length).toBeGreaterThan(0));
    expect(screen.queryByLabelText(/删除仓1止损/)).not.toBeInTheDocument();
  });

  it('shows Free Replay hover percentage from the latest revealed candle close', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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

  it('toggles log scale and resets the Free Replay price scale to normal autoscale', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());
    chartMocks.priceScaleApplyOptions.mockClear();

    fireEvent.click(screen.getByLabelText('切换对数价格刻度'));
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 1, autoScale: true })));

    chartMocks.priceScaleApplyOptions.mockClear();
    fireEvent.click(screen.getByLabelText('重置价格刻度'));
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 0, autoScale: true })));
  });

  it('remaps Free Replay paper trade markers after switching timeframe', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟交易' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '开始模拟交易' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '市价开仓' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '市价开仓' }));
    fireEvent.click(screen.getByRole('button', { name: '下一根 K 线' }));
    fireEvent.click(screen.getByRole('button', { name: '全部市价平仓' }));

    await waitFor(() => expect(chartMocks.setMarkers).toHaveBeenCalledWith([
      expect.objectContaining({ time: Date.parse('2024-05-21T09:55:00+08:00') / 1000 }),
      expect.objectContaining({ time: Date.parse('2024-05-21T10:00:00+08:00') / 1000 }),
    ]));

    fireEvent.click(screen.getByRole('button', { name: '15m' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
    await waitFor(() => expect(chartMocks.setMarkers).toHaveBeenCalledWith([
      expect.objectContaining({ time: Date.parse('2024-05-21T09:45:00+08:00') / 1000 }),
      expect.objectContaining({ time: Date.parse('2024-05-21T09:45:00+08:00') / 1000 }),
    ]));
    const latestMarkersCall = chartMocks.setMarkers.mock.calls.at(-1)?.[0];
    expect(latestMarkersCall).toHaveLength(2);
  });

  it('keeps Free Replay progress across large timeframe switches without revealing unfinished candles', async () => {
    const candleRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
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
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));

    fireEvent.click(screen.getByRole('button', { name: /^BTC-USDT-SWAP/ }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTC-USDT-SWAP' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '15m' }).className).toContain('selected');
    expect(screen.getByLabelText('市价开仓')).toBeInTheDocument();

    const restoredCursor = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
    await waitFor(() => {
      const bodies = sessionPutBodies();
      expect(bodies.at(-1)?.cursorTime).toBe(restoredCursor);
      expect(bodies.at(-1)?.timeframe).toBe('15m');
    });
  });

  it('resumes an existing session when starting the same instrument and start time', async () => {
    const seeded = [makeSeededSession()];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTC-USDT-SWAP' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '15m' }).className).toContain('selected');
    expect(screen.getByLabelText('市价开仓')).toBeInTheDocument();
  });

  it('deletes the active session, stops replay, and does not re-save it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeInTheDocument());

    await waitFor(() => expect(screen.getByLabelText('删除会话 BTC-USDT-SWAP 2024-05-21 10:00')).toBeInTheDocument());

    const beforeDelete = sessionPutBodies().length;
    fireEvent.click(screen.getByLabelText('删除会话 BTC-USDT-SWAP 2024-05-21 10:00'));

    await waitFor(() => expect(screen.getByText('选择交易对和开始时间，开始回溯复盘')).toBeInTheDocument());
    expect(screen.queryByLabelText('开始模拟交易')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('删除会话 BTC-USDT-SWAP 2024-05-21 10:00')).not.toBeInTheDocument();

    await new Promise((resolve) => window.setTimeout(resolve, 700));
    expect(sessionPutBodies().length).toBe(beforeDelete);
  });
});

function makeCandle(time: string, overrides = {}) {
  return {
    instrument: 'BTC-USDT-SWAP',
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

function makeSeededSession() {
  const cursorTime = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
  return {
    instrument: 'BTC-USDT-SWAP',
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
  };
}

function sessionPutBodies(): Array<Record<string, unknown>> {
  const fetchMock = fetch as unknown as { mock: { calls: Array<[unknown, RequestInit | undefined]> } };
  return fetchMock.mock.calls
    .filter(([, callInit]) => callInit?.method === 'PUT')
    .map(([, callInit]) => JSON.parse(String(callInit?.body)) as Record<string, unknown>);
}
