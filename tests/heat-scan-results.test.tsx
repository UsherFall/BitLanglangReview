// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HeatRow, MarketHeatResult } from '../src/domain/market-heat';
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

function activityRow(index: number, overrides: Partial<HeatRow> = {}): HeatRow {
  return {
    instrument: `COIN${index}USDT`,
    changePct: index % 2 === 0 ? index : -index,
    windowQuoteVolume: index * 1e8,
    isReviewCoin: false,
    quoteVolumeRatio20d: index / 10,
    rangeRatio20d: index / 5,
    activityScore: index,
    recent4hVolumeIntensity: 2,
    ...overrides,
  };
}

function activityResult(rows: HeatRow[]): MarketHeatResult {
  return {
    ...heatResult(),
    activityPoolSize: 120,
    activityCandidates: rows,
  };
}

describe('HeatScanResults', () => {
  it('renders the tier, stats, boards, and skip hints for the coin-scan heat method', () => {
    render(<HeatScanResults result={heatResult()} label="当前 2026-09-08 10:00" />);
    expect(screen.getByText('选品结果 · 活跃度')).toBeInTheDocument();
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

  it('shows the first 20 activity candidates without legacy boards and expands to all', () => {
    const rows = Array.from({ length: 25 }, (_, index) => activityRow(index));
    const { container } = render(<HeatScanResults result={activityResult(rows)} label="当前" />);

    expect(screen.getByText('活跃度候选')).toBeInTheDocument();
    expect(screen.getByText('COIN24USDT')).toBeInTheDocument();
    expect(screen.queryByText('COIN0USDT')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.market-heat-board')).toHaveLength(0);
    expect(container.querySelectorAll('.heat-activity-table tbody tr')).toHaveLength(20);

    fireEvent.click(screen.getByRole('button', { name: /显示更多/ }));
    expect(screen.getByText('COIN0USDT')).toBeInTheDocument();
    expect(container.querySelectorAll('.heat-activity-table tbody tr')).toHaveLength(25);
  });

  it('sorts by volume, keeps null activity last, and filters recency or insufficient history', () => {
    const rows = [
      activityRow(1, { instrument: 'AAUSDT', activityScore: 0.5, quoteVolumeRatio20d: 3, recent4hVolumeIntensity: 2 }),
      activityRow(2, { instrument: 'BBUSDT', activityScore: 2, quoteVolumeRatio20d: 1, recent4hVolumeIntensity: 0.5 }),
      activityRow(3, { instrument: 'CCUSDT', activityScore: null, quoteVolumeRatio20d: null, rangeRatio20d: null, recent4hVolumeIntensity: null }),
    ];
    const { container } = render(<HeatScanResults result={activityResult(rows)} label="当前" />);
    const firstRow = () => container.querySelector('.heat-activity-table tbody tr')?.textContent;

    // Default: score BB > AA > null CC.
    expect(firstRow()).toContain('BBUSDT');
    fireEvent.change(screen.getByLabelText('活跃榜排序'), { target: { value: 'volume' } });
    expect(firstRow()).toContain('AAUSDT');

    fireEvent.click(screen.getByRole('button', { name: '近4h加速' }));
    expect(firstRow()).toContain('AAUSDT');
    expect(container.querySelectorAll('.heat-activity-table tbody tr')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '近4h降温' }));
    expect(firstRow()).toContain('BBUSDT');
    expect(container.querySelectorAll('.heat-activity-table tbody tr')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '历史不足' }));
    expect(firstRow()).toContain('CCUSDT');
    expect(container.querySelectorAll('.heat-activity-table tbody tr')).toHaveLength(1);
  });

  it('opens the chart for the selected activity candidate', () => {
    const onOpenChart = vi.fn();
    render(<HeatScanResults result={activityResult([activityRow(7)])} label="当前" onOpenChart={onOpenChart} />);

    fireEvent.click(screen.getByRole('button', { name: '看图' }));
    expect(onOpenChart).toHaveBeenCalledWith('COIN7USDT');
  });
});
