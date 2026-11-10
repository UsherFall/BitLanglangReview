import { useEffect, useRef, useState } from 'react';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import { ChevronDown, ChevronUp, Star, Trash2 } from 'lucide-react';
import { paperSessionKey, type PaperRound, type PaperRoundLibraryResponse, type PaperRoundSessionRow } from '../domain/paper-round';
import type { FreeReplaySession, FreeReplaySessionPayload, FreeReplayStart } from '../domain/free-replay-session';
import type { ReplayCandleSource } from '../domain/candlestick';
import type { TradeReview } from '../domain/review';
import type { ReviewTimeframe } from '../domain/trade';
import { freeReplayCursorTimeForProgress, freeReplayProgressTimeForStart } from './chart-time';
import { FREE_REPLAY_CANDLE_SOURCE, REPLAY_SOURCE_LABELS, replayCandleGrid } from './free-replay-chart';
import { PaperRoundReviewEditor, type PaperReviewSavedPayload } from './PaperRoundReviewEditor';
import type { TagMutation } from './ReviewEditor';

export type { FreeReplaySession, FreeReplaySessionPayload, FreeReplayStart } from '../domain/free-replay-session';
export type { PaperRoundLibraryResponse, PaperRoundSessionRow } from '../domain/paper-round';

type InstrumentResponse = {
  instruments: string[];
};

