import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  scanTimeframes,
  type ConvergenceStructure,
  type ScanResponse,
  type ScanRow,
} from '../domain/coin-scan';
import type { MarketHeatResult } from '../domain/market-heat';
import {
  COARSE_POS_RANGE_FLOOR,
  DEFAULT_MARKET_DATA_SOURCE,
  MARKET_DATA_SOURCES,
  SCAN_SCOPES,
  defaultScanParams,
  isMarketDataSource,
  type MarketDataSource,
  type ScanScope,
} from '../domain/scan-scope';
import { orderScanRows } from './coin-scan-rows';

/** 选品扫描结果: 按方法区分载荷。`shrink` 的 scope 由 `data.params.scope` 回显。 */
export type ScanResult =
  | { method: 'shrink'; data: ScanResponse }
  | { method: 'heat'; data: MarketHeatResult; anchorLabel: string };

export type CoinScanPanelProps = {
  /** 当前子模块 (加密 / 股票); 由 App 持有, 与结果面板共享。 */
  scope: ScanScope;
  /** 切换子模块; App 负责清空上一次结果。 */
  onScopeChange: (scope: ScanScope) => void;
  onScanned: (result: ScanResult) => void;
};

const SCOPE_LABELS: Record<ScanScope, string> = { crypto: '加密', equity: '股票' };

const SOURCE_LABELS: Record<MarketDataSource, string> = { binance: '币安', okx: 'OKX', bitget: 'Bitget' };

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

/**
 * 扫描数量 is a CAP now (上限保护), not the pool definition: the scan covers the
 * whole 加密 universe of the scope, and the box only limits it. An absent cap
 * renders as an EMPTY input, which is what "留空 = 全池" means on the wire.
 */
