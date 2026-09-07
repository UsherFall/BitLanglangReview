# 清理 Bitget 残留 k 线缓存并记录源命名空间冲突

## Goal

修复"个人复盘 ZEC 日线同一天出现两根、价格略异"的缓存混源问题:本地 `candles` 表中残留的 Bitget 行(曾以 native symbol `ZECUSDT` 写入)与新的 Binance 行(同名 `ZECUSDT`)共享同一 PK 键,图表把两源 K 线混画。清空 candles 缓存(纯派生、按需重建),并在代码/规范中记录教训:任何与 Binance 同用 `base+USDT` 符号命名空间的源都会与其缓存键冲突,未来引入须先做按源命名空间。

## Background (confirmed)

- 本地 `data/review.sqlite::candles` 中 `ZECUSDT` 1D 每天多行:Bitget 行 ts=16:00Z(北京0点)+ Binance 行 ts=00:00Z(北京8点);close 略异 → 图上一日两根。
- `candles` 主键 `(instrument, timeframe, timestamp)` 不区分来源;OKX 因键名带 `-USDT-SWAP` 与 Binance/Bitget 的 `base+USDT` 天然隔离,而 **Binance 与 Bitget 符号同名**。
- Bitget 源代码已在前一任务整体删除;遗留行只是缓存。
- 缓存非权威(spec 已述),可整体清空后按需重建;reviews/drawings/positions 等其它表不动。

## Requirements

- **R1 清空 candles 缓存**:删除 `candles` 表全部行(不删表、不动其它表)。
- **R2 防再犯注释**:`src/server/binance-candles.ts` 头注释补一句 —— 缓存键是 `base+USDT` 原生符号,与任何同命名空间的其它源(如已撤回的 Bitget)共享主键、会冲突;再引入这类源必须先加按源命名空间(如 key 前缀),不能只靠 instrument 名隔离。
- **R3 spec 同步**:`market-data.md` 的源选择注记把"native 名隔离"表述修正为:隔离只对命名空间不同的源成立(OKX `-SWAP` vs `base+USDT`);同命名空间的源必须显式命名空间化。

## Acceptance Criteria

- [ ] AC1 本地 candles 表清空后,`npm run dev` 重启,ZEC 日线(个人复盘)不再出现同日双根;连续日期各一根。
- [ ] AC2 `binance-candles.ts` 头注释与 `market-data.md` 已补充命名空间冲突警告。
- [ ] AC3 全量 vitest + `tsc --noEmit` 不受影响(纯注释 + 缓存清理)。

## Out of Scope

- candles 表结构变更/加 source 列(当前仅单一 base+USDT 源在写,不引入迁移)。
- 其它任何行为改动。
