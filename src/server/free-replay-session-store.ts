import Database from 'better-sqlite3';
import type { ReplayCandleSource } from '../domain/candlestick';
import type { FreeReplayReviewStatus, FreeReplaySession, FreeReplaySessionPayload } from '../domain/free-replay-session';
import { deleteReviewsByPrefix } from './review-store';

export type { FreeReplaySessionPayload } from '../domain/free-replay-session';

// The neutral domain owns the wire shape; paper_trading_json remains opaque
// serialized JSON at the storage boundary, mirroring drawing points_json.
export type SaveFreeReplaySessionInput = FreeReplaySessionPayload<unknown, string>;

type StoredFreeReplaySession = FreeReplaySession<unknown, string>;

type SessionRow = {
  instrument: string;
  candle_source: ReplayCandleSource | null;
  start_time: string;
  timeframe: string;
  data_anchor_time: string;
  start_cursor_time: number;
  start_progress_time: number;
  progress_time: number;
  cursor_time: number;
  paper_trading_json: string;
  review_status: string;
  updated_at: string;
};

/** 11/10 结束/恢复复盘：缺省/未知状态一律读作可操作态 `active`。 */
function normalizeReviewStatus(value: unknown): FreeReplayReviewStatus {
  return value === 'ended' ? 'ended' : 'active';
}

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
        review_status       text not null default 'active',
        updated_at          text not null,
        primary key (instrument, start_time)
      );
    `);
    this.allowCandleSourceColumn();
    this.allowReviewStatusColumn();
  }

  /**
   * Adds the `review_status` column (11/10 结束/恢复复盘).
   *
   * Unlike the candle-source rebuild above, a plain `alter table ... add
   * column ... not null default 'active'` is sufficient here: the column has a
   * default, existing rows backfill to `active` (the pre-11/10 behaviour),
   * and no data is rewritten.
   */
  private allowReviewStatusColumn(): void {
    if (columnExists(this.db, 'free_replay_sessions', 'review_status')) return;
    this.db.exec(`
      alter table free_replay_sessions
        add column review_status text not null default 'active';
    `);
  }

  /**
   * Adds the optional `candle_source` column (10/21).
   *
   * The migration copies the table rather than running `alter table ... add
   * column`, matching the pattern `drawing-store.ts` established: the rebuild
   * works on every SQLite build the app may run against. Existing rows keep
   * NULL, which reads as "the old behaviour" (Binance). The rebuilt schema
   * deliberately does NOT include `review_status` — `allowReviewStatusColumn`
   * adds it afterwards, so a pre-10/21 database goes through both migrations.
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

  listSessions(): StoredFreeReplaySession[] {
    const rows = this.db.prepare('select * from free_replay_sessions order by updated_at desc').all() as SessionRow[];
    return rows.map(toSessionPayload);
  }

  saveSession(input: SaveFreeReplaySessionInput): StoredFreeReplaySession {
    const updatedAt = new Date().toISOString();
    const reviewStatus = normalizeReviewStatus(input.reviewStatus);
    this.db
      .prepare(
        `insert into free_replay_sessions (instrument, candle_source, start_time, timeframe, data_anchor_time, start_cursor_time, start_progress_time, progress_time, cursor_time, paper_trading_json, review_status, updated_at)
         values (@instrument, @candleSource, @startTime, @timeframe, @dataAnchorTime, @startCursorTime, @startProgressTime, @progressTime, @cursorTime, @paperTradingJson, @reviewStatus, @updatedAt)
         on conflict(instrument, start_time) do update set
           candle_source = excluded.candle_source,
           timeframe = excluded.timeframe,
           data_anchor_time = excluded.data_anchor_time,
           start_cursor_time = excluded.start_cursor_time,
           start_progress_time = excluded.start_progress_time,
           progress_time = excluded.progress_time,
           cursor_time = excluded.cursor_time,
           paper_trading_json = excluded.paper_trading_json,
           review_status = excluded.review_status,
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
        reviewStatus,
        updatedAt,
      });
    // The venue is echoed back, so a caller that just saved a session can
    // read which venue it will replay against; the review status is echoed
    // normalized (an omitted/unknown status reads as `active`).
    return { ...input, reviewStatus, candleSource: input.candleSource ?? undefined, updatedAt };
  }

  deleteSession(instrument: string, startTime: string): void {
    this.db.prepare('delete from free_replay_sessions where instrument = ? and start_time = ?').run(instrument, startTime);
  }

  /**
   * Deletes a Session and its Paper Round annotations atomically. Both stores
   * normally own separate connections, so the cascade must run on THIS store's
   * connection rather than calling ReviewStore's public delete method.
   */
  deleteSessionWithPaperReviews(instrument: string, startTime: string, paperReviewPrefix: string): { deletedReviews: number } {
    const cascade = this.db.transaction((): { deletedReviews: number } => {
      this.db.prepare('delete from free_replay_sessions where instrument = ? and start_time = ?').run(instrument, startTime);
      const deletedReviews = deleteReviewsByPrefix(this.db, paperReviewPrefix);
      return { deletedReviews };
    });
    return cascade();
  }

  close(): void {
    this.db.close();
  }
}

function toSessionPayload(row: SessionRow): StoredFreeReplaySession {
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
    reviewStatus: normalizeReviewStatus(row.review_status),
    updatedAt: row.updated_at,
  };
}

/** Whether the table already carries the column. */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
