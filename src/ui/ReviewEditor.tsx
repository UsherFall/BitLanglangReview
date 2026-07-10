import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TradeReview } from '../domain/review';
import type { ReviewedTrade } from '../domain/review-queue';

export function ReviewEditor({ trade, availableTags = [], onSaved }: { trade: ReviewedTrade; availableTags?: string[]; onSaved: (review: TradeReview) => void }) {
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftTagInput, setDraftTagInput] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftTags(trade.review?.tags ?? []);
    setDraftTagInput('');
    setDraftNote(trade.review?.note ?? '');
  }, [trade.id]);

  async function saveReview() {
    setIsSaving(true);
    const review = (await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tradeId: trade.id,
        tags: cleanTags([...draftTags, draftTagInput]),
        note: draftNote,
        starred: trade.review?.starred ?? false,
      }),
    }).then((response) => response.json())) as TradeReview;
    setDraftTags(review.tags);
    setDraftTagInput('');
    onSaved(review);
    setIsSaving(false);
  }

  return (
    <>
      <div className="review-field">
        <span>标签</span>
        <TagsCombobox availableTags={availableTags} selectedTags={draftTags} inputValue={draftTagInput} onInputChange={setDraftTagInput} onChange={setDraftTags} />
      </div>
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

function TagsCombobox({
  availableTags,
  selectedTags,
  inputValue,
  onInputChange,
  onChange,
}: {
  availableTags: string[];
  selectedTags: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onChange: (tags: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const normalizedInput = inputValue.trim().toLowerCase();
  const uniqueTags = [...new Set(availableTags.map((tag) => tag.trim()).filter(Boolean))].sort();
  const selectableTags = uniqueTags.filter((tag) => !selectedTags.includes(tag));
  const filteredTags = normalizedInput
    ? selectableTags.filter((tag) => tag.toLowerCase().includes(normalizedInput))
    : selectableTags;
  const canCreate = inputValue.trim() && !selectedTags.includes(inputValue.trim()) && !uniqueTags.includes(inputValue.trim());

  function addTag(tag: string) {
    const clean = tag.trim();
    if (!clean || selectedTags.includes(clean)) return;
    onChange([...selectedTags, clean]);
    onInputChange('');
    setIsOpen(true);
  }

  function removeTag(tag: string) {
    onChange(selectedTags.filter((item) => item !== tag));
  }

  function commitInput() {
    if (inputValue.trim()) addTag(inputValue);
  }

  return (
    <div className="tags-combobox" onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      commitInput();
      setIsOpen(false);
    }}>
      <div className="tag-chip-list">
        {selectedTags.map((tag) => (
          <button key={tag} type="button" className="tag-chip" onClick={() => removeTag(tag)} aria-label={`移除标签 ${tag}`}>
            {tag}<span aria-hidden="true">x</span>
          </button>
        ))}
        <input
          aria-label="标签"
          value={inputValue}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => { onInputChange(event.target.value); setIsOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitInput();
            }
            if (event.key === 'Backspace' && !inputValue && selectedTags.length) {
              removeTag(selectedTags[selectedTags.length - 1]);
            }
          }}
          placeholder={selectedTags.length ? '' : '选择或输入标签'}
        />
      </div>
      {isOpen && (filteredTags.length > 0 || canCreate) ? (
        <div className="tag-options" role="listbox">
          {filteredTags.map((tag) => (
            <button key={tag} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => addTag(tag)}>
              {tag}
            </button>
          ))}
          {canCreate ? (
            <button type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => addTag(inputValue)}>
              创建 "{inputValue.trim()}"
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
