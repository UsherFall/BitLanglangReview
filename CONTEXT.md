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

**Free Replay**:
A review mode for studying market movement from a reviewer-chosen **Instrument** and start time without requiring a **Trade**. A **Free Replay** reveals **Candlesticks** progressively from that start time in the active **Review Timeframe**.
_Avoid_: trade review, backtest, simulator

**Free Replay Instrument List**:
The selectable **Instruments** for **Free Replay**, loaded from OKX public SWAP instruments instead of only from the **Source Workbook**. The first version limits free replay selection to swap instruments so the instrument language stays consistent with `BTC-USDT-SWAP` style futures review.
_Avoid_: source workbook instruments only, futures expiry list, spot pair list

**Trade Review**:
A review mode for studying a completed **Trade** with its entry, exit, review tags, review note, and chart drawings. Trade review uses the **Review Queue** to choose which trade is active.
_Avoid_: free replay, generic chart browsing

**Free Replay Cursor**:
The rightmost revealed **Candlestick** in a **Free Replay**. When the reviewer chooses a start time, the **Free Replay Cursor** belongs to the **Candlestick** whose time range contains the chosen time; when the reviewer switches **Review Timeframes**, it belongs to the candlestick whose time range contains the previous cursor candlestick's open time.
_Avoid_: chart center, mouse cursor, selected trade time

**Free Replay Reveal**:
The act of adding the next **Candlestick** to a **Free Replay** without removing previously revealed candlesticks. Revealing a candlestick advances the **Free Replay Cursor** but does not automatically move the visible chart range; future candlestick data may be prefetched but remains hidden until revealed.
_Avoid_: auto-play, scrolling the chart, replacing the visible window

**Free Replay Rewind**:
The act of hiding the latest revealed **Candlestick** in a **Free Replay** and moving the **Free Replay Cursor** back to the previous revealed candlestick. Rewind cannot move before the first candlestick selected by the replay start time.
_Avoid_: chart undo, browser back, deleting candlestick data

**Free Replay History**:
The candlesticks before the **Free Replay Cursor** that give the reviewer market context at the replay start. Free replay history loads on demand like the normal **Review Window**, while future candlesticks remain hidden until **Free Replay Reveal** exposes them.
_Avoid_: hidden past, replay future, fixed preload

**Free Replay Chart Context**:
The chart content shown during a **Free Replay**: candlesticks and instrument-level **Chart Drawings**, but not **Trade** entry or exit markers. Trade markers belong to **Trade Review** because free replay should not reveal the reviewer's past trade decisions.
_Avoid_: trade hints, entry marker, exit marker

**Free Replay Session**:
The temporary in-page state of a **Free Replay**, including its selected **Instrument**, start time, active **Review Timeframe**, and **Free Replay Cursor**. The first version does not save free replay sessions between page visits.
_Avoid_: saved replay, review note, journal entry

**Free Replay Start Time**:
The reviewer-chosen local date and minute where a **Free Replay** begins. The start time is placed on the containing **Candlestick** in the active **Review Timeframe**.
_Avoid_: second-level timestamp, exchange server time, exact tick

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

Reviewer: I also want to choose BTC-USDT-SWAP and start from a specific time, then reveal candlesticks one by one.

Developer: That is a free replay, because it studies the instrument's candlesticks directly instead of starting from a trade.

Reviewer: I want to switch between reviewing my completed trades and replaying any instrument from any time.

Developer: Trade review and free replay are separate review modes, because one starts from the review queue and the other starts from an instrument and replay start time.

Reviewer: Free replay should let me choose instruments even if I did not trade them before.

Developer: The free replay instrument list comes from OKX swap instruments, not only from the source workbook.

Reviewer: If I start at 10:07 on the 15-minute chart, which candlestick appears first?

Developer: The free replay cursor is the 10:00 candlestick, because that candlestick contains 10:07.

Reviewer: If I have revealed up to the 10:35 candlestick on the five-minute chart and switch to fifteen minutes, where does replay land?

Developer: It lands on the 10:30 candlestick, because the previous cursor candlestick's open time belongs to that fifteen-minute candlestick.

Reviewer: When I press the right arrow, show the next candlestick, but do not move my chart view.

Developer: A free replay reveal appends the next candlestick and advances the cursor, while leaving the visible chart range under the reviewer's control.

Reviewer: I still want to see the market structure before my chosen start time.

Developer: Free replay history shows and expands earlier candlesticks on demand, while later candlesticks remain controlled by reveal and rewind.

Reviewer: If I press the left arrow, hide the latest candlestick and go back one step.

Developer: Free replay rewind removes only the latest revealed candlestick from view and cannot rewind before the starting candlestick.

Reviewer: If I close the page, the free replay progress does not need to come back.

Developer: Free replay session state is temporary; only chart drawings remain saved across sessions.

Reviewer: I want to choose the free replay start time from a picker.

Developer: The free replay start time is selected as a local date and minute, then mapped to the containing candlestick.

Reviewer: Do not show my historical trade entry and exit markers during free replay.

Developer: Free replay chart context excludes trade markers so the reviewer can judge the market without seeing past trade decisions.
