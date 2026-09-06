/** Raw row shape returned by Bitget `v2/mix/position/history-position`
 * (non-unified / mix productType=USDT-FUTURES). Numeric fields are strings,
 * matching the exchange payload; convert at the import boundary. */
export type BitgetHistoryPosition = {
  symbol: string;
  marginCoin?: string;
  holdSide: 'long' | 'short';
  marginMode?: string;
  openAvgPrice: string;
  closeAvgPrice: string;
  openTotalPos: string;
  closeTotalPos: string;
  pnl: string;
  netProfit: string;
  totalFunding: string;
  openFee: string;
  closeFee: string;
  /** Open time as epoch milliseconds string. */
  ctime: string;
  /** Close time as epoch milliseconds string. */
  utime: string;
};

/**
 * Maps a Bitget USDT-M symbol (`BTCUSDT`) to the OKX-style instrument the
 * review charts and candlestick cache use (`BTC-USDT-SWAP`). Returns null when
 * the symbol is not a USDT-settled perpetual, so callers can skip it.
 */
export function bitgetSymbolToOkxInstrument(symbol: string): string | null {
  if (!/^[A-Z0-9]{2,}USDT$/.test(symbol)) return null;
  const base = symbol.slice(0, -4);
  if (!base) return null;
  return `${base}-USDT-SWAP`;
}

/**
 * Deterministic collision-resistant key for one closed position cycle. The id
 * stored on the mapped `Trade` is `bg-` + sha256 of this key, hashed in the
 * server importer (`src/server/bitget-import.ts`) exactly like workbook trades.
 * Keying on content rather than `positionId` keeps upserts stable even if the
 * exchange omits or recycles position ids.
 */
export function historyPositionRowKey(row: BitgetHistoryPosition): string {
  return [
    row.symbol,
    row.holdSide,
    row.ctime,
    row.utime,
    row.openAvgPrice,
    row.closeAvgPrice,
    row.closeTotalPos,
    row.netProfit,
  ].join('|');
}
