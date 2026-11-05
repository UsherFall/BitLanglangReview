import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { paperSessionReviewPrefix } from '../src/domain/paper-round';
import { FreeReplaySessionStore, type SaveFreeReplaySessionInput } from '../src/server/free-replay-session-store';
import { ReviewStore } from '../src/server/review-store';

const INSTRUMENT = 'BTCUSDT';
const START_TIME = '2024-05-21 10:07';
const OTHER_START = '2024-05-21 10:0';
const round = (instrument: string, startTime: string, positionId: string) => `paper:${instrument}:${startTime}:${positionId}`;

function sessionInput(instrument = INSTRUMENT, startTime = START_TIME): SaveFreeReplaySessionInput {
  return {
    instrument,
    startTime,
    dataAnchorTime: startTime,
    startCursorTime: 1716267600,
    startProgressTime: 1716268800,
    progressTime: 1716269400,
    cursorTime: 1716268800,
    timeframe: '5m',
    paperTrading: { active: false, trades: [] },
  };
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-session-cascade-'));
  const filename = path.join(directory, 'review.sqlite');
  const reviewStore = new ReviewStore(filename);
  const sessionStore = new FreeReplaySessionStore(filename);
  sessionStore.saveSession(sessionInput());
  sessionStore.saveSession(sessionInput(INSTRUMENT, OTHER_START));
  reviewStore.saveReview({ tradeId: round(INSTRUMENT, START_TIME, 'position-1'), tags: ['目标一'], note: '' });
  reviewStore.saveReview({ tradeId: round(INSTRUMENT, START_TIME, 'position-2'), tags: ['目标二'], note: '' });
  reviewStore.saveReview({ tradeId: round(INSTRUMENT, OTHER_START, 'position-3'), tags: ['邻居'], note: '' });
  reviewStore.saveReview({ tradeId: 'bg-ordinary-trade', tags: ['普通'], note: '' });
  return {
    filename,
    reviewStore,
    sessionStore,
    close() {
      sessionStore.close();
      reviewStore.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

let currentFixture: ReturnType<typeof fixture> | undefined;

afterEach(() => {
  currentFixture?.close();
  currentFixture = undefined;
});

describe('FreeReplaySessionStore.deleteSessionWithPaperReviews', () => {
  it('commits the session and exactly its Paper Round reviews in one result', () => {
    currentFixture = fixture();

    const result = currentFixture.sessionStore.deleteSessionWithPaperReviews(
      INSTRUMENT,
      START_TIME,
      paperSessionReviewPrefix(INSTRUMENT, START_TIME),
    );

    expect(result).toEqual({ deletedReviews: 2 });
    expect(currentFixture.sessionStore.listSessions().map((session) => session.startTime)).toEqual([OTHER_START]);
    expect(currentFixture.reviewStore.getReview(round(INSTRUMENT, START_TIME, 'position-1'))).toBeNull();
    expect(currentFixture.reviewStore.getReview(round(INSTRUMENT, START_TIME, 'position-2'))).toBeNull();
    expect(currentFixture.reviewStore.getReview(round(INSTRUMENT, OTHER_START, 'position-3'))).not.toBeNull();
    expect(currentFixture.reviewStore.getReview('bg-ordinary-trade')).not.toBeNull();
  });

  it('rolls back the session deletion when Paper Review deletion fails', () => {
    currentFixture = fixture();
    const db = new Database(currentFixture.filename);
    db.exec(`
      create trigger force_paper_review_delete_failure
      before delete on trade_reviews
      begin
        select raise(abort, 'forced review delete failure');
      end;
    `);
    db.close();

    expect(() => currentFixture!.sessionStore.deleteSessionWithPaperReviews(
      INSTRUMENT,
      START_TIME,
      paperSessionReviewPrefix(INSTRUMENT, START_TIME),
    )).toThrow('forced review delete failure');

    expect(currentFixture.sessionStore.listSessions().map((session) => session.startTime).sort()).toEqual([START_TIME, OTHER_START].sort());
    expect(currentFixture.reviewStore.getReview(round(INSTRUMENT, START_TIME, 'position-1'))).not.toBeNull();
    expect(currentFixture.reviewStore.getReview(round(INSTRUMENT, START_TIME, 'position-2'))).not.toBeNull();
    expect(currentFixture.reviewStore.getReview(round(INSTRUMENT, OTHER_START, 'position-3'))).not.toBeNull();
    expect(currentFixture.reviewStore.getReview('bg-ordinary-trade')).not.toBeNull();
  });
});
