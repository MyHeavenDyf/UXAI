# 上下文自动压缩修复说明

## 1. 文档范围

- 分支：`fix/content_limit`
- 当前提交：`6c5ed515d`
- 涉及提交：
  - `0ca86c22c fix(opencode): correct bundled model limits`
  - `5b150850b fix(opencode): restore automatic context compaction`
  - `9a6034c84 fix(opencode): detect gateway input length overflow`
  - `3f3b818fe fix(opencode): harden context compaction flow`
  - `6c5ed515d fix(app): prevent compaction replay and scroll jump`

> 注意：`0ca86c22c` 对 `packages/opencode/api.json` 中模型上限的修改，已在 `5b150850b` 中完整撤回。当前分支相对修改前的 `api.json` 没有净变化，最终方案不依赖虚增模型上下文上限。

## 2. 修复目标

本分支修复以下问题：

1. OpenAI-compatible 网关流式响应没有稳定返回或解析 `usage`，导致客户端无法判断上下文是否接近上限。
2. 其他提供商缺失 `usage` 时，自动压缩逻辑没有 token 数据可用。
3. 请求在发送前已经超过模型上下文时，仍会直接发给提供商并报错。
4. 部分网关返回 `maximum input length` 文案时，没有被识别为上下文超限。
5. 压缩模型返回空内容或不完整摘要时，系统仍可能把它当作压缩成功。
6. 压缩后内部重放消息和摘要被 UI 当作普通聊天内容展示，造成旧内容重复显示。
7. 内部压缩消息成为自动滚动锚点，页面会跳回“会话已压缩”的位置。
8. 压缩是否成功、压缩耗时和实际摘要缺少可排查日志。

## 3. 当前触发流程

```text
用户发送消息
  |
  v
请求前本地估算完整输入 token
  |
  +-- 未达到可用阈值 --------------------------> 正常请求模型
  |
  +-- 历史导致超限，当前请求本身仍可容纳 ------> 先压缩，再继续请求
  |
  +-- 当前请求本身已经超限 --------------------> 拒绝请求，提示拆分附件

正常请求模型
  |
  +-- usage 达到阈值 --------------------------> 创建自动压缩任务
  |
  +-- usage 缺失 ------------------------------> 使用本地 token 估算后判断
  |
  +-- 提供商返回上下文超限 --------------------> 识别错误并尝试压缩恢复
```

自动压缩阈值定义在 [`packages/opencode/src/session/overflow.ts`](../packages/opencode/src/session/overflow.ts)：

```text
有独立 input 上限时：usable = input limit - reserved
没有独立 input 上限时：usable = context limit - max output tokens
```

`reserved` 默认取 `min(20,000, 模型最大输出 token)`。也可以通过 `compaction.reserved` 配置。

请求前预检有三种结果：

- `send`：完整输入未达到可用阈值，直接发送。
- `compact`：完整输入超限，但系统提示、工具定义和当前用户消息仍能放入上下文；先压缩旧历史。
- `reject`：不包含旧历史的必要输入也已经超限；压缩历史没有意义，直接提示减少或拆分文件。

## 4. 修改位置和功能

### 4.1 网关返回和解析 usage

文件：[`packages/console/app/src/routes/zen/util/provider/openai-compatible.ts`](../packages/console/app/src/routes/zen/util/provider/openai-compatible.ts)

修改内容：

- 流式请求强制增加 `stream_options.include_usage = true`。
- 合并已有的 `stream_options`，不覆盖调用方其他配置。
- 同时兼容 `data:{...}` 和 `data: {...}` 两种 SSE 格式。

作用：

- 网关能够向客户端回传流式 token 使用量。
- 避免由于 SSE 冒号后是否有空格不同而丢失 `usage`。

### 4.2 usage 缺失时本地估算

文件：

- [`packages/opencode/src/session/processor.ts`](../packages/opencode/src/session/processor.ts)
- [`packages/opencode/src/session/session.ts`](../packages/opencode/src/session/session.ts)
- [`packages/opencode/src/util/token.ts`](../packages/opencode/src/util/token.ts)

修改内容：

- 请求发送前估算系统提示、模型消息和工具定义的输入 token。
- 流式生成过程中累计文本、推理文本和工具调用参数长度，估算输出 token。
- 提供商返回的输入或输出 usage 为 `0`/缺失时，分别使用本地估算补齐。
- 提供商 usage 完整时，仍优先采用提供商的真实数据。
- 任一字段使用估算后，重新计算 `total`，避免沿用不完整的提供商 total。
- 使用本地估算时输出 `provider usage missing; using local token estimate` 警告日志。

估算规则：

- 普通非 CJK 文本按约 4 字符/token 估算。
- 汉字、日文假名和韩文字符按约 1 字符/token 估算，降低中文会话低估风险。
- Base64 媒体数据不按原始字符串长度计算，单个媒体使用固定估算值，避免 Base64 体积造成极端误判。
- 支持递归估算消息、工具参数等结构化对象，并防止循环引用。

