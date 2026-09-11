import { Check, Pencil, Save, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import type { TradeReview } from '../domain/review';
import type { ReviewedTrade } from '../domain/review-queue';

/** A global tag edit: rename when `to` is a name, delete when `to` is null. */
export type TagMutation = { from: string; to: string | null };

/** The active review module, which scopes the tag list and per-tag counts. */
export type ReviewModule = 'trade' | 'bitget';

/**
 * `/api/reviews` answers with the saved review plus the module-scoped tag list
 * and counts, so the caller can patch `tagCounts` in place.
 */
export type SavedReviewPayload = {
  review: TradeReview;
  tags: string[];
  tagCounts: Record<string, number>;
};

export function ReviewEditor({
  trade,
  module,
  availableTags = [],
  tagCounts = {},
  onMutateTag,
  onSaved,
}: {
  trade: ReviewedTrade;
  module: ReviewModule;
  availableTags?: string[];
  tagCounts?: Record<string, number>;
  /** Renames/deletes a tag across every trade; rejects when the request fails. */
  onMutateTag?: (mutation: TagMutation) => Promise<void>;
  onSaved: (payload: SavedReviewPayload) => void;
}) {
  const [draftTags, setDraftTags] = useState<string[]>(() => trade.review?.tags ?? []);
  const [draftTagInput, setDraftTagInput] = useState('');
  const [draftNote, setDraftNote] = useState(() => trade.review?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftTags(trade.review?.tags ?? []);
    setDraftTagInput('');
    setDraftNote(trade.review?.note ?? '');
  }, [trade.id]);

  async function saveReview() {
    setIsSaving(true);
    const payload = (await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tradeId: trade.id,
        tags: cleanTags([...draftTags, draftTagInput]),
        note: draftNote,
        starred: trade.review?.starred ?? false,
        module,
      }),
    }).then((response) => response.json())) as SavedReviewPayload;
    setDraftTags(payload.review.tags);
    setDraftTagInput('');
    onSaved(payload);
    setIsSaving(false);
  }

  return (
    <>
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
  tagCounts,
  selectedTags,
  inputValue,
  onInputChange,
  onChange,
  onMutateTag,
}: {
  availableTags: string[];
  tagCounts: Record<string, number>;
  selectedTags: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onChange: (tags: string[]) => void;
  onMutateTag?: (mutation: TagMutation) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ tag: string; draft: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busyTag, setBusyTag] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ tag: string; message: string } | null>(null);

  const normalizedInput = inputValue.trim().toLowerCase();
  const uniqueTags = [...new Set(availableTags.map((tag) => tag.trim()).filter(Boolean))].sort();
  // Every saved tag is listed, including ones already on this trade: renaming must
  // be reachable for the tag the reviewer is looking at, and clicking a selected
  // one just takes it off this trade.
  const filteredTags = normalizedInput
    ? uniqueTags.filter((tag) => tag.toLowerCase().includes(normalizedInput))
    : uniqueTags;
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

  async function runMutation(tag: string, { from, to }: TagMutation) {
    if (!onMutateTag) return;
    setBusyTag(tag);
    setFailed(null);
    try {
      await onMutateTag({ from, to });
      // Keep the draft in step, otherwise saving writes the old name straight back
      // and silently resurrects the tag that was just renamed/deleted.
      onChange(
        to === null
          ? selectedTags.filter((item) => item !== from)
          : [...new Set(selectedTags.map((item) => (item === from ? to : item)))],
      );
      setRenaming(null);
      setConfirmingDelete(null);
    } catch (error) {
      setFailed({ tag, message: error instanceof Error ? error.message : '操作失败，请重试' });
    } finally {
      setBusyTag(null);
    }
  }

  function submitRename(tag: string) {
    const to = (renaming?.tag === tag ? renaming.draft : '').trim();
    if (!to || to === tag) {
      setRenaming(null);
      return;
    }
    void runMutation(tag, { from: tag, to });
  }

  return (
    <div className="tags-combobox" onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      commitInput();
      setRenaming(null);
      setConfirmingDelete(null);
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
          {filteredTags.map((tag) => {
            const count = tagCounts[tag] ?? 0;
            const isSelected = selectedTags.includes(tag);
            const isBusy = busyTag === tag;
            const keepOpen = (event: { preventDefault: () => void }) => event.preventDefault();

            if (renaming?.tag === tag) {
              return (
                <div className="tag-option-row tag-option-editing" key={tag}>
                  <input
                    aria-label={`重命名标签 ${tag}`}
                    autoFocus
                    value={renaming.draft}
                    disabled={isBusy}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRenaming({ tag, draft: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submitRename(tag);
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setRenaming(null);
                      }
                    }}
                  />
                  <button type="button" aria-label={`保存标签名 ${tag}`} disabled={isBusy || !renaming.draft.trim()} onMouseDown={keepOpen} onClick={() => submitRename(tag)}>
                    <Check size={14} />
                  </button>
                  <button type="button" aria-label="取消重命名" onMouseDown={keepOpen} onClick={() => setRenaming(null)}>
                    <X size={14} />
                  </button>
                </div>
              );
            }

            if (confirmingDelete === tag) {
              return (
                <div className="tag-option-row tag-option-confirm" key={tag}>
                  <span>删除「{tag}」？影响 {count} 笔</span>
                  <button type="button" className="tag-option-danger" aria-label={`确认删除标签 ${tag}`} disabled={isBusy} onMouseDown={keepOpen} onClick={() => void runMutation(tag, { from: tag, to: null })}>
                    删除
                  </button>
                  <button type="button" aria-label="取消删除" onMouseDown={keepOpen} onClick={() => setConfirmingDelete(null)}>
                    取消
                  </button>
                </div>
              );
            }

            return (
              <Fragment key={tag}>
                <div className="tag-option-row">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className="tag-option-main"
                    onMouseDown={keepOpen}
                    onClick={() => (isSelected ? removeTag(tag) : addTag(tag))}
                  >
                    <span>{tag}{isSelected ? ' · 已添加' : ''}</span>
                    {/* Hidden from assistive tech so the option's accessible name stays the tag name. */}
                    <span className="tag-option-count" aria-hidden="true">{count} 笔</span>
                  </button>
                  <button
                    type="button"
                    className="tag-option-action"
                    aria-label={`重命名标签 ${tag}`}
                    disabled={isBusy}
                    onMouseDown={keepOpen}
                    onClick={() => { setConfirmingDelete(null); setRenaming({ tag, draft: tag }); }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="tag-option-action"
                    aria-label={`删除标签 ${tag}`}
                    disabled={isBusy}
                    onMouseDown={keepOpen}
                    onClick={() => { setRenaming(null); setConfirmingDelete(tag); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {failed?.tag === tag ? <div className="tag-option-error">{failed.message}</div> : null}
              </Fragment>
            );
          })}
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
