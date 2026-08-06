import { useEffect, useState } from 'react';
import type { AlertDirection, PriceAlert } from '../domain/price-alert';
import type { ScanResponse } from '../domain/coin-scan';
import { scanTimeframes } from '../domain/coin-scan';
import type { ReviewTimeframe } from '../domain/trade';

export type CoinScanPanelProps = {
  onScanned: (result: ScanResponse) => void;
  alertInstrument: string;
  onAlertInstrumentChange: (instrument: string) => void;
};

type AlertConfig = {
  notifierConfigured: boolean;
  monitorIntervalMs: number;
};

export function CoinScanPanel({ onScanned, alertInstrument, onAlertInstrumentChange }: CoinScanPanelProps) {
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('5m');
  const [topN, setTopN] = useState('50');
  const [ratioThreshold, setRatioThreshold] = useState('0.7');
  const [boxWindow, setBoxWindow] = useState('12');
  const [maxCompression, setMaxCompression] = useState('0.8');
  const [maxLatestTrend, setMaxLatestTrend] = useState('0.9');
  const [trendWindow, setTrendWindow] = useState('4');
  const [consecutive, setConsecutive] = useState('3');
  const [avgWindow, setAvgWindow] = useState('20');
  const [minQuoteVolume24h, setMinQuoteVolume24h] = useState('10000000');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertConfig, setAlertConfig] = useState<AlertConfig | null>(null);
  const [alertDirection, setAlertDirection] = useState<AlertDirection>('above');
  const [alertPrice, setAlertPrice] = useState('');
  const [alertFormError, setAlertFormError] = useState<string | null>(null);
  const [alertSaving, setAlertSaving] = useState(false);

  useEffect(() => {
    void loadAlerts();
  }, []);

  async function scan() {
    const inputs = [topN, ratioThreshold, boxWindow, maxCompression, maxLatestTrend, trendWindow, consecutive, avgWindow, minQuoteVolume24h];
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
        boxWindow,
        maxCompression,
        maxLatestTrend,
        trendWindow,
        consecutive,
        window: avgWindow,
        minQuoteVolume24h,
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

  async function loadAlerts() {
    try {
      const response = await fetch('/api/alerts');
      const payload = (await response.json()) as { alerts: PriceAlert[]; config: AlertConfig };
      if (!response.ok) return;
      setAlerts(payload.alerts);
      setAlertConfig(payload.config);
    } catch {
      // The alert list simply stays empty when the request fails.
    }
  }

  async function saveAlert() {
    const targetPrice = Number(alertPrice);
    if (!alertInstrument.trim() || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      setAlertFormError('币和正的目标价必填');
      return;
    }
    setAlertSaving(true);
    setAlertFormError(null);
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instrument: alertInstrument, direction: alertDirection, targetPrice }),
      });
      if (!response.ok) throw new Error('保存警报失败');
      setAlertPrice('');
      await loadAlerts();
    } catch (alertError) {
      setAlertFormError(alertError instanceof Error ? alertError.message : '保存警报失败');
    } finally {
      setAlertSaving(false);
    }
  }

  async function deleteAlert(id: number) {
    await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
    await loadAlerts();
  }

  async function reactivateAlert(id: number) {
    await fetch(`/api/alerts/reactivate?id=${id}`, { method: 'POST' });
    await loadAlerts();
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
          压缩窗口
          <input type="number" min="1" value={boxWindow} onChange={(event) => setBoxWindow(event.target.value)} />
        </label>
        <label>
          压缩阈值
          <input type="number" min="0" step="0.05" value={maxCompression} onChange={(event) => setMaxCompression(event.target.value)} />
        </label>
        <label>
          收窄阈值
          <input type="number" min="0" step="0.05" value={maxLatestTrend} onChange={(event) => setMaxLatestTrend(event.target.value)} />
        </label>
        <label>
          趋势窗口
          <input type="number" min="1" value={trendWindow} onChange={(event) => setTrendWindow(event.target.value)} />
        </label>
        <label>
          连续根数
          <input type="number" min="1" value={consecutive} onChange={(event) => setConsecutive(event.target.value)} />
        </label>
        <label>
          均量窗口
          <input type="number" min="1" value={avgWindow} onChange={(event) => setAvgWindow(event.target.value)} />
        </label>
        <label>
          最低成交额
          <input type="number" min="0" value={minQuoteVolume24h} onChange={(event) => setMinQuoteVolume24h(event.target.value)} />
        </label>
      </div>
      <button className="save-button" disabled={scanning} onClick={() => void scan()}>
        {scanning ? '扫描中…' : '扫描'}
      </button>
      {error && <p className="panel-status bad">{error}</p>}
      <div className="coin-scan-alerts">
        <h3>价格警报</h3>
        <p className={`alert-config ${alertConfig?.notifierConfigured ? 'ok' : 'bad'}`}>
          {alertConfig?.notifierConfigured ? '微信通知:已配置 ✓' : '微信通知:未配置(需 .env 配 SERVERCHAN_KEY)'}
        </p>
        <div className="coin-scan-alert-form">
          <label>
            币
            <input value={alertInstrument} onChange={(event) => onAlertInstrumentChange(event.target.value)} placeholder="BTC-USDT-SWAP" />
          </label>
          <label>
            方向
            <select value={alertDirection} onChange={(event) => setAlertDirection(event.target.value as AlertDirection)}>
              <option value="above">上破</option>
              <option value="below">下破</option>
            </select>
          </label>
          <label>
            目标价
            <input type="number" min="0" step="any" value={alertPrice} onChange={(event) => setAlertPrice(event.target.value)} />
          </label>
          <button className="save-button" disabled={alertSaving} onClick={() => void saveAlert()}>
            {alertSaving ? '保存中…' : '设警报'}
          </button>
          {alertFormError && <p className="panel-status bad">{alertFormError}</p>}
        </div>
        <ul className="coin-scan-alert-list">
          {alerts.map((alert) => (
            <li key={alert.id} className={alert.status}>
              <span className="alert-main">
                {shortInstrument(alert.instrument)} {alert.direction === 'above' ? '上破' : '下破'} {formatPrice(alert.targetPrice)}
              </span>
              <span className="alert-status">{alert.status === 'triggered' ? '已触发' : '监控中'}</span>
              <div className="alert-actions">
                {alert.status === 'triggered' && (
                  <button type="button" className="coin-scan-copy" onClick={() => void reactivateAlert(alert.id)}>重新启用</button>
                )}
                <button type="button" className="coin-scan-copy" onClick={() => void deleteAlert(alert.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
        {alerts.length === 0 && <p className="alert-empty">还没有警报。从扫描结果点「设警报」或手动添加。</p>}
      </div>
    </div>
  );
}

export type CoinScanResultsProps = {
  result: ScanResponse | null;
  onSetAlertInstrument: (instrument: string) => void;
};

export function CoinScanResults({ result, onSetAlertInstrument }: CoinScanResultsProps) {
  const [copiedInstrument, setCopiedInstrument] = useState<string | null>(null);

  function copyInstrument(instrument: string) {
    const copyText = shortInstrument(instrument).toLowerCase();
    navigator.clipboard.writeText(copyText).then(() => {
      setCopiedInstrument(instrument);
      window.setTimeout(() => {
        setCopiedInstrument((current) => (current === instrument ? null : current));
      }, 1500);
    }).catch(() => {
      setCopiedInstrument(null);
    });
  }

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
              <th>成交额</th>
              <th>当前量</th>
              <th>均量</th>
              <th>量比</th>
              <th>振幅比</th>
              <th>强度分</th>
              <th>连续平静</th>
              <th>压缩比</th>
              <th>收窄趋势</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => (
              <tr key={row.instrument} className={row.qualified ? 'qualified' : ''}>
                <td>{shortInstrument(row.instrument)}</td>
                <td>{formatPrice(row.lastPrice)}</td>
                <td className={row.change24h >= 0 ? 'profit' : 'loss'}>{row.change24h >= 0 ? '+' : ''}{row.change24h.toFixed(2)}%</td>
                <td>{formatVolume(row.quoteVolume24h)}</td>
                <td>{formatVolume(row.currentVolume)}</td>
                <td>{formatVolume(row.averageVolume)}</td>
                <td>{row.ratio.toFixed(2)}</td>
                <td>{row.amplitudeRatio.toFixed(2)}</td>
                <td>{row.intensity.toFixed(2)}</td>
                <td>{row.consecutiveQuiet}</td>
                <td>{formatCompression(row.compression)}</td>
                <td>{formatLatestTrend(row.latestTrend)}</td>
                <td>{row.qualified ? '合格' : '—'}</td>
                <td>
                  <button
                    type="button"
                    className="coin-scan-copy"
                    title={`为 ${shortInstrument(row.instrument)} 设价格警报`}
                    onClick={() => onSetAlertInstrument(row.instrument)}
                  >
                    设警报
                  </button>
                  <button
                    type="button"
                    className="coin-scan-copy"
                    title={`复制 ${shortInstrument(row.instrument).toLowerCase()}`}
                    onClick={() => copyInstrument(row.instrument)}
                  >
                    {copiedInstrument === row.instrument ? '已复制' : '复制'}
                  </button>
                </td>
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

function formatCompression(value: number): string {
  // compression is always a finite number on the wire, but the prior-window-is-flat
  // boundary reports LARGE_RATIO (1e9) as a "woke up from flat" sentinel. Show it
  // as a dash so the column stays readable while signaling non-convergence.
  return value >= 1e9 ? '—' : value.toFixed(2);
}

function formatLatestTrend(value: number): string {
  // latestTrend mirrors compression's boundary handling: a flat middle window with
  // an active latest window reports LARGE_RATIO (1e9), shown as a dash.
  return value >= 1e9 ? '—' : value.toFixed(2);
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
