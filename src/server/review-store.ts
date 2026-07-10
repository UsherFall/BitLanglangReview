import Database from 'better-sqlite3';
import type { TradeReview } from '../domain/review';

type SaveReviewInput = {
  tradeId: string;
  tags: string[];
  note: string;
  starred?: boolean;
};

type ReviewRow = {
  trade_id: string;
  tags_json: string;
  note: string;
  starred: number;
  updated_at: string;
};

export class ReviewStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists trade_reviews (
        trade_id text primary key,
        tags_json text not null,
        note text not null,
        starred integer not null default 0,
        updated_at text not null
      );
    `);
    try {
      this.db.exec('alter table trade_reviews add column starred integer not null default 0');
    } catch {
      // Column already exists.
    }
  }

  saveReview(input: SaveReviewInput): TradeReview {
    const review: TradeReview = {
      tradeId: input.tradeId,
      tags: uniqueCleanTags(input.tags),
      note: input.note,
      starred: input.starred ?? false,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `insert into trade_reviews (trade_id, tags_json, note, starred, updated_at)
         values (@tradeId, @tagsJson, @note, @starred, @updatedAt)
         on conflict(trade_id) do update set
           tags_json = excluded.tags_json,
           note = excluded.note,
           starred = excluded.starred,
           updated_at = excluded.updated_at`,
      )
      .run({
        tradeId: review.tradeId,
        tagsJson: JSON.stringify(review.tags),
        note: review.note,
        starred: review.starred ? 1 : 0,
        updatedAt: review.updatedAt,
      });

    return review;
  }

  getReview(tradeId: string): TradeReview | null {
    const row = this.db.prepare('select * from trade_reviews where trade_id = ?').get(tradeId) as ReviewRow | undefined;
    return row ? toReview(row) : null;
  }

  listReviews(): TradeReview[] {
    const rows = this.db.prepare('select * from trade_reviews order by updated_at desc').all() as ReviewRow[];
    return rows.map(toReview);
  }

  close(): void {
    this.db.close();
  }
}

function toReview(row: ReviewRow): TradeReview {
  return {
    tradeId: row.trade_id,
    tags: JSON.parse(row.tags_json) as string[],
    note: row.note,
    starred: row.starred === 1,
    updatedAt: row.updated_at,
  };
}

function uniqueCleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
