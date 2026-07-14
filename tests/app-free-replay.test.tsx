// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

const chartMocks = vi.hoisted(() => ({
  getVisibleRange: vi.fn(),
  setVisibleRange: vi.fn(),
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn() }),
    remove: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      coordinateToTime: vi.fn(),
      getVisibleRange: chartMocks.getVisibleRange,
      setVisibleRange: chartMocks.setVisibleRange,
      subscribeVisibleLogicalRangeChange: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    }),
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
}));

describe('App Free Replay', () => {
  beforeEach(() => {
    chartMocks.getVisibleRange.mockReturnValue({ from: 1000, to: 2000 });
    chartMocks.setVisibleRange.mockClear();
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
            makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }),
            makeCandle('2024-05-21T10:05:00+08:00', { close: 110 }),
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

    const nextCursor = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({
      from: nextCursor - 1000 + 3000,
      to: nextCursor + 3000,
    }));
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
