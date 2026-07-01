# Trading Review

This context defines the language for reviewing futures trades against market movement.

## Language

**Trade**:
A completed futures position from an entry time and price to an exit time and price. Each **Trade** comes from the second worksheet, `时间排列+去除金额错误单子`, and belongs to one instrument.
_Avoid_: order, transaction, row

**Trade ID**:
A stable identifier derived from a **Trade's** source sequence and core source fields: instrument, entry time, exit time, direction, entry price, exit price, and profit. A **Trade ID** must survive workbook sorting or row insertion while still distinguishing otherwise identical trades.
_Avoid_: row number, Excel index

**Instrument**:
The futures contract being traded, named with the exchange symbol such as `BTC-USDT-SWAP`.
_Avoid_: coin, pair, ticker

**Entry**:
The opening point of a **Trade**, defined by entry time, entry price, and direction.
_Avoid_: buy point, open marker

**Exit**:
The closing point of a **Trade**, defined by exit time and exit price.
_Avoid_: sell point, close marker

**Timeframe Candlestick Placement**:
The placement rule that an **Entry** or **Exit** belongs to the **Candlestick** in the active **Review Timeframe** whose time range contains that point's time.
_Avoid_: exact-minute placement on every timeframe, interpolated trade marker

**Candlestick**:
A time-bucketed OHLCV market bar for an **Instrument**.
_Avoid_: K line, price line

**Review Timeframe**:
The candlestick interval used while reviewing a **Trade**. Supported review timeframes are `5m`, `15m`, `1H`, `4H`, `1D`, `1W`, and `1M`; `1m` is intentionally excluded.
_Avoid_: one-minute chart

**Review Window**:
The initial candlestick range shown around a **Trade** during review. The default review window centers on the entry with 150 candlesticks before entry and 150 candlesticks after entry, then expands on demand as the reviewer scrolls, drags, or zooms the chart.
_Avoid_: fixed maximum range, tiny chart window, fixed hour range

**On-Demand Candlestick Loading**:
The chart behavior that automatically fetches more candlesticks when the reviewer navigates near the edge of the currently loaded range. The reviewer can expand both left into earlier market structure and right into later price action; unloaded ranges remain navigable blank space while fetching, and loaded candlesticks are stored in the **Candlestick Cache** so later reviews can reuse them.
_Avoid_: manual load-more button, preloading all history, fixed chart range

**Chart Navigation Anchor**:
The market time under the reviewer's active navigation point while dragging, scrolling, zooming, or using touchpad inertia on the candlestick chart. When the pointer is inside the chart, the **Chart Navigation Anchor** is the market time under that pointer; otherwise it is the market time at the center of the visible chart. **On-Demand Candlestick Loading** must not change the **Chart Navigation Anchor** while the reviewer is navigating or when newly loaded candlesticks are applied after navigation stops.
_Avoid_: drifting chart position, unstable drag point, jumpy time axis

**Market Data Source**:
The external source used to obtain **Candlesticks**. This project uses OKX public market data for futures instruments.
_Avoid_: quote provider, exchange data

**Source Workbook**:
The read-only Excel workbook that provides the original **Trades**. Review work must not modify the **Source Workbook**.
_Avoid_: database, editable workbook

**Review Store**:
The local SQLite data for user-created review content, including **Review Tags** and **Review Notes** attached to **Trades**.
_Avoid_: source sheet, Excel notes, browser-only state

**Candlestick Cache**:
The local SQLite copy of candlesticks fetched from the **Market Data Source**, keyed by instrument, review timeframe, and timestamp. It is a cache that can be refetched, not the source of truth.
_Avoid_: authoritative market archive

**Local Review Tool**:
The first version of the review website, intended for one reviewer on one local machine. It does not need accounts, shared permissions, or cross-device synchronization.
_Avoid_: team platform, cloud service

**Review Tag**:
A custom user-created label that groups **Trades** by review meaning, such as setup quality, mistake type, or strategy pattern. Each **Trade** can have zero or more **Review Tags**, and the first version does not provide preset tags.
_Avoid_: category, single-select type, preset label

**Review Note**:
One user-written summary attached to a **Trade** during review.
_Avoid_: comment thread, timeline note, memo

**Chart Drawing**:
A user-created price/time annotation attached to an **Instrument** and shown across **Trades** and **Review Timeframes** for that instrument. A **Chart Drawing** keeps the same prices across timeframes, while its times are placed on the containing **Candlestick** for the active **Review Timeframe**.
_Avoid_: trade-only drawing, timeframe-only drawing, temporary sketch, private drawing

**Review Queue**:
The ordered list of **Trades** shown for review. The default review queue is sorted by entry time from earliest to latest; optional sorting fields are entry time, return rate, profit, and holding duration, each in ascending or descending order.
_Avoid_: profit-ranked list as the default view

**Review Filter**:
A condition that narrows the **Review Queue**. The first version supports filters by instrument, direction, time range, profit/loss result, review tag, and whether a review note exists.
_Avoid_: permanent grouping, saved screen

## Example Dialogue

Reviewer: Show me the BTC-USDT-SWAP trade from 2022-05-24 on the candlestick chart.

Developer: The chart loads candlesticks for that instrument from OKX and overlays the trade's entry and exit points; the trade ID keeps its review data matched even if the source workbook is reordered.

Reviewer: On the four-hour chart, the entry happened at 01:17. Which candlestick owns it?

Developer: Timeframe candlestick placement puts that entry on the four-hour candlestick whose range contains 01:17, not on a separate minute-level position.

Reviewer: Then I will assign review tags and write a review note for that trade.

Developer: Review tags are created by the reviewer as needed instead of coming from a preset list.

Reviewer: If I draw a support line on ETH while reviewing one trade, should I see it on another ETH trade and on the four-hour chart too?

Developer: Yes. A chart drawing belongs to the instrument, so it appears across trades and review timeframes for that instrument; the active timeframe decides which candlestick owns each drawing time.

Reviewer: Each trade only needs one review note in the first version.

Developer: The reviewer can switch the candlestick chart between supported review timeframes, starting from five minutes and above.

Reviewer: Center the initial review window on entry with 150 candlesticks before and 150 candlesticks after.

Developer: If the reviewer drags or zooms beyond the loaded candlesticks, load more from the market data source and cache them locally.

Reviewer: While more candlesticks are loading, do not pull the chart away from where I dragged it.

Developer: On-demand candlestick loading keeps the reviewer's chart navigation anchor stable during dragging, scrolling, zooming, and touchpad inertia; newly loaded candlesticks are applied after navigation stops without changing the market time under the pointer or chart center.

Developer: Those review tags and notes are saved in the review store, while the source workbook remains unchanged.

Developer: Candlesticks fetched from OKX are stored in the candlestick cache so repeated reviews are faster.

Reviewer: This is a local review tool for my own replay work, not a shared team system.

Developer: The review queue starts from the earliest trade and moves forward through time.

Reviewer: I can filter the queue by instrument, direction, date, result, tag, or missing review note.
