# 选币模块-缩量盘整规则优化

## Goal

把"缩量"判定从**纯量缩**升级为**缩量盘整(量缩 + 价格波动收窄)**:候选币需同时满足成交量萎缩与价格振幅收敛,才判定为平静/盘整(方向选择前的蓄力形态)。修正当前"无量阴跌也会被当缩量"的误判。

## Background / Confirmed Facts

- 当前规则(已交付):量比 = 单根量 ÷ 前 `window` 根均量;强度分 = 最近 `consecutive` 根量比均值;合格 = 连续 `consecutive` 根量比 < `ratioThreshold`。只用已收盘 K 线。
- 现有参数:`timeframe`(默认 5m)、`topN`(50)、`ratioThreshold`(0.7)、`consecutive`(3)、`window`(20)、`minQuoteVolume24h`(1000 万)。
- 相关代码:`src/domain/coin-scan.ts`(`computeShrinkMetrics` 纯函数)、`src/server/coin-scan-service.ts`、`src/ui/CoinScanPanel.tsx`、`/api/scan`。
- 用户需求:合格需**量缩且价格波动变小**。

## Requirements

- 每根 bar 新增**振幅**指标(振幅 = (高−低)÷最低)及其相对基准的**振幅比**。
- **振幅比 = 该根振幅 ÷ 前 `window` 根均振幅**(镜像量比逻辑,已定 A 方案)。
- **"平静"判定(每根 bar)** = 量比 < 量比阈值 **且** 振幅比 < 波动阈值。
- **合格 = 连续 `consecutive` 根平静**。
- 新增参数**波动阈值**(默认 **0.7**,可调),复用 `window` / `consecutive`。
- 结果表加**振幅比**列。
- **强度分(已定 A)= 最近 `consecutive` 根每根(量比+振幅比)/2 的均值**,即平静强度;排序升序,最平静在前。原"连续缩量"列改为**连续平静根数**。

## Acceptance Criteria

- [ ] AC1:`computeShrinkMetrics` 改造为"平静判定":每根 bar 算量比与振幅比(各自对比前 window 根基准);平静 = 两者均低于对应阈值。
- [ ] AC2:合格 = 连续 `consecutive` 根平静(量比<阈值 且 振幅比<波动阈值);新强度分 = 最近 M 根 (量比+振幅比)/2 均值,排序升序。
- [ ] AC3:`/api/scan` 接受新参数 `volatilityThreshold`(默认 0.7),校验同量比阈值;响应行含 `amplitudeRatio` 字段,"连续缩量"语义改为"连续平静"。
- [ ] AC4:参数面板加"波动阈值"输入(默认 0.7);结果表加"振幅比"列,列头/文案改为平静语义。
- [ ] AC5:算法与服务单测覆盖(量比/振幅比/平静/合格/排序/窗口不足/零振幅基准);全量测试绿。

## Open Questions

无阻塞项。波动阈值默认 0.7,参数可调。

## Out of Scope

- 自动定时刷新、其它找币方法、全站中文翻译。

## Notes

- 复杂任务,`design.md` + `implement.md` 需在 `task.py start` 前补齐。
- 影响算法纯函数、/api/scan 契约、结果表与参数面板。
