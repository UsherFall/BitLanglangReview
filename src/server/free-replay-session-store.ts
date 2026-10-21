import Database from 'better-sqlite3';

// The session payload is opaque JSON to the store: the server serializes the
// frontend's FreeReplayStart + paper trading session without knowing their
// types, mirroring how chart drawing points are stored as points_json.
export type FreeReplaySessionPayload = {
  instrument: string;
  /**
   * Which venue's candles this session replays against (10/21).
   *
   * The Free Replay panel moved to the Bitget source, but the sessions stored
   * BEFORE that move were recorded against Binance. The field is therefore
   * OPTIONAL: an absent value means "the old behaviour" (Binance), so an old
   * session keeps replaying exactly as it did instead of silently switching
   * venues under the user's feet.
   */
  candleSource?: string;
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
  candle_source: string | null;
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
        candle_source       text,
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
    this.allowCandleSourceColumn();
  }

  /**
   * Adds the optional `candle_source` column (10/21).
   *
   * The migration copies the table rather than running `alter table ... add
   * column`, matching the pattern `drawing-store.ts` established: the rebuild
   * works on every SQLite build the app may run against. Existing rows keep
   * NULL, which reads as "the old behaviour" (Binance).
   */
  private allowCandleSourceColumn(): void {
    if (columnExists(this.db, 'free_replay_sessions', 'candle_source')) return;
    this.db.exec(`
      alter table free_replay_sessions rename to free_replay_sessions_old;
      create table free_replay_sessions (
        instrument          text not null,
        candle_source       text,
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
      insert into free_replay_sessions (instrument, candle_source, start_time, timeframe, data_anchor_time, start_cursor_time, start_progress_time, progress_time, cursor_time, paper_trading_json, updated_at)
        select instrument, null, start_time, timeframe, data_anchor_time, start_cursor_time, start_progress_time, progress_time, cursor_time, paper_trading_json, updated_at
        from free_replay_sessions_old;
      drop table free_replay_sessions_old;
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
        `insert into free_replay_sessions (instrument, candle_source, start_time, timeframe, data_anchor_time, start_cursor_time, start_progress_time, progress_time, cursor_time, paper_trading_json, updated_at)
         values (@instrument, @candleSource, @startTime, @timeframe, @dataAnchorTime, @startCursorTime, @startProgressTime, @progressTime, @cursorTime, @paperTradingJson, @updatedAt)
         on conflict(instrument, start_time) do update set
           candle_source = excluded.candle_source,
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
        candleSource: input.candleSource ?? null,
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
    // The venue is echoed back, so a caller that just saved a session can
    // read which venue it will replay against.
    return { ...input, candleSource: input.candleSource ?? undefined, updatedAt };
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
    candleSource: row.candle_source ?? undefined,
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

/** Whether the table already carries the column. */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
