import { useEffect, useRef, useState } from 'react';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { ReviewTimeframe } from '../domain/trade';
import { freeReplayCursorTimeForProgress, freeReplayProgressTimeForStart } from './chart-time';
import type { PaperTradingSession } from './free-replay-paper-trading';

type InstrumentResponse = {
  instruments: string[];
};

export type FreeReplayStart = {
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
  const [status, setStatus] = useState('Loading instruments');
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const startInputRef = useRef<HTMLInputElement>(null);
  const startPickerRef = useRef<{ close(): void; destroy(): void } | null>(null);
  const sessionList = sessions ?? [];

  useEffect(() => {
    fetch('/api/free-replay/instruments')
      .then((response) => response.json())
      .then((next: InstrumentResponse) => {
        setInstruments(next.instruments);
        setSelectedInstrument((current) => current || next.instruments[0] || '');
        setStatus('');
      })
      .catch(() => setStatus('Failed to load instruments'));
  }, []);

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
        Search instrument
        <input value={instrumentSearch} onChange={(event) => setInstrumentSearch(event.target.value)} />
      </label>
      <label>
        Instrument
        <select value={selectedInstrument} onChange={(event) => setSelectedInstrument(event.target.value)}>
          {filteredInstruments.map((instrument) => <option key={instrument}>{instrument}</option>)}
        </select>
      </label>
      <label>
        Start time
        <input
          ref={startInputRef}
          aria-label="Start time"
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
        const cursorTime = freeReplayCursorTimeForProgress(progressTime, timeframe);
        onStart?.({
          instrument: selectedInstrument,
          startTime,
          dataAnchorTime: startTime,
          startProgressTime: progressTime,
          progressTime,
          startCursorTime: cursorTime,
          cursorTime,
        });
      }}>Start Free Replay</button>
      <div className="replay-controls">
        <button type="button" onClick={onRewind}>Previous candle</button>
        <button type="button" onClick={onReveal}>Next candle</button>
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
                    aria-label={`Delete session ${session.instrument} ${session.startTime}`}
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
