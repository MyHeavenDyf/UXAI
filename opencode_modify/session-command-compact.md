# session.command 支持 /compact（会话压缩）方案与进度

## 背景

`/make` 的输入框通过 `session.command` 提交命令，但 `/compact`（会话压缩）目前无法通过该路径使用。客户端侧对 `/compact` 的支持方式分几种：

- **TUI**：直接特判 command name，调用 `sdk.client.session.summarize()`（见 `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:482-507`），不经过 `Command.Service`。
- **ACP**：在 `availableCommands` 注入 "compact"，收到后在服务端特判直接调 `summarize`（见 `packages/opencode/src/acp/agent.ts:1199-1203` 和 `1540-1551`）。
- **/make（session.command）**：只处理注册在 `Command.Service` 中的命令（普通 command、MCP command、skill command），遇到未注册的命令名会抛出 `Command not found: "compact"` 错误。

用户希望在 `session.command` 中拦截 `compact`/`summarize` 命令，使其能触发与 TUI 相同的会话压缩流程，且**不修改前端、只改后端**。

## 方案一（已选定）：在 SessionPrompt.command() 中拦截

拦截点选在 `SessionPrompt.command()` 的 `commands.get(input.command)` 之前，而不是把命令注册进 `Command.Service`。理由：

- `Command.Service` 的 state 会缓存所有命令（含 skill command、MCP prompt command），在里面塞一个带副作用、需要实时会话上下文的 "compact" 命令会和现有命令语义混杂；
- 拦截点离 `loop()` / `compaction` / `lastModel` 等闭包最近，能直接复用 SessionPrompt layer 内已有的服务依赖（`sessions`、`agents`、`revert`、`compaction`、`loop`、`lastModel`），不需要新造服务或扩展依赖层。

处理流程与 `POST /session/{sessionID}/summarize` 路由 handler（`packages/opencode/src/server/routes/instance/session.ts:587-618`）保持一致：

1. `sessions.get(sessionID)` → `revert.cleanup(session)` 清理待撤销消息；
2. `sessions.messages({ sessionID })` 取完整消息，找最后一条 user 消息的 agent 作为当前 agent，找不到用 `agents.defaultAgent()`；
3. model：`input.model`（`"providerID/modelID"` 格式）用 `Provider.parseModel()` 解析；未提供则用 `lastModel(sessionID)`（现有闭包，取最后一条带 model 的 user 消息，否则 provider 默认模型）；
4. `compaction.create({ sessionID, agent, model, auto: false })` 创建压缩用户消息（`auto: false` 表示手动压缩）；
5. `loop({ sessionID })` 执行真实摘要，返回 `MessageV2.WithParts`。

`auto: false` 的手动压缩，`loop()` 中 `runLoop` 处理 compaction task 时（`prompt.ts:1538-1549`）会在压缩完成后 `break`，不会继续追问模型（自动压缩才 `continue`），与手动 summarize 语义一致。

## 已完成的实现

### 1. 服务端拦截（packages/opencode/src/session/prompt.ts）

新增 `compactCommand` 闭包（位于 `command` 定义之前，约 line 1749-1770）：

```typescript
// /make 等客户端走 session.command,无法直接调 session.summarize(TUI/ACP 是特判直接调)。
// 这里在 commands.get 之前拦截 compact/summarize,按 summarize 路由同样的逻辑触发会话压缩:
// 清理待撤销消息、解析 model、创建压缩用户消息,再 loop 执行真实摘要。
const compactCommand = Effect.fn("SessionPrompt.compactCommand")(function* (input: CommandInput) {
  const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
  yield* revert.cleanup(session)
  const msgs = yield* sessions.messages({ sessionID: input.sessionID })
  const defaultAgent = yield* agents.defaultAgent()
  const currentAgent = msgs.findLast((m) => m.info.role === "user")?.info.agent ?? defaultAgent

  const model = input.model
    ? Provider.parseModel(input.model)
    : yield* lastModel(input.sessionID)

  yield* compaction.create({
    sessionID: input.sessionID,
    agent: currentAgent,
    model,
    auto: false,
  })
  return yield* loop({ sessionID: input.sessionID })
})
```

在 `command` 最前面拦截（prompt.ts:1772-1776）：

```typescript
const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
  yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
  if (input.command === "compact" || input.command === "summarize") {
    return yield* compactCommand(input)
  }
  const cmd = yield* commands.get(input.command)
  ...
```

关键点：

- 拦截词 `compact` / `summarize` 与 TUI 的 slash 定义（`name: "compact", aliases: ["summarize"]`）保持一致；
- `CommandInput` 已有 `model?: string`（`"providerID/modelID"` 格式）和 `agent?: string` 字段（prompt.ts:1967-1994），无需改 schema；
- model 解析复用现有 `Provider.parseModel()`（`packages/opencode/src/provider/provider.ts:2455-2461`）和 `lastModel()`（prompt.ts:950-954），与 `command` 里 `taskModel` 的解析方式一致。

### 2. 命令注册 stub（packages/opencode/src/command/index.ts）

