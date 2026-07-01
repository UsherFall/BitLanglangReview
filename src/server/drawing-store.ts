import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { ChartDrawing, SaveChartDrawingInput } from '../domain/drawing';
import type { ReviewTimeframe } from '../domain/trade';

type DrawingRow = {
  id: string;
  trade_id: string;
  instrument: string;
  timeframe: ReviewTimeframe;
  kind: ChartDrawing['kind'];
  points_json: string;
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
        trade_id text not null,
        instrument text not null,
        timeframe text not null,
        kind text not null,
        points_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists idx_chart_drawings_instrument on chart_drawings (instrument);
    `);
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
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.db.prepare(
      `insert into chart_drawings (id, trade_id, instrument, timeframe, kind, points_json, created_at, updated_at)
       values (@id, @tradeId, @instrument, @timeframe, @kind, @pointsJson, @createdAt, @updatedAt)
       on conflict(id) do update set
         trade_id = excluded.trade_id,
         instrument = excluded.instrument,
         timeframe = excluded.timeframe,
         kind = excluded.kind,
         points_json = excluded.points_json,
         updated_at = excluded.updated_at`,
    ).run({
      id: drawing.id,
      tradeId: drawing.tradeId,
      instrument: drawing.instrument,
      timeframe: drawing.timeframe,
      kind: drawing.kind,
      pointsJson: JSON.stringify(drawing.points),
      createdAt: drawing.createdAt,
      updatedAt: drawing.updatedAt,
    });

    return drawing;
  }

  listDrawings(input: { instrument: string }): ChartDrawing[] {
    const rows = this.db
      .prepare('select * from chart_drawings where instrument = @instrument order by created_at asc')
      .all(input) as DrawingRow[];
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
}

function toDrawing(row: DrawingRow): ChartDrawing {
  return {
    id: row.id,
    tradeId: row.trade_id,
    instrument: row.instrument,
    timeframe: row.timeframe,
    kind: row.kind,
    points: JSON.parse(row.points_json) as ChartDrawing['points'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
