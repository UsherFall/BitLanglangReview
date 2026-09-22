/**
 * Hover card for a trade point. Plain DOM rather than React: it is positioned
 * from chart coordinates on every crosshair move, and re-rendering React on
 * pointer movement would fight the chart for frames.
 */

export type TooltipData = {
  kind: 'open' | 'close';
  timeMs: number;
  price: number;
  qty: number;
  /** null when the source has no per-action detail → row is omitted. */
  fee: number | null;
  profit: number | null;
  /** Empty string when the source has no exchange order source. */
  source: string;
  leverage: number | null;
};

export type TradeMarkerTooltip = {
  show(data: TooltipData, anchor: { x: number; y: number }): void;
  hide(): void;
  destroy(): void;
};

const SOURCE_TEXT: Record<string, string> = {
  market: '市价',
  normal: '限价',
  modify_order_limit: '限价改单',
  loss_market: '止损市价',
};

const MARGIN_PX = 18;
const EDGE_PX = 8;

export function createTradeMarkerTooltip(container: HTMLElement): TradeMarkerTooltip {
  const element = document.createElement('div');
  element.className = 'trade-point-tip';
  element.hidden = true;
  container.appendChild(element);

  function hide(): void {
    element.hidden = true;
  }

  function show(data: TooltipData, anchor: { x: number; y: number }): void {
    element.innerHTML = renderContent(data);
    element.hidden = false;

    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = anchor.x + MARGIN_PX;
    if (left + width > container.clientWidth - EDGE_PX) left = anchor.x - MARGIN_PX - width;
    left = Math.max(EDGE_PX, left);
    let top = anchor.y - height / 2;
    top = Math.max(EDGE_PX, Math.min(top, container.clientHeight - height - EDGE_PX));

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  return {
    show,
    hide,
    destroy: () => element.remove(),
  };
}

function renderContent(data: TooltipData): string {
  const isOpen = data.kind === 'open';
  const label = isOpen ? '开仓' : '平仓';
  const badgeClass = isOpen ? 'trade-point-tip-open' : 'trade-point-tip-close';
  const rows: string[] = [
    `<div><dt>价格</dt><dd>${formatPrice(data.price)}</dd></div>`,
    `<div><dt>数量</dt><dd>${formatQty(data.qty)}</dd></div>`,
    `<div><dt>时间</dt><dd>${formatTime(data.timeMs)}</dd></div>`,
  ];

  if (data.leverage !== null) {
    rows.push(`<div><dt>杠杆</dt><dd>${formatNumber(data.leverage)}x</dd></div>`);
  }
  if (data.fee !== null) {
    rows.push(`<div><dt>手续费</dt><dd>${data.fee.toFixed(4)}</dd></div>`);
  }
  if (data.source) {
    const isStop = data.source === 'loss_market';
    rows.push(`<div><dt>来源</dt><dd class="${isStop ? 'trade-point-tip-stop' : ''}">${SOURCE_TEXT[data.source] ?? data.source}</dd></div>`);
  }
  if (!isOpen && data.profit !== null) {
    const tone = data.profit >= 0 ? 'trade-point-tip-gain' : 'trade-point-tip-loss';
    rows.push(`<div><dt>盈亏</dt><dd class="${tone}">${data.profit >= 0 ? '+' : ''}${data.profit.toFixed(4)}</dd></div>`);
  }

  return `<div class="trade-point-tip-head"><span class="trade-point-tip-badge ${badgeClass}">${label}</span></div><dl>${rows.join('')}</dl>`;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return String(Number(price.toPrecision(4)));
}

function formatQty(qty: number): string {
  if (qty >= 1000) return qty.toFixed(0);
  if (qty >= 1) return String(Number(qty.toFixed(4)));
  return String(Number(qty.toPrecision(4)));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatTime(timeMs: number): string {
  if (!Number.isFinite(timeMs)) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timeMs));
}
