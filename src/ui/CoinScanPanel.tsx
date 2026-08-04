import { useState } from 'react';
import type { ScanResponse } from '../domain/coin-scan';
import { scanTimeframes } from '../domain/coin-scan';
import type { ReviewTimeframe } from '../domain/trade';

export type CoinScanPanelProps = {
  onScanned: (result: ScanResponse) => void;
};

export function CoinScanPanel({ onScanned }: CoinScanPanelProps) {
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('5m');
  const [topN, setTopN] = useState('50');
  const [ratioThreshold, setRatioThreshold] = useState('0.7');
  const [consecutive, setConsecutive] = useState('3');
  const [avgWindow, setAvgWindow] = useState('20');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    const inputs = [topN, ratioThreshold, consecutive, avgWindow];
    if (!scanTimeframes.includes(timeframe) || inputs.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) {
      setError('参数无效,请检查');
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        method: 'shrink',
        timeframe,
        topN,
        ratioThreshold,
        consecutive,
        window: avgWindow,
      });
      const response = await fetch(`/api/scan?${query.toString()}`);
      const payload = (await response.json()) as ScanResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || '扫描失败');
      onScanned(payload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="coin-scan-panel">
      <label>
        方法
        <select value="shrink" disabled>
          <option value="shrink">缩量</option>
        </select>
      </label>
      <label>
        时间周期
        <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as ReviewTimeframe)}>
          {scanTimeframes.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <div className="coin-scan-params">
        <label>
          扫描数量
          <input type="number" min="1" value={topN} onChange={(event) => setTopN(event.target.value)} />
        </label>
        <label>
          量比阈值
          <input type="number" min="0" step="0.05" value={ratioThreshold} onChange={(event) => setRatioThreshold(event.target.value)} />
        </label>
        <label>
          连续根数
          <input type="number" min="1" value={consecutive} onChange={(event) => setConsecutive(event.target.value)} />
        </label>
        <label>
          均量窗口
          <input type="number" min="1" value={avgWindow} onChange={(event) => setAvgWindow(event.target.value)} />
        </label>
      </div>
      <button className="save-button" disabled={scanning} onClick={() => void scan()}>
        {scanning ? '扫描中…' : '扫描'}
      </button>
      {error && <p className="panel-status bad">{error}</p>}
    </div>
  );
}

export type CoinScanResultsProps = {
  result: ScanResponse | null;
  onOpenReplay: (instrument: string, timeframe: ReviewTimeframe, lastCandleTime: number) => void;
};

export function CoinScanResults({ result, onOpenReplay }: CoinScanResultsProps) {
  if (!result) {
    return <div className="empty-state">在左侧选择参数并点击「扫描」</div>;
  }
  const ordered = [...result.scanned].sort((a, b) => Number(b.qualified) - Number(a.qualified) || a.intensity - b.intensity);
  return (
    <>
      <header className="detail-header">
        <div>
          <h1>选币结果</h1>
          <p>扫描 {result.scanned.length} 个 · 合格 {result.qualifiedCount} 个 · 周期 {result.params.timeframe}</p>
        </div>
      </header>
      <div className="coin-scan-table-wrap">
        <table className="coin-scan-table">
          <thead>
            <tr>
              <th>币</th>
              <th>最新价</th>
              <th>24h 涨跌</th>
              <th>当前量</th>
              <th>均量</th>
              <th>量比</th>
              <th>强度分</th>
              <th>连续缩量</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => (
              <tr
                key={row.instrument}
                className={row.qualified ? 'qualified' : ''}
                title={`${row.instrument} · 点击进入复盘`}
                onClick={() => onOpenReplay(row.instrument, result.params.timeframe, row.lastCandleTime)}
              >
                <td>{shortInstrument(row.instrument)}</td>
                <td>{formatPrice(row.lastPrice)}</td>
                <td className={row.change24h >= 0 ? 'profit' : 'loss'}>{row.change24h >= 0 ? '+' : ''}{row.change24h.toFixed(2)}%</td>
                <td>{formatVolume(row.currentVolume)}</td>
                <td>{formatVolume(row.averageVolume)}</td>
                <td>{row.ratio.toFixed(2)}</td>
                <td>{row.intensity.toFixed(2)}</td>
                <td>{row.consecutiveShrunk}</td>
                <td>{row.qualified ? '合格' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function shortInstrument(instrument: string): string {
  return instrument.endsWith('-USDT-SWAP') ? instrument.slice(0, -'-USDT-SWAP'.length) : instrument;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return value.toFixed(0);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}
