// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeReplayPanel } from '../src/ui/FreeReplayPanel';

const pickerMocks = vi.hoisted(() => ({
  close: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('flatpickr', () => ({
  default: vi.fn(() => ({ close: pickerMocks.close, destroy: pickerMocks.destroy })),
}));

describe('FreeReplayPanel', () => {
  beforeEach(() => {
    pickerMocks.close.mockClear();
    pickerMocks.destroy.mockClear();
  });

  it('loads selectable instruments from the venue the replay will use (10/21: Bitget)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT', 'ETHUSDT'] }))));

    render(<FreeReplayPanel timeframe="5m" />);

    expect(screen.getByText('加载交易对')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    expect(screen.getByRole('option', { name: 'ETHUSDT' })).toBeInTheDocument();
    // The list must be named in the venue's own vocabulary, or the panel would
    // offer symbols the candle route cannot load.
    expect(fetch).toHaveBeenCalledWith('/api/free-replay/instruments?source=bitget');
  });

  it('starts Free Replay from a picked local minute', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT'] }))));
    const onStart = vi.fn();

    render(<FreeReplayPanel timeframe="15m" onStart={onStart} />);

    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTCUSDT'));
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    expect(onStart).toHaveBeenCalledWith({
      instrument: 'BTCUSDT',
      startTime: '2024-05-21 10:07',
      dataAnchorTime: '2024-05-21 10:07',
      startProgressTime: Date.parse('2024-05-21T10:07:00+08:00') / 1000,
      progressTime: Date.parse('2024-05-21T10:07:00+08:00') / 1000,
      startCursorTime: Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      cursorTime: Date.parse('2024-05-21T09:45:00+08:00') / 1000,
      // The venue is recorded with the session (10/21), so the replay keeps
      // reading this venue even if the default moves later.
      candleSource: 'bitget',
    });
  });

  it('filters instruments by search text before starting Free Replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'] }))));
    const onStart = vi.fn();

    render(<FreeReplayPanel timeframe="5m" onStart={onStart} />);

    await waitFor(() => expect(screen.getByLabelText('交易对')).toHaveValue('BTC-USDT-SWAP'));
    fireEvent.change(screen.getByLabelText('搜索交易对'), { target: { value: 'eth' } });
    expect(screen.queryByRole('option', { name: 'BTC-USDT-SWAP' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ETH-USDT-SWAP' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2024-05-21 10:07' } });
    fireEvent.click(screen.getByRole('button', { name: '开始回溯复盘' }));

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ instrument: 'ETH-USDT-SWAP' }));
  });

  it('keeps the time picker open while editing time and closes it on Enter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTC-USDT-SWAP'] }))));

    render(<FreeReplayPanel timeframe="5m" />);

    const input = screen.getByLabelText('开始时间');
    fireEvent.input(input, { target: { value: '2024-05-21 10:07' } });
    expect(pickerMocks.close).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(pickerMocks.close).toHaveBeenCalledTimes(1);
  });
});
