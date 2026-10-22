import Database from 'better-sqlite3';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';

export class CandlestickStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists candles (
        instrument text not null,
        timeframe text not null,
        timestamp integer not null,
        open real not null,
        high real not null,
        low real not null,
        close real not null,
        volume real not null,
        primary key (instrument, timeframe, timestamp)
      );

      create table if not exists candle_meta (
        key text primary key,
        value text not null
      );
    `);
  }

  listBefore(input: { instrument: string; timeframe: ReviewTimeframe; before: number; limit: number }): Candlestick[] {
    const rows = this.db
      .prepare(
        `select * from candles
         where instrument = @instrument and timeframe = @timeframe and timestamp < @before
         order by timestamp desc
         limit @limit`,
      )
      .all(input) as Omit<Candlestick, 'timeframe'>[] & { timeframe: ReviewTimeframe }[];

    return rows.reverse().map((row) => ({ ...row, timeframe: input.timeframe }));
  }

  listAfter(input: { instrument: string; timeframe: ReviewTimeframe; after: number; limit: number }): Candlestick[] {
    const rows = this.db
      .prepare(
        `select * from candles
         where instrument = @instrument and timeframe = @timeframe and timestamp > @after
         order by timestamp asc
         limit @limit`,
      )
      .all(input) as Omit<Candlestick, 'timeframe'>[] & { timeframe: ReviewTimeframe }[];

    return rows.map((row) => ({ ...row, timeframe: input.timeframe }));
  }

  save(candles: Candlestick[]): void {
    const statement = this.db.prepare(
      `insert into candles (instrument, timeframe, timestamp, open, high, low, close, volume)
       values (@instrument, @timeframe, @timestamp, @open, @high, @low, @close, @volume)
       on conflict(instrument, timeframe, timestamp) do update set
         open = excluded.open,
         high = excluded.high,
         low = excluded.low,
         close = excluded.close,
         volume = excluded.volume`,
    );
    const transaction = this.db.transaction((items: Candlestick[]) => {
      for (const candle of items) statement.run(candle);
    });
    transaction(candles);
  }

  /**
   * Deletes every candle row whose `instrument` starts with `prefix` and
   * returns how many were removed. Used by one-time migrations that have to
   * clear a source's namespace without touching the rows of other sources —
   * e.g. purging `bitget:` rows frozen half-formed by the pre-10/22 `later`
   * fetch (they are indistinguishable from closed rows once written, so the
   * only guaranteed cleanup is deleting the whole namespace). The prefix is a
   * caller constant; `LIKE` special characters in it are not escaped.
   */
  deleteByInstrumentPrefix(prefix: string): number {
    return this.db.prepare('delete from candles where instrument like ?').run(`${prefix}%`).changes;
  }

  /** One-time-migration marker: absent means the migration has not run yet. */
  getMeta(key: string): string | null {
    const row = this.db.prepare('select value from candle_meta where key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('insert into candle_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
