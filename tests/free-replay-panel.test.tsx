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

  // 11/03：开始模拟交易后回退与成单时间线互斥 —— 面板按 canRewind 置灰，
  // App 传 `!paperTrading.active`。
  it('greys out rewind when paper trading has started and keeps next enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT'] }))));

    const { rerender } = render(<FreeReplayPanel timeframe="5m" canRewind />);

    expect(screen.getByRole('button', { name: '上一根 K 线' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeEnabled();

    rerender(<FreeReplayPanel timeframe="5m" canRewind={false} />);

    const rewind = screen.getByRole('button', { name: '上一根 K 线' });
    expect(rewind).toBeDisabled();
    expect(rewind).toHaveAttribute('title', '开始模拟交易后不能回退 K 线');
    // 步进不受影响 —— 模拟中仍要能向前揭示。
    expect(screen.getByRole('button', { name: '下一根 K 线' })).toBeEnabled();
  });

  // 11/04：回顾页首页并列的「模拟单库」—— 跨会话聚合已完结回合。
  const round = {
    id: 'paper:BTCUSDT:2024-05-21 10:07:position-1',
    positionId: 'position-1',
    instrument: 'BTCUSDT',
    startTime: '2024-05-21 10:07',
    direction: 'long' as const,
    entryPrice: 100,
    entryTime: 0,
    exitPrice: 110,
    exitTime: 1,
    positionOpenPrice: 100,
    positionOpenTime: 0,
    quantity: 1,
    margin: 100,
    notional: 100,
    leverage: 1,
    pnl: 10,
    returnRate: 0.1,
    fillCount: 2,
    tradeIds: ['fill-1', 'fill-2'],
  };

  it('lists closed paper rounds with their source session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT'] }))));

    render(
      <FreeReplayPanel
        timeframe="5m"
        paperRounds={[round]}
        paperRoundSessions={[{ instrument: 'BTCUSDT', startTime: '2024-05-21 10:07', updatedAt: '2024-05-21T09:00:00.000Z', roundCount: 1 }]}
        paperTags={['追高']}
        paperTagCounts={{ 追高: 1 }}
      />,
    );

    expect(screen.getByRole('button', { name: /模拟单库 \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('+10.00%')).toBeInTheDocument();
    expect(screen.getByText('2 笔')).toBeInTheDocument();
    // 来源会话标签让库行可比对（币种 + 回放起点）。
    expect(screen.getByText('2024-05-21 10:07 起')).toBeInTheDocument();
  });

  it('opens the source session when a library row is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT'] }))));
    const onOpenPaperRound = vi.fn();

    render(<FreeReplayPanel timeframe="5m" paperRounds={[round]} onOpenPaperRound={onOpenPaperRound} />);

    fireEvent.click(screen.getByTitle('回到该回合'));

    expect(onOpenPaperRound).toHaveBeenCalledWith(round);
  });

  // 11/04：库行的星标是单击直写，不该顺手展开批注编辑器 —— 两处入口对同一
  // 动作必须表现一致（回放单子行同样如此）。
  it('toggles the star from a library row without opening the editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT'] }))));
    const onTogglePaperStar = vi.fn();

    render(<FreeReplayPanel timeframe="5m" paperRounds={[round]} onTogglePaperStar={onTogglePaperStar} />);

    fireEvent.click(screen.getByRole('button', { name: '收藏 BTCUSDT position-1' }));

    expect(onTogglePaperStar).toHaveBeenCalledWith(round);
    expect(screen.queryByLabelText(`批注 ${round.id}`)).not.toBeInTheDocument();
  });

  it('reports library filter changes so the server can re-derive the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ instruments: ['BTCUSDT'] }))));
    const onPaperFiltersChange = vi.fn();

    render(
      <FreeReplayPanel
        timeframe="5m"
        paperRounds={[round]}
        paperTags={['追高']}
        paperTagCounts={{ 追高: 1 }}
        onPaperFiltersChange={onPaperFiltersChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('按收藏状态筛选模拟单'), { target: { value: 'yes' } });

    expect(onPaperFiltersChange).toHaveBeenCalledWith({ tag: undefined, starred: 'yes', session: undefined });
  });
});
