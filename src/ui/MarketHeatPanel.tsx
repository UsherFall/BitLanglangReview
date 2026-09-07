import { useEffect, useState, type ReactNode } from 'react';
import type { HeatRow, MarketHeatResult, MarketTier } from '../domain/market-heat';

export type MarketHeatPanelProps = {
  /** Review symbol as shown in the workbook/Bitget (e.g. BTC-USDT-SWAP). */
  instrument: string;
  entryTime: string;
  exitTime: string;
  onClose: () => void;
};

const TIER_LABEL: Record<MarketTier, string> = {
  hot: '热市',
  warm: '偏热',
  neutral: '中性',
  cool: '偏冷',
  cold: '冷市',
};

const TIER_HINT: Record<MarketTier, string> = {
  hot: '普涨且涨得猛，场子很热',
  warm: '偏暖：多数币上涨或涨幅领先',
  neutral: '涨跌分化、平盘',
  cool: '偏冷：多数币下跌或跌幅领先',
  cold: '普跌且跌得深，场子很冷',
};

function shortTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

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

export function MarketHeatPanel({ instrument, entryTime, exitTime, onClose }: MarketHeatPanelProps) {
  const [useExit, setUseExit] = useState(false);
  const [result, setResult] = useState<MarketHeatResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const anchorTime = useExit ? exitTime : entryTime;
  const anchorMs = Date.parse(anchorTime);

  useEffect(() => {
    if (!Number.isFinite(anchorMs)) {
      setLoading(false);
      setError('锚点时间无效');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    fetch(`/api/market-heat?anchor=${anchorMs}&instrument=${encodeURIComponent(instrument)}`)
      .then(async (response) => {
        const payload = (await response.json()) as MarketHeatResult & { error?: string };
        if (!response.ok) throw new Error(payload.error || '市场热度计算失败');
        if (!cancelled) {
          setResult(payload);
          setLoading(false);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : '市场热度计算失败');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [anchorMs, instrument]);

  const tier = result?.tier ?? null;
  const reviewInstrument = result?.reviewCoin?.instrument;

  return (
    <section className="market-heat-panel">
      <header className="market-heat-header">
        <span className="market-heat-title">市场热度</span>
        <span className="market-heat-anchor-time">锚点 {shortTime(anchorTime)}</span>
        <div className="market-heat-anchor-toggle">
          <button type="button" aria-pressed={!useExit} className={!useExit ? 'selected' : ''} onClick={() => setUseExit(false)}>入场</button>
          <button type="button" aria-pressed={useExit} className={useExit ? 'selected' : ''} onClick={() => setUseExit(true)}>离场</button>
        </div>
        <button type="button" className="market-heat-close" onClick={onClose} aria-label="关闭市场热度">✕</button>
      </header>

      <div className="market-heat-body">
        {loading && <div className="market-heat-status">正在拉取全池 24h K 线计算温度…首次约需数秒</div>}
        {!loading && error && <div className="market-heat-status bad">{error}</div>}
        {!loading && !error && result && tier && (
          <>
            <div className={`market-heat-tier ${tier}`}>
              <span className="market-heat-tier-label">{TIER_LABEL[tier]}</span>
              <span className="market-heat-tier-hint">{TIER_HINT[tier]}</span>
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
        )}
      </div>
    </section>
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
