// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MarketHeatResult } from '../src/domain/market-heat';
import { HeatScanResults } from '../src/ui/HeatScanResults';

function heatResult(): MarketHeatResult {
  return {
    tier: 'hot',
    stats: {
      poolSize: 80,
      coveredCount: 70,
      medianChangePct: 2.1,
      upCount: 60,
      downCount: 10,
      volatileCount: 25,
    },
    topGainers: [{ instrument: 'BTCUSDT', changePct: 3.2, windowQuoteVolume: 1e9, isReviewCoin: false }],
    topLosers: [],
    reviewCoin: null,
    skipped: { closedCount: 2, noDataCount: 3, unmappedReviewInstrument: false },
    warnings: [],
  };
}

describe('HeatScanResults', () => {
  it('renders the tier, stats, boards, and skip hints for the coin-scan heat method', () => {
    render(<HeatScanResults result={heatResult()} label="当前 2026-09-08 10:00" />);
    expect(screen.getByText('选币结果 · 热度')).toBeInTheDocument();
    expect(screen.getByText('热市')).toBeInTheDocument();
    expect(screen.getByText('+2.10%')).toBeInTheDocument();
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
    expect(screen.getByText('涨幅榜')).toBeInTheDocument();
    expect(screen.getByText(/已跳过 2 个休市标的/)).toBeInTheDocument();
    expect(screen.queryByText(/复盘币/)).not.toBeInTheDocument();
  });

  it('lays the two boards out as a side-by-side column grid for the embedded coin-scan card', () => {
    const { container } = render(<HeatScanResults result={heatResult()} label="当前 2026-09-08 10:00" />);

    const boards = container.querySelector('.market-heat-boards');
    expect(boards).not.toBeNull();
    expect(boards?.classList.contains('columns')).toBe(true);
    expect(boards?.querySelectorAll('.market-heat-board')).toHaveLength(2);
  });
});
