/**
 * Stablecoin/synthetic USDT-quoted pairs excluded from every market-data
 * ticker source's scan pool. Their "price discovery" is not meaningful for a
 * volume-shrink scan. Shared by the Binance and Bitget sources so the
 * exclusion cannot drift between venues; extend as new pairs appear.
 */
export const STABLECOIN_QUOTE_PAIRS = new Set<string>([
  'USDCUSDT',
  'FDUSDUSDT',
  'DAIUSDT',
  'TUSDUSDT',
  'USDDUSDT',
  'USDPUSDT',
  'USD1USDT',
  'USD0USDT',
]);
