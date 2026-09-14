import type { MarketHeatResult } from '../domain/market-heat';
import { MarketHeatView } from './market-heat-view';

/** 选币「热度」方法的扫描结果: 整体场子热度读数(与复盘市场热度同款视图)。 */
export function HeatScanResults({ result, label }: { result: MarketHeatResult; label: string }) {
  return (
    <>
      <header className="detail-header">
        <div>
          <h1>选币结果 · 热度</h1>
          <p>{label}</p>
        </div>
      </header>
      <section className="market-heat-panel heat-scan-results">
        <div className="market-heat-body">
          <MarketHeatView result={result} layout="columns" />
        </div>
      </section>
    </>
  );
}