### 4.3 请求发送前预检

文件：

- [`packages/opencode/src/session/overflow.ts`](../packages/opencode/src/session/overflow.ts)
- [`packages/opencode/src/session/processor.ts`](../packages/opencode/src/session/processor.ts)

修改内容：

- 增加 `preflight()`，在调用提供商前判断完整输入是否会超过可用上下文。
- 分别计算：
  - `estimatedInput`：全部待发送内容。
  - `unavoidableInput`：系统提示、工具定义和当前用户消息，即压缩历史后仍无法删除的内容。
- 历史过大时返回 `compact`，不先发送注定失败的请求。
- 当前请求本身过大时返回 `reject`，停止循环并提示拆分附件。
- 输出 `preflight context overflow` 日志，包含估算输入、必要输入、可用阈值、模型和提供商。

作用：

- 第一条消息附带大量文件时，不会进入无意义的“发送失败—压缩—再次失败”循环。
- 第二条消息发送前已经接近上限时，会先压缩旧历史。

### 4.4 提供商上下文超限错误识别

文件：[`packages/opencode/src/provider/error.ts`](../packages/opencode/src/provider/error.ts)

修改内容：

- 增加 `maximum input length is N tokens` 匹配规则。
- 流式错误体即使错误码不是 `context_length_exceeded`，只要错误消息符合上下文超限特征，也转换为 `ContextOverflowError`。

可识别示例：

```text
This model's maximum input length is 131071 tokens.
However, you requested 137089 tokens.
```

作用：提供商使用非标准错误码时，客户端仍能进入压缩恢复流程，而不是把它当作普通 API 错误直接结束。

### 4.5 压缩结果校验和成功日志

文件：[`packages/opencode/src/session/compaction.ts`](../packages/opencode/src/session/compaction.ts)

修改内容：

- 压缩摘要必须非空，并包含以下固定章节：
  - `Goal`
  - `Constraints & Preferences`
  - `Progress`
  - `Key Decisions`
  - `Next Steps`
  - `Critical Context`
  - `Relevant Files`
- 摘要为空或章节缺失时，将压缩标记为错误，不激活不完整摘要。
- 压缩失败输出 `compaction summary invalid` 日志。
- 压缩成功输出 `compaction completed` 日志，并记录：
  - `sessionID`
  - `providerID`
  - `modelID`
  - 输入/输出 token
  - 压缩耗时 `duration_ms`
  - 保留内容起点 `tail_start_id`
  - 完整压缩摘要 `summary`
- 压缩后为继续原请求而生成的内部重放内容增加：
  - `synthetic: true`
  - `metadata.compaction_replay: true`
- 媒体附件在重放时只保留文字占位，不再次把大媒体发送进上下文。

作用：

- 只有结构完整的摘要才算压缩成功。
- 可以从日志确认压缩是否真实调用了模型、耗时多久、生成了什么摘要。
- UI 和插件可以准确识别内部重放内容。

### 4.6 压缩 UI 状态和重复内容处理

文件：

- [`packages/ui/src/components/message-part.tsx`](../packages/ui/src/components/message-part.tsx)
- [`packages/ui/src/components/session-turn.tsx`](../packages/ui/src/components/session-turn.tsx)

修改内容：

- `compaction_replay` 内部用户消息不显示为普通用户气泡。
- 成功的摘要助手消息不显示为普通助手回复，避免压缩后的旧内容再次出现在会话中。
- 摘要生成失败时仍显示错误，不能把失败静默隐藏。
- 只有摘要已经完成且无错误时，才显示“会话已压缩”分隔线。

作用：用户只看到一次“会话已压缩”状态，不会看到旧内容重复展示，也不会在压缩尚未成功时提前看到成功提示。

### 4.7 防止压缩时滚动跳转

文件：

- [`packages/app/src/pages/session/message-timeline.tsx`](../packages/app/src/pages/session/message-timeline.tsx)
- [`packages/app/octoapp/pages/session/message-timeline.tsx`](../packages/app/octoapp/pages/session/message-timeline.tsx)

修改内容：

- 选择当前活动消息和自动滚动锚点时，跳过包含 `compaction` part 的内部用户消息。
- 标准 App 和 Octo 桌面端保持相同行为。

作用：压缩发生时，滚动位置继续跟随真实用户请求和生成中的回复，不再跳回上方“会话已压缩”的位置。

## 5. 配置项

