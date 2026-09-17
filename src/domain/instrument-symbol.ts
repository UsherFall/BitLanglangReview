/**
 * Mapping between the OKX-style chart instrument the review queues use
 * (`BTC-USDT-SWAP`) and the native symbol a non-OKX market-data source expects.
 *
 * Review trades are normalized to OKX-style instruments no matter which
 * exchange produced them, so a chart source that is not OKX has to convert the
 * instrument back to its own vocabulary before requesting candles.
 */

/** OKX-style base asset of a USDT-margined swap, or null for any other symbol. */
function okxBaseAsset(instId: string): string | null {
  const match = /^([A-Z0-9]{2,})-USDT-SWAP$/.exec(instId);
  return match ? match[1] : null;
}

/**
 * OKX-style base asset -> the Binance USDT-M symbol of the SAME asset, for the
 * cases where Binance's plain `base+USDT` is missing or no longer tradable.
 *
 * Hard rule for this table: only same-asset, same-scale renames belong here.
 * A Binance contract with a DIFFERENT face value (e.g. `SHIB` -> `1000SHIBUSDT`,
 * which prices at 1000x) must NOT be added — the candle prices would no longer
 * share a scale with the trade's entry/exit prices, and fixing that needs a
 * price-scaling layer (which would also change how drawings interpret prices).
 * Those cases are served by the OKX fallback instead, which lists the same
 * symbol at the same scale.
 *
 * `RAY`: Binance settled its original RAYUSDT perpetual in 2022-11 and lists the
 * same asset as `RAYSOLUSDT` (verified 2026-09-17: RAYSOLUSDT traded 1.19–1.22
 * right where a Bitget RAYUSDT position opened at 1.2121).
 */
export const BINANCE_SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  RAY: 'RAYSOLUSDT',
};

/** Binance `exchangeInfo.status` of a symbol that can actually trade. */
const BINANCE_TRADING_STATUS = 'TRADING';

/**
 * One step of the ordered candle-source chain. Binance steps carry `usable`
 * (plus `reason` when not) so the executor can report WHY a step was skipped
 * instead of silently dropping it.
 */
export type CandleChainStep =
  | { kind: 'binance'; symbol: string; usable: boolean; reason?: string }
  | { kind: 'okx'; instrument: string };

/**
 * Ordered candle-source candidates for a review instrument: the Binance symbol
 * candidates (alias first, then the plain `base+USDT`) followed by the OKX
 * fallback on the instrument's own name.
 *
 * `binanceStatuses` is the `exchangeInfo` `symbol -> status` map (see
 * `BinanceInstrumentMetadataSource.symbolStatuses`). `'TRADING'` is the only
 * usable status: Binance keeps `SETTLING`/`CLOSE` symbols in `exchangeInfo` and
 * still answers `fapi/v1/klines` for them with a FROZEN price and zero volume,
 * so a delisted contract would otherwise chart as a perfectly flat line.
 *
 * An EMPTY map means the metadata could not be read at all, which is different
 * from "this symbol is absent": nothing can be validated, so every Binance step
 * is marked usable and the executor cannot advance past them — behaviour then
 * matches the pre-chain implementation. A non-empty map is authoritative, so an
 * absent symbol really is missing.
 *
 * Returns `[]` for an instrument that is not a `*-USDT-SWAP` symbol, letting
 * callers keep their "unmappable instrument" behaviour.
 */
export function resolveCandleChain(instId: string, binanceStatuses: ReadonlyMap<string, string>): CandleChainStep[] {
  const base = okxBaseAsset(instId);
  if (!base) return [];
  const alias = BINANCE_SYMBOL_ALIASES[base];
  const mapped = `${base}USDT`;
  const symbols = alias && alias !== mapped ? [alias, mapped] : [mapped];
  return [...symbols.map((symbol) => binanceStep(symbol, binanceStatuses)), { kind: 'okx', instrument: instId }];
}

function binanceStep(symbol: string, binanceStatuses: ReadonlyMap<string, string>): CandleChainStep {
  if (binanceStatuses.size === 0) return { kind: 'binance', symbol, usable: true };
  const status = binanceStatuses.get(symbol);
  if (status === BINANCE_TRADING_STATUS) return { kind: 'binance', symbol, usable: true };
  return { kind: 'binance', symbol, usable: false, reason: status === undefined ? '无此合约' : `合约状态 ${status}` };
}