export function FreeReplayPanel({
  timeframe,
  onStart,
  onReveal,
  onRewind,
  canRewind = true,
  replayEnded = false,
  sessions,
  activeReplay,
  onRestore,
  onDelete,
  paperRounds,
  paperRoundSessions,
  paperTags,
  paperTagCounts,
  paperReviews,
  onSavePaperReview,
  onTogglePaperStar,
  onMutatePaperTag,
  onOpenPaperRound,
  onPaperFiltersChange,
}: {
  timeframe: ReviewTimeframe;
  onStart?: (start: FreeReplayStart) => void;
  onReveal?: () => void;
  onRewind?: () => void;
  /** 11/03：开始模拟交易后回退会把游标拉回已成交单之前，成单时间线错乱 ——
   * App 以 `!paperTrading.active` 传入，按钮置灰并把原因写进 title。 */
  canRewind?: boolean;
  /** 11/10 结束复盘：冻结上一根/下一根，恢复后解除。 */
  replayEnded?: boolean;
  sessions?: FreeReplaySession[];
  activeReplay?: FreeReplayStart | null;
  onRestore?: (session: FreeReplaySession) => void;
  onDelete?: (instrument: string, startTime: string) => void;
  /** 回溯复盘首页的「模拟单库」（11/04）—— 无活跃回放时与会话列表并列。 */
  paperRounds?: PaperRound[];
  paperRoundSessions?: PaperRoundSessionRow[];
  paperTags?: string[];
  paperTagCounts?: Record<string, number>;
  /** Round review id → saved review, shared with the in-replay rows. */
  paperReviews?: Record<string, TradeReview>;
  onSavePaperReview?: (payload: PaperReviewSavedPayload) => void;
  /**
   * One-click star from a library row (11/04): the star must toggle the
   * annotation, not open the editor — opening an editor to add a star would make
   * the two entries behave differently for the same action.
   */
  onTogglePaperStar?: (round: PaperRound) => void;
  onMutatePaperTag?: (mutation: TagMutation) => Promise<void>;
  /** 点库行：恢复来源会话并定位该回合末笔成交。 */
  onOpenPaperRound?: (round: PaperRound) => void;
  onPaperFiltersChange?: (filters: { tag?: string; starred?: 'yes' | 'no'; session?: string }) => void;
}) {
  const [instruments, setInstruments] = useState<string[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState('');
  const [instrumentSearch, setInstrumentSearch] = useState('');
  const [startTime, setStartTime] = useState('');
  const [status, setStatus] = useState('加载交易对');
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  /** 11/04：库行选中态 —— 点「回到该回合」后记住该行，高亮对齐交割单复盘的选中语言。 */
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const [starredFilter, setStarredFilter] = useState<'' | 'yes' | 'no'>('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const roundList = paperRounds ?? [];
  const roundSessions = paperRoundSessions ?? [];
  const roundReviews = paperReviews ?? {};
  // 11/02：行情源可选（选品同款词汇），新会话把所选源写进 candleSource；
  // 交易对列表按源拉取（各源词汇不同：币安/Bitget `XXXUSDT`，OKX `XXX-USDT-SWAP`）。
  const [source, setSource] = useState<ReplayCandleSource>(FREE_REPLAY_CANDLE_SOURCE);
  const startInputRef = useRef<HTMLInputElement>(null);
  const startPickerRef = useRef<{ close(): void; destroy(): void } | null>(null);
  const sessionList = sessions ?? [];

  useEffect(() => {
    // 11/02：列表随所选源变 —— /api/free-replay/instruments 按源返回各自词汇表的
    // 标的（okx → OKX 式、bitget → Bitget 式、默认 → 币安式）。
    setStatus('加载交易对');
    fetch(`/api/free-replay/instruments?source=${source}`)
      .then((response) => response.json())
      .then((next: InstrumentResponse) => {
        setInstruments(next.instruments);
        setSelectedInstrument((current) => (next.instruments.includes(current) ? current : next.instruments[0] || ''));
        setStatus('');
      })
      .catch(() => setStatus('交易对加载失败'));
  }, [source]);

  const filteredInstruments = instruments.filter((instrument) => instrument.toLowerCase().includes(instrumentSearch.trim().toLowerCase()));

  useEffect(() => {
    if (!filteredInstruments.length) {
      setSelectedInstrument('');
      return;
    }
    setSelectedInstrument((current) => (filteredInstruments.includes(current) ? current : filteredInstruments[0]));
  }, [instrumentSearch, instruments]);

  useEffect(() => {
    if (!startInputRef.current) return;
    const picker = flatpickr(startInputRef.current, {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      time_24hr: true,
      minuteIncrement: 1,
      allowInput: true,
      onChange: (_dates, currentDateString) => setStartTime(currentDateString),
    }) as unknown as { close(): void; destroy(): void };
    startPickerRef.current = picker;
    return () => {
      startPickerRef.current = null;
      picker.destroy();
    };
  }, []);

  return (
    <div className="free-replay-panel">
      <label>
        行情源
        <div className="segmented-control source-select" role="group" aria-label="行情源">
          {(Object.keys(REPLAY_SOURCE_LABELS) as ReplayCandleSource[]).map((item) => (
            <button
              key={item}
              type="button"
              className={source === item ? 'selected' : ''}
              aria-pressed={source === item}
              onClick={() => setSource(item)}
            >
              {REPLAY_SOURCE_LABELS[item]}
            </button>
          ))}
        </div>
      </label>
      <label>
        搜索交易对
        <input value={instrumentSearch} onChange={(event) => setInstrumentSearch(event.target.value)} />
      </label>
      <label>
        交易对
        <select value={selectedInstrument} onChange={(event) => setSelectedInstrument(event.target.value)}>
          {filteredInstruments.map((instrument) => <option key={instrument}>{instrument}</option>)}
        </select>
      </label>
      <label>
        开始时间
        <input
          ref={startInputRef}
          aria-label="开始时间"
          value={startTime}
          onInput={(event) => {
            setStartTime(event.currentTarget.value);
          }}
          onChange={(event) => setStartTime(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') startPickerRef.current?.close();
          }}
        />
      </label>
      <button className="save-button" disabled={!selectedInstrument || !startTime} onClick={() => {
        if (!selectedInstrument || !startTime) return;
        const progressTime = freeReplayProgressTimeForStart(startTime);
        const cursorTime = freeReplayCursorTimeForProgress(progressTime, timeframe, replayCandleGrid({ candleSource: source }));
        onStart?.({
          instrument: selectedInstrument,
          startTime,
          dataAnchorTime: startTime,
          startProgressTime: progressTime,
          progressTime,
          startCursorTime: cursorTime,
          cursorTime,
          // 11/02：会话记录所选源（币安选项 = 严格 binance-only，不带兜底）。
          candleSource: source,
        });
      }}>开始回溯复盘</button>
      <div className="replay-controls">
        <button
          type="button"
          disabled={!canRewind || replayEnded}
          title={replayEnded ? '结束复盘后不能调整 K 线进度' : canRewind ? undefined : '开始模拟交易后不能回退 K 线'}
          onClick={onRewind}
        >
          上一根 K 线
        </button>
        <button type="button" disabled={replayEnded} title={replayEnded ? '结束复盘后不能调整 K 线进度' : undefined} onClick={onReveal}>下一根 K 线</button>
      </div>
      <div className="free-replay-history" data-testid="free-replay-history">
        <button type="button" className="history-header" aria-expanded={!historyCollapsed} onClick={() => setHistoryCollapsed((current) => !current)}>
          <span>历史会话</span>
          {historyCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {!historyCollapsed && (
          <div className="history-list">
            {sessionList.length === 0 ? <p className="history-empty">暂无会话</p> : sessionList.map((session) => {
              const isActive = Boolean(activeReplay && activeReplay.instrument === session.instrument && activeReplay.startTime === session.startTime);
              return (
                <div
                  key={`${session.instrument}:${session.startTime}`}
                  role="button"
                  tabIndex={0}
                  className={`history-row ${isActive ? 'active' : ''}`}
                  onClick={() => onRestore?.(session)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRestore?.(session);
                    }
                  }}
                >
                  <span className="history-row-main">
                    <strong>{session.instrument}</strong>
                    <span>{session.startTime}</span>
                    <span className="history-time">{formatSessionTime(session.updatedAt)}</span>
                  </span>
                  <button
                    type="button"
                    className="history-delete"
                    aria-label={`删除会话 ${session.instrument} ${session.startTime}`}
                    title="删除会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete?.(session.instrument, session.startTime);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* 11/04 sim 单库：与「历史会话」并列，不设新导航。行数据是跨会话聚的
          已完结合回，批注与回放内单子行共享同一份 `paper:` 批注。 */}
      <div className={`free-replay-history paper-round-library${libraryCollapsed ? ' collapsed' : ''}`} data-testid="paper-round-library">
        <button type="button" className="history-header" aria-expanded={!libraryCollapsed} onClick={() => setLibraryCollapsed((current) => !current)}>
          <span>模拟单库{roundList.length ? ` (${roundList.length})` : ''}</span>
          {libraryCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {!libraryCollapsed && (
          <div className="history-list">
            <div className="paper-round-filters">
              <select
                aria-label="按标签筛选模拟单"
                value={tagFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setTagFilter(value);
                  onPaperFiltersChange?.({ tag: value || undefined, starred: starredFilter || undefined, session: sessionFilter || undefined });
                }}
              >
                <option value="">全部标签</option>
                {(paperTags ?? []).map((tag) => (
                  <option key={tag} value={tag}>{tag} ({paperTagCounts?.[tag] ?? 0})</option>
                ))}
              </select>
              <select
                aria-label="按收藏状态筛选模拟单"
                value={starredFilter}
                onChange={(event) => {
                  const value = event.target.value as '' | 'yes' | 'no';
                  setStarredFilter(value);
                  onPaperFiltersChange?.({ tag: tagFilter || undefined, starred: value || undefined, session: sessionFilter || undefined });
                }}
              >
                <option value="">收藏状态</option>
                <option value="yes">已收藏</option>
                <option value="no">未收藏</option>
              </select>
              <select
                aria-label="按来源会话筛选模拟单"
                value={sessionFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setSessionFilter(value);
                  onPaperFiltersChange?.({ tag: tagFilter || undefined, starred: starredFilter || undefined, session: value || undefined });
                }}
              >
                <option value="">全部会话</option>
                {roundSessions.map((row) => (
                  <option key={paperSessionKey(row.instrument, row.startTime)} value={paperSessionKey(row.instrument, row.startTime)}>
                    {row.instrument} · {formatRoundSessionStart(row.startTime)}
                  </option>
                ))}
              </select>
            </div>
            {roundList.length === 0 ? <p className="history-empty">暂无已完结的模拟单</p> : roundList.map((round) => {
              const review = roundReviews[round.id] ?? round.review;
              const isEditing = editingRoundId === round.id;
              const isActive = selectedRoundId === round.id || isEditing;
              return (
                <div key={round.id} className="paper-round-row-wrap">
                  <div className={`paper-round-row ${isActive ? 'active' : ''}`}>
                    <button
                      type="button"
                      className={`star-toggle ${review?.starred ? 'active' : ''}`}
                      aria-label={`${review?.starred ? '取消收藏' : '收藏'} ${round.instrument} ${round.positionId}`}
                      title={review?.starred ? '取消收藏' : '收藏'}
                      onClick={() => onTogglePaperStar?.(round)}
                    >
                      <Star size={14} fill={review?.starred ? 'currentColor' : 'none'} />
                    </button>
                    <button type="button" className="paper-round-row-main" title="回到该回合" onClick={() => { setSelectedRoundId(round.id); onOpenPaperRound?.(round); }}>
                      <span>{round.instrument}</span>
                      <span className={round.direction === 'long' ? 'long' : 'short'}>{round.direction === 'long' ? '多' : '空'}</span>
                      <span>{round.entryPrice} → {round.exitPrice}</span>
                      <strong className={round.pnl >= 0 ? 'profit' : 'loss'}>{round.pnl.toFixed(2)}</strong>
                      <span className={round.returnRate >= 0 ? 'profit' : 'loss'}>{formatRoundPercent(round.returnRate)}</span>
                      <span>{round.fillCount} 笔</span>
                      <span className="paper-order-time">{formatRoundSessionStart(round.startTime)} 起</span>
                      <span className="tags">{review?.tags.join(' · ') || '未标记'}</span>
                    </button>
                    <button type="button" aria-label={`批注 ${round.instrument} ${round.positionId}`} title="批注" onClick={() => setEditingRoundId(isEditing ? null : round.id)}>
                      {isEditing ? '收起' : '批注'}
                    </button>
                  </div>
                  {isEditing && (
                    <PaperRoundReviewEditor
                      reviewId={round.id}
                      review={review}
                      availableTags={paperTags ?? []}
                      tagCounts={paperTagCounts ?? {}}
                      onMutateTag={onMutatePaperTag}
                      onSaved={(payload) => onSavePaperReview?.(payload)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {status && <p className="panel-status">{status}</p>}
    </div>
  );
}

function formatRoundSessionStart(value: string): string {
  return value;
}

/** Signed percent for a round's realized return (0.1 → +10.00%). */
function formatRoundPercent(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
