import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TradeReview } from '../domain/review';
import type { ReviewedTrade } from '../domain/review-queue';

export function ReviewEditor({ trade, onSaved }: { trade: ReviewedTrade; onSaved: (review: TradeReview) => void }) {
  const [draftTags, setDraftTags] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftTags(trade.review?.tags.join(', ') ?? '');
    setDraftNote(trade.review?.note ?? '');
  }, [trade.id]);

  async function saveReview() {
    setIsSaving(true);
    const review = (await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tradeId: trade.id,
        tags: draftTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        note: draftNote,
      }),
    }).then((response) => response.json())) as TradeReview;
    onSaved(review);
    setIsSaving(false);
  }

  return (
    <>
      <label>
        标签
        <input aria-label="标签" value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder="用逗号分隔" />
      </label>
      <label>
        备注
        <textarea aria-label="备注" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} />
      </label>
      <button className="save-button" onClick={saveReview} disabled={isSaving}>
        <Save size={17} />
        {isSaving ? '保存中' : '保存复盘'}
      </button>
    </>
  );
}
