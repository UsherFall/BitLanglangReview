import Database from 'better-sqlite3';

// The session payload is opaque JSON to the store: the server serializes the
// frontend's FreeReplayStart + paper trading session without knowing their
// types, mirroring how chart drawing points are stored as points_json.
export type FreeReplaySessionPayload = {
  instrument: string;
  startTime: string;
  dataAnchorTime: string;
  startCursorTime: number;
  startProgressTime: number;
  progressTime: number;
  cursorTime: number;
  timeframe: string;
  paperTrading: unknown;
  updatedAt: string;
};

export type SaveFreeReplaySessionInput = Omit<FreeReplaySessionPayload, 'updatedAt'>;

type SessionRow = {
  instrument: string;
  start_time: string;
  timeframe: string;
  data_anchor_time: string;
  start_cursor_time: number;
  start_progress_time: number;
  progress_time: number;
  cursor_time: number;
  paper_trading_json: string;
  updated_at: string;
};

export class FreeReplaySessionStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists free_replay_sessions (
        instrument          text not null,
        start_time          text not null,
        timeframe           text not null,
        data_anchor_time    text not null,
        start_cursor_time   integer not null,
        start_progress_time integer not null,
        progress_time       integer not null,
        cursor_time         integer not null,
        paper_trading_json  text not null,
        updated_at          text not null,
        primary key (instrument, start_time)
      );
    `);
  }

  listSessions(): FreeReplaySessionPayload[] {
    const rows = this.db.prepare('select * from free_replay_sessions order by updated_at desc').all() as SessionRow[];
    return rows.map(toSessionPayload);
  }

  saveSession(input: SaveFreeReplaySessionInput): FreeReplaySessionPayload {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `insert into free_replay_sessions (instrument, start_time, timeframe, data_anchor_time, start_cursor_time, start_progress_time, progress_time, cursor_time, paper_trading_json, updated_at)
         values (@instrument, @startTime, @timeframe, @dataAnchorTime, @startCursorTime, @startProgressTime, @progressTime, @cursorTime, @paperTradingJson, @updatedAt)
         on conflict(instrument, start_time) do update set
           timeframe = excluded.timeframe,
           data_anchor_time = excluded.data_anchor_time,
           start_cursor_time = excluded.start_cursor_time,
           start_progress_time = excluded.start_progress_time,
           progress_time = excluded.progress_time,
           cursor_time = excluded.cursor_time,
           paper_trading_json = excluded.paper_trading_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        instrument: input.instrument,
        startTime: input.startTime,
        timeframe: input.timeframe,
        dataAnchorTime: input.dataAnchorTime,
        startCursorTime: input.startCursorTime,
        startProgressTime: input.startProgressTime,
        progressTime: input.progressTime,
        cursorTime: input.cursorTime,
        paperTradingJson: JSON.stringify(input.paperTrading),
        updatedAt,
      });
    return { ...input, updatedAt };
  }

  deleteSession(instrument: string, startTime: string): void {
    this.db.prepare('delete from free_replay_sessions where instrument = ? and start_time = ?').run(instrument, startTime);
  }

  close(): void {
    this.db.close();
  }
}

function toSessionPayload(row: SessionRow): FreeReplaySessionPayload {
  return {
    instrument: row.instrument,
    startTime: row.start_time,
    dataAnchorTime: row.data_anchor_time,
    startCursorTime: row.start_cursor_time,
    startProgressTime: row.start_progress_time,
    progressTime: row.progress_time,
    cursorTime: row.cursor_time,
    timeframe: row.timeframe,
    paperTrading: JSON.parse(row.paper_trading_json),
    updatedAt: row.updated_at,
  };
}
