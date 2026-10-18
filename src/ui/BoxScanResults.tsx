import type { BoxBraceScanResponse } from '../server/coin-scan-service';

/**
 * 箱体蓄力 (box-braces) results: one row per instrument whose last daily bar
 * sits in a box under a move, tightest box first.
 *
 * The panel is deliberately read-only: the row's job is to point the reviewer at
 * the instrument and the box bounds, not to restate the detector. `squeeze` is a
 * ratio (box height ÷ the move's travel), so it is comparable across coins, and
 * the box low/high are the levels the reviewer draws in the chart.
 */
export function BoxScanResults({ result }: { result: BoxBraceScanResponse }) {
  if (result.rows.length === 0) {
    return <div className="empty-state">没有符合「箱体蓄力」条件的标的：箱高 / 前段行程 ≤ {result.params.maxHeightRatio ?? 0.65}，且未突破。</div>;
  }
  return (
    <div className="coin-scan-results">
      <p className="panel-status hint">
        箱体蓄力 {result.rows.length} 个（扫描 {result.scanned} 个标的）· 箱高/前段行程越小越紧 ·
        {result.failedInstruments?.length ? ` 抓取失败 ${result.failedInstruments.length} 个` : ''}
        {result.skippedInstruments?.length ? ` · 休市跳过 ${result.skippedInstruments.length} 个` : ''}
      </p>
      <table>
        <thead>
          <tr>
            <th>币</th>
            <th>最新价</th>
            <th>24h 涨跌</th>
            <th>成交额</th>
            <th>箱体（低 – 高）</th>
            <th>箱高 %</th>
            <th>箱高/前段</th>
            <th>箱内位置</th>
            <th>箱长</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.instrument}>
              <td>{row.instrument}</td>
              <td>{row.lastPrice}</td>
              <td>{row.change24h.toFixed(2)}%</td>
              <td>{formatVolume(row.quoteVolume24h)}</td>
              <td>
                {row.box.boxLow} – {row.box.boxHigh}
              </td>
              <td>{row.box.heightPct.toFixed(1)}%</td>
              <td>{row.box.squeeze.toFixed(2)}</td>
              <td>{(row.box.position * 100).toFixed(0)}%</td>
              <td>{row.box.bars} 根</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}
