// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import { formatChartPrice } from '../src/ui/chart-price';

const chartMocks = vi.hoisted(() => ({
  createChartOptions: [] as unknown[],
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: (_container: HTMLElement, options: unknown) => {
    chartMocks.createChartOptions.push(options);
    return {
      addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn() }),
      remove: vi.fn(),
      subscribeCrosshairMove: vi.fn(),
      timeScale: () => ({
        coordinateToTime: vi.fn(),
        getVisibleRange: vi.fn(() => ({ from: 1000, to: 2000 })),
        setVisibleRange: vi.fn(),
        subscribeVisibleLogicalRangeChange: vi.fn(),
        subscribeVisibleTimeRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleTimeRangeChange: vi.fn(),
      }),
    };
  },
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
}));

describe('App Chart Price', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    chartMocks.createChartOptions.length = 0;
  });

  it('uses the adaptive price formatter for Trade Review and Free Replay charts', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await waitFor(() => expect(chartMocks.createChartOptions).toHaveLength(1));
    expect(priceFormatterAt(0)).toBe(formatChartPrice);

    fireEvent.click(screen.getByRole('button', { name: 'Free Replay' }));
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('LUNA-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));

    await waitFor(() => expect(chartMocks.createChartOptions).toHaveLength(2));
    expect(priceFormatterAt(1)).toBe(formatChartPrice);
  });
});

function priceFormatterAt(index: number): unknown {
  return (chartMocks.createChartOptions[index] as { localization?: { priceFormatter?: unknown } }).localization?.priceFormatter;
}

function makeFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({
        trades: [makeTrade()],
        instruments: ['LUNA-USDT-SWAP'],
        tags: [],
      }));
    }
    if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['LUNA-USDT-SWAP'] }));
    if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
    if (url.startsWith('/api/candles')) {
      return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T10:00:00+08:00')] }));
    }
    return new Response(JSON.stringify({}));
  });
}

function makeTrade() {
  return {
    id: 't1',
    sequence: 1,
    instrument: 'LUNA-USDT-SWAP',
    direction: '多',
    leverage: 1,
    margin: 1,
    entryPrice: 0.00001234,
    exitPrice: 0.00001235,
    returnRate: 0,
    profit: 0,
    turnover: 0,
    size: 0,
    maxPositionValue: 0,
    fee: 0,
    entryTime: '2024-05-21T10:00:00.000+08:00',
    exitTime: '2024-05-21T10:05:00.000+08:00',
    holdingMinutes: 5,
    amplitude: null,
    sourceNote: '',
    review: { tradeId: 't1', tags: [], note: '', updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}

function makeCandle(time: string) {
  return {
    instrument: 'LUNA-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 0.0000123,
    high: 0.0000124,
    low: 0.0000122,
    close: 0.00001234,
    volume: 10,
  };
}
