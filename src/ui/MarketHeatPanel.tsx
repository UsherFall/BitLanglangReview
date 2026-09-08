import { useEffect, useState } from 'react';
import type { MarketHeatResult } from '../domain/market-heat';
import { MarketHeatView } from './market-heat-view';

export type MarketHeatPanelProps = {
  /** Review symbol as shown in the workbook/Bitget (e.g. BTC-USDT-SWAP). */
  instrument: string;
  /** Trade entry time (ISO); the heat anchor is the entry moment. */
  entryTime: string;
  onClose: () => void;
};

function shortTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function MarketHeatPanel({ instrument, entryTime, onClose }: MarketHeatPanelProps) {
  const [result, setResult] = useState<MarketHeatResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The heat reading is anchored at the trade's entry moment.
  const anchorMs = Date.parse(entryTime);

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

  return (
    <section className="market-heat-panel">
      <header className="market-heat-header">
        <span className="market-heat-title">市场热度</span>
        <span className="market-heat-anchor-time">锚点 {shortTime(entryTime)}</span>
        <button type="button" className="market-heat-close" onClick={onClose} aria-label="关闭市场热度">✕</button>
      </header>

      <div className="market-heat-body">
        {loading && <div className="market-heat-status">正在拉取全池 24h K 线计算温度…首次约需数秒</div>}
        {!loading && error && <div className="market-heat-status bad">{error}</div>}
        {!loading && !error && result && tier && (
          <MarketHeatView result={result} />
        )}
      </div>
    </section>
  );
}
