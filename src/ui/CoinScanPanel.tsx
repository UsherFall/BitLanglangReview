import { Fragment, useEffect, useState } from 'react';
import type { AlertDirection, PriceAlert } from '../domain/price-alert';
import {
  scanTimeframes,
  type ConvergenceStructure,
  type ScanResponse,
  type ScanRow,
} from '../domain/coin-scan';

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
  const [topN, setTopN] = useState('60');
  const [minQuoteVolume24h, setMinQuoteVolume24h] = useState('10000000');
  // 结构强度阈值主旋钮:调高 = 宁少勿滥. Default 0.7 = prefer fewer, stronger structures.
  const [minScore, setMinScore] = useState('0.6');
  // Optional scan anchor (local datetime); empty = scan "now".
  const [anchorInput, setAnchorInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);

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
    const inputs = [topN, minQuoteVolume24h, minScore];
    if (inputs.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) {
      setError('参数无效,请检查');
      return;
    }
    const anchorEpoch = anchorInput.trim() === '' ? null : Date.parse(anchorInput);
    if (anchorInput.trim() !== '' && !Number.isFinite(anchorEpoch)) {
      setError('时间点无效,请检查');
      return;
    }
    setScanning(true);
    setError(null);
    setScanWarnings([]);
    try {
      const query = new URLSearchParams({
        method: 'shrink',
        topN,
        minQuoteVolume24h,
        minScore,
      });
      if (anchorEpoch !== null) query.set('anchor', String(anchorEpoch));
      const response = await fetch(`/api/scan?${query.toString()}`);
      const payload = (await response.json()) as ScanResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || '扫描失败');
      setScanWarnings(payload.warnings ?? []);
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
          <option value="shrink">收敛结构</option>
        </select>
      </label>
      <div className="coin-scan-params">
        <label>
          扫描数量
          <input type="number" min="1" value={topN} onChange={(event) => setTopN(event.target.value)} />
        </label>
        <label>
          最低成交额
          <input type="number" min="0" value={minQuoteVolume24h} onChange={(event) => setMinQuoteVolume24h(event.target.value)} />
        </label>
        <label>
          结构强度阈值
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={minScore}
            onChange={(event) => setMinScore(event.target.value)}
            title="调高 = 宁少勿滥"
          />
        </label>
        <label>
          扫描时间点
          <input type="datetime-local" value={anchorInput} onChange={(event) => setAnchorInput(event.target.value)} />
        </label>
      </div>
      <p className="panel-status hint">
        一次扫描全周期(5m/15m/1H/4H/1D),每币一行。结构强度阈值调高 = 宁少勿滥;时间点留空 = 现在,填入则扫描「该时刻之前已完成」的 K 线。
      </p>
      <button className="save-button" disabled={scanning} onClick={() => void scan()}>
        {scanning ? '扫描中…' : '扫描'}
      </button>
      {scanWarnings.length > 0 && scanWarnings.map((warning) => (
        <p key={warning} className="panel-status warn">{warning}</p>
      ))}
      {error && <p className="panel-status bad">{error}</p>}
      <div className="coin-scan-alerts">
        <h3>价格警报</h3>
        <p className={`alert-config ${alertConfig?.notifierConfigured ? 'ok' : 'bad'}`}>
          {alertConfig?.notifierConfigured ? '微信通知:已配置 ✓' : '微信通知:未配置(需 .env 配 SERVERCHAN_KEY)'}
        </p>
        <div className="coin-scan-alert-form">
          <label>
            币
            <input value={alertInstrument} onChange={(event) => onAlertInstrumentChange(event.target.value)} placeholder="XAUUSDT" />
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
  leaderCoins: string[];
  onToggleLeaderCoin: (instrument: string) => void;
  onSetAlertInstrument: (instrument: string) => void;
};

