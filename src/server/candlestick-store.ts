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

  close(): void {
    this.db.close();
  }
}
