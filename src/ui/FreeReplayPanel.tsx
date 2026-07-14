import { useEffect, useRef, useState } from 'react';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import type { ReviewTimeframe } from '../domain/trade';
import { freeReplayCursorTimeForStart } from './chart-time';

type InstrumentResponse = {
  instruments: string[];
};

export type FreeReplayStart = {
  instrument: string;
  startTime: string;
  dataAnchorTime: string;
  startCursorTime: number;
  cursorTime: number;
};

export function FreeReplayPanel({ timeframe, onStart, onReveal, onRewind }: { timeframe: ReviewTimeframe; onStart?: (start: FreeReplayStart) => void; onReveal?: () => void; onRewind?: () => void }) {
  const [instruments, setInstruments] = useState<string[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState('');
  const [instrumentSearch, setInstrumentSearch] = useState('');
  const [startTime, setStartTime] = useState('');
  const [status, setStatus] = useState('Loading instruments');
  const startInputRef = useRef<HTMLInputElement>(null);
  const startPickerRef = useRef<{ close(): void; destroy(): void } | null>(null);

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
            startPickerRef.current?.close();
          }}
          onChange={(event) => setStartTime(event.currentTarget.value)}
        />
      </label>
      <button className="save-button" disabled={!selectedInstrument || !startTime} onClick={() => {
        if (!selectedInstrument || !startTime) return;
        const cursorTime = freeReplayCursorTimeForStart(startTime, timeframe);
        onStart?.({
          instrument: selectedInstrument,
          startTime,
          dataAnchorTime: startTime,
          startCursorTime: cursorTime,
          cursorTime,
        });
      }}>Start Free Replay</button>
      <div className="replay-controls">
        <button type="button" onClick={onRewind}>Previous candle</button>
        <button type="button" onClick={onReveal}>Next candle</button>
      </div>
      {status && <p className="panel-status">{status}</p>}
    </div>
  );
}
