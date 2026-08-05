# ServerChan 推送通道 URL 支持

## Goal

ServerChanNotifier 目前固定拼 `https://sctapi.ftqq.com/{key}.send`。sctp 推送通道 key 的正确域名是 `{uid}.push.ft07.com`,拼错域名推送失败(用户实测微信收不到)。支持配置为**完整 send URL** 或**裸 key**。

## Requirements

- R1:`ServerChanNotifier` 构造参数为 `keyOrUrl`,三种格式:
  - 完整 send URL(`http` 开头)→ 直用(ServerChan³ sctp 推送通道 / 自建)。
  - 裸 `sctp{uid}t...` key → 按官方正则 `/^sctp(\d+)t/` 提取 uid,拼 `https://{uid}.push.ft07.com/send/{key}.send`。
  - 裸 `SCT...` key → 拼 `https://sctapi.ftqq.com/{key}.send`(微信 Turbo)。
- R2:`.env` 的 `SERVERCHAN_KEY` 支持三种格式;UI `notifierConfigured` 判定不变(仅看非空)。
- R3:spec 记录契约。

## Acceptance Criteria

- [x] AC1:完整 URL 配置 → POST 到该 URL(单测断言 URL 直用)。
- [x] AC2:裸 `SCT` key → 拼 sctapi.ftqq.com(既有单测不回归)。
- [x] AC3:裸 `sctp` key → 提取 uid 拼 ft07.com URL(单测断言)。
- [x] AC4:实测用户 SC3 URL POST 返回 `code 0`(SC3 APP 收到)。
- [x] AC5:`npm test` 全绿(155)。

## Notes

- 官方文档确认:Server酱³(SC3,sctp key)推 **APP**,Server酱 Turbo(SCT key)推 **微信**。用户选微信推送 → 需 sct.ftqq.com 拿 Turbo `SCT` key,`.env` 换成它(当前 .env 是 SC3 URL)。
- 轻量任务,PRD-only。
- 触碰:`src/server/notify.ts`、`tests/serverchan-notifier.test.ts`、`.trellis/spec/server/api-plugin.md`、`.env`(gitignored)。
