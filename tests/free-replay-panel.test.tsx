// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FreeReplayPanel } from '../src/ui/FreeReplayPanel';

describe('FreeReplayPanel', () => {
  it('loads selectable OKX SWAP instruments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'] }))));

    render(<FreeReplayPanel timeframe="5m" />);

    expect(screen.getByText('Loading instruments')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    expect(screen.getByRole('option', { name: 'ETH-USDT-SWAP' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/free-replay/instruments');
  });

  it('starts Free Replay from a picked local minute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }))));
    const onStart = vi.fn();

    render(<FreeReplayPanel timeframe="15m" onStart={onStart} />);

    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));

    expect(onStart).toHaveBeenCalledWith({
      instrument: 'BTC-USDT-SWAP',
      startTime: '2024-05-21 10:07',
      dataAnchorTime: '2024-05-21 10:07',
      startCursorTime: Date.parse('2024-05-21T10:00:00+08:00') / 1000,
      cursorTime: Date.parse('2024-05-21T10:00:00+08:00') / 1000,
    });
  });

  it('filters instruments by search text before starting Free Replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'] }))));
    const onStart = vi.fn();

    render(<FreeReplayPanel timeframe="5m" onStart={onStart} />);

    await waitFor(() => expect(screen.getByLabelText('Instrument')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('Search instrument'), { target: { value: 'eth' } });
    expect(screen.queryByRole('option', { name: 'BTC-USDT-SWAP' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ETH-USDT-SWAP' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Free Replay' }));

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ instrument: 'ETH-USDT-SWAP' }));
  });
});