function topNInput(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function CoinScanPanel({ scope, onScopeChange, onScanned }: CoinScanPanelProps) {
  const [method, setMethod] = useState<'shrink' | 'heat'>('shrink');
  // 行情源: 初值 = 共享默认源, 挂载后由服务端启动源校正(见下)。
  const [source, setSource] = useState<MarketDataSource>(DEFAULT_MARKET_DATA_SOURCE);
  // 参数默认值按「源 × 品种」推导(成交额下限分级: 各源体量不同)。扫描数量留空 =
  // 全池 —— topN 只是上限保护, 不再是硬门槛(见 `scan-scope.ts`)。
  const [topN, setTopN] = useState(topNInput(defaultScanParams(DEFAULT_MARKET_DATA_SOURCE, scope).topN));
  const [minQuoteVolume24h, setMinQuoteVolume24h] = useState(String(defaultScanParams(DEFAULT_MARKET_DATA_SOURCE, scope).minQuoteVolume24h));
  // 结构强度阈值主旋钮:调高 = 宁少勿滥.
  const [minScore, setMinScore] = useState('0.6');
  // Optional scan anchor (local datetime); empty = scan "now".
  const [anchorInput, setAnchorInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);

  // 配置返回时要用「当时」的品种重算默认值: 挂载 effect 的闭包只会捕获首帧的
  // scope, 用户在配置返回前切了品种就会用过期 scope 覆盖两个输入框。
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  // 服务端的启动源才是选择器的正确初值(.env / MARKET_DATA_SOURCE)。取值失败 —
  // 离线、接口缺失、或测试环境没有 fetch(那是同步抛出,不是 rejected promise,
  // 所以先包一层 Promise.resolve) — 一律保留默认源, 选源只是可用性增强。
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => fetch('/api/scan/config'))
      .then((response) => response.json() as Promise<{ source?: unknown }>)
      .then((body) => {
        if (cancelled || !isMarketDataSource(body?.source) || body.source === DEFAULT_MARKET_DATA_SOURCE) return;
        applyDefaults(body.source, scopeRef.current);
        setSource(body.source);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // 只在挂载时校正一次; 之后由用户点击决定。
  }, []);

  /** 换源/换品种都要重算默认值, 因为下限是「源 × 品种」的二维表。 */
  function applyDefaults(nextSource: MarketDataSource, nextScope: ScanScope) {
    const defaults = defaultScanParams(nextSource, nextScope);
    setTopN(topNInput(defaults.topN));
    setMinQuoteVolume24h(String(defaults.minQuoteVolume24h));
  }

  /** Switching sub-module resets the scope-specific params and drops 热度 (crypto-only). */
  function changeScope(next: ScanScope) {
    if (next === scope) return;
    onScopeChange(next);
    applyDefaults(source, next);
    if (next === 'equity' && method === 'heat') setMethod('shrink');
    setError(null);
  }

  /** 换行情源: 扫描请求带 source, 默认参数随之重新推导。 */
  function changeSource(next: MarketDataSource) {
    if (next === source) return;
    setSource(next);
    applyDefaults(next, scope);
    setError(null);
  }

  async function scan() {
    if (method === 'shrink') {
      const inputs = [minQuoteVolume24h, minScore];
      if (inputs.some((value) => value.trim() === '' || !Number.isFinite(Number(value)))) {
        setError('参数无效,请检查');
        return;
      }
      // 扫描数量留空 = 全池(合法); 填了就必须是 >= 1 的有限数。
      if (topN.trim() !== '' && !(Number.isFinite(Number(topN)) && Number(topN) >= 1)) {
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
      const query = new URLSearchParams({ method, scope, source });
      if (method === 'shrink') {
        // 留空 = 不发 topN = 全池。
        if (topN.trim() !== '') query.set('topN', topN);
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
      <div className="coin-scan-scope-row">
        <span>品种</span>
        <span className="coin-scan-scope">
          {SCAN_SCOPES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === scope ? 'selected' : ''}
              onClick={() => changeScope(candidate)}
            >
              {SCOPE_LABELS[candidate]}
            </button>
          ))}
        </span>
      </div>
      <div className="coin-scan-scope-row">
        <span>行情源</span>
        <span className="coin-scan-scope">
          {MARKET_DATA_SOURCES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === source ? 'selected' : ''}
              onClick={() => changeSource(candidate)}
            >
              {SOURCE_LABELS[candidate]}
            </button>
          ))}
        </span>
      </div>
      <label>
        方法
        <select value={method} onChange={(event) => setMethod(event.target.value as 'shrink' | 'heat')}>
          <option value="shrink">收敛结构</option>
          {scope === 'crypto' && <option value="heat">热度</option>}
        </select>
      </label>
      <div className="coin-scan-params">
        {method === 'shrink' && (
          <>
            <label>
              扫描数量
              <input
                type="number"
                min="1"
                value={topN}
                placeholder="全池"
                title="上限保护: 留空 = 全池(扫描整个品种池后再粗筛)"
                onChange={(event) => setTopN(event.target.value)}
              />
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
        {scope === 'equity'
          ? '范围 = 美股 + 韩股:休市时段整体剔除,序列只含真实交易时段 K 线(盘前 04:00 – 盘后 20:00 ET)。'
          : '范围 = 加密 + 指数 + 商品,7×24 参与,不受交易时段影响。'}
        {method === 'shrink'
          ? '扫描数量留空 = 全池(上限保护)。先对全池取日线做「池内分位粗筛」(盘得够久 + 收住了 + 不在趋势中,再排除趴在序列绝对底部的品种),只对通过者再取 5m/15m/1H/4H,每币一行。结构强度阈值调高 = 宁少勿滥,大级别(4H/1D)自动更宽容;时间点留空 = 现在,填入则扫描「该时刻之前已完成」的 K 线。'
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
  /** Instruments the user manually demoted (日线结构不适合做多); rendered last and dimmed. */
  demotedCoins: string[];
  onToggleDemotedCoin: (instrument: string) => void;
};

export function CoinScanResults({ result, leaderCoins, onToggleLeaderCoin, demotedCoins, onToggleDemotedCoin }: CoinScanResultsProps) {
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
  // The service sorts scanned rows (highest converged level, then qualifiedCount,
  // then bestScore — a coarse survivor that converges nowhere reads as level -1
  // and sinks) and the UI keeps that order, except that manually demoted rows sink
  // to the bottom (a stable partition, not a re-rank).
  const rows = orderScanRows(result.scanned, demotedCoins);
  // 行入选 = 通过 1D 粗筛,所以「收敛」是行内子集(粗筛放行的币可能在所有周期都不收敛)。
  const convergedRows = rows.filter((row) => row.qualifiedCount > 0).length;
  return (
    <>
      <header className="detail-header">
        <div>
          <h1>选品结果 · {SCOPE_LABELS[result.params.scope ?? 'crypto']}</h1>
          <p>
            粗筛 {result.scanned.length} 个{result.coarse ? ` · 候选 ${result.coarse.candidates} 个` : ''} · 收敛 {convergedRows} 个
            {result.coarse ? ` · 日线窗口 ${result.coarse.windowDays} 天` : ''}
          </p>
          {result.skippedInstruments && result.skippedInstruments.length > 0 && (
            <p className="coin-scan-skip-hint" title={result.skippedInstruments.join(', ')}>
              已跳过 {result.skippedInstruments.length} 个休市标的:{formatSkippedNames(result.skippedInstruments)}
            </p>
          )}
          {result.failedInstruments && result.failedInstruments.length > 0 && (
            <p className="coin-scan-skip-hint" title={result.failedInstruments.join(', ')}>
              已跳过 {result.failedInstruments.length} 个取数失败标的:{formatSkippedNames(result.failedInstruments)}
            </p>
          )}
          {result.metadataUnavailable && (
            <p className="coin-scan-skip-hint" title="币安 exchangeInfo 元数据不可用，本次未按交易时段过滤">
              休市过滤未生效:合约类别元数据拉取失败，本次结果可能包含休市标的
            </p>
          )}
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
              <th>结构</th>
              <th>收敛结构</th>
              <th>强度分</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isDemoted = demotedCoins.includes(row.instrument);
              return (
                <Fragment key={row.instrument}>
                  <tr className={isDemoted ? 'demoted' : 'qualified'}>
                    <td>{shortInstrument(row.instrument)}</td>
                    <td>{formatPrice(row.lastPrice)}</td>
                    <td className={row.change24h >= 0 ? 'profit' : 'loss'}>{row.change24h >= 0 ? '+' : ''}{row.change24h.toFixed(2)}%</td>
                    <td>{formatVolume(row.quoteVolume24h)}</td>
                    <td>{formatCoarse(row, result.coarse?.windowDays)}</td>
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
                        aria-pressed={isDemoted}
                        title={isDemoted ? `取消 ${shortInstrument(row.instrument)} 的降权` : `将 ${shortInstrument(row.instrument)} 降权(沉底并灰化)`}
                        onClick={() => onToggleDemotedCoin(row.instrument)}
                      >
                        {isDemoted ? '已降权' : '降权'}
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
                    <tr className={isDemoted ? 'coin-scan-detail-row demoted' : 'coin-scan-detail-row'}>
                      <td colSpan={8}>
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
              );
            })}
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

// 结构 column: the 1D coarse screen's own measures — 盘得够久(窗口天数)/ 收住了(区间)/
// 不在趋势中(净漂移)/ 位置(现价在全序列中的位置, 0 = 绝对底部). Every row in the
// table passed the screen, so this is what put the row here; the pool-relative
// cuts and the absolute position floor behind it are printed in the title.
function formatCoarse(row: ScanRow, windowDays: number | undefined): ReactNode {
  const coarse = row.coarse;
  if (!coarse) return '—';
  const window = windowDays === undefined ? '' : `${windowDays}天 `;
  const title =
    `日线粗筛: 区间 ≤ ${formatPercent(coarse.rangePctThreshold)} 且 净漂移 ≤ ${formatPercent(coarse.netPctThreshold)}(本次池内分位重算)` +
    ` 且 全序列位置 ≥ ${formatPercent(COARSE_POS_RANGE_FLOOR)}(绝对下限)`;
  return (
    <span className="coin-scan-coarse" title={title}>
      {`${window}区间${formatPercent(coarse.rangePct)} 净${formatPercent(coarse.netPct)} 位${formatPercent(coarse.posRange)}`}
    </span>
  );
}

/** A 0..1 relative measure as a percent (0.459 → "45.9%"); unknown cuts read as "—". */
function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
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
