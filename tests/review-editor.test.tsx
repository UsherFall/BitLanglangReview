// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewedTrade } from '../src/domain/review-queue';
import { ReviewEditor } from '../src/ui/ReviewEditor';

describe('ReviewEditor', () => {
  it('keeps tag and note drafts local, resets them when the selected trade changes, and saves the current drafts', async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tradeId: 't2', tags: ['breakout', 'late'], note: 'wait for close', starred: true })));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<ReviewEditor trade={makeTrade({ id: 't1', tags: ['old'], note: 'first note', starred: true })} availableTags={['breakout', 'late']} onSaved={onSaved} />);

    const tags = screen.getByLabelText('标签');
    const note = screen.getByLabelText('备注');
    expect(screen.getByRole('button', { name: '移除标签 old' })).toBeInTheDocument();
    expect(note).toHaveValue('first note');

    fireEvent.click(screen.getByRole('button', { name: '移除标签 old' }));
    fireEvent.focus(tags);
    fireEvent.click(screen.getByRole('option', { name: 'breakout' }));
    fireEvent.change(tags, { target: { value: 'late' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    fireEvent.change(note, { target: { value: 'wait for close' } });

    rerender(<ReviewEditor trade={makeTrade({ id: 't2', tags: ['fresh'], note: 'second note', starred: true })} availableTags={['breakout', 'late']} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: '移除标签 fresh' })).toBeInTheDocument();
    expect(screen.getByLabelText('备注')).toHaveValue('second note');

    fireEvent.click(screen.getByRole('button', { name: '移除标签 fresh' }));
    fireEvent.focus(screen.getByLabelText('标签'));
    fireEvent.click(screen.getByRole('option', { name: 'breakout' }));
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: 'late' } });
    fireEvent.keyDown(screen.getByLabelText('标签'), { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: 'wait for close' } });
    fireEvent.click(screen.getByRole('button', { name: /保存复盘/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ tradeId: 't2', tags: ['breakout', 'late'], note: 'wait for close', starred: true }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tradeId: 't2', tags: ['breakout', 'late'], note: 'wait for close', starred: true }),
    }));
  });
});

function makeTrade(input: { id: string; tags: string[]; note: string; starred?: boolean }): ReviewedTrade {
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
    review: { tradeId: input.id, tags: input.tags, note: input.note, starred: input.starred ?? false, updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}
