// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewedTrade } from '../src/domain/review-queue';
import { App } from '../src/ui/App';

// Mirror the chart mocks from app-review-progress.test.tsx: the App renders a
// chart, which we stub so this test only exercises the tag management flow.
const chartMocks = vi.hoisted(() => ({
  getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 160 })),
  setMarkers: vi.fn(),
  setVisibleLogicalRange: vi.fn(),
  setVisibleRange: vi.fn(),
  timeToIndex: vi.fn(() => 150),
  getVisibleRange: vi.fn(() => ({ from: 1000, to: 2000 })),
}));

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'Candlestick',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), priceToCoordinate: vi.fn() }),
    remove: vi.fn(),
    priceScale: () => ({ applyOptions: vi.fn() }),
    subscribeCrosshairMove: vi.fn(),
    timeScale: () => ({
      coordinateToTime: vi.fn(),
      getVisibleLogicalRange: chartMocks.getVisibleLogicalRange,
      getVisibleRange: chartMocks.getVisibleRange,
      options: vi.fn(() => ({ barSpacing: 6 })),
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

function makeTrade(id: string, tags: string[], note: string): ReviewedTrade {
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
    review: { tradeId: id, tags, note, starred: false, updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}

type TradeState = { trades: ReviewedTrade[] };

function tagPayload(trades: ReviewedTrade[]) {
  const tags = [...new Set(trades.flatMap((t) => t.review?.tags ?? []))].sort();
  const counts: Record<string, number> = {};
  for (const t of trades) for (const tag of t.review?.tags ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
  return { tags, tagCounts: counts };
}

function makeFetch(state: TradeState) {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith('/api/trades')) {
      return new Response(JSON.stringify({ trades: state.trades, instruments: ['BTC-USDT-SWAP'], ...tagPayload(state.trades) }));
    }
    if (url === '/api/tags/rename' && init?.method === 'POST') {
      const { from, to } = JSON.parse(init.body ?? '{}') as { from: string; to: string };
      for (const t of state.trades) {
        if (t.review) t.review = { ...t.review, tags: [...new Set(t.review.tags.map((x) => (x === from ? to : x)))] };
      }
      return new Response(JSON.stringify({ affected: 1, ...tagPayload(state.trades) }));
    }
    if (url === '/api/tags/delete' && init?.method === 'POST') {
      const { tag } = JSON.parse(init.body ?? '{}') as { tag: string };
      for (const t of state.trades) {
        if (t.review) t.review = { ...t.review, tags: t.review.tags.filter((x) => x !== tag) };
      }
      return new Response(JSON.stringify({ affected: 1, ...tagPayload(state.trades) }));
    }
    if (url === '/api/reviews') return new Response(init?.body ?? '{}');
    if (url === '/api/free-replay/instruments') return new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }));
    if (url.startsWith('/api/candles')) return new Response(JSON.stringify({ candles: [] }));
    if (url.startsWith('/api/drawings')) return new Response(JSON.stringify({ drawings: [] }));
    return new Response(JSON.stringify({}));
  });
}

describe('Tag management', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    for (const mock of Object.values(chartMocks)) {
      if (typeof mock === 'function') {
        mock.mockClear();
        if (mock === chartMocks.getVisibleLogicalRange) mock.mockReturnValue({ from: 0, to: 160 });
        if (mock === chartMocks.getVisibleRange) mock.mockReturnValue({ from: 1000, to: 2000 });
        if (mock === chartMocks.timeToIndex) mock.mockReturnValue(150);
      }
    }
  });

  it('renames a tag across every trade through the dropdown', async () => {
    const state: TradeState = {
      trades: [makeTrade('t1', ['breakout'], ''), makeTrade('t2', ['breakout'], ''), makeTrade('t3', ['scalp'], '')],
    };
    vi.stubGlobal('fetch', makeFetch(state));

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('标签')).toBeInTheDocument());

    // The selected trade (t1) shows the tag chip...
    expect(screen.getByRole('button', { name: '移除标签 breakout' })).toBeInTheDocument();

    // Open the dropdown and start renaming.
    fireEvent.focus(screen.getByLabelText('标签'));
    fireEvent.click(screen.getByRole('button', { name: '重命名标签 breakout' }));

    const renameInput = screen.getByLabelText('重命名标签 breakout');
    fireEvent.change(renameInput, { target: { value: '箱体突破' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标签名 breakout' }));

    // The current trade's draft chip updates and the old name is gone everywhere.
    await waitFor(() => expect(screen.getByRole('button', { name: '移除标签 箱体突破' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '移除标签 breakout' })).toBeNull();
  });

  it('merges onto an existing tag when the new name is already used', async () => {
    const state: TradeState = {
      trades: [makeTrade('t1', ['breakout'], ''), makeTrade('t2', ['late'], '')],
    };
    vi.stubGlobal('fetch', makeFetch(state));

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('标签')).toBeInTheDocument());

    fireEvent.focus(screen.getByLabelText('标签'));
    fireEvent.click(screen.getByRole('button', { name: '重命名标签 breakout' }));
    fireEvent.change(screen.getByLabelText('重命名标签 breakout'), { target: { value: 'late' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标签名 breakout' }));

    // t1 carried both -> only one 'late' remains for it.
    await waitFor(() => expect(screen.getByRole('button', { name: '移除标签 late' })).toBeInTheDocument());
  });

  it('deletes a tag and removes it from every trade', async () => {
    const state: TradeState = {
      trades: [makeTrade('t1', ['breakout'], ''), makeTrade('t2', ['breakout'], ''), makeTrade('t3', ['scalp'], '')],
    };
    vi.stubGlobal('fetch', makeFetch(state));

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('标签')).toBeInTheDocument());

    fireEvent.focus(screen.getByLabelText('标签'));
    fireEvent.click(screen.getByRole('button', { name: '删除标签 breakout' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除标签 breakout' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '移除标签 breakout' })).toBeNull());
    // 'scalp' lives on another (unselected) trade, so it is gone from the current
    // trade's chips but survives in the global tag list shown in the dropdown.
    expect(screen.getByRole('button', { name: '重命名标签 scalp' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重命名标签 breakout' })).toBeNull();
  });

  it('updates the active tag filter when the filtered tag is renamed', async () => {
    const state: TradeState = {
      trades: [makeTrade('t1', ['breakout'], ''), makeTrade('t2', ['breakout'], ''), makeTrade('t3', ['scalp'], '')],
    };
    vi.stubGlobal('fetch', makeFetch(state));
    // Start with the queue filtered to the "breakout" tag.
    window.history.pushState(null, '', '?tag=breakout');

    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('标签')).toBeInTheDocument());

    fireEvent.focus(screen.getByLabelText('标签'));
    fireEvent.click(screen.getByRole('button', { name: '重命名标签 breakout' }));
    fireEvent.change(screen.getByLabelText('重命名标签 breakout'), { target: { value: '箱体突破' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标签名 breakout' }));

    // The queue keeps both "breakout" trades under the new name instead of emptying.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /移除标签 箱体突破/ })).toHaveLength(1));
    expect(screen.queryByText('没有匹配的交易')).toBeNull();
  });
});
