// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

type ChartPointLike = { time: number; price: number };
type PostedDrawing = { kind: string; points: ChartPointLike[] };

const chartMock = vi.hoisted(() => ({ setData: [] as { time: number }[][] }));
const posted = vi.hoisted(() => [] as PostedDrawing[]);

/**
 * Fake chart with a real (linear) price scale so the snap is observable:
 * y = (200 - price) * 2 and its inverse price = 200 - y / 2.
 * One pixel of x is one second, so the two clicks below stay inside 10:00–10:05.
 */
vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: () => ({
    addSeries: () => ({
      setData: (data: { time: number }[]) => {
        chartMock.setData.push(data);
      },
      priceToCoordinate: (price: number) => (200 - price) * 2,
      coordinateToPrice: (y: number) => 200 - y / 2,
    }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      coordinateToTime: vi.fn((x: number) => 1716256800 + x),
      getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
      getVisibleRange: vi.fn(() => ({ from: 1716256500, to: 1716257100 })),
      options: vi.fn(() => ({ barSpacing: 6 })),
      setVisibleLogicalRange: vi.fn(),
      setVisibleRange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      subscribeVisibleTimeRangeChange: vi.fn(),
      timeToCoordinate: vi.fn((time: number) => time - 1716256800),
      timeToIndex: vi.fn(() => 150),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
    }),
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
}));

/** The 10:00 5m candlestick's OHLC; y = 22 / 8 / 44 / 14 on the fake price scale. */
const FIRST_BAR_OHLC = { open: 189, high: 196, low: 178, close: 193 };
const FIRST_BAR_SECONDS = 1716256800;
/** The 10:05 candlestick, still hidden behind the Free Replay cursor at 10:00. */
const HIDDEN_BAR_OHLC = { open: 150, high: 160, low: 140, close: 155 };

describe('App drawing magnet snap', () => {
  beforeEach(() => {
    chartMock.setData = [];
    posted.length = 0;
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', makeFetch());
  });

  it('AC8 saves segment endpoints snapped to an OHLC of the candlestick under the pointer', async () => {
    render(<App />);

    const overlay = await drawingOverlay();
    const toolbarButtons = document.querySelectorAll('.drawing-toolbar button');
    fireEvent.click(toolbarButtons[1]);

    // 10:00–10:05 (30s) and both clicks land inside that bar, but the raw
    // coordinateToPrice values (195 / 185) are not OHLC values of the bar.
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.click(overlay, { clientX: 30, clientY: 30 });

    await waitFor(() => expect(posted).toHaveLength(1));
    const drawing = posted[0];
    expect(drawing.kind).toBe('segment');
    expect(drawing.points).toHaveLength(2);

    for (const point of drawing.points) {
      expect([FIRST_BAR_OHLC.open, FIRST_BAR_OHLC.high, FIRST_BAR_OHLC.low, FIRST_BAR_OHLC.close]).toContain(point.price);
      expect(point.time).toBe(FIRST_BAR_SECONDS);
      expect(Number.isFinite(point.price)).toBe(true);
    }
    expect(drawing.points.map((point) => point.price)).not.toContain(195);
    expect(drawing.points.map((point) => point.price)).not.toContain(185);
  });

  it('AC9 defaults to weak magnet and cycles weak → strong → off → weak', async () => {
    render(<App />);

    await drawingOverlay();
    const magnet = () => screen.getByRole('button', { name: '磁吸模式' }) as HTMLButtonElement;

    expect(magnet()).toHaveAttribute('aria-pressed', 'true');
    expect(magnet()).toHaveTextContent('弱');
    expect(magnet()).toHaveClass('selected');
    expect(magnet()).toHaveAttribute('title', '磁吸：弱（点击切换为强）');

    fireEvent.click(magnet());
    expect(magnet()).toHaveAttribute('aria-pressed', 'true');
    expect(magnet()).toHaveTextContent('强');
    expect(magnet()).toHaveClass('selected');
    expect(magnet()).toHaveAttribute('title', '磁吸：强（点击切换为关）');

    fireEvent.click(magnet());
    expect(magnet()).toHaveAttribute('aria-pressed', 'false');
    expect(magnet()).toHaveTextContent('关');
    expect(magnet()).not.toHaveClass('selected');
    expect(magnet()).toHaveAttribute('title', '磁吸：关（点击切换为弱）');

    fireEvent.click(magnet());
    expect(magnet()).toHaveAttribute('aria-pressed', 'true');
    expect(magnet()).toHaveTextContent('弱');
  });
});