为了让 make 的多斜杠检测（`packages/app/octoapp/pages/make/index.tsx:2498-2617`）识别 `/compact`，必须让它出现在 `sync.data.command` 中——该列表由 bootstrap 阶段 `input.sdk.command.list()` 填充，后者枚举 `Command.Service` 的 state。因此把 `compact` / `summarize` 以 stub 命令注册进 `Command.state`：

- `Command.state`（command/index.ts:80-176）新增 `commands[Default.COMPACT]`（`name: "compact"`）与 `commands["summarize"]`：
  ```typescript
  commands[Default.COMPACT] = {
    name: Default.COMPACT,
    description: "summarize and compact the current session",
    source: "command",
    get template() {
      return PROMPT_COMPACT
    },
    hints: [],
  }
  commands["summarize"] = {
    name: "summarize",
    description: "alias of /compact, summarize and compact the current session",
    source: "command",
    get template() {
      return PROMPT_COMPACT
    },
    hints: [],
  }
  ```
- 模板文件 `packages/opencode/src/command/template/compact.txt`（内容 "Compact this session."）——stub 的执行路径**永远到不了**（`SessionPrompt.command()` 会在 `commands.get()` 之前拦截这两个名字），模板仅用于满足 `Info` schema 的 `template` 字段，保证类型与序列化完整。
- `Command.Default` 新增 `COMPACT: "compact"`。

效果：`GET /command` → `command.list()` 现在返回 compact/summarize → 前端 `sync.data.command` 命中 → make 输入 `/compact` 时走 `session.command({ command: "compact" })` → 服务端拦截触发压缩。**未触碰** `Command.Service` 之外的注册语义，也没有让 stub 命令能被执行到模板。

> 前端适配范围：make 一侧的识别完全由后端注册 stub 驱动、**make 前端零改动**；insight 发送路径没有斜杠分支，其前端适配由 insight 团队另行处理（本任务只负责 command 注册，不改 /insight 前端代码）。

## 复用/参考的现有代码

| 用途 | 位置 |
|------|------|
| summarize 路由 handler（对本流程建模） | `packages/opencode/src/server/routes/instance/session.ts:587-618`（Hono 版）、`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:240-259` |
| `SessionCompaction.create()` 签名 | `packages/opencode/src/session/compaction.ts:690-718` |
| `lastModel()` 闭包 | `packages/opencode/src/session/prompt.ts:950-954` |
| `Provider.parseModel()` | `packages/opencode/src/provider/provider.ts:2455-2461` |
| `CommandInput` schema（已含 model/agent） | `packages/opencode/src/session/prompt.ts:1967-1994` |
| TUI /compact 定义（拦截词来源） | `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:482-507` |
| 手动压缩 loop 行为（auto=false 压缩后 break） | `packages/opencode/src/session/prompt.ts:1538-1549` |
| isSuccessful 判定（若返回 boolean） | `packages/opencode/src/session/compaction.ts:111-118` |
| make 多斜杠检测（根因：只认 sync.data.command） | `packages/app/octoapp/pages/make/index.tsx:2498-2617` |
| bootstrap 填充 sync.data.command | `packages/app/octoapp/context/global-sync/bootstrap.ts:265` |
| insight 发送路径（无斜杠分支 → 需前端补分支） | `packages/app/octoapp/pages/insight/index.tsx:1475`（promptAsync）、`1588`（handleSubmit） |

## 验证（已做）

已运行 `bun run --cwd packages/opencode typecheck`，通过（无类型错误输出）。

已新增 5 个测试并分别验证通过（`packages/opencode/test/session/prompt.test.ts`）：

| 测试 | 结果 |
|------|------|
| compact command creates compaction message and returns summary assistant | pass（7 expect） |
| summarize alias triggers the same compaction flow | pass（3 expect） |
| compact command uses provided model for compaction message | pass（4 expect） |
| compact command without model falls back to last model | pass（4 expect） |
| regular command still resolves through Command.Service | pass（3 expect，确认 stub 注册不影响普通命令） |

运行方式：`bun run --cwd packages/opencode test test/session/prompt.test.ts -t "compact command"` 等按用例名过滤。

注意：完整跑 `test/session/prompt.test.ts` 时，文件内另有 13 个既有测试失败（如 "glob tool keeps instance context"、cancel/shell 系列、unknown agent），均为超时/取消类测试，与本改动无关，属于仓库既有环境问题。

## 待办

- [x] 追加测试：在 `packages/opencode/test/session/prompt.test.ts` 新增 describe/用例，覆盖 `/compact`、`/summarize` 别名、model 解析、默认 model、普通命令不受影响。
- [x] 运行测试并修复断言/类型问题。
- [x] 最终 diff 涉及文件清单确认。
- [x] 注册 compact/summarize stub 到 `Command.Service`（command/index.ts + template/compact.txt），使 `command.list()` → `sync.data.command` 返回它们。
- [ ] 重启桌面端，验证 /compact 在 make 中真正触发压缩（make 前端零改动）。
- [ ] insight 前端适配（发送路径无斜杠分支）由 insight 团队另行处理，本任务不涉及。

## 涉及文件（最终）

