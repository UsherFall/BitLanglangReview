import { useEffect, useRef, useState } from 'react';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { ReviewTimeframe } from '../domain/trade';
import { freeReplayCursorTimeForProgress, freeReplayProgressTimeForStart } from './chart-time';
import { FREE_REPLAY_CANDLE_SOURCE, REPLAY_SOURCE_LABELS, replayCandleGrid, type ReplayCandleSource } from './free-replay-chart';
import type { PaperTradingSession } from './free-replay-paper-trading';

type InstrumentResponse = {
  instruments: string[];
};

export type FreeReplayStart = {
  /**
   * Which venue's candles this replay reads (10/21). Optional: a session
   * recorded before the move has none and keeps its original venue.
   */
  candleSource?: string;
  instrument: string;
  startTime: string;
  dataAnchorTime: string;
  startCursorTime: number;
  startProgressTime: number;
  progressTime: number;
  cursorTime: number;
};

export type FreeReplaySessionPayload = FreeReplayStart & {
  timeframe: ReviewTimeframe;
  paperTrading: PaperTradingSession;
};

export type FreeReplaySession = FreeReplaySessionPayload & {
  updatedAt: string;
};

export function FreeReplayPanel({
  timeframe,
  onStart,
  onReveal,
  onRewind,
  sessions,
  activeReplay,
  onRestore,
  onDelete,
}: {
  timeframe: ReviewTimeframe;
  onStart?: (start: FreeReplayStart) => void;
  onReveal?: () => void;
  onRewind?: () => void;
  sessions?: FreeReplaySession[];
  activeReplay?: FreeReplayStart | null;
  onRestore?: (session: FreeReplaySession) => void;
  onDelete?: (instrument: string, startTime: string) => void;
}) {
  const [instruments, setInstruments] = useState<string[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState('');
  const [instrumentSearch, setInstrumentSearch] = useState('');
  const [startTime, setStartTime] = useState('');
  const [status, setStatus] = useState('加载交易对');
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
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
        <button type="button" onClick={onRewind}>上一根 K 线</button>
        <button type="button" onClick={onReveal}>下一根 K 线</button>
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
      {status && <p className="panel-status">{status}</p>}
    </div>
  );
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
