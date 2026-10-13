// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { scanTimeframes, type ScanResponse, type ScanRow, type StructureResult } from '../src/domain/coin-scan';
import { CoinScanResults, type CoinScanResultsProps } from '../src/ui/CoinScanPanel';

function structure(qualified: boolean): StructureResult {
  return {
    structure: qualified ? 'convergence' : null,
    position: 0.5,
    score: qualified ? 0.8 : 0.2,
    touchCount: 0,
    qualified,
  };
}

function scanRow(instrument = 'AAAUSDT'): ScanRow {
  const structures = {} as ScanRow['structures'];
  for (const [index, timeframe] of scanTimeframes.entries()) {
    structures[timeframe] = structure(index === 0);
  }
  return {
    instrument,
    lastPrice: 12.5,
    change24h: 1.25,
    quoteVolume24h: 2e9,
    structures,
    convergedTimeframes: [scanTimeframes[0]],
    qualifiedCount: 1,
    bestScore: 0.8,
    qualified: true,
    // Row inclusion IS the 1D coarse screen, so every row carries its measures and
    // this scan's pool-relative cuts.
    coarse: { pass: true, rangePct: 0.459, netPct: 0.0948, rangePctThreshold: 0.41, netPctThreshold: 0.06 },
  };
}

function scanResponse(instruments: string[] = ['AAAUSDT']): ScanResponse {
  const scanned = instruments.map((instrument) => scanRow(instrument));
  return {
    scanned,
    qualifiedCount: scanned.length,
    params: { method: 'shrink', minQuoteVolume24h: 10_000_000 },
    scannedAt: '2026-09-11T00:00:00.000Z',
    skippedInstruments: ['BBBUSDT', 'CCCUSDT'],
    coarse: {
      windowDays: 23,
      pctRange: 0.7371,
      pctNet: 0.4849,
      poolSize: 465,
      rangePctThreshold: 0.41,
      netPctThreshold: 0.06,
      candidates: 465,
    },
  };
}

function renderResults(overrides: Partial<CoinScanResultsProps> = {}) {
  const props: CoinScanResultsProps = {
    result: scanResponse(),
    leaderCoins: [],
    onToggleLeaderCoin: vi.fn(),
    demotedCoins: [],
    onToggleDemotedCoin: vi.fn(),
    ...overrides,
  };
  return render(<CoinScanResults {...props} />);
}

/** Instrument cells of the top-level rows, in rendered order (detail rows excluded). */
function renderedInstruments(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.coin-scan-table tbody > tr:not(.coin-scan-detail-row) > td:first-child'),
  ).map((cell) => cell.textContent ?? '');
}

describe('CoinScanResults', () => {
  it('keeps the skipped-instrument hint inside the detail header', () => {
    const { container } = renderResults();

    const hint = container.querySelector('.coin-scan-skip-hint');
    expect(hint).not.toBeNull();
    expect(hint?.closest('.detail-header')).not.toBeNull();
    // Structural/name assertions only: several Chinese literals in this checkout
    // are mojibake, so avoid coupling to the exact sentence (quality-guidelines).
    expect(hint?.textContent).toContain('BBBUSDT');
    expect(hint?.textContent).toContain('CCCUSDT');
    expect(hint?.textContent).toContain(`${scanResponse().skippedInstruments?.length}`);
  });

  it('leaves only the header and the table as results-grid children when instruments were skipped', () => {
    const { container } = renderResults();

    // The old standalone <p> was a third grid item and got stretched by the
    // `minmax(360px, 1fr)` row; folding it into the header leaves two items.
    expect(container.childElementCount).toBe(2);
    expect(container.querySelector('.coin-scan-table-wrap')?.closest('.detail-header')).toBeNull();
  });

  it('renders the server order as-is when nothing is demoted', () => {
    const { container } = renderResults({ result: scanResponse(['AAAUSDT', 'BBBUSDT', 'CCCUSDT']) });

    expect(renderedInstruments(container)).toEqual(['AAAUSDT', 'BBBUSDT', 'CCCUSDT']);
    expect(container.querySelectorAll('.coin-scan-table tbody tr.demoted')).toHaveLength(0);
  });

  it('shows the 1D coarse measures in the 结构 column, with this scan\'s cuts', () => {
    const { container } = renderResults();

    const headers = [...container.querySelectorAll('.coin-scan-table thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['币', '最新价', '24h 涨跌', '成交额', '结构', '收敛结构', '强度分', '操作']);

    const cell = container.querySelector('.coin-scan-coarse');
    expect(cell?.textContent).toBe('23天 区间45.9% 净9.5%');
    // The thresholds are pool-relative and recomputed per scan, so they are
    // reported (they are NOT the qR/qN constants).
    expect(cell?.getAttribute('title')).toContain('41.0%');
    expect(cell?.getAttribute('title')).toContain('6.0%');
  });

  it('reports the coarse candidates against the converged subset in the header', () => {
    const { container } = renderResults({ result: scanResponse(['AAAUSDT', 'BBBUSDT']) });

    const summary = container.querySelector('.detail-header p')?.textContent ?? '';
    expect(summary).toContain('候选 465 个');
    expect(summary).toContain('收敛 2 个');
  });

  it('sinks demoted rows to the bottom while keeping the order inside each group', () => {
    const { container } = renderResults({
      result: scanResponse(['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT']),
      demotedCoins: ['BBBUSDT', 'DDDUSDT'],
    });

    expect(renderedInstruments(container)).toEqual(['AAAUSDT', 'CCCUSDT', 'BBBUSDT', 'DDDUSDT']);
  });

  it('drops the qualified styling on demoted rows and keeps it on the rest', () => {
    const { container } = renderResults({
      result: scanResponse(['AAAUSDT', 'BBBUSDT']),
      demotedCoins: ['AAAUSDT'],
    });

    const rows = Array.from(container.querySelectorAll('.coin-scan-table tbody > tr:not(.coin-scan-detail-row)'));
    const demoted = rows.find((row) => row.textContent?.includes('AAAUSDT'));
    const active = rows.find((row) => row.textContent?.includes('BBBUSDT'));

    expect(demoted?.classList.contains('demoted')).toBe(true);
    expect(demoted?.classList.contains('qualified')).toBe(false);
    expect(active?.classList.contains('qualified')).toBe(true);
    expect(active?.classList.contains('demoted')).toBe(false);
  });

  it('shows the demoted state on the toggle and reports clicks for that instrument', () => {
    const onToggleDemotedCoin = vi.fn();
    const { container } = renderResults({ demotedCoins: ['AAAUSDT'], onToggleDemotedCoin });

    const demoteButtons = Array.from(container.querySelectorAll('.coin-scan-table button[aria-pressed]'));
    expect(demoteButtons).toHaveLength(1);
    expect(demoteButtons[0].getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(demoteButtons[0]);
    expect(onToggleDemotedCoin).toHaveBeenCalledWith('AAAUSDT');
  });

  it('keeps the demote toggle independent from the leader-coin toggle', () => {
    const onToggleDemotedCoin = vi.fn();
    const onToggleLeaderCoin = vi.fn();
    const { container } = renderResults({
      leaderCoins: ['AAAUSDT'],
      onToggleLeaderCoin,
      onToggleDemotedCoin,
    });

    const demoteButton = container.querySelector('.coin-scan-table button[aria-pressed]');
    expect(demoteButton?.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(demoteButton as Element);
    expect(onToggleDemotedCoin).toHaveBeenCalledWith('AAAUSDT');
    expect(onToggleLeaderCoin).not.toHaveBeenCalled();
  });
});