- `packages/opencode/src/session/prompt.ts`（已改：新增 `compactCommand` 闭包 + `command()` 开头拦截）
- `packages/opencode/src/command/index.ts`（已改：`Default.COMPACT` + compact/summarize stub 注册）
- `packages/opencode/src/command/template/compact.txt`（新增：stub 模板，仅满足 schema，不会被执行）
- `packages/opencode/test/session/prompt.test.ts`（已改：新增 5 个用例 + `test-model-2` 模型配置）
- `opencode_modify/session-command-compact.md`（本记录）

前端零改动（make / insight 均未修改）。

`git diff HEAD -- packages/opencode/src/session/prompt.ts` 确认改动仅 26 行（+26），未触碰 `Command.Service` 的执行路径、schema、路由层。

---

# 追加：/compact 输入回显与完成提示（2026-09-02）

## 需求

`/compact` 在 make 输入框发送后，聊天流中要能看到用户这条输入（此前完全不可见），并且压缩完成后有完成提示。**只显示手动压缩**：自动压缩（auto）与 summarize 按钮路径的内容继续保持隐藏。

## 根因

1. `/compact` 输入不可见：`compaction.create()` 创建的用户消息只有 compaction part、无 text part；且 make 页 `userMessages()` 的 `visible` 过滤器（make/index.tsx）把带 compaction part 的用户消息整个排除。
2. 完成提示缺失：命令路径只 `await session.command(...)`，响应未被用于提示；v2 SSE 事件（`session.next.compaction.*`）受 `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` flag 门控、桌面端未开启，不可依赖。

## 实现

### 后端

- `packages/opencode/src/session/compaction.ts`：`create()`（Interface + 实现两处）新增可选 `message?: string`；有值时在 compaction part 后追加 `synthetic: true` 的 text part（`satisfies MessageV2.TextPart`）。
- `packages/opencode/src/session/prompt.ts`：`compactCommand` 构造显示文本 `trimmedArgs ? \`/${command} ${trimmedArgs}\` : \`/${command}\`` 并传入 `compaction.create({ ..., message: displayText })`。

synthetic 的选择依据：make 页 `userText()` 取第一个 text part（不检查 synthetic）→ 显示；标准 UI 的 Message 组件过滤 synthetic text part（packages/ui/src/components/message-part.tsx）→ session 页不会重复显示；进入模型上下文无害（text part 不区分 synthetic，出现在 compaction 的 "What did we do so far?" 前，语义自然）。

### 前端（packages/app/octoapp）

- `pages/make/index.tsx` `visible` 过滤器：带 compaction part 的用户消息，仅当同时带 text part（即手动路径）才显示；自动压缩（无 text part）与 summarize 按钮路径（未传 message）保持隐藏。
- `pages/make/components/insight-turn.tsx`：
  - 新增 `isCompactionTurn`（用户消息带 compaction part）、`compacted`（摘要 assistant 消息 `summary === true && finish && !error`，与后端 `isSuccessful` 一致）、`compactionFailed`（有 error 且未成功）三个 memo。
  - 压缩 turn 渲染三态：运行中显示"正在压缩上下文…"pill（蓝色脉冲点）；完成显示 `MessageDivider`（i18n `ui.messagePart.compaction` = "会话已压缩"，packages/ui i18n 已有该 key）；失败显示红色提示块。
  - 压缩 turn 的正常 assistant 内容（reasoning/prose/工具/卡片/WaitingPill/turnMeta/阻塞提示等）整体包进 `<Show when={!isCompactionTurn()}>` 抑制渲染；用户气泡自动显示 "/compact"（`userText()` 命中 synthetic text part）。
- `pages/make/index.tsx` 命令执行循环：`session.command` 响应为 `{ data: { info, parts }, error }`（openapi-fetch 包装），对 compact/summarize 检查 `info.summary === true && info.finish && !info.error` → `showOctoToast({ title: "上下文压缩完成" })`，否则/抛错时显示"上下文压缩失败"toast（与 compactContext 按钮路径风格一致）。

## 验证

- `bun run --cwd packages/opencode typecheck`、`bun run --cwd packages/app typecheck` 均通过。
- `bun run --cwd packages/opencode test test/session/prompt.test.ts` compact 相关 6 用例全过（新增 "compact command with arguments echoes them in the compaction text part"，并在既有用例中断言 text part 内容 `/compact`、`/summarize` 及 `synthetic: true`）。

## 本次涉及文件

- `packages/opencode/src/session/compaction.ts`（Interface + create() 加 message 参数、synthetic text part）
- `packages/opencode/src/session/prompt.ts`（compactCommand 传显示文本）
- `packages/app/octoapp/pages/make/index.tsx`（visible 过滤器 + 命令循环 toast）
- `packages/app/octoapp/pages/make/components/insight-turn.tsx`（压缩 turn 三态渲染）
- `packages/opencode/test/session/prompt.test.ts`（断言扩充 + 新用例）
- `opencode_modify/session-command-compact.md`（本记录）

## 待验证

- [ ] 重启桌面端实测：make 输入 `/compact` → 显示用户输入 → 运行中 pill → 完成 divider + toast；失败场景（断网/模型错误）toast。