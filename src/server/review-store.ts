import Database from 'better-sqlite3';
import type { TradeReview } from '../domain/review';

type SaveReviewInput = {
  tradeId: string;
  tags: string[];
  note: string;
};

type ReviewRow = {
  trade_id: string;
  tags_json: string;
  note: string;
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
        updated_at text not null
      );
    `);
  }

  saveReview(input: SaveReviewInput): TradeReview {
    const review: TradeReview = {
      tradeId: input.tradeId,
      tags: uniqueCleanTags(input.tags),
      note: input.note,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `insert into trade_reviews (trade_id, tags_json, note, updated_at)
         values (@tradeId, @tagsJson, @note, @updatedAt)
         on conflict(trade_id) do update set
           tags_json = excluded.tags_json,
           note = excluded.note,
           updated_at = excluded.updated_at`,
      )
      .run({
        tradeId: review.tradeId,
        tagsJson: JSON.stringify(review.tags),
        note: review.note,
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
    updatedAt: row.updated_at,
  };
}

function uniqueCleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
