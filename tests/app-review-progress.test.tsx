// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';

const chartMocks = vi.hoisted(() => ({
  setVisibleRange: vi.fn(),
  getVisibleRange: vi.fn(() => ({ from: 1000, to: 2000 })),
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

describe('App Review Progress', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    chartMocks.setVisibleRange.mockClear();
    chartMocks.getVisibleRange.mockClear();
    chartMocks.getVisibleRange.mockReturnValue({ from: 1000, to: 2000 });
  });

  it('shows the selected Trade position, reviewed count, and reviewed profit for the current Review Queue', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    const progress = await progressPanel();
    expect(progress).toHaveTextContent('1 / 3');
    expect(progress).toHaveTextContent('2 / 3');
    expect(progress).toHaveTextContent('+5.00 USDT');
  });

  it('updates Review Progress and reviewed profit after saving Review Tags', async () => {
    vi.stubGlobal('fetch', makeFetch({ savedReview: { tradeId: 't2', tags: ['late'], note: 'note only' } }));

    render(<App />);

    await progressPanel();
    fireEvent.click(tradeRows()[1]);
    fireEvent.change(tagInput(), { target: { value: 'late' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByLabelText('Review progress')).toHaveTextContent('3 / 3'));
    expect(screen.getByLabelText('Review progress')).toHaveTextContent('+4.00 USDT');
  });

  it('moves the Trade Review chart visible range by one candle with arrow keys', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await progressPanel();
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) })));
    await Promise.resolve();
    chartMocks.setVisibleRange.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({ from: 1300, to: 2300 }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await waitFor(() => expect(chartMocks.setVisibleRange).toHaveBeenCalledWith({ from: 700, to: 1700 }));
  });

  it('does not move the Trade Review chart when arrow keys come from a form control', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await progressPanel();
    chartMocks.setVisibleRange.mockClear();
    fireEvent.keyDown(tagInput(), { key: 'ArrowRight' });

    expect(chartMocks.setVisibleRange).not.toHaveBeenCalled();
  });

  it('continues review by selecting the first unreviewed Trade in the current Review Queue', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await progressPanel();
    fireEvent.click(getContinueButton());

    await waitFor(() => expect(noteInput()).toHaveValue('note only'));
    expect(tagInput()).toHaveValue('');
  });

  it('disables Continue Review when every Trade in the current Review Queue is reviewed', async () => {
    vi.stubGlobal('fetch', makeFetch({
      trades: [
        makeTrade('t1', ['breakout'], ''),
        makeTrade('t2', ['late'], 'note'),
      ],
    }));

    render(<App />);

    await waitFor(() => expect(getContinueButton()).toBeDisabled());
  });

  it('continues to the next first unreviewed Trade after saving Review Tags', async () => {
    vi.stubGlobal('fetch', makeFetch({
      savedReview: { tradeId: 't2', tags: ['late'], note: 'note only' },
      trades: [
        makeTrade('t1', ['breakout'], ''),
        makeTrade('t2', [], 'note only'),
        makeTrade('t3', [], ''),
      ],
    }));

    render(<App />);

    await progressPanel();
    fireEvent.click(getContinueButton());
    await waitFor(() => expect(noteInput()).toHaveValue('note only'));
    fireEvent.change(tagInput(), { target: { value: 'late' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(tagInput()).toHaveValue('late'));

    fireEvent.click(getContinueButton());

    await waitFor(() => expect(tagInput()).toHaveValue(''));
    expect(noteInput()).toHaveValue('');
  });

  it('centers the selected Trade row after Continue Review selects it', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await progressPanel();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    fireEvent.click(getContinueButton());

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
  });
});

async function progressPanel(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByLabelText('Review progress')).toBeInTheDocument());
  return screen.getByLabelText('Review progress');
}

function tagInput(): HTMLInputElement {
  return document.querySelector('.review-panel input') as HTMLInputElement;
}

function noteInput(): HTMLTextAreaElement {
  return document.querySelector('.review-panel textarea') as HTMLTextAreaElement;
}

function saveButton(): HTMLButtonElement {
  return document.querySelector('.review-panel .save-button') as HTMLButtonElement;
}

function getContinueButton(): HTMLButtonElement {
  const button = document.querySelector('.continue-review') as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  return button!;
}

function tradeRows(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.trade-row')) as HTMLButtonElement[];
}

function makeFetch(options: { savedReview?: { tradeId: string; tags: string[]; note: string }; trades?: ReturnType<typeof makeTrade>[] } = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({
        trades: options.trades ?? [
          makeTrade('t1', ['breakout'], ''),
          makeTrade('t2', [], 'note only'),
          makeTrade('t3', ['late'], ''),
        ],
        instruments: ['BTC-USDT-SWAP'],
        tags: ['breakout'],
      }));
    }
    if (url === '/api/reviews') return new Response(JSON.stringify(options.savedReview));
    if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [] }));
    if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
    return new Response(JSON.stringify({}));
  });
}

function makeTrade(id: string, tags: string[], note: string) {
  const profits: Record<string, number> = { t1: 10, t2: -1, t3: -5 };
  return {
    id,
    sequence: 1,
    instrument: 'BTC-USDT-SWAP',
    direction: '多',
    leverage: 1,
    margin: 1,
    entryPrice: 1,
    exitPrice: 1,
    returnRate: 0,
    profit: profits[id] ?? 0,
    turnover: 0,
    size: 0,
    maxPositionValue: 0,
    fee: 0,
    entryTime: '2024-05-21T10:00:00.000+08:00',
    exitTime: '2024-05-21T10:05:00.000+08:00',
    holdingMinutes: 5,
    amplitude: null,
    sourceNote: '',
    review: { tradeId: id, tags, note, updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}
