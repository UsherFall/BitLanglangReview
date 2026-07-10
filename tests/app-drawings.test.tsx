// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  createChart: () => ({
    addSeries: () => ({
      setData: vi.fn(),
      priceToCoordinate: vi.fn(() => 120),
      coordinateToPrice: vi.fn(() => 100),
    }),
    remove: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      coordinateToTime: vi.fn(() => 1716256800),
      getVisibleRange: vi.fn(() => ({ from: 1716256500, to: 1716257100 })),
      setVisibleRange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      timeToCoordinate: vi.fn(() => 200),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    }),
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
}));

describe('App drawings', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', makeFetch());
  });

  it('scales drawing width by timeframe and clears selection on chart blank click', async () => {
    render(<App />);

    const line = await drawingLine();
    expect(line).toHaveAttribute('stroke-width', '1');

    fireEvent.click(line);
    await waitFor(() => expect(line).toHaveAttribute('stroke-width', '2'));
    expect(deleteButton()).toBeEnabled();

    fireEvent.click(document.querySelector('svg.drawing-overlay')!);
    await waitFor(() => expect(line).toHaveAttribute('stroke-width', '1'));
    expect(deleteButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '1D' }));
    await waitFor(() => expect(line).toHaveAttribute('stroke-width', '2'));
  });
});

async function drawingLine(): Promise<SVGLineElement> {
  await waitFor(() => expect(document.querySelector('line.drawing-shape')).toBeInTheDocument());
  return document.querySelector('line.drawing-shape') as SVGLineElement;
}

function deleteButton(): HTMLButtonElement {
  return screen.getByTitle('删除选中画线') as HTMLButtonElement;
}

function makeFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({
        trades: [makeTrade()],
        instruments: ['BTC-USDT-SWAP'],
        tags: [],
      }));
    }
    if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [makeDrawing()] }));
    if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T10:00:00+08:00')] }));
    return new Response(JSON.stringify({}));
  });
}

function makeTrade() {
  return {
    id: 't1',
    sequence: 1,
    instrument: 'BTC-USDT-SWAP',
    direction: '多',
    leverage: 1,
    margin: 1,
    entryPrice: 100,
    exitPrice: 101,
    returnRate: 0.01,
    profit: 1,
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

function makeDrawing() {
  return {
    id: 'd1',
    tradeId: 't1',
    instrument: 'BTC-USDT-SWAP',
    timeframe: '1D',
    kind: 'horizontal',
    points: [{ time: 1716256800, price: 100 }],
    createdAt: '2024-05-21T00:00:00.000Z',
    updatedAt: '2024-05-21T00:00:00.000Z',
  };
}

function makeCandle(time: string) {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 99,
    high: 101,
    low: 98,
    close: 100,
    volume: 10,
  };
}