export function CoinScanResults({ result, leaderCoins, onToggleLeaderCoin, onSetAlertInstrument }: CoinScanResultsProps) {
  const [copiedInstrument, setCopiedInstrument] = useState<string | null>(null);
  const [expandedInstrument, setExpandedInstrument] = useState<string | null>(null);

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
  // The service sorts scanned rows (qualifiedCount desc, then bestScore desc); the
  // UI renders them as-is.
  return (
    <>
      <header className="detail-header">
        <div>
          <h1>选币结果</h1>
          <p>扫描 {result.scanned.length} 个 · 收敛 {result.qualifiedCount} 个 · 全周期</p>
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
              <th>收敛结构</th>
              <th>强度分</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {result.scanned.map((row) => (
              <Fragment key={row.instrument}>
                <tr className="qualified">
                  <td>{shortInstrument(row.instrument)}</td>
                  <td>{formatPrice(row.lastPrice)}</td>
                  <td className={row.change24h >= 0 ? 'profit' : 'loss'}>{row.change24h >= 0 ? '+' : ''}{row.change24h.toFixed(2)}%</td>
                  <td>{formatVolume(row.quoteVolume24h)}</td>
                  <td>{formatConvergedStructures(row)}</td>
                  <td>{formatScore(row.bestScore)}</td>
                  <td>
                    <button
                      type="button"
                      className="coin-scan-copy"
                      title="展开各周期结构明细"
                      onClick={() => setExpandedInstrument((current) => (current === row.instrument ? null : row.instrument))}
                    >
                      {expandedInstrument === row.instrument ? '收起' : '详情'}
                    </button>
                    <button
                      type="button"
                      className="coin-scan-copy"
                      title={leaderCoins.includes(row.instrument) ? `取消 ${shortInstrument(row.instrument)} 的龙头币标记` : `将 ${shortInstrument(row.instrument)} 记为龙头币`}
                      onClick={() => onToggleLeaderCoin(row.instrument)}
                    >
                      {leaderCoins.includes(row.instrument) ? '已记' : '记龙头'}
                    </button>
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
                {expandedInstrument === row.instrument && (
                  <tr className="coin-scan-detail-row">
                    <td colSpan={7}>
                      <table className="coin-scan-detail-table">
                        <thead>
                          <tr>
                            <th>周期</th>
                            <th>结构类型</th>
                            <th>位置</th>
                            <th>强度分</th>
                            <th>触碰次数</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanTimeframes.map((timeframe) => {
                            const structure = row.structures[timeframe];
                            return (
                              <tr key={timeframe} className={structure.qualified ? 'qualified' : ''}>
                                <td>{timeframe}</td>
                                <td>{structureLabel(structure.structure)}</td>
                                <td>{formatPosition(structure.position)}</td>
                                <td>{formatScore(structure.score)}</td>
                                <td>{structure.touchCount}</td>
                                <td>{structure.qualified ? '合格' : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// OKX symbols carry a `-USDT-SWAP` suffix (BTC-USDT-SWAP) that we strip for
// display; Binance perpetuals (XAUUSDT, BTCUSDT) have no suffix and pass through
// as-is.
function shortInstrument(instrument: string): string {
  return instrument.endsWith('-USDT-SWAP') ? instrument.slice(0, -'-USDT-SWAP'.length) : instrument;
}

// 收敛结构 column: each qualified timeframe shown with its structure type
// (always 收敛 now). Rows always have >= 1 qualified timeframe, but a defensive
// dash keeps the column readable if a row ever arrives empty.
function formatConvergedStructures(row: ScanRow): string {
  const parts = row.convergedTimeframes.map((timeframe) => {
    const structure = row.structures[timeframe].structure;
    return `${timeframe}${structureLabel(structure)}`;
  });
  return parts.length > 0 ? parts.join(' ') : '—';
}

function structureLabel(structure: ConvergenceStructure | null): string {
  return structure === 'convergence' ? '收敛' : '—';
}

function formatPosition(value: number): string {
  // position is a 0..1 fraction; show it as a percent (0.28 → "28%").
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  // score is normalized to 0..1 (larger = stronger convergence).
  return value.toFixed(2);
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
