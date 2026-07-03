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
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn() }),
    remove: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      coordinateToTime: vi.fn(),
      getVisibleRange: vi.fn(),
      setVisibleRange: vi.fn(),
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
  });

  it('shows the selected Trade position and reviewed count for the current Review Queue', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Review progress')).toBeInTheDocument());
    expect(screen.getByText('当前')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('已复盘')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('updates Review Progress after saving Review Tags', async () => {
    vi.stubGlobal('fetch', makeFetch({ savedReview: { tradeId: 't2', tags: ['late'], note: 'note only' } }));

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Review progress')).toBeInTheDocument());
    fireEvent.click(screen.getByText('未标记'));
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'late' } });
    fireEvent.click(screen.getByRole('button', { name: /保存复盘/ }));

    await waitFor(() => expect(screen.getByText('3 / 3')).toBeInTheDocument());
  });

  it('continues review by selecting the first unreviewed Trade in the current Review Queue', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Review progress')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '继续复盘' }));

    await waitFor(() => expect(screen.getByLabelText('备注')).toHaveValue('note only'));
    expect(screen.getByLabelText('标签')).toHaveValue('');
  });

  it('disables Continue Review when every Trade in the current Review Queue is reviewed', async () => {
    vi.stubGlobal('fetch', makeFetch({
      trades: [
        makeTrade('t1', ['breakout'], ''),
        makeTrade('t2', ['late'], 'note'),
      ],
    }));

    render(<App />);

    await waitFor(() => expect(screen.getByRole('button', { name: '已完成' })).toBeDisabled());
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

    await waitFor(() => expect(screen.getByLabelText('Review progress')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '继续复盘' }));
    await waitFor(() => expect(screen.getByLabelText('备注')).toHaveValue('note only'));
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'late' } });
    fireEvent.click(screen.getByRole('button', { name: /保存复盘/ }));
    await waitFor(() => expect(screen.getByLabelText('标签')).toHaveValue('late'));

    fireEvent.click(screen.getByRole('button', { name: '继续复盘' }));

    await waitFor(() => expect(screen.getByLabelText('标签')).toHaveValue(''));
    expect(screen.getByLabelText('备注')).toHaveValue('');
  });
  it('centers the selected Trade row after Continue Review selects it', async () => {
    vi.stubGlobal('fetch', makeFetch());

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText('Review progress')).toBeInTheDocument());
    const continueButton = screen.getAllByRole('button').find((button) => button.textContent === '继续复盘');
    expect(continueButton).toBeDefined();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    fireEvent.click(continueButton!);

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
  });
});

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
    review: { tradeId: id, tags, note, updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}
