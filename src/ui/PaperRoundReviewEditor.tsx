import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TradeReview } from '../domain/review';
import { TagsCombobox, type TagMutation } from './ReviewEditor';

/** `/api/reviews` answer for a paper round save (module='paper'). */
export type PaperReviewSavedPayload = {
  review: TradeReview;
  tags: string[];
  tagCounts: Record<string, number>;
};

/**
 * Inline annotation editor for ONE Paper Round (11/04).
 *
 * Reachable from two places — the in-replay 单子 list and the 复盘库 — and BOTH
 * write the same `trade_reviews` row (`paper:{instrument}:{startTime}:{positionId}`).
 * Because the annotation belongs to the ROUND, every fill row of a round renders
 * this same editor state: annotating one partial close annotates them all.
 *
 * Saves go through the existing `/api/reviews` route with `module: 'paper'`, so
 * tag counts come back scoped to the paper module (「共名、分计数」).
 */
export function PaperRoundReviewEditor({
  reviewId,
  review,
  availableTags = [],
  tagCounts = {},
  onMutateTag,
  onSaved,
}: {
  reviewId: string;
  review?: TradeReview;
  availableTags?: string[];
  tagCounts?: Record<string, number>;
  onMutateTag?: (mutation: TagMutation) => Promise<void>;
  onSaved: (payload: PaperReviewSavedPayload) => void;
}) {
  const [draftTags, setDraftTags] = useState<string[]>(() => review?.tags ?? []);
  const [draftTagInput, setDraftTagInput] = useState('');
  const [draftNote, setDraftNote] = useState(() => review?.note ?? '');
  const [starred, setStarred] = useState(() => review?.starred ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Another round's editor keeps its own draft; switching rounds resets it.
  useEffect(() => {
    setDraftTags(review?.tags ?? []);
    setDraftTagInput('');
    setDraftNote(review?.note ?? '');
    setStarred(review?.starred ?? false);
    setStatus('');
  }, [reviewId]);

  async function persist(next: { tags: string[]; note: string; starred: boolean }): Promise<boolean> {
    setIsSaving(true);
    setStatus('');
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tradeId: reviewId, ...next, module: 'paper' }),
      });
      if (!response.ok) throw new Error('保存失败');
      const payload = (await response.json()) as PaperReviewSavedPayload;
      setDraftTags(payload.review.tags);
      setDraftTagInput('');
      setStarred(payload.review.starred);
      onSaved(payload);
      return true;
    } catch {
      setStatus('保存失败，请重试');
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function saveReview() {
    void persist({ tags: cleanTags([...draftTags, draftTagInput]), note: draftNote, starred });
  }

  /**
   * Star toggling is one click: it saves immediately with the round's SAVED
   * tags/note — never the drafts, which keep the explicit 保存 button — and
   * rolls the star back when the request fails.
   */
  function toggleStarred() {
    const next = !starred;
    setStarred(next);
    void persist({ tags: review?.tags ?? [], note: review?.note ?? '', starred: next })
      .then((ok) => { if (!ok) setStarred(!next); });
  }

  return (
    <div className="paper-round-editor" aria-label={`批注 ${reviewId}`}>
      <div className="review-field">
        <span>标签</span>
        <TagsCombobox
          availableTags={availableTags}
          tagCounts={tagCounts}
          selectedTags={draftTags}
          inputValue={draftTagInput}
          onInputChange={setDraftTagInput}
          onChange={setDraftTags}
          onMutateTag={onMutateTag}
        />
      </div>
      <label>
        备注
        <textarea aria-label="模拟单备注" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} />
      </label>
      <div className="paper-round-editor-actions">
        <button
          type="button"
          className={`star-toggle ${starred ? 'active' : ''}`}
          aria-label={starred ? '取消收藏' : '收藏'}
          title={starred ? '取消收藏' : '收藏'}
          onClick={toggleStarred}
          disabled={isSaving}
        >
          <Star size={16} fill={starred ? 'currentColor' : 'none'} />
        </button>
        <button className="save-button" onClick={saveReview} disabled={isSaving}>{isSaving ? '保存中' : '保存批注'}</button>
        {status && <span className="paper-round-editor-status">{status}</span>}
      </div>
    </div>
  );
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
