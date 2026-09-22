/**
 * One filled order from Bitget `v2/mix/order/orders-history`, normalized at the
 * client boundary (exchange payload is all strings). A history-position row is
 * a whole closed cycle; these rows are the individual open/add/reduce fills
 * that made it up, which is what the chart plots point by point.
 */
export type BitgetOrder = {
  /** Exchange order id; unique and stable, used as the cache primary key. */
  orderId: string;
  symbol: string;
  posSide: 'long' | 'short';
  side: 'open' | 'close';
  /** baseVolume — the order's filled size in contracts/coins. */
  qty: number;
  /** priceAvg — the order's average fill price. */
  price: number;
  fee: number;
  /** totalProfits — realized pnl of this order (0 for opens; excludes funding). */
  profit: number;
  /** orderSource: `market` | `normal` | `modify_order_limit` | `loss_market` (stop). */
  source: string;
  leverage: number | null;
  /**
   * uTime — when the order finished filling, in epoch ms. Charts must place
   * points with this: limit orders can be placed minutes before they fill
   * (measured 799s in this account), so `placedAt` would plot them early.
   */
  tradedAt: number;
  /** cTime — order creation time in epoch ms; kept for reference only. */
  placedAt: number | null;
};
