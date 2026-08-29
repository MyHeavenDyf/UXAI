# Design 上下文进度与压缩改动说明

## 1. 文档目的

本文记录 Design 会话上下文进度、模型上下文上限、超限处理和主动压缩相关改动，并明确后续迁移方向。

> **重要结论：当前点击进度圈后直接调用 `session.summarize` 的主动压缩方式是临时方案，不是最终方案。**
>
> 最终方案应统一走 `/compact`：用户点击进度圈并确认后，由客户端发送 `/compact`，通过统一命令链路完成压缩。当前 Make 页的内置命令权限尚未放开，`/compact` 暂时不可用，所以现阶段只能保留临时直调方案。

后续 `/compact` 可用后，需要替换临时方案，并还原本次为“直接主动压缩”增加的专用代码。不能直接回滚整批提交，否则会同时丢失仍需保留的 Token 进度、真实 usage、模型上限和上下文超限保护。

## 2. 本次改动范围

### 2.1 Design 标题栏上下文进度

- 在会话标题旁增加上下文进度圈。
- 悬浮展示当前上下文 Token 和模型上限。
- 进度圈基于当前选中模型重新计算；从大模型切换到小模型时，上限同步变化。
- 优先使用模型的 `limit.input`，没有时使用 `limit.context`。
- 自定义供应商未配置上下文上限时，默认使用 `128000`。
- 压缩完成后，进度以压缩摘要的上下文量重新展示。

上下文用量口径：

```text
context_tokens = input_tokens + cache_read_tokens + cache_write_tokens
context_percent = context_tokens / (limit.input ?? limit.context) × 100%
```

进度圈展示的是最近一次请求已经由供应商确认的输入上下文。当前轮的 `completion_tokens` 会在下一轮成为历史输入，并由下一轮的 `prompt_tokens` 统一统计；这里不把当前轮输出直接叠加到当前轮输入，避免混用两个时点的口径。也就是说，在下一次请求返回 usage 前，进度展示的是最近一次已确认的上下文量。

主要文件：

- `packages/app/octoapp/components/session/session-context-metrics.ts`
- `packages/app/octoapp/components/session/session-context-metrics.test.ts`
- `packages/app/octoapp/pages/make/index.tsx`
- `packages/opencode/src/provider/provider.ts`

### 2.2 真实 usage 与日志

OpenAI Compatible 流式请求需要携带：

```json
{
  "stream_options": {
    "include_usage": true
  }
}
```

供应商支持该参数时，最后一个数据块可以得到真实值：

```json
{
  "usage": {
    "prompt_tokens": 2061,
    "completion_tokens": 1388,
    "total_tokens": 3449
  }
}
```

进度和压缩判断应优先使用供应商返回的真实 usage，不再以本地估算值代替已返回的真实值。本地估算仍可用于请求发送前的 preflight，因为此时尚未获得本轮真实 usage。

每轮结束会输出 `context usage` 日志，包含：

- `providerID`
- `modelID`
- `input`
- `output`
- `total`
- `limit`
- `percent`

日志由服务端会话处理器输出，通常在启动 Octo/OpenCode 服务的终端中查看，而不是浏览器控制台。

主要文件：

- `packages/opencode/src/session/processor.ts`

### 2.3 自动压缩与上下文超限

自动压缩代码仍然保留，但当前通过以下开关屏蔽：

```ts
export const AUTOMATIC_COMPACTION_ENABLED = false
```

屏蔽自动压缩期间：

- 不在 85% 时自动生成压缩任务。
- 请求发送前如果已达到模型硬上限，直接拒绝请求。
- 流式响应结束时如果真实 usage 已达到硬上限，将本轮标记为上下文超限。
- 界面展示“当前对话上下文已达上限”。
- 提示文案为：“系统的单次处理能力已满。请点击‘新建对话’重置上下文。”

85% 阈值逻辑仍然保留，供未来重新开放自动压缩时使用；硬上限判断使用 100%。

主要文件：

- `packages/opencode/src/session/overflow.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/app/octoapp/pages/make/components/insight-turn.tsx`

### 2.4 当前主动压缩临时方案

当前交互：

