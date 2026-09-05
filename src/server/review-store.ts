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

  /**
   * How many reviews carry each tag, keyed by tag name. Callers that already hold
   * the reviews (e.g. the trades route) pass them in to avoid a second query.
   */
  listTagCounts(reviews: readonly TradeReview[] = this.listReviews()): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const review of reviews) {
      for (const tag of review.tags) counts[tag] = (counts[tag] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Renames a tag across EVERY review that carries it and returns the number of
   * affected reviews. Tag names are shared globally (they live inside each
   * review's `tags_json`), so renaming only the trade being looked at would split
   * one tag into an old and a new name.
   *
   * Renaming onto a name that already exists merges the two: `uniqueCleanTags`
   * dedupes, so a review that carried both ends up with only `to`.
   */
  renameTag(from: string, to: string): number {
    const source = from.trim();
    const target = to.trim();
    if (!source || !target) throw new Error('Both the current and the new tag name are required');
    return this.mapTags((tags) => tags.map((tag) => (tag === source ? target : tag)));
  }

  /** Removes a tag from every review that carries it; returns the affected count. */
  deleteTag(tag: string): number {
    const target = tag.trim();
    if (!target) throw new Error('A tag name is required');
    return this.mapTags((tags) => tags.filter((item) => item !== target));
  }

  /**
   * Rewrites every review's tags through `map`, inside one transaction, and
   * returns how many reviews actually changed. Reuses `saveReview` so trimming,
   * dedupe, and `updated_at` handling stay in one place — note this bumps
   * `updated_at` on affected rows, which is intended because their tags did change.
   */
  private mapTags(map: (tags: string[]) => string[]): number {
    const apply = this.db.transaction((): number => {
      let affected = 0;
      for (const review of this.listReviews()) {
        const tags = uniqueCleanTags(map(review.tags));
        if (sameTags(tags, review.tags)) continue;
        this.saveReview({ tradeId: review.tradeId, tags, note: review.note, starred: review.starred });
        affected += 1;
      }
      return affected;
    });
    return apply();
  }

  close(): void {
    this.db.close();
  }
}

/** Positional comparison; `map` above preserves order, so this is enough to skip no-op rows. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
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