自动压缩默认开启，可以在 OpenCode 配置中调整：

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 20000,
    "tail_turns": 2,
    "preserve_recent_tokens": 8000
  }
}
```

- `auto`：是否启用基于 token 阈值的自动压缩，默认 `true`。
- `prune`：是否裁剪过旧的工具输出，默认 `true`。
- `reserved`：为压缩和模型输出预留的 token。
- `tail_turns`：压缩后最多原样保留的最近用户回合数，默认 `2`。
- `preserve_recent_tokens`：最近回合允许原样保留的 token 上限。

如果没有显式配置 `preserve_recent_tokens`，默认取可用上下文的 25%，且限制在 2,000～8,000 token。

也可以在会话中使用 `/compact` 手动压缩。

## 6. 测试覆盖

### 6.1 网关测试

文件：[`packages/console/app/test/openai-compatible-usage.test.ts`](../packages/console/app/test/openai-compatible-usage.test.ts)

覆盖：

- 流式请求自动开启 usage。
- 保留已有 stream options。
- 解析带空格和不带空格的 SSE usage。

### 6.2 压缩和 usage 测试

文件：[`packages/opencode/test/session/compaction.test.ts`](../packages/opencode/test/session/compaction.test.ts)

覆盖：

- usage 完全缺失时采用本地估算。
- usage 部分缺失时只补缺失字段并重新计算 total。
- provider usage 完整时优先使用真实值。
- CJK、结构化消息和 Base64 媒体估算。
- 压缩摘要完整性校验。
- 压缩成功/失败状态、尾部保留和内部重放标记。

### 6.3 请求处理测试

文件：[`packages/opencode/test/session/processor-effect.test.ts`](../packages/opencode/test/session/processor-effect.test.ts)

覆盖：

- provider usage 缺失时仍能触发压缩。
- 完整历史超限、当前请求可容纳时返回 `compact`。
- 当前请求本身超限时返回 `reject`。
- 上下文超限错误进入压缩恢复路径。

### 6.4 错误识别测试

文件：[`packages/opencode/test/session/message-v2.test.ts`](../packages/opencode/test/session/message-v2.test.ts)

覆盖 `maximum input length` 流式错误和普通错误的识别。

### 6.5 UI 验证

已执行：

- `packages/ui` 类型检查通过。
- `packages/app` 类型检查通过。
- `packages/ui` 测试：28 个通过，0 个失败。
- 定向压缩、usage 和预检测试通过。

开发环境运行完整 OpenCode 压缩测试时，部分 live 用例可能受 macOS FSEvents 或本地测试 HTTP 端口限制影响；相关失败属于测试运行环境初始化问题，不是断言失败。

## 7. 建议验收场景

1. **正常自动压缩**
   - 连续发送足够长的对话直到超过可用阈值。
   - 预期：出现一次“会话已压缩”，随后继续回答。

2. **usage 缺失**
   - 使用不返回流式 usage 的提供商。
   - 预期：日志出现本地估算警告，达到阈值后仍能自动压缩。

3. **历史过长，当前消息较小**
   - 在接近上限的长会话中发送一条短消息。
   - 预期：请求发送前先压缩，然后继续处理短消息。

4. **第一条消息附带过多文件**
   - 新会话第一条消息传入超过模型可用上下文的文件。
   - 预期：直接提示减少或拆分附件，不反复压缩重试。

5. **提供商返回非标准超限错误**
   - 返回包含 `maximum input length` 的错误。
   - 预期：错误被识别为上下文超限，并进入压缩恢复路径。

6. **压缩摘要异常**
   - 让压缩模型返回空内容或缺少固定章节。
   - 预期：显示压缩错误，不显示成功分隔线，不用无效摘要替换历史。

7. **UI 重复和滚动**
   - 在会话底部触发压缩。
   - 预期：旧内容不重复显示，页面不跳到上方“会话已压缩”位置。

## 8. 日志排查

重点日志关键字：

```text
provider usage missing; using local token estimate
preflight context overflow
compaction summary invalid
compaction completed
```

Windows 可以用以下 PowerShell 查找并持续查看最新日志：

```powershell
$dirs = @(
  "$env:USERPROFILE\.local\share\opencode\log",
  "$env:APPDATA\ai.octo.desktop\opencode\log",
  "$env:APPDATA\ai.octo.desktop.dev\opencode\log"
)
$log = Get-ChildItem -Path $dirs -Filter "*.log" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$log.FullName
Get-Content $log.FullName -Wait |
  Select-String "provider usage missing|preflight context overflow|compaction completed|compaction summary invalid"
```

开发版 macOS 日志目录通常为：

```text
~/.local/share/opencode/log
```

## 9. 最终有效修改文件清单

生产代码：

- `packages/console/app/src/routes/zen/util/provider/openai-compatible.ts`
- `packages/opencode/src/provider/error.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/overflow.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/util/token.ts`
- `packages/ui/src/components/message-part.tsx`
- `packages/ui/src/components/session-turn.tsx`
- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/octoapp/pages/session/message-timeline.tsx`

测试代码：

- `packages/console/app/test/openai-compatible-usage.test.ts`
- `packages/opencode/test/session/compaction.test.ts`
- `packages/opencode/test/session/message-v2.test.ts`
- `packages/opencode/test/session/processor-effect.test.ts`

