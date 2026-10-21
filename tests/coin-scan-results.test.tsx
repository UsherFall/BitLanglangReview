// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { scanTimeframes, type LevelWatchResponse, type ScanResponse, type ScanRow } from '../src/domain/coin-scan';
import type { LevelAlert } from '../src/domain/level-alert';
import { CoinScanResults, type CoinScanResultsProps } from '../src/ui/CoinScanPanel';

function alert(distancePct: number, state: LevelAlert['state'] = 'alert'): LevelAlert {
  return {
    distancePct,
    scalePct: 4,
    ratio: Math.abs(distancePct) / 4,
    state,
    line: { kind: 'horizontal', price: 100 },
  };
}

function scanRow(instrument = 'AAAUSDT'): ScanRow {
  const levelAlerts = {} as ScanRow['levelAlerts'];
  for (const [index, timeframe] of scanTimeframes.entries()) {
    // Only the first timeframe has a drawn line — the others read as "no line".
    levelAlerts[timeframe] = index === 0 ? alert(1.2) : null;
  }
  return {
    instrument,
    lastPrice: 12.5,
    change24h: 1.25,
    quoteVolume24h: 2e9,
    levelAlerts,
    alertTimeframes: [scanTimeframes[0]],
    // Row inclusion IS the 1D coarse screen, so every row carries its measures and
    // this scan's pool-relative cuts.
    coarse: { pass: true, rangePct: 0.459, netPct: 0.0948, posRange: 0.5, rangePctThreshold: 0.41, netPctThreshold: 0.06 },
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

function watchResponse(instruments: string[] = ['AAAUSDT']): LevelWatchResponse {
  // Watch rows carry NO coarse verdict — the row criterion is "the user drew a
  // line", not "the daily box passed".
  const scanned = instruments.map((instrument) => ({ ...scanRow(instrument), coarse: undefined }));
  return {
    scanned,
    params: { method: 'watch', anchor: 1_700_000_000_000 },
    scannedAt: '2026-10-21T00:00:00.000Z',
    missingInstruments: ['ZZZUSDT'],
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

  it('reports fetch-failed instruments as their own hint, next to the closed-market one', () => {
    const { container } = renderResults({
      result: { ...scanResponse(), failedInstruments: ['DDDUSDT', 'EEEUSDT'] },
    });

    // Two hints, in render order: closed markets first, then fetch failures —
    // the two channels must not be folded into one line, because they ask for
    // different user reactions (re-scan later vs. look at the instrument).
    const hints = Array.from(container.querySelectorAll('.coin-scan-skip-hint'));
    expect(hints).toHaveLength(2);
    expect(hints[0]?.textContent).toContain('BBBUSDT');
    expect(hints[1]?.closest('.detail-header')).not.toBeNull();
    expect(hints[1]?.textContent).toContain('DDDUSDT');
    expect(hints[1]?.textContent).toContain('EEEUSDT');
    expect(hints[1]?.textContent).toContain('2');
    // Folding the hint into the header still leaves two results-grid children.
    expect(container.childElementCount).toBe(2);
  });

  it('renders no fetch-failure hint on a clean scan', () => {
    const { container } = renderResults();

    expect(container.querySelectorAll('.coin-scan-skip-hint')).toHaveLength(1);
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
    expect(headers).toEqual(['币', '最新价', '24h 涨跌', '成交额', '结构', '距线', '操作']);

    const cell = container.querySelector('.coin-scan-coarse');
    // 区间/净漂移 are pool-relative measures, 位 is the row's position inside its
    // whole 1D series (the quantity the absolute floor judges).
    expect(cell?.textContent).toBe('23天 区间45.9% 净9.5% 位50.0%');
    // The thresholds are pool-relative and recomputed per scan, so they are
    // reported (they are NOT the qR/qN constants); the position floor is the one
    // ABSOLUTE gate and is reported as such.
    expect(cell?.getAttribute('title')).toContain('41.0%');
    expect(cell?.getAttribute('title')).toContain('6.0%');
    expect(cell?.getAttribute('title')).toContain('3.0%');
  });

  it('shows the distance to the user\'s own line, with its state', () => {
    const { container } = renderResults();

    const cell = container.querySelector('.coin-scan-level');
    expect(cell).not.toBeNull();
    // The timeframe the line was drawn on, the distance in %, and the state.
    expect(cell?.textContent).toContain('5m');
    expect(cell?.textContent).toContain('+1.20%');
    expect(cell?.textContent).toContain('贴近');
  });

  it('offers a 画线 button that asks for that instrument', () => {
    const onDrawLevel = vi.fn();
    const { container } = renderResults({ onDrawLevel });

    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === '画线');
    expect(button).toBeDefined();
    fireEvent.click(button!);
    expect(onDrawLevel).toHaveBeenCalledWith('AAAUSDT');
  });

  it('hides the 画线 button when no drawer is wired up', () => {
    const { container } = renderResults();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).not.toContain('画线');
  });

  it('reports the coarse candidates against the alert subset in the header', () => {
    const { container } = renderResults({ result: scanResponse(['AAAUSDT', 'BBBUSDT']) });

    const summary = container.querySelector('.detail-header p')?.textContent ?? '';
    expect(summary).toContain('候选 465 个');
    expect(summary).toContain('贴近 2 个');
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

describe('CoinScanResults · 展示层只出 20 个（10/21）', () => {
  const many = Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, '0')}USDT`);

  it('默认只渲染前 20 行，并说明还有多少个', () => {
    const { container } = renderResults({ result: scanResponse(many) });

    expect(renderedInstruments(container)).toHaveLength(20);
    expect(renderedInstruments(container)[0]).toBe('C00USDT');
    expect(container.textContent).toContain('显示 20 个');
  });

  it('「显示更多」展开到全部行', () => {
    const { container } = renderResults({ result: scanResponse(many) });

    const more = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('显示更多'));
    expect(more).toBeDefined();
    fireEvent.click(more as Element);

    expect(renderedInstruments(container)).toHaveLength(30);
  });

  it('降权沉底在截断之前：被降权的币不占前 20 的位置', () => {
    // 服务端按「距线最近」排序；用户降权的币沉到最末。截断取前 20，
    // 所以被降权的那个必须出现在第 20 名之后（而不是被截掉前排的名额）。
    const { container } = renderResults({ result: scanResponse(many), demotedCoins: ['C00USDT'] });

    const rendered = renderedInstruments(container);
    expect(rendered).toHaveLength(20);
    expect(rendered).not.toContain('C00USDT');
    expect(rendered[0]).toBe('C01USDT');
  });

  it('行数不足 20 时不显示「显示更多」', () => {
    const { container } = renderResults({ result: scanResponse(['AAAUSDT', 'BBBUSDT']) });

    expect(renderedInstruments(container)).toHaveLength(2);
    const buttons = Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '');
    expect(buttons.some((text) => text.includes('显示更多'))).toBe(false);
  });
});

describe('CoinScanResults · 标线监控视图（10/21）', () => {
  it('renders the watch payload with a watch header and no screen columns', () => {
    const { container } = renderResults({ result: watchResponse(['AAAUSDT', 'BBBUSDT']) });

    expect(container.querySelector('.detail-header h1')?.textContent).toBe('标线监控');
    // No coarse screen → no structure measures, no coarse note, no candidates.
    expect(container.querySelector('.coin-scan-coarse')).toBeNull();
    expect(container.querySelector('.coin-scan-note')).toBeNull();
    const summary = container.querySelector('.detail-header p')?.textContent ?? '';
    expect(summary).toContain('监控 2 个画线币');
    expect(summary).toContain('贴近 2 个');
    expect(summary).not.toContain('候选');
    // The 距线 column still renders — the watch view shares the measurement path.
    expect(container.querySelector('.coin-scan-level')).not.toBeNull();
  });

  it('reports unresolvable marked instruments as their own hint (not a fetch failure)', () => {
    const { container } = renderResults({ result: watchResponse() });

    const hints = Array.from(container.querySelectorAll('.coin-scan-skip-hint'));
    expect(hints).toHaveLength(1);
    expect(hints[0]?.textContent).toContain('ZZZUSDT');
  });
});
