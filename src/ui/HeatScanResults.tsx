import { useState } from 'react';
import type { HeatRow, MarketHeatResult } from '../domain/market-heat';
import { shortInstrument } from '../domain/instrument-symbol';
import { formatSigned, formatVolume, MarketHeatView } from './market-heat-view';

const COLLAPSED_ROW_COUNT = 20;

type ActivitySort = 'activity' | 'volume' | 'range' | 'absoluteChange';
type ActivityFilter = 'all' | 'accelerating' | 'cooling' | 'insufficient';

function sortValue(row: HeatRow, mode: ActivitySort): number {
  if (mode === 'absoluteChange') return Math.abs(row.changePct);
  if (mode === 'volume') return row.quoteVolumeRatio20d ?? Number.NEGATIVE_INFINITY;
  if (mode === 'range') return row.rangeRatio20d ?? Number.NEGATIVE_INFINITY;
  return row.activityScore ?? Number.NEGATIVE_INFINITY;
}

function sortActivityRows(rows: readonly HeatRow[], mode: ActivitySort): HeatRow[] {
  return [...rows].sort((a, b) => sortValue(b, mode) - sortValue(a, mode));
}

function filterActivityRow(row: HeatRow, filter: ActivityFilter): boolean {
  if (filter === 'insufficient') return row.activityScore == null;
  if (filter === 'accelerating') return (row.recent4hVolumeIntensity ?? Number.NEGATIVE_INFINITY) > 1;
  if (filter === 'cooling') return (row.recent4hVolumeIntensity ?? Number.POSITIVE_INFINITY) < 1;
  return true;
}

function ratio(value: number | null | undefined): string {
  return value == null ? '—' : `${value.toFixed(2)}x`;
}

function recency(row: HeatRow) {
  const value = row.recent4hVolumeIntensity;
  if (value == null) return { label: '—', className: 'unknown' };
  if (value > 1) return { label: `${ratio(value)} · 加速`, className: 'accelerating' };
  if (value < 1) return { label: `${ratio(value)} · 降温`, className: 'cooling' };
  return { label: `${ratio(value)} · 持平`, className: 'flat' };
}

/** 选品「热度」：市场温度摘要 + 活跃度工作清单。活跃度只安排看图顺序。 */
export function HeatScanResults({ result, label, onOpenChart }: {
  result: MarketHeatResult;
  label: string;
  onOpenChart?: (instrument: string) => void;
}) {
  const hasActivity = result.activityCandidates !== undefined;
  const [sortMode, setSortMode] = useState<ActivitySort>('activity');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [showAllRows, setShowAllRows] = useState(false);
  const candidates = result.activityCandidates ?? [];
  const filteredRows = sortActivityRows(candidates.filter((row) => filterActivityRow(row, filter)), sortMode);
  const visibleRows = showAllRows ? filteredRows : filteredRows.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenRows = filteredRows.length - visibleRows.length;
  const scoredCount = candidates.filter((row) => row.activityScore != null).length;

  function changeFilter(next: ActivityFilter) {
    setFilter(next);
    setShowAllRows(false);
  }

  return (
    <>
      <header className="detail-header">
        <div>
          <h1>选品结果 · 活跃度</h1>
          <p>{label} · 市场温度看背景，活跃榜决定先看哪张图</p>
        </div>
      </header>
      <section className="market-heat-panel heat-scan-results">
        <div className="market-heat-body">
          <MarketHeatView result={result} layout="columns" showBoards={!hasActivity} />
          {hasActivity && (
            <section className="heat-activity-section" aria-label="活跃度候选">
              <div className="heat-activity-heading">
                <div>
                  <h2>活跃度候选</h2>
                  <p>
                    活跃池 {result.activityPoolSize ?? candidates.length} · 可计算 {scoredCount} · 当前显示 {visibleRows.length}/{filteredRows.length}
                  </p>
                </div>
                <label className="heat-activity-sort">
                  排序
                  <select aria-label="活跃榜排序" value={sortMode} onChange={(event) => setSortMode(event.target.value as ActivitySort)}>
                    <option value="activity">综合活跃</option>
                    <option value="volume">成交额倍数</option>
                    <option value="range">波幅倍数</option>
                    <option value="absoluteChange">24h绝对涨跌</option>
                  </select>
                </label>
              </div>
              <div className="heat-activity-filters" aria-label="活跃榜筛选">
                {([
                  ['all', '全部'],
                  ['accelerating', '近4h加速'],
                  ['cooling', '近4h降温'],
                  ['insufficient', '历史不足'],
                ] as const).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    className={filter === value ? 'selected' : ''}
                    aria-pressed={filter === value}
                    onClick={() => changeFilter(value)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <div className="coin-scan-table-wrap heat-activity-table-wrap">
                <table className="coin-scan-table heat-activity-table">
                  <thead>
                    <tr>
                      <th>币</th>
                      <th>活跃度</th>
                      <th>成交额倍数</th>
                      <th>波幅倍数</th>
                      <th>近4h强度</th>
                      <th>24h涨跌</th>
                      <th>24h成交额</th>
                      {onOpenChart && <th>操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const recent = recency(row);
                      return (
                        <tr key={row.instrument}>
                          <td><strong>{shortInstrument(row.instrument)}</strong></td>
                          <td className="heat-activity-score">{row.activityScore == null ? '—' : row.activityScore.toFixed(2)}</td>
                          <td>{ratio(row.quoteVolumeRatio20d)}</td>
                          <td>{ratio(row.rangeRatio20d)}</td>
                          <td className={`heat-recency ${recent.className}`}>{recent.label}</td>
                          <td className={row.changePct >= 0 ? 'profit' : 'loss'}>{formatSigned(row.changePct)}</td>
                          <td>≈{formatVolume(row.windowQuoteVolume)}</td>
                          {onOpenChart && (
                            <td><button type="button" className="coin-scan-copy" onClick={() => onOpenChart(row.instrument)}>看图</button></td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length === 0 && <p className="market-heat-board-empty">当前筛选下没有候选</p>}
              </div>
              {hiddenRows > 0 && (
                <button type="button" className="coin-scan-more" onClick={() => setShowAllRows(true)}>显示更多（还有 {hiddenRows} 个）</button>
              )}
              {showAllRows && filteredRows.length > COLLAPSED_ROW_COUNT && (
                <button type="button" className="coin-scan-more" onClick={() => setShowAllRows(false)}>收起，只看前 {COLLAPSED_ROW_COUNT} 个</button>
              )}
              <details className="coin-scan-note heat-activity-help">
                <summary>指标怎么算？</summary>
                <div className="coin-scan-metric-help-body">
                  <p><strong>成交额倍数</strong>：滚动24h成交额 ÷ 过去20个完整日线成交额中位数。</p>
                  <p><strong>波幅倍数</strong>：滚动24h最高至最低跨度 ÷ 过去20个完整日线跨度中位数。</p>
                  <p><strong>活跃度</strong>：√（成交额倍数 × 波幅倍数），只安排看图顺序，不预测方向。</p>
                  <p><strong>近4h强度</strong>：最近4h每小时成交额 ÷ 前20h每小时成交额；大于 1 为加速，小于 1 为降温，不是买卖否决条件。</p>
                  <p>「—」表示历史不足或基线无效，相关候选始终排在可计算项之后。</p>
                </div>
              </details>
            </section>
          )}
        </div>
      </section>
    </>
  );
}
