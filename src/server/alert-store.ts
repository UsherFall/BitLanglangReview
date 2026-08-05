import Database from 'better-sqlite3';
import type { AlertDirection, AlertStatus, PriceAlert } from '../domain/price-alert';

export type SaveAlertInput = {
  instrument: string;
  direction: AlertDirection;
  targetPrice: number;
};

type AlertRow = {
  id: number;
  instrument: string;
  direction: string;
  target_price: number;
  status: string;
  created_at: string;
  triggered_at: string | null;
};

export class AlertStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists price_alerts (
        id           integer primary key autoincrement,
        instrument   text    not null,
        direction    text    not null,
        target_price real    not null,
        status       text    not null default 'active',
        created_at   text    not null,
        triggered_at text
      );
    `);
  }

  listAlerts(): PriceAlert[] {
    const rows = this.db.prepare('select * from price_alerts order by id desc').all() as AlertRow[];
    return rows.map(toAlert);
  }

  listActiveAlerts(): PriceAlert[] {
    const rows = this.db.prepare("select * from price_alerts where status = 'active'").all() as AlertRow[];
    return rows.map(toAlert);
  }

  saveAlert(input: SaveAlertInput): PriceAlert {
    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `insert into price_alerts (instrument, direction, target_price, status, created_at, triggered_at)
         values (@instrument, @direction, @targetPrice, 'active', @createdAt, null)`,
      )
      .run({ instrument: input.instrument, direction: input.direction, targetPrice: input.targetPrice, createdAt });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  deleteAlert(id: number): void {
    this.db.prepare('delete from price_alerts where id = ?').run(id);
  }

  markTriggered(id: number): void {
    this.db
      .prepare("update price_alerts set status = 'triggered', triggered_at = ? where id = ? and status = 'active'")
      .run(new Date().toISOString(), id);
  }

  reactivate(id: number): void {
    this.db.prepare("update price_alerts set status = 'active', triggered_at = null where id = ?").run(id);
  }

  getById(id: number): PriceAlert | null {
    const row = this.db.prepare('select * from price_alerts where id = ?').get(id) as AlertRow | undefined;
    return row ? toAlert(row) : null;
  }

  close(): void {
    this.db.close();
  }
}

function toAlert(row: AlertRow): PriceAlert {
  return {
    id: row.id,
    instrument: row.instrument,
    direction: row.direction as AlertDirection,
    targetPrice: row.target_price,
    status: row.status as AlertStatus,
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
  };
}
