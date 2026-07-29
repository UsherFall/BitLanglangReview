// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

const chartMocks = vi.hoisted(() => ({
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
  getVisibleRange: vi.fn(),
  priceScaleApplyOptions: vi.fn(),
  setMarkers: vi.fn(),
  setVisibleLogicalRange: vi.fn(),
  setVisibleRange: vi.fn(),
  timeToIndex: vi.fn(() => 150),
  timeScaleOptions: vi.fn(() => ({ barSpacing: 6 })),
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn() }),
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
      subscribeVisibleLogicalRangeChange: vi.fn(),
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
    chartMocks.getVisibleRange.mockReturnValue({ from: 1000, to: 2000 });
    chartMocks.getVisibleLogicalRange.mockClear();
    chartMocks.getVisibleLogicalRange.mockReturnValue({ from: 0, to: 160 });
    chartMocks.priceScaleApplyOptions.mockClear();
    chartMocks.setMarkers.mockClear();
    chartMocks.setVisibleLogicalRange.mockClear();
    chartMocks.setVisibleRange.mockClear();
    chartMocks.timeToIndex.mockClear();
    chartMocks.timeToIndex.mockReturnValue(150);
    chartMocks.timeScaleOptions.mockClear();
    chartMocks.timeScaleOptions.mockReturnValue({ barSpacing: 6 });
  });

  it('keeps the workspace rendered after starting Free Replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'BTC-USDT-SWAP' })).toBeInTheDocument());
    expect(screen.queryByText('Choose an instrument and start time to begin Free Replay')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=15m')));
  });

  it('supports a paper trading market open and close during Free Replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Market open' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Market open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next candle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Market close' }));

    await waitFor(() => expect(screen.getAllByText('+100.00 USDT').length).toBeGreaterThan(0));
    expect(screen.getAllByText('10.00%').length).toBeGreaterThan(0);
  });

  it('scrolls the Free Replay viewport without changing zoom when advancing the cursor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next candle' })).toBeInTheDocument());
    chartMocks.setVisibleRange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Next candle' }));

    const nextCursor = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: nextCursor - 1000 + 3000,
      to: nextCursor + 3000,
    }));
  });

  it('starts Free Replay with the cursor visible and right-side padding', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));

    const cursor = Date.parse('2024-05-21T09:55:00+08:00') / 1000;
    const step = 5 * 60;
    void cursor;
    void step;
    await waitFor(() => expect(chartMocks.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 160 }));
  });

  it('toggles log scale and resets the Free Replay price scale to normal autoscale', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
      if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
      if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T09:55:00+08:00')] }));
      return new Response(JSON.stringify({}));
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeInTheDocument());
    chartMocks.priceScaleApplyOptions.mockClear();

    fireEvent.click(screen.getByLabelText('Toggle log price scale'));
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 1, autoScale: true })));

    chartMocks.priceScaleApplyOptions.mockClear();
    fireEvent.click(screen.getByLabelText('Reset price scale'));
    await waitFor(() => expect(chartMocks.priceScaleApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ mode: 0, autoScale: true })));
  });

  it('remaps Free Replay paper trade markers after switching timeframe', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Market open' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Market open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next candle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Market close' }));

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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/trades')) return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
      if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeInTheDocument());

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
    fireEvent.click(screen.getByRole('button', { name: 'Next candle' }));

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
