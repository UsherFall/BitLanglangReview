import type { ReactNode } from 'react';
import type { HeatRow, MarketHeatResult, MarketTier } from '../domain/market-heat';

export const TIER_LABEL: Record<MarketTier, string> = {
  hot: '热市',
  warm: '偏热',
  neutral: '中性',
  cool: '偏冷',
  cold: '冷市',
};

export const TIER_HINT: Record<MarketTier, string> = {
  hot: '普涨且涨得猛，场子很热',
  warm: '偏暖：多数币上涨或涨幅领先',
  neutral: '涨跌分化、平盘',
  cool: '偏冷：多数币下跌或跌幅领先',
  cold: '普跌且跌得深，场子很冷',
};

function formatSigned(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

/**
 * Presentational market-temperature view (市场热度读数), shared by the review
 * panel (`MarketHeatPanel`, which fetches at a trade's anchor) and the coin-scan
 * heat results (`HeatScanResults`). One source of truth for tier/stats/boards
 * markup so the two surfaces never drift apart.
 */
export function MarketHeatView({ result }: { result: MarketHeatResult }) {
  const reviewInstrument = result.reviewCoin?.instrument;
  return (
    <>
      <div className={`market-heat-tier ${result.tier}`}>
        <span className="market-heat-tier-label">{TIER_LABEL[result.tier]}</span>
        <span className="market-heat-tier-hint">{TIER_HINT[result.tier]}</span>
      </div>
      <div className="market-heat-numbers">
        <span className="market-heat-number">
          中位 <b className={result.stats.medianChangePct >= 0 ? 'profit' : 'loss'}>{formatSigned(result.stats.medianChangePct)}</b>
        </span>
        <span className="market-heat-number">涨 <b className="profit">{result.stats.upCount}</b></span>
        <span className="market-heat-number">跌 <b className="loss">{result.stats.downCount}</b></span>
        <span className="market-heat-number">异动 <b>{result.stats.volatileCount}</b></span>
        <span className="market-heat-number">覆盖 <b>{result.stats.coveredCount}/{result.stats.poolSize}</b></span>
      </div>
      <HeatBoard rows={result.topGainers} title="涨幅榜" tone="profit" reviewInstrument={reviewInstrument} empty="当时没有上涨的币" />
      <HeatBoard rows={result.topLosers} title="跌幅榜" tone="loss" reviewInstrument={reviewInstrument} empty="当时没有下跌的币" />
      {renderSkips(result)}
      {result.warnings.map((warning) => <p key={warning} className="market-heat-warning">{warning}</p>)}
    </>
  );
}

function HeatBoard({ rows, title, tone, reviewInstrument, empty }: {
  rows: HeatRow[];
  title: string;
  tone: 'profit' | 'loss';
  reviewInstrument?: string;
  empty: string;
}) {
  return (
    <div className="market-heat-board">
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="market-heat-board-empty">{empty}</p>
      ) : (
        <table className="market-heat-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.instrument} className={row.instrument === reviewInstrument ? 'review-coin' : ''}>
                <td>{row.instrument}{row.instrument === reviewInstrument ? ' · 复盘币' : ''}</td>
                <td className={tone}>{formatSigned(row.changePct)}</td>
                <td className="heat-volume">≈{formatVolume(row.windowQuoteVolume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function renderSkips(result: MarketHeatResult): ReactNode {
  const parts: string[] = [];
  if (result.skipped.closedCount > 0) parts.push(`已跳过 ${result.skipped.closedCount} 个休市标的`);
  if (result.skipped.noDataCount > 0) parts.push(`${result.skipped.noDataCount} 个当时无行情`);
  if (result.skipped.unmappedReviewInstrument) parts.push('复盘币不在 Binance USDT-M');
  if (parts.length === 0) return null;
  return <p className="market-heat-skip" title={parts.join('；')}>{parts.join('；')}</p>;
}