describe('App drawing magnet snap in Free Replay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFreeReplayFetch());
  });

  it('does not snap to a candlestick the Free Replay cursor has not revealed yet', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '回溯复盘' }));
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    const overlay = await drawingOverlay();
    fireEvent.click(document.querySelectorAll('.drawing-toolbar button')[0]);

    // x=310 maps to 10:05:10 — inside the 10:05 candlestick, which the cursor
    // (10:00) has not revealed. Snapping there would leak its OHLC levels, so the
    // point must keep the raw pointer time and price.
    fireEvent.click(overlay, { clientX: 310, clientY: 30 });

    await waitFor(() => expect(posted).toHaveLength(1));
    const [point] = posted[0].points;
    expect(posted[0].kind).toBe('horizontal');
    expect(point.time).toBe(FIRST_BAR_SECONDS + 310);
    expect(point.price).toBe(185);
    expect([HIDDEN_BAR_OHLC.open, HIDDEN_BAR_OHLC.high, HIDDEN_BAR_OHLC.low, HIDDEN_BAR_OHLC.close]).not.toContain(point.price);
  });
});

/** Waits for the chart to exist AND for candlesticks to be applied to the series. */
async function drawingOverlay(): Promise<SVGSVGElement> {
  const overlay = await waitFor(() => {
    const element = document.querySelector('svg.drawing-overlay');
    expect(element).not.toBeNull();
    return element as SVGSVGElement;
  });
  await waitFor(() => expect(chartMock.setData.some((data) => data.length >= 2)).toBe(true));
  return overlay;
}

function makeFetch() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({
        trades: [makeTrade()],
        instruments: ['BTC-USDT-SWAP'],
        tags: [],
      }));
    }
    if (url.startsWith('/api/drawings')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as PostedDrawing;
        posted.push(body);
        return new Response(JSON.stringify({ id: 'saved-1', ...body, createdAt: '2024-05-21T00:00:00.000Z', updatedAt: '2024-05-21T00:00:00.000Z' }));
      }
      return new Response(JSON.stringify({ drawings: [] }));
    }
    if (url.startsWith('/api/candles')) {
      return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T10:00:00+08:00', FIRST_BAR_OHLC), makeCandle('2024-05-21T10:05:00+08:00', { open: 189, high: 196, low: 178, close: 193 })] }));
    }
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

function makeCandle(time: string, ohlc: { open: number; high: number; low: number; close: number }) {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    volume: 10,
    ...ohlc,
  };
}

/** Free Replay fixture: the initial window already carries the 10:05 candlestick, but the cursor sits at 10:00. */
function makeFreeReplayFetch() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({ trades: [], instruments: [], tags: [] }));
    }
    if (url === '/api/free-replay/instruments') {
      return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
    }
    if (url.startsWith('/api/free-replay/sessions')) {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ...JSON.parse(String(init.body)), updatedAt: '2024-05-21T12:00:00+08:00' }));
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }));
      return new Response(JSON.stringify({ sessions: [] }));
    }
    if (url.startsWith('/api/drawings')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as PostedDrawing;
        posted.push(body);
        return new Response(JSON.stringify({ id: 'saved-1', ...body, createdAt: '2024-05-21T00:00:00.000Z', updatedAt: '2024-05-21T00:00:00.000Z' }));
      }
      return new Response(JSON.stringify({ drawings: [] }));
    }
    if (url.startsWith('/api/candles')) {
      return new Response(JSON.stringify({
        candles: [
          makeCandle('2024-05-21T10:00:00+08:00', FIRST_BAR_OHLC),
          makeCandle('2024-05-21T10:05:00+08:00', HIDDEN_BAR_OHLC),
        ],
      }));
    }
    return new Response(JSON.stringify({}));
  });
}
