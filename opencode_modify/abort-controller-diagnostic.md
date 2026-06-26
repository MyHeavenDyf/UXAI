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
  - 时间戳 + 全局调用编号（便于关联多次 abort）
  - `reason`（兼容 `Error` / `string` / `object`，含 cause）
  - **完整 stack**（不限行数，原始保留）
  - 业务代码帧（Top 5）单独提取
  - `FromUserCode` 标记：用于过滤纯 Node 内部调用
- **三路并行写入**（保证至少一路可见）：
  1. **独立日志文件**：`<Global.Path.log>/abort-debug.log`
     - Linux/macOS: `~/.local/share/opencode/log/abort-debug.log`
     - Windows: `%LOCALAPPDATA%\opencode\log\abort-debug.log`
  2. **opencode 主日志**：通过 `Log.Default.error` 写入（`dev.log` 或 `<时间戳>.log`）
  3. **stderr**：运行时实时可见
- **写入失败可见**：所有 `try/catch` 都不静默吞，错误会输出到 stderr，必要时降级写到 `os.tmpdir()/opencode-abort-debug-failed.log`
- **启动标记**：模块加载时同步创建空 `abort-debug.log` 文件并写 boot 消息，用于验证 monkey-patch 是否真正生效（若文件不存在，说明构建未重新执行）
- **环境变量**：
  - `OPENCODE_ABORT_DEBUG=0` 临时禁用
  - `OPENCODE_ABORT_DEBUG_LOG=/path/to/file` 自定义独立日志路径
- 启动时打标记日志，确认 patch 已生效

### 修改：`packages/opencode/src/index.ts`

在文件**第一行**（所有 import 之前）新增：

```ts
import "@/util/debug-abort"
```

利用 ES module 副作用执行特性，保证 monkey-patch 在任何业务代码运行之前生效（即所有 fetch / abortSignal 链路启动前）。

## 涉及文件

- `packages/opencode/src/util/debug-abort.ts`（新增）
- `packages/opencode/src/index.ts`（顶部加一行 import）

## 验证方法

### 关键：必须重新构建 opencode，否则 monkey-patch 不生效

```bash
# 在 packages/opencode 下构建（具体命令按项目约定）
cd packages/opencode
bun run build   # 或对应 dev:build 命令
```

### 确认 monkey-patch 已生效

启动 opencode 后，stderr 应出现：

```
[2026-06-26T...] === abort-debug monkey-patch installed ===
Log file: /完整绝对路径/abort-debug.log
To disable: OPENCODE_ABORT_DEBUG=0
```

同时以下文件应被创建（即使没触发 abort 也会存在）：

```
<Global.Path.log>/abort-debug.log    # 空文件 + boot 消息
```

若文件**不存在**，说明构建未生效或 patch 未加载，需排查：
- 是否运行了 `bun run build`
- 是否运行的是新构建产物（而非旧版本）
- turbo 缓存：`bun turbo typecheck --force`

### 触发 abort 后查看日志

```bash
# 主日志目录
ls ~/.local/share/opencode/log/        # Linux/macOS
ls "$LOCALAPPDATA/opencode/log/"       # Windows

# 查看 abort 独立日志
cat ~/.local/share/opencode/log/abort-debug.log

# 或在 opencode 主日志里搜索
grep "abort-debug" ~/.local/share/opencode/log/dev.log
```

关注 `FromUserCode: YES` 的条目，看 `Top user-code frames` 第一帧，就是触发 abort 的业务代码位置。

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
