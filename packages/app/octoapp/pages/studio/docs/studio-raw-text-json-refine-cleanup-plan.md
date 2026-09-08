# Studio Prompt Refine Raw Text JSON 整理方案

## 背景

Studio 引入 LLM prompt refine 后，用户机出现 `Studio prompt refine timed out`。排查日志显示请求能够完成模型选择、provider 解析、`chat.params` / `chat.headers`，并在 `transform-params:done` 后超时。

进一步定位发现：

- `generateObject + wrapLanguageModel + ProviderTransform.message` 在部分 provider 通道下会卡住。
- `streamText + language + 手动解析 JSON` 可以成功拿到 `{ assistantText, refinedPrompt }`。
- 问题不应该用 `resolved.providerID.startsWith("opencode")` 这类硬编码修复，因为未来其它 provider 可能出现同类兼容问题。

因此整理方向是：Studio prompt refine 统一改为 raw text JSON 路径，去掉诊断期间加入的大量 stage 日志，只保留模型与参数摘要日志。

## 修改文件

### `packages/opencode/src/studio/studio-service.ts`

只修改 Studio prompt refine 相关逻辑。

## 具体修改项

### 1. 调整 AI SDK import

当前位置：文件顶部 import 区域。

删除不再需要的结构化输出和 wrapper：

```ts
generateObject
streamObject
wrapLanguageModel
```

保留：

```ts
streamText
type ModelMessage
```

整理后目标：

```ts
import { streamText, type ModelMessage } from "ai"
```

如果 `ModelMessage` 后续可由局部变量推断，也可以进一步移除。

### 2. 保留并整理 JSON 解析 helper

当前位置：`promptRefineSchema` 附近。

保留 `parsePromptRefineText(text: string)`，用于从模型普通文本输出中解析结构化结果。

要求支持：

