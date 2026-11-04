// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradeReview } from '../src/domain/review';
import { PaperRoundReviewEditor } from '../src/ui/PaperRoundReviewEditor';

const REVIEW_ID = 'paper:BTCUSDT:2024-05-21 10:07:position-1';

function savedReview(overrides: Partial<TradeReview> = {}): TradeReview {
  return {
    tradeId: REVIEW_ID,
    tags: ['假突破'],
    note: '已保存的笔记',
    starred: false,
    updatedAt: '2024-05-21T02:07:00.000Z',
    ...overrides,
  };
}

function okPayload(review: TradeReview) {
  return { review, tags: review.tags, tagCounts: { [review.tags[0] ?? '假突破']: 1 } };
}

describe('PaperRoundReviewEditor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('star toggle saves the SAVED tags/note, never the unsaved drafts', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(okPayload({ ...savedReview(), tags: body.tags, note: body.note, starred: body.starred })), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();

    render(<PaperRoundReviewEditor reviewId={REVIEW_ID} review={savedReview()} onSaved={onSaved} />);

    // Draft edits that stay UNSAVED: a new note text and an extra tag token.
    fireEvent.change(screen.getByLabelText('模拟单备注'), { target: { value: '还没点保存的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      tradeId: REVIEW_ID,
      starred: true,
      module: 'paper',
      tags: ['假突破'],
      note: '已保存的笔记',
    });
  });

  it('rolls the star back when the save fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    render(<PaperRoundReviewEditor reviewId={REVIEW_ID} review={savedReview()} onSaved={vi.fn()} />);

    const star = screen.getByRole('button', { name: '收藏' });
    fireEvent.click(star);
    // Optimistic flip lands first…
    await waitFor(() => expect(screen.getByRole('button', { name: '取消收藏' })).toBeInTheDocument());
    // …then the failed save rolls it back and reports the failure.
    await waitFor(() => expect(screen.getByRole('button', { name: '收藏' })).toBeInTheDocument());
    expect(screen.getByText('保存失败，请重试')).toBeInTheDocument();
  });

  it('keeps tags/note behind the explicit save button', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(okPayload({ ...savedReview(), tags: body.tags, note: body.note, starred: body.starred })), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();

    render(<PaperRoundReviewEditor reviewId={REVIEW_ID} review={savedReview()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('模拟单备注'), { target: { value: '新笔记' } });
    fireEvent.click(screen.getByRole('button', { name: '保存批注' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ note: '新笔记', starred: false, tags: ['假突破'] });
  });
});
