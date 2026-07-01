// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewedTrade } from '../src/domain/review-queue';
import { ReviewEditor } from '../src/ui/ReviewEditor';

describe('ReviewEditor', () => {
  it('keeps tag and note drafts local, resets them when the selected trade changes, and saves the current drafts', async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tradeId: 't2', tags: ['breakout', 'late'], note: 'wait for close' })));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<ReviewEditor trade={makeTrade({ id: 't1', tags: ['old'], note: 'first note' })} onSaved={onSaved} />);

    const tags = screen.getByLabelText('标签');
    const note = screen.getByLabelText('备注');
    expect(tags).toHaveValue('old');
    expect(note).toHaveValue('first note');

    fireEvent.change(tags, { target: { value: 'breakout, late' } });
    fireEvent.change(note, { target: { value: 'wait for close' } });

    rerender(<ReviewEditor trade={makeTrade({ id: 't2', tags: ['fresh'], note: 'second note' })} onSaved={onSaved} />);
    expect(screen.getByLabelText('标签')).toHaveValue('fresh');
    expect(screen.getByLabelText('备注')).toHaveValue('second note');

    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'breakout, late' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: 'wait for close' } });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ tradeId: 't2', tags: ['breakout', 'late'], note: 'wait for close' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tradeId: 't2', tags: ['breakout', 'late'], note: 'wait for close' }),
    }));
  });
});

function makeTrade(input: { id: string; tags: string[]; note: string }): ReviewedTrade {
  return {
    id: input.id,
    sequence: 1,
    instrument: 'ETH-USDT-SWAP',
    direction: '多',
    entryTime: '2024-05-21T01:17:00.000+08:00',
    exitTime: '2024-05-21T02:17:00.000+08:00',
    entryPrice: 1,
    exitPrice: 2,
    profit: 1,
    leverage: 1,
    margin: 1,
    returnRate: 0.1,
    turnover: 1,
    size: 1,
    maxPositionValue: 1,
    fee: 0,
    holdingMinutes: 60,
    amplitude: null,
    sourceNote: '',
    review: { tradeId: input.id, tags: input.tags, note: input.note, updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}