1. 用户点击上下文进度圈。
2. 弹出二次确认框。
3. 用户点击“确认压缩”。
4. Make 页直接调用 `sdk.client.session.summarize(...)`。
5. 压缩期间进度圈不可再次点击，对话进行中也不可点击。
6. 完整且无错误的摘要生成后提示“上下文压缩完成”。
7. 用户暂停或压缩失败时不显示成功提示。

当前临时方案还处理了以下问题：

- 主动压缩只生成摘要，不让模型额外回复一条普通消息。
- 压缩结束后恢复空闲状态。
- 内部 compaction 消息不参与模型选择恢复，避免用户选择 B 模型压缩时界面又切回上一轮的 A 模型。
- 提示框固定显示在进度圈下方，箭头指向进度圈。

主要文件：

- `packages/app/octoapp/pages/make/index.tsx`
- `packages/app/octoapp/pages/make/octo-tokens.css`
- `packages/opencode/src/server/routes/instance/session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/test/session/compaction.test.ts`

## 3. `/compact` 当前状态与阻塞点

仓库中已经存在 `/compact` 的概念，但 Make 页尚未形成可用链路：

- `packages/app/octoapp/pages/make/use-make-commands.tsx` 已注册 `make.compact`，但 `onSelect` 仍是 TODO。
- Make 页暂时隐藏了内置 slash commands。
- Make 页发送逻辑当前只开放部分命令来源，`/compact` 不在已开放范围内。
- 因产品权限尚未放开，用户输入或程序发送 `/compact` 目前不能可靠触发压缩。

因此，现阶段不能简单把进度圈点击事件改成发送 `/compact`，否则点击后不会执行压缩。

## 4. 最终目标方案

权限开放后，主动压缩统一走以下链路：

```text
点击进度圈
  → 二次确认
  → 发送 /compact
  → 统一命令解析与权限校验
  → 命令层触发上下文压缩
  → 会话事件更新状态和进度
```

目标原则：

- 进度圈和用户输入 `/compact` 必须走同一条命令链路。
- Make 页不再直接调用 `session.summarize`。
- 压缩状态、暂停、错误和完成结果由统一命令/会话事件驱动。
- 不在 Make 页重复维护一套压缩生命周期。

## 5. `/compact` 开放后的实施步骤

### 第一步：开放命令

1. 放开 Make 页内置命令展示或程序化执行权限。
2. 实现 `use-make-commands.tsx` 中 `make.compact` 的 `onSelect`。
3. 确认 `/compact` 不会作为普通用户文本发送给模型。
4. 确认命令执行过程中可以暂停，并能正确产生完成、失败和取消状态。

### 第二步：切换进度圈入口

保留进度圈和二次确认 UI，将“确认压缩”后的动作从：

```ts
sdk.client.session.summarize(...)
```

改为调用统一 `/compact` 命令入口。不要在 UI 中模拟一条普通聊天文本；应调用与用户选择 slash command 相同的执行函数。

### 第三步：还原临时主动压缩代码

完成 `/compact` 联调后，按第 6 节清单还原临时代码，再验证压缩状态完全由统一命令链路驱动。

## 6. 临时主动压缩代码还原清单

### 6.1 必须还原或替换

#### `packages/app/octoapp/pages/make/index.tsx`

删除或替换以下临时逻辑：

- `compactContext()` 中对 `sdk.client.session.summarize(...)` 的直接调用。
- 仅服务于直调接口的 `contextCompacting` 本地生命周期。
- 依据 `result.data === true` 判断是否弹成功 Toast 的逻辑。
- 直调接口失败时由 Make 页自行拼装“上下文压缩失败”的逻辑；改由统一命令状态处理。

保留并复用：

- 进度圈展示。
- `contextTokens`、`contextLimit`、`contextUsage` 计算。
- 二次确认弹窗。
- 对话进行中禁止点击。
- Tooltip 及箭头样式。

确认按钮只需要改为执行统一 `/compact` 命令。

#### `packages/opencode/src/server/routes/instance/session.ts`

#### `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`

当前为了让直调方区分“真正完成”和“用户暂停”，接口返回：

```ts
SessionCompaction.isSuccessful(yield* prompt.loop(...))
```

统一 `/compact` 链路不再依赖 Make 页读取该布尔值后，可还原为原来的：

```ts
yield* prompt.loop(...)
return true
```

