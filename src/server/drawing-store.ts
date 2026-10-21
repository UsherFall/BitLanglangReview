import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { ChartDrawing, SaveChartDrawingInput } from '../domain/drawing';
import type { ReviewTimeframe } from '../domain/trade';

type DrawingRow = {
  id: string;
  trade_id: string | null;
  instrument: string;
  timeframe: ReviewTimeframe;
  kind: ChartDrawing['kind'];
  points_json: string;
  ref_price: number | null;
  ref_time: number | null;
  created_at: string;
  updated_at: string;
};

export class DrawingStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists chart_drawings (
        id text primary key,
        trade_id text,
        instrument text not null,
        timeframe text not null,
        kind text not null,
        points_json text not null,
        ref_price real,
        ref_time integer,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists idx_chart_drawings_instrument on chart_drawings (instrument);
    `);
    this.allowNullableTradeId();
    this.allowReferenceColumns();
  }

  saveDrawing(input: SaveChartDrawingInput): ChartDrawing {
    const existing = input.id ? this.getDrawing(input.id) : null;
    const now = new Date().toISOString();
    const drawing: ChartDrawing = {
      id: input.id ?? randomUUID(),
      tradeId: input.tradeId,
      instrument: input.instrument,
      timeframe: input.timeframe,
      kind: input.kind,
      points: input.points,
      refPrice: input.refPrice,
      refTime: input.refTime,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.db.prepare(
      `insert into chart_drawings (id, trade_id, instrument, timeframe, kind, points_json, ref_price, ref_time, created_at, updated_at)
       values (@id, @tradeId, @instrument, @timeframe, @kind, @pointsJson, @refPrice, @refTime, @createdAt, @updatedAt)
       on conflict(id) do update set
         trade_id = excluded.trade_id,
         instrument = excluded.instrument,
         timeframe = excluded.timeframe,
         kind = excluded.kind,
         points_json = excluded.points_json,
         ref_price = excluded.ref_price,
         ref_time = excluded.ref_time,
         updated_at = excluded.updated_at`,
    ).run({
      id: drawing.id,
      tradeId: drawing.tradeId,
      instrument: drawing.instrument,
      timeframe: drawing.timeframe,
      kind: drawing.kind,
      pointsJson: JSON.stringify(drawing.points),
      refPrice: drawing.refPrice ?? null,
      refTime: drawing.refTime ?? null,
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
    });

    return drawing;
  }

  listDrawings(input: { instrument: string; timeframe?: string }): ChartDrawing[] {
    const rows = input.timeframe
      ? (this.db
          .prepare('select * from chart_drawings where instrument = @instrument and timeframe = @timeframe order by created_at asc')
          .all({ instrument: input.instrument, timeframe: input.timeframe }) as DrawingRow[])
      : (this.db
          .prepare('select * from chart_drawings where instrument = @instrument order by created_at asc')
          .all({ instrument: input.instrument }) as DrawingRow[]);
    return rows.map(toDrawing);
  }

  /**
   * All drawings of one timeframe, across every instrument.
   *
   * The 选品 scan needs this: it measures "how far is the price from the line the
   * user drew" for a whole pool at once, so it must know which instruments have
   * lines before it fetches their candles. `timeframe` is part of the filter
   * because each level is measured with its OWN volatility scale.
   */
  listDrawingsByTimeframe(timeframe: ReviewTimeframe): ChartDrawing[] {
    const rows = this.db
      .prepare('select * from chart_drawings where timeframe = @timeframe order by created_at asc')
      .all({ timeframe }) as DrawingRow[];
    return rows.map(toDrawing);
  }

  deleteDrawing(id: string): void {
    this.db.prepare('delete from chart_drawings where id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }

  private getDrawing(id: string): ChartDrawing | null {
    const row = this.db.prepare('select * from chart_drawings where id = ?').get(id) as DrawingRow | undefined;
    return row ? toDrawing(row) : null;
  }

  private allowNullableTradeId(): void {
    if (columnAllowsNull(this.db, 'chart_drawings', 'trade_id')) return;
    this.db.exec(`
      alter table chart_drawings rename to chart_drawings_old;
      create table chart_drawings (
        id text primary key,
        trade_id text,
        instrument text not null,
        timeframe text not null,
        kind text not null,
        points_json text not null,
        created_at text not null,
        updated_at text not null
      );
      insert into chart_drawings (id, trade_id, instrument, timeframe, kind, points_json, created_at, updated_at)
        select id, trade_id, instrument, timeframe, kind, points_json, created_at, updated_at
        from chart_drawings_old;
      drop table chart_drawings_old;
      create index if not exists idx_chart_drawings_instrument on chart_drawings (instrument);
    `);
  }
  /**
   * Adds the optional reference columns (10/21) — the price basis a level was
   * drawn in (`ref_price` / `ref_time`). Old rows keep NULL, which the 距线
   * path reads as "no reference" and measures unscaled.
   *
   * The migration copies the table instead of `alter table ... add column`
   * because `alter table add column` is not supported by every SQLite build
   * the app may run against, and the existing `allowNullableTradeId` already
   * established the rebuild pattern in this file.
   */
  private allowReferenceColumns(): void {
    if (columnExists(this.db, 'chart_drawings', 'ref_price')) return;
    this.db.exec(`
      alter table chart_drawings rename to chart_drawings_old;
      create table chart_drawings (
        id text primary key,
        trade_id text,
        instrument text not null,
        timeframe text not null,
        kind text not null,
        points_json text not null,
        ref_price real,
        ref_time integer,
        created_at text not null,
        updated_at text not null
      );
      insert into chart_drawings (id, trade_id, instrument, timeframe, kind, points_json, ref_price, ref_time, created_at, updated_at)
        select id, trade_id, instrument, timeframe, kind, points_json, null, null, created_at, updated_at
        from chart_drawings_old;
      drop table chart_drawings_old;
      create index if not exists idx_chart_drawings_instrument on chart_drawings (instrument);
    `);
  }
}

function columnAllowsNull(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string; notnull: number }>;
  return rows.find((row) => row.name === column)?.notnull === 0;
}

/** Whether the table already carries the column. */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function toDrawing(row: DrawingRow): ChartDrawing {
  return {
    id: row.id,
    tradeId: row.trade_id,
    instrument: row.instrument,
    timeframe: row.timeframe,
    kind: row.kind,
    points: JSON.parse(row.points_json) as ChartDrawing['points'],
    refPrice: row.ref_price ?? undefined,
    refTime: row.ref_time ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
