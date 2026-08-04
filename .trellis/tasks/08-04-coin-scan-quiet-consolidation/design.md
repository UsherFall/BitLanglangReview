# 选币模块-缩量盘整规则优化 — 技术设计

## 架构与边界

改造现有缩量算法为"缩量盘整(平静)"判定。改动:
- `src/domain/coin-scan.ts` — 算法重写 + 类型增删。
- `src/server/coin-scan-service.ts` — 调新算法 + 新字段。
- `src/server/app-plugin.ts` — 新参数 `volatilityThreshold` 解析。
- `src/ui/CoinScanPanel.tsx` — 波动阈值输入 + 振幅比列 + 文案。
- `.trellis/spec/server/coin-scan.md` — 契约更新。

## 算法(domain)

`computeShrinkMetrics` 重命名为 `computeQuietMetrics`,入参加 `volatilityThreshold`:

```ts
// 每根 bar:
//   amplitude[i]  = (high[i] - low[i]) / low[i]        // low<=0 → 行整体跳过
//   volumeRatio[i] = vol[i] / mean(vol[i-window..i-1])
//   amplitudeRatio[i] = amplitude[i] / mean(amplitude[i-window..i-1])
//       若振幅基准均值 <= 0:amplitudeRatio = current==0 ? 0 : Infinity
//   calm[i] = volumeRatio[i] < ratioThreshold AND amplitudeRatio[i] < volatilityThreshold

// 输出(基于最近已收盘 bar):
//   currentVolume, averageVolume, ratio(volumeRatio), amplitudeRatio,
//   intensity = mean( 最近 consecutive 根 (volumeRatio+amplitudeRatio)/2 ),  // 平静强度
//   consecutiveQuiet = 从最新向前连续 calm 的根数
//   qualified = consecutiveQuiet >= consecutive
```

`window + consecutive` 根不足或窗口均量 <= 0 → 返回 null(跳过该币),沿用现有语义。

## 契约变更

`ShrinkScanParams` 加 `volatilityThreshold: number`(默认 0.7)。

`ScanRow`:
- 删 `consecutiveShrunk`,加 `amplitudeRatio: number`、`consecutiveQuiet: number`。
- `intensity` 语义改为平静强度。

路由:`parseScanParam(volatilityThreshold, 0.7)`,`> 0` 校验。

## UI

- 参数面板加"波动阈值"输入(默认 0.7)。
- 结果表:加"振幅比"列(格式 2 位小数);列头"连续缩量"→"连续平静";"强度分"语义即平静强度。方法 label 保持"缩量"(规则语义在内部,可选改"缩量盘整")。

## 兼容

- `/api/scan` 缺省 `volatilityThreshold` 回退 0.7,向后兼容。
- `computeQuietMetrics` 为内部重命名,单测同步更新。

## 测试要点

- 算法:量比/振幅比各自独立基准;平静 AND 判定;合格/不合格;连续平静根数;窗口不足;振幅基准为零(全平 bar→平静,基准零+当前有波动→不平静)。
- 服务:新字段透传、参数缺省、排序按平静强度。
- UI 文案列头变化由组件测试/手动验证。
