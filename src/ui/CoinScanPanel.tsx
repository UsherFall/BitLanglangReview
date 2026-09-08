import { Fragment, useState } from 'react';
import {
  scanTimeframes,
  type ConvergenceStructure,
  type ScanResponse,
  type ScanRow,
} from '../domain/coin-scan';
import type { MarketHeatResult } from '../domain/market-heat';

/** 选币扫描结果: 按方法区分载荷。 */
export type ScanResult =
  | { method: 'shrink'; data: ScanResponse }
  | { method: 'heat'; data: MarketHeatResult; anchorLabel: string };

export type CoinScanPanelProps = {
  onScanned: (result: ScanResult) => void;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateTimeLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function anchorScanLabel(anchorEpoch: number | null): string {
  return anchorEpoch === null ? `当前 ${localDateTimeLabel(Date.now())}` : `锚点 ${localDateTimeLabel(anchorEpoch)}`;
}

export function CoinScanPanel({ onScanned }: CoinScanPanelProps) {
  const [method, setMethod] = useState<'shrink' | 'heat'>('shrink');
  const [topN, setTopN] = useState('60');
  const [minQuoteVolume24h, setMinQuoteVolume24h] = useState('10000000');
  // 结构强度阈值主旋钮:调高 = 宁少勿滥.
  const [minScore, setMinScore] = useState('0.6');
  // Optional scan anchor (local datetime); empty = scan "now".
  const [anchorInput, setAnchorInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);

  async function scan() {
    if (method === 'shrink') {
      const inputs = [topN, minQuoteVolume24h, minScore];
      if (inputs.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) {
        setError('参数无效,请检查');
        return;
      }
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
      const query = new URLSearchParams({ method });
      if (method === 'shrink') {
        query.set('topN', topN);
        query.set('minQuoteVolume24h', minQuoteVolume24h);
        query.set('minScore', minScore);
      }
      if (anchorEpoch !== null) query.set('anchor', String(anchorEpoch));
      const response = await fetch(`/api/scan?${query.toString()}`);
      const payload = (await response.json()) as (ScanResponse | MarketHeatResult) & { error?: string };
      if (!response.ok) throw new Error(payload.error || '扫描失败');
      if (method === 'heat') {
        const heat = payload as MarketHeatResult;
        setScanWarnings(heat.warnings ?? []);
        onScanned({ method: 'heat', data: heat, anchorLabel: anchorScanLabel(anchorEpoch) });
      } else {
        const scan = payload as ScanResponse;
        setScanWarnings(scan.warnings ?? []);
        onScanned({ method: 'shrink', data: scan });
      }
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
        <select value={method} onChange={(event) => setMethod(event.target.value as 'shrink' | 'heat')}>
          <option value="shrink">收敛结构</option>
          <option value="heat">热度</option>
        </select>
      </label>
      <div className="coin-scan-params">
        {method === 'shrink' && (
          <>
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
          </>
        )}
        <label>
          扫描时间点
          <input type="datetime-local" value={anchorInput} onChange={(event) => setAnchorInput(event.target.value)} />
        </label>
      </div>
      <p className="panel-status hint">
        {method === 'shrink'
          ? '一次扫描全周期(5m/15m/1H/4H/1D),每币一行。结构强度阈值调高 = 宁少勿滥;时间点留空 = 现在,填入则扫描「该时刻之前已完成」的 K 线。'
          : '扫描当前市场热度:整体场子五档温度 + 涨跌幅榜,池 = 币安成交额 Top80,口径与复盘一致;时间点留空 = 现在。'}
      </p>
      <button className="save-button" disabled={scanning} onClick={() => void scan()}>
        {scanning ? '扫描中…' : '扫描'}
      </button>
      {scanWarnings.length > 0 && scanWarnings.map((warning) => (
        <p key={warning} className="panel-status warn">{warning}</p>
      ))}
      {error && <p className="panel-status bad">{error}</p>}
    </div>
  );
}

export type CoinScanResultsProps = {
  result: ScanResponse | null;
  leaderCoins: string[];
  onToggleLeaderCoin: (instrument: string) => void;
};

export function CoinScanResults({ result, leaderCoins, onToggleLeaderCoin }: CoinScanResultsProps) {
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
      {result.skippedInstruments && result.skippedInstruments.length > 0 && (
        <p className="coin-scan-skip-hint" title={result.skippedInstruments.join(', ')}>
          已跳过 {result.skippedInstruments.length} 个休市标的:{formatSkippedNames(result.skippedInstruments)}
        </p>
      )}
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

/** First 8 skipped instruments, then "等 N 个" when truncated (full list in `title`). */
const SKIPPED_NAME_LIMIT = 8;
function formatSkippedNames(skipped: readonly string[]): string {
  const names = skipped.slice(0, SKIPPED_NAME_LIMIT).map(shortInstrument).join('、');
  const extra = skipped.length - SKIPPED_NAME_LIMIT;
  return extra > 0 ? `${names} 等 ${extra} 个` : names;
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
