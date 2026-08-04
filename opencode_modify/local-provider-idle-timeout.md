# 本地 provider 5 分钟超时兜底改 idle timeout

## 背景

上一个提交 `df4441eed`（fix: 本地 provider 加 5 分钟超时兜底，防止 fetch 假死）
为修华为内网 6 秒 `fetch failed` 问题，给本地 provider 加了 5 分钟超时。但实现方式
用的是 **wall-clock 超时**（`AbortSignal.timeout(300000)`，请求发出即计时），导致：

在 `/make`（`octo_make` agent）等长耗时生成场景，模型持续吐内容超过 5 分钟，
**精准在第 5 分钟被掐断**，即使输出仍在进行。

## 根因

`df4441eed` 在 `options["fetch"]` 包装器里：

```ts
const effectiveTimeout =
  options["timeout"] === undefined && shouldUseBypassDispatcher(model.providerID, url)
    ? 5 * 60 * 1000   // ← 请求发出那一刻计时
    : options["timeout"]
if (effectiveTimeout) optionsTimeoutSignal = AbortSignal.timeout(effectiveTimeout)
```

- 计时起点 = **fetch 发出时刻**，不是最后一个 chunk
- `AbortSignal.timeout` 是绝对 wall-clock，模型只要输出超 5 分钟就 abort
- 与 undici dispatcher 的 `headersTimeout/bodyTimeout = 5min` 叠加

而 `wrapSSE` 里已有的 chunk timeout 本意是正确答案——每次 `reader.read()` 完成
会 `clearTimeout` 并重新 `setTimeout`，是 **idle timeout**，但默认没启用。

## 修复

`packages/opencode/src/provider/provider.ts`：

1. **取消本地 provider 的 wall-clock 兜底注入**（`provider.ts:~2019-2028`）
   - 删除 `effectiveTimeout = 5*60*1000` 注入
   - `options["timeout"]` 仅在用户显式配置时生效（可设 `false` 关闭）

2. **local provider 退到 5 分钟 chunk idle timeout**（`provider.ts:~2024-2025`）
   ```ts
   chunkIdleTimeoutMs =
     chunkTimeout ?? (shouldUseBypassDispatcher(model.providerID, url) ? 5 * 60 * 1000 : undefined)
   ```
   传给 `wrapSSE`，由它做 per-chunk idle 超时——最后一个 chunk 后持续 5 分钟
   无新数据才 abort，防止服务端死锁，但不打断正常长输出。

3. `options.timeout` 保留为**可选硬上限**，用户想设绝对时长仍可配。

### 变化后的超时语义

| | 改前 | 改后 |
|---|---|---|
| 计时起点 | 请求发出时刻 | 最后一个 chunk 到达后 |
| 触发 | 满 5 分钟即断（不论是否在吐） | 连续 5 分钟无 chunk 才断 |
| 长输出 | 被切断 | 不断流 |

注意：undici dispatcher 的 `headersTimeout/bodyTimeout = 5min` 未动。这两个是
连接层读写超时，对 SSE 流 chunk 间隔影响有限；若实测仍断，需一并调大。

## 涉及文件

- `packages/opencode/src/provider/provider.ts`

## 验证

```bash
cd packages/opencode
bun run typecheck
# 长耗时 /make 场景不再在 5 分钟被掐断
```

## 相关记录

- 上个提交：`df4441eed` — `opencode_modify/fix-local-provider-proxy-bypass.md`
- fetch-debug 诊断链路：`opencode_modify/abort-controller-diagnostic.md`
