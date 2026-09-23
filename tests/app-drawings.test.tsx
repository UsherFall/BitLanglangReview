// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: () => ({
    addSeries: () => ({
      setData: vi.fn(),
      priceToCoordinate: vi.fn(() => 120),
      attachPrimitive: vi.fn(),
      coordinateToPrice: vi.fn(() => 100),
    }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
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

type PostedDrawing = { kind: string; points: { time: number; price: number }[] };

const posted: PostedDrawing[] = [];

describe('App drawings', () => {
  beforeEach(() => {
    posted.length = 0;
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

  it('previews a ray from the endpoint through the current pointer before the second click', async () => {
    render(<App />);

    await drawingLine();
    const toolbarButtons = document.querySelectorAll('.drawing-toolbar button');
    // The 线段 tool is replaced, not joined by a third button.
    expect(toolbarButtons[1]).toHaveAttribute('title', '射线');
    expect(document.querySelector('.drawing-toolbar button[title="线段"]')).toBeNull();
    fireEvent.click(toolbarButtons[1]);
    expect(toolbarButtons[1]).toHaveClass('selected');

    const overlay = document.querySelector('svg.drawing-overlay')!;
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 330, clientY: 20 });

    await waitFor(() => {
      const draft = Array.from(document.querySelectorAll('line.drawing-shape')).at(-1) as SVGLineElement;
      // The draft is already a ray, not a segment. Magnetic snap quantizes each
      // point's time to the bar of the 5m candlestick containing the pointer
      // (mock: 1px = 1s, bars at 10:00 and 10:05), so the click at x=10 lands on
      // the 10:00 bar at x=0 and the moving end on the 10:05 bar at x=300. A
      // segment would stop at x2=300; the ray runs on far past it.
      expect(draft).toHaveAttribute('x1', '0');
      expect(draft).toHaveAttribute('y1', '120');
      expect(Number(draft.getAttribute('x2'))).toBeGreaterThan(1000);
    });

    // ...and it follows the pointer back: moving inside the first bar again puts
    // the direction point on top of the endpoint, so there is no direction to
    // extend along and the preview must collapse instead of emitting NaN.
    fireEvent.pointerMove(overlay, { clientX: 20, clientY: 20 });
    await waitFor(() => {
      const draft = Array.from(document.querySelectorAll('line.drawing-shape')).at(-1) as SVGLineElement;
      expect(draft).toHaveAttribute('x1', '0');
      expect(draft).toHaveAttribute('x2', '0');
      expect(draft).toHaveAttribute('y2', '120');
    });
  });

  it('commits a ray whose endpoint comes from the first click and direction point from the second', async () => {
    render(<App />);

    await drawingLine();
    fireEvent.click(document.querySelectorAll('.drawing-toolbar button')[1]);

    const overlay = document.querySelector('svg.drawing-overlay')!;
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.click(overlay, { clientX: 330, clientY: 20 });

    await waitFor(() => expect(posted).toHaveLength(1));
    const drawing = posted[0];
    expect(drawing.kind).toBe('ray');
    expect(drawing.points).toHaveLength(2);
    // Snapped bar times once more: the first click sits in the 10:00 bar
    // (`points[0]`, the endpoint) and the second in the 10:05 bar
    // (`points[1]`, the direction point).
    expect(drawing.points[0].time).toBe(1716256800);
    expect(drawing.points[1].time).toBe(1716257100);
  });

  it('drops a half-drawn ray when another tool is picked instead of leaving a ghost line', async () => {
    render(<App />);

    await drawingLine();
    const toolbarButtons = document.querySelectorAll('.drawing-toolbar button');
    const overlay = document.querySelector('svg.drawing-overlay')!;

    // Start a ray: the first click lays the endpoint and the pointer move gives
    // it a direction, so a draft line joins the one saved drawing on screen.
    fireEvent.click(toolbarButtons[1]);
    fireEvent.click(overlay, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 330, clientY: 20 });
    await waitFor(() => expect(document.querySelectorAll('line.drawing-shape')).toHaveLength(2));

    // Switching tools must abandon it. The preview renders in the ACTIVE tool's
    // shape, so a leftover draft comes back as a full-width horizontal line —
    // a drawing the user never made and no click can clear.
    fireEvent.click(toolbarButtons[0]);
    await waitFor(() => expect(document.querySelectorAll('line.drawing-shape')).toHaveLength(1));
  });

  it('still renders a saved segment as a finite two-point line', async () => {
    vi.stubGlobal('fetch', makeFetch([
      { ...makeDrawing(), id: 'd-segment', kind: 'segment', points: [{ time: 1716256800, price: 100 }, { time: 1716257100, price: 100 }] },
    ]));

    render(<App />);

    await waitFor(() => expect(document.querySelectorAll('line.drawing-shape')).toHaveLength(1));
    const line = document.querySelector('line.drawing-shape') as SVGLineElement;
    // Kept drawings of the retired `segment` kind must not pick up the ray
    // extension: the line ends on its own second point.
    expect(line).toHaveAttribute('x1', '0');
    expect(line).toHaveAttribute('x2', '300');
  });

  it('renders a ray loaded from the API as an extended line', async () => {
    vi.stubGlobal('fetch', makeFetch([
      { ...makeDrawing(), id: 'd-ray', kind: 'ray', points: [{ time: 1716256800, price: 100 }, { time: 1716257100, price: 100 }] },
    ]));

    render(<App />);

    await waitFor(() => expect(document.querySelectorAll('line.drawing-shape')).toHaveLength(1));
    const line = document.querySelector('line.drawing-shape') as SVGLineElement;
    // Same two points as the saved segment above, only the kind differs: a
    // persisted ray must extend past its direction point (x=300) too, not just
    // the in-progress draft.
    expect(line).toHaveAttribute('x1', '0');
    expect(Number(line.getAttribute('x2'))).toBeGreaterThan(1000);
  });
});

async function drawingLine(): Promise<SVGLineElement> {
  await waitFor(() => expect(document.querySelector('line.drawing-shape')).toBeInTheDocument());
  return document.querySelector('line.drawing-shape') as SVGLineElement;
}

function deleteButton(): HTMLButtonElement {
  return screen.getByTitle('删除选中画线') as HTMLButtonElement;
}

function makeFetch(drawings: unknown[] = [makeDrawing()]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
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
      return new Response(JSON.stringify({ drawings }));
    }
    if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [makeCandle('2024-05-21T10:00:00+08:00'), makeCandle('2024-05-21T10:05:00+08:00')] }));
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
