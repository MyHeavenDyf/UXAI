# sidecar OOM：压缩估算 structuredClone 移除

## 1. 文档范围

- 分支：`dev_dyf`
- 涉及文件：
  - `packages/opencode/src/session/prompt.ts`（本次修改）
  - `packages/desktop/src/main/server.ts`（关联修复，desktop 包）

## 2. 事故背景

2026-10-15 用户侧报障：desktop sidecar（utilityProcess 跑 opencode server）V8 OOM 崩溃
（`Zone Allocation failed - process out of memory`，exit code 5），之后所有对话不可见。

GC 日志关键事实：堆稳定在 ~80MB 运行 13 分钟后，**126ms 内涨至 233.9MB**，随后崩溃。
该分配模式与「会话引擎每轮循环全量物化会话历史」的代码路径吻合。

## 3. 根因：三层叠加

| 层 | 引入时间 | 内容 |
|---|---|---|
| 隐患（上游） | 2025-07-07 `f884766445` v2 消息引擎 | 构建上下文即全量物化整个会话（`filterCompactedEffect` → `stream()` 从 SQLite 读全部消息+parts） |
| 显性化（上游） | 2026-05-07 `54a78c9224` | desktop 把 server 从主进程搬进 utilityProcess，未设 `execArgv`，堆预算仅 ~250MB；同样的内存尖峰从「占用偏高」变成「进程崩溃」 |
| 加重（自有） | 2026-09-16 `c5294e950e` | `estimateCompactedContext` 对全量消息做 `structuredClone`，自动压缩估算时峰值再翻一倍——恰好在最接近 OOM 边缘的大会话上触发 |

内存放大链（一次 prompt loop）：

```
SQLite 全量行 → hydrate 对象（第 1 份）
             → toModelMessagesEffect 构建 ModelMessage[]（第 2 份）
             → estimateCompactedContext 里 structuredClone（第 3 份，仅 auto-compaction 估算时）
```

## 4. 本次修改

`prompt.ts` `estimateCompactedContext`：

```diff
-const messages = structuredClone(yield* MessageV2.filterCompactedEffect(input.sessionID))
+const messages = yield* MessageV2.filterCompactedEffect(input.sessionID)
```

### 为什么安全

- `filterCompactedEffect` → `stream()` → `page()` → `hydrate()` 每次都从 SQLite 读出**全新对象**，
  没有其他持有者，用完即丢；即使 `prepareRequest`/插件 transform 会 mutate 这些对象，
  也不会污染任何共享状态。
- 当初 `c5294e950e` 加 clone 无注释说明动机，属纯防御性拷贝，实际无保护对象。

### 关联修复（desktop 包，`server.ts`）

`utilityProcess.fork` 增加 `execArgv: ["--max-old-space-size=2048"]`，
将 sidecar 堆上限从 ~250MB 抬至 2GB，与普通 Node 子进程对齐，
直接撤销 2026-05-07 utilityProcess 迁移引入的脆弱性。

## 5. 验证

- `bun run typecheck` 通过。
- `packages/opencode/test/session/prompt.test.ts`
  「compact command creates compaction message and returns summary assistant」
  （覆盖估算链路 `SessionCompaction.Event.Estimated`）单独跑通过。
- 完整文件基线对比：修改前后均为 35 pass / 13 skip / 10 fail，失败名单完全一致
  （全部为 local provider 超时 / Insight 真调用等环境依赖的既有失败，与本次修改无关）。

## 6. 未处理的后续项（需单独规划）

1. `runLoop`（`prompt.ts` filterCompactedEffect 每 step 全量重物化）改增量加载——根因，
   涉及会话引擎核心，改动风险高。
2. 构建上下文时对超大历史 part 的截断护栏（`toolOutputMaxChars` 已有机制，需评估默认值）。
3. 对话消失的另一个独立风险：storage fallback 静默切空库
   （`storage.ts` `shouldRetryWithAppDataFallback` 命中 `unable to open database file` 即
   永久切 app-data-fallback 空库），建议加「旧库有数据时弹窗确认」防护，属 desktop 包。
