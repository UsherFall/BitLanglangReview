/**
 * Mapping between the OKX-style chart instrument the review queues use
 * (`BTC-USDT-SWAP`) and the native symbol a non-OKX market-data source expects.
 *
 * Review trades are normalized to OKX-style instruments no matter which
 * exchange produced them, so a chart source that is not OKX has to convert the
 * instrument back to its own vocabulary before requesting candles.
 */

/**
 * Maps an OKX-style USDT-M instrument (`BTC-USDT-SWAP`) to the Binance USDT-M
 * perpetual symbol (`BTCUSDT`) used by Binance market-data endpoints. Returns
 * null for anything that is not a `*-USDT-SWAP` instrument, so callers can fall
 * through to an empty result.
 */
export function okxInstrumentToBinanceSymbol(instId: string): string | null {
  if (!/^[A-Z0-9]{2,}-USDT-SWAP$/.test(instId)) return null;
  const base = instId.slice(0, -'-USDT-SWAP'.length);
  if (!base) return null;
  return `${base}USDT`;
}
