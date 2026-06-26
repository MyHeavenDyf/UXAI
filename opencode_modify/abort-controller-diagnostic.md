# AbortController 调用诊断 Monkey-Patch

## 背景

octo AI 预制 provider 下的对话（包含主对话与 title 生成任务）频繁报错：

```
AI_RetryError (maxRetriesExceeded) / AI_APICallError
  └── cause.cause: { name: "AbortError", code: "UND_ERR_ABORTED" }
  └── url: http://octoai-llm.ucd.huawei.com/v1/chat/completions
  └── requestBodyValues.model: DeepSeek-V4-Flash
```

排查现象：
- **几秒内必现**（排除 5 分钟级 timeout）
- **每次都失败**（排除偶发网络抖动）
- **curl 同 URL 能拿到 SSE 流**（排除服务端、网络层、API Key、URL）

`UND_ERR_ABORTED` 是 undici 的特有错误码，**唯一触发条件**是 fetch 的 signal 被 abort。也就是说，必然有业务代码主动调用了 `AbortController.prototype.abort()`。

要精确定位是哪条调用链触发的 abort，只能 monkey-patch `AbortController.abort`，在每次调用时打印完整调用栈。

## 修改内容

### 新增：`packages/opencode/src/util/debug-abort.ts`

monkey-patch 模块，覆盖 `AbortController.prototype.abort`：

- 每次调用时记录：
  - 全局调用编号
  - `reason`（兼容 `Error` / `string` / `object`，含 cause）
  - **完整 stack**（不限行数，原始保留）
  - 业务代码帧（Top 5）单独提取
  - `from_user_code` 标记：用于过滤纯 Node 内部调用
- **只通过 opencode 原生 Log 模块输出**：
  - 用 `Log.create({ service: "abort-debug" })` 创建专用 logger
  - 日志写入 opencode 主日志文件：`<Global.Path.log>/<dev|时间戳>.log`
  - Linux/macOS: `~/.local/share/opencode/log/dev.log`
  - Windows: `%LOCALAPPDATA%\opencode\log\dev.log`
  - 用 `grep "service=abort-debug"` 即可过滤
- **不再创建独立文件**：之前的 abort-debug.log 方案因构建/路径等问题难以发现，本次改为复用 opencode 原生日志通道，确保只要 opencode 主日志能写，abort 信息也能写
- **环境变量**：
  - `OPENCODE_ABORT_DEBUG=0` 临时禁用
- 启动时打标记日志，确认 patch 已生效

### 修改：入口文件顶部加 import

opencode 有多个运行入口，全部覆盖才能保证 monkey-patch 在任意启动方式下生效：

| 入口文件 | 触发场景 | 修改 |
|---|---|---|
| `packages/opencode/src/index.ts` | CLI 命令行模式（`opencode` 命令）| 顶部加 `import "@/util/debug-abort"` |
| `packages/opencode/src/node.ts` | **Desktop sidecar**（`virtual:opencode-server` 解析入口）| 顶部加 `import "@/util/debug-abort"` |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | TUI worker 进程 | 顶部加 `import "@/util/debug-abort"` |

利用 ES module 副作用执行特性，保证 monkey-patch 在任何 fetch / abortSignal 链路启动前生效。

**关键**：desktop sidecar 的入口是 `src/node.ts`（由 `script/build-node.ts` 构建到 `dist/node/node.js`），不是 `src/index.ts`。如果只在 `src/index.ts` 加 import，desktop 场景下 monkey-patch **不会**被加载。

## 涉及文件

- `packages/opencode/src/util/debug-abort.ts`（新增）
- `packages/opencode/src/index.ts`（顶部加一行 import）

## 验证方法

### 关键：必须重新构建 opencode，否则 monkey-patch 不生效

```bash
# 在 packages/opencode 下构建（具体命令按项目约定）
cd packages/opencode
bun turbo build --force
# 或：bun run build（具体看 package.json scripts）
```

### 确认 monkey-patch 已生效

启动 opencode 后，主日志文件最后应出现一条：

```
ERROR service=abort-debug monkey-patch installed started_at=...
```

主日志文件路径：
- Linux/macOS: `~/.local/share/opencode/log/dev.log`（开发模式）或 `~/.local/share/opencode/log/<时间戳>.log`
- Windows: `%LOCALAPPDATA%\opencode\log\dev.log`

```bash
# 验证 patch 已安装
grep "service=abort-debug" ~/.local/share/opencode/log/dev.log | head
# 期望：能看到 "monkey-patch installed" 这条
```

### 触发 abort 后查看日志

```bash
# 查看所有 abort-debug 日志
grep "service=abort-debug" ~/.local/share/opencode/log/dev.log

# 关注 from_user_code=YES 的条目
grep "service=abort-debug" ~/.local/share/opencode/log/dev.log | grep "from_user_code=YES"

# 看最近一条 abort 的完整信息（含 stack）
grep "service=abort-debug" ~/.local/share/opencode/log/dev.log | tail -1
```

每条 abort 日志格式：

```
ERROR service=abort-debug abort #<编号> from_user_code=YES reason=<...> top_frames=["..."] full_stack="Error\n    at ..."
```

`from_user_code=YES` 的条目，看 `top_frames` 第一帧就是触发 abort 的业务代码位置。

### 排查完成后

1. 删除 `packages/opencode/src/index.ts` 顶部的 `import "@/util/debug-abort"`
2. 删除 `packages/opencode/src/util/debug-abort.ts`

## 预期产出

每次 abort 调用会产出形如：

```
=========================================================
[2026-06-26T...] ABORT #3 (patch started at 2026-06-26T...)
FromUserCode: YES  <<< 关注这条
Reason: AbortError: This operation was aborted

--- Top user-code frames ---
at Object.abort (packages/opencode/src/util/debug-abort.ts:...)
at SessionProcessor.<anonymous> (packages/opencode/src/session/processor.ts:690)
...

--- Full Stack ---
Error
at Object.abort (packages/opencode/src/util/debug-abort.ts:...)
...
```

其中 **`Top user-code frames` 的第一帧就是触发 abort 的业务代码位置**，能直接回答"是谁主动 abort 了请求"这个问题。
