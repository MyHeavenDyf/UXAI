---
name: webfetch 请求最小间隔
description: 内网网关拒绝连续过快的请求，为进程内所有 webfetch 请求增加 1 秒全局最小间隔
type: feature
---

# webfetch 请求最小间隔

## 背景
内网环境下网关会拒绝连续过快的请求：agent 接连调用 webfetch 时部分请求被网关拒绝导致工具失败。
需要一个请求级别的节流，保证两次实际发出的 HTTP 请求之间至少间隔 1 秒。

## 实现
`packages/opencode/src/tool/webfetch.ts` 增加模块级槽位预留（`reserveRequestSlot`）：
- 模块变量 `nextRequestAt` 记录下一个请求最早可发起的时间；每次 execute 在发起请求前同步预留槽位，
  返回需要等待的毫秒数，并用 `Effect.sleep` 等待（可被 abort 中断）。
- 因为是模块级状态，同一进程内多个 session / 多个工具并发调用也会被串行间隔开；
  等待发生在权限确认（`ctx.ask`）之后、真正发起请求之前，权限弹窗的耗时不会浪费间隔槽位。
- **并发调用是排队不是拒绝**：模型一轮同时发 N 个 webfetch 时，第 k 个请求等待 (k-1)×间隔后发出，
  全部正常执行。排队等待用 `Effect.sleep`，可被 abort 中断；
  且 `Effect.timeoutOrElse` 只包住真正 fetch，排队等待不占用请求自身的 timeout。
  执行链路（`session/prompt.ts` 的 tool execute 包装、`tool/tool.ts`）没有会杀掉排队等待的外层超时。
- 失败的请求同样消耗槽位（网关已经看到过该请求）。
- Cloudflare 403 重试走同一 execute 内的第二次 `httpOk.execute`，不额外间隔（内网网关场景不会触发该分支）。

间隔常量 `MIN_REQUEST_INTERVAL = 1000`，应用范围：进程内所有 webfetch 请求（不区分内外网）。

## 验证
- `bun test --timeout 30000 test/tool/webfetch.test.ts`：4 pass。
- 新增用例 `queues concurrent requests instead of rejecting them`：并发发 4 个 webfetch，
  在本地 Bun server 记录请求到达时间，断言全部成功且相邻两次到达间隔 ≥ 900ms（留 100ms 计时误差余量）。
- 注意：跑该文件必须带 `--timeout 30000`（项目 test script 同款），bun 默认 5s 超时会误杀慢用例。

## 改动文件
- `packages/opencode/src/tool/webfetch.ts:13-22`（常量与槽位预留函数）
- `packages/opencode/src/tool/webfetch.ts:63-64`（execute 中等待）
- `packages/opencode/test/tool/webfetch.test.ts`（新增间隔用例）