- 纯 JSON
- ```json fenced code block
- 前后混入少量说明文字时，截取第一个 `{` 到最后一个 `}`

建议返回 `StudioPromptRefineResult` 需要的核心结构：

```ts
{
  assistantText: string
  refinedPrompt: string
}
```

解析失败返回 `undefined`，由上层决定 fallback。

### 3. 删除诊断 stage 日志

当前位置：`refineStudioPrompt()` 开头及内部各阶段。

删除：

- `started`
- `currentStage`
- `debugStage`
- `start`
- `select-model:*`
- `get-model:*`
- `get-provider:*`
- `get-language:*`
- `auth:*`
- `build-input:*`
- `provider-options:*`
- `chat-params:*`
- `chat-headers:*`
- `params:*`
- `call-params:*`
- `transform-params:*`
- `generate-object:*`
- `stream-object:*`
- `opencode-text:*`

保留 catch 中的 warn，但改为更简洁的失败日志。

### 4. 保留模型调用日志

位置：完成 `selected`、`resolved`、`providerInfo`、`language` 获取后。

新增或保留一条模型日志：

```ts
console.log("[studio.service] prompt refine model", {
  sessionID: session.id,
  selectedProviderID: selected.providerID,
  selectedModelID: selected.modelID,
  resolvedProviderID: resolved.providerID,
  resolvedModelID: resolved.id,
  apiID: resolved.api.id,
  apiNpm: resolved.api.npm,
})
```

用途：确认 Studio refine 实际使用哪个 provider/model/api。

### 5. 保留参数摘要日志

位置：完成 `headers`、`providerOptions`、`messages` 构建后，调用 `streamText()` 前。

新增一条参数摘要日志：

```ts
console.log("[studio.service] prompt refine params", {
  sessionID: session.id,
  providerID: resolved.providerID,
  modelID: resolved.id,
  apiID: resolved.api.id,
  apiNpm: resolved.api.npm,
  temperature: chatParams.temperature,
  topP: chatParams.topP,
  topK: chatParams.topK,
  maxOutputTokens: chatParams.maxOutputTokens,
  messageRoles: messages.map((item) => item.role),
  messageContentLengths: messages.map((item) =>
    typeof item.content === "string" ? item.content.length : JSON.stringify(item.content).length,
  ),
  providerOptionsKeys: Object.keys(providerOptions),
  providerOptionsNestedKeys: Object.fromEntries(
    Object.entries(providerOptions).map(([key, value]) => [
      key,
      value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : typeof value,
    ]),
  ),
  headerKeys: Object.keys(headers),
})
```

注意：不要打印完整 prompt、用户输入、上下文、headers value、providerOptions value。

### 6. 统一走 raw text JSON 调用路径

位置：`refineStudioPrompt()` 内原来分支调用 `generateObject` / `streamObject` 的位置。

删除：

- `generateObject(params)`
- `streamObject(...)`
- `wrapLanguageModel(...)`
- `ProviderTransform.message(...)` middleware
- `resolved.providerID.startsWith("opencode")` 特判分支

改为统一：

```ts
const stream = streamText({
  model: language,
  temperature: chatParams.temperature,
  topP: chatParams.topP,
  topK: chatParams.topK,
  maxOutputTokens: chatParams.maxOutputTokens,
  messages,
  providerOptions,
  abortSignal: controller.signal,
  headers,
  maxRetries: 0,
  onError: (error) => {
    console.warn("[studio.service] prompt refine stream error", error)
  },
})
```

### 7. 保留 provider 输出 token 配置

位置：`chatParams` 获取后。

本次整理不额外限制 `maxOutputTokens`。

原因：

- 当前失败根因已经定位到 `wrapLanguageModel + ProviderTransform.message`，不是输出 token 上限。
- Studio prompt refine 的 system prompt 已要求只输出短 JSON。
- 本机其它 provider 即使 `maxOutputTokens` 较大也能正常结束。

因此调用 `streamText()` 时直接沿用 `chat.params` 后的值：

```ts
maxOutputTokens: chatParams.maxOutputTokens
```

### 8. 解析成功后主动 abort

位置：消费 `stream.fullStream` 的循环内。

逻辑：

```ts
let text = ""
for await (const part of stream.fullStream) {
  if (part.type === "error") throw part.error
  if (part.type !== "text-delta") continue

  text += part.text
  const parsed = parsePromptRefineText(text)
  if (!parsed) continue

  controller.abort()
  return {
    assistantText: parsed.assistantText.trim(),
    refinedPrompt: parsed.refinedPrompt.trim(),
    effectivePrompt: parsed.refinedPrompt.trim(),
    raw: parsed,
  }
}
```

说明：不等待 provider 自然结束。只要完整 JSON 已经可解析，即可结束 Studio refine。

### 9. 流结束后兜底解析

位置：`for await` 循环后。

如果流自然结束但循环中没有提前解析成功，再尝试一次：

```ts
const parsed = parsePromptRefineText(text)
if (parsed) {
  return {
    assistantText: parsed.assistantText.trim(),
    refinedPrompt: parsed.refinedPrompt.trim(),
    effectivePrompt: parsed.refinedPrompt.trim(),
    raw: parsed,
  }
}
```

仍失败则抛错进入 fallback：

```ts
throw new Error("Studio prompt refine did not return valid JSON.")
```

### 10. 精简失败日志

位置：`refineStudioPrompt()` catch 块。

目标：

```ts
console.warn("[studio.service] prompt refine failed", {
  sessionID: session.id,
  capability: input.capability,
  error,
})
```

然后继续：

```ts
return promptRefineFallback(input)
```

## 整理后的流程

1. 判断是否需要 LLM refine。
2. 选择 session model 或 default model。
3. 获取 resolved model、providerInfo、language。
4. 打印模型日志。
5. 构建 system/user messages。
6. 通过 `ProviderTransform.options`、`chat.params`、`chat.headers` 构建兼容参数。
7. 打印参数摘要日志。
8. 用 `streamText({ model: language })` 发起普通文本请求。
9. 持续收集 `text-delta`。
10. 一旦解析出合法 JSON，主动 abort 并返回。
11. 如果失败或超时，fallback 到拼接提示词。

## 验证点

运行：

```bash
cd packages/opencode
bun typecheck
```

验证 Studio：

- 本机 DeepSeek 等正常 provider 仍能 refine。
- 用户机原先超时的 provider 能成功返回。
- 日志中只保留：
  - `[studio.service] prompt refine model`
  - `[studio.service] prompt refine params`
  - 必要的 warn/error
- 用户气泡仍显示用户原文。
- assistant 气泡显示 `assistantText`。
- 最终生图 prompt 使用 `refinedPrompt`。

## 后续暂不处理

本方案暂不处理：

- refine 阶段取消按钮
- HTTP 请求断开联动 abort
- generation 状态拆分为 `refining_prompt` / `submitting_generation`
- LLM refine 失败重试
- 将 raw text JSON 抽成公共 provider 兼容工具