稳定 Hono 和 Effect HttpApi 两个实现应同步还原。虽然 Effect HttpApi 仍以实验性目录命名，但 `dev`、`beta` 和 `local` 渠道默认启用它；缺少这一修改会导致暂停压缩后接口固定返回 `true`，前端误报“压缩完成”。

#### `packages/opencode/src/session/compaction.ts`

如果没有其他调用方使用，删除仅为直调结果判断增加的：

```ts
SessionCompaction.isSuccessful(...)
```

#### `packages/opencode/test/session/compaction.test.ts`

删除 `session.compaction.isSuccessful` 对应测试；其他上下文计算、硬上限、85% 阈值和压缩流程测试继续保留。

### 6.2 联调后决定是否还原

#### `packages/opencode/src/session/prompt.ts`

当前手动压缩完成后执行：

```ts
if (!task.auto) break
```

用于阻止主动压缩后继续生成一条普通模型回复。若新的 `/compact` 命令层已经保证“只压缩、不回复”，应还原该临时分支；若命令最终仍复用同一 prompt loop，则应保留，否则会重新出现压缩后模型额外回复的问题。

#### `packages/app/octoapp/pages/make/index.tsx` 的 compaction 消息过滤

当前普通用户消息列表会排除内部 compaction 消息，防止压缩过程中模型选择从 B 切回 A。

如果 `/compact` 仍会向当前会话写入内部 compaction user message，建议保留过滤；只有确认统一命令链路不会污染模型恢复逻辑时才还原。

### 6.3 不应随主动压缩一起还原

以下改动与主动压缩入口无关，必须保留：

- 真实 usage 的读取和 `context usage` 日志。
- 上下文分子只统计 input/cache 的口径。
- `limit.input ?? limit.context` 的模型上限选择。
- 自定义供应商默认 `128000`。
- 自动压缩开关 `AUTOMATIC_COMPACTION_ENABLED = false`。
- 100% 硬上限阻断和用户警告。
- 85% 自动压缩阈值代码（保留但暂不启用）。
- Design 标题栏进度圈和 Tooltip。
- 供应商编辑按钮只对自定义供应商显示的限制。

## 7. TUI 改动说明

以下文件只修正终端 TUI 的上下文显示，不影响桌面端 Design：

- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/subagent-footer.tsx`

如果本次 PR 只服务桌面端，可以将这 3 处恢复为 `dev`，以缩小改动范围。如果希望 TUI 与桌面端使用同一上下文口径，则可以保留。

## 8. 相关提交

基础功能已经合入 `dev`：

- `0767daabd`：Design 标题栏显示 Token 进度。
- `2e7fa81fb`：只有自定义供应商显示编辑按钮。
- `0d851a99b`：自动压缩阈值改为 85%。

当前分支的后续修正：

- `b03cfaf87`：使用真实上下文 usage 和正确模型上限。
- `916d4bb03`：自定义上限、屏蔽自动压缩、超限提示及主动压缩临时入口。
- `5e84561e7`：补充 100% 硬上限警告。
- `1b2925cc8`：主动压缩只生成摘要，不额外回复。
- `5330cb4c4`：压缩后刷新进度和状态。
- `ec97b2e16`：暂停压缩时不再误报成功。
- `7498bf312`：压缩时保持用户选择的模型。
- `fae596433`：增加二次确认并修正 Tooltip 箭头。

## 9. 回归验证清单

### 当前临时方案

- A 模型完成一轮对话后切换 B，点击压缩，实际压缩模型和界面选择均保持 B。
- 对话进行中不可点击进度圈。
- 点击进度圈先显示二次确认。
- 点击取消不发起压缩。
- 压缩过程中点击暂停，不显示“压缩成功”。
- 压缩成功后不产生普通模型回复。
- 压缩成功后进度下降、状态恢复空闲。
- 达到硬上限后中断并展示指定警告。

### 切换 `/compact` 后

- 点击进度圈与手动输入 `/compact` 走同一个命令处理函数。
- `/compact` 不作为普通文本发送给模型。
- 权限不足时给出明确提示，不静默失败。
- 暂停、失败和成功状态正确。
- 不重复压缩、不额外回复。
- 内部 compaction 消息不显示、不切换模型。
- 进度、模型上限和超限保护不受入口替换影响。
