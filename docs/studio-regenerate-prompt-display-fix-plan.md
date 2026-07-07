# Studio 再次生成 prompt 与气泡展示修复方案

## 背景

Studio 点击“再次生成”后，目前出现了三类问题：

1. 点击按钮后短暂出现两组对话和两张 `studio-result-card`：
   - 一组用户气泡是 `再次生成`
   - 另一组用户气泡是被再次生成任务的最终 prompt
   - 之后又只剩 `再次生成` 这一组
2. “再次生成”没有经过 LLM 对话，但后端 fallback 仍把上一轮成功任务 prompt 拼进本次 prompt，最终 prompt 中出现：
   - 上一轮任务 prompt
   - `延续上一轮画面：...` 这类拼接标志
3. 点击“再次生成”后切换到其它 session，再切回来，原本显示 `再次生成` 的用户气泡变成完整最终 prompt。

这三个问题的共同根因是：前端临时态里的展示文案 `displayPrompt` 和真实生成 prompt 在传输、持久化、fallback 生成、历史水合之间没有稳定对齐。

## 目标

再次生成链路需要满足：

- 用户气泡始终显示 `再次生成`
- assistant 文案固定显示 `好的，我会按当前结果的配置重新生成。`
- 最终生成接口使用被操作结果的真实最终 prompt
- `再次生成` 不能触发 LLM 润色，也不能 fallback 拼接上一轮 prompt
- session 切换、刷新、历史水合后，用户气泡仍显示 `再次生成`
- 点击时不应短暂出现两个对话 turn 或两个 `studio-result-card`

## 核心设计

将一次生成拆成两个语义不同的字段：

- `displayPrompt`：只用于对话 UI 展示。再次生成固定为 `再次生成`
- `effectivePrompt`：用于真实生成接口。再次生成复用被操作结果的最终 prompt

再次生成不再把“用户气泡展示文本”当作“生成 prompt”，也不再把“生成 prompt”当作“用户气泡展示文本”。

## 修改 1：HTTP API payload 保留 regenerate 字段

### 文件

- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

### 问题

前端 `createStudioGeneration()` 已经向 `/studio/generations` 发送：

```ts
displayPrompt: input.displayPrompt,
refinedPrompt: input.refinedPrompt,
effectivePrompt: input.effectivePrompt,
```

但 HTTP API schema `StudioGenerationPayload` 没有定义这三个字段，handler 转调 `createGeneration()` 时也没有传下去。

结果是：

- 前端 pending 临时态知道这是 `再次生成`
- 后端持久化 turn 不知道这是 `再次生成`
- tool input 里没有 `displayPrompt`
- 历史水合后只能显示真实 prompt

### 修改方式

在 `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` 的 `StudioGenerationPayload` 中增加：

```ts
displayPrompt: Schema.optional(Schema.String),
refinedPrompt: Schema.optional(Schema.String),
effectivePrompt: Schema.optional(Schema.String),
```

建议放在 `prompt` 字段后面，和 Hono route 的 `StudioGenerationInput` 保持一致：

```ts
export const StudioGenerationPayload = Schema.Struct({
  sessionID: Schema.optional(Schema.String),
  capability: Schema.Literals([
    "image.generate",
    "video.generate",
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
    "image.fusion",
  ]),
  prompt: Schema.String,
  displayPrompt: Schema.optional(Schema.String),
  refinedPrompt: Schema.optional(Schema.String),
  effectivePrompt: Schema.optional(Schema.String),
  styleModel: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Int),
  imageTool: Schema.optional(Schema.Union([Schema.Literal("jimeng"), Schema.Literal("internel")])),
  referenceImages: Schema.optional(Schema.Array(Schema.String)),
  sourceImage: Schema.optional(Schema.String),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
```

在 `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts` 的 `createGeneration()` 入参中补传：

```ts
createGeneration({
  sessionID: ctx.payload.sessionID,
  capability: ctx.payload.capability,
  prompt: ctx.payload.prompt,
  displayPrompt: ctx.payload.displayPrompt,
  refinedPrompt: ctx.payload.refinedPrompt,
  effectivePrompt: ctx.payload.effectivePrompt,
  styleModel: ctx.payload.styleModel,
  aspectRatio: ctx.payload.aspectRatio,
  count: ctx.payload.count,
  imageTool: ctx.payload.imageTool,
  referenceImages: ctx.payload.referenceImages ? [...ctx.payload.referenceImages] : undefined,
  sourceImage: ctx.payload.sourceImage,
  extra: ctx.payload.extra ? { ...ctx.payload.extra } : undefined,
})
```

### 预期效果

后端持久化 turn 时可以拿到：

- `request.displayPrompt === "再次生成"`
- `request.effectivePrompt === 被再次生成任务的最终 prompt`
- tool input 中也会保存这两个字段

历史水合时 `buildStudioTurns()` 可以继续通过 tool input 的 `displayPrompt` 把用户气泡还原为 `再次生成`。

## 修改 2：后端 fallback 对再次生成禁用“延续上一轮”拼接

### 文件

- `packages/opencode/src/studio/studio-service.ts`

### 问题

当前 `promptRefineFallback()` 的核心逻辑是：

```ts
const restoredPrompt = input.effectivePrompt?.trim() || input.refinedPrompt?.trim()
const effectivePrompt = restoredPrompt || buildEffectivePromptFromPrevious(input, previous)
const regenerateText = input.displayPrompt?.trim() === "再次生成"
```

这只把 `displayPrompt === "再次生成"` 用于 assistant 文案，没有用于 prompt 生成逻辑。

如果 `effectivePrompt/refinedPrompt` 因为 schema 或 handler 丢失，`promptRefineFallback()` 会进入：

```ts
buildEffectivePromptFromPrevious(input, previous)
```

最终生成：

```txt
延续上一轮画面：{上一轮 prompt}。{本次 prompt}
```

这与“再次生成直接复用当前结果最终 prompt”的语义冲突。

### 修改方式

将 `regenerateText` 提前，并让再次生成 fallback 使用 `input.prompt` 作为最终 prompt：

```ts
function promptRefineFallback(input: StudioGenerationRequest, previous?: StudioGenerationRecord): StudioPromptRefineResult {
  const regenerateText = input.displayPrompt?.trim() === "再次生成"
  const restoredPrompt = input.effectivePrompt?.trim() || input.refinedPrompt?.trim()
  const effectivePrompt = restoredPrompt || (regenerateText ? input.prompt : buildEffectivePromptFromPrevious(input, previous))
  return {
    assistantText: regenerateText
      ? "好的，我会按当前结果的配置重新生成。"
      : shouldRefineWithLLM(input)
      ? input.capability === "video.generate"
        ? "好的，我会根据你的描述创作视频。"
        : input.sourceImage
          ? "好的，我会基于当前画面继续创作。"
          : "好的，我会根据你的描述创作画面。"
      : buildAssistantText(input),
    refinedPrompt: effectivePrompt,
    effectivePrompt,
    fallback: true,
  }
}
```

### 预期效果

即使未来某条入口又漏传 `effectivePrompt/refinedPrompt`，只要 `displayPrompt` 还在，后端也不会再给再次生成 prompt 拼接上一轮内容。

## 修改 3：再次生成入口统一携带 displayPrompt 与 skipPromptRefine

### 文件

- `packages/app/octoapp/pages/studio-page.tsx`

### 问题

当前 `restoreGenerationInput()` 对 `image.generate` 的再次生成处理比较完整：

```ts
displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
refinedPrompt,
effectivePrompt,
extra: { ...(extra ?? {}), skipPromptRefine: true },
useRestoredInputs: true,
```

但 `video.generate` 和编辑类能力没有统一加 `displayPrompt`。这会导致不同能力的再次生成语义不一致：

- 图片再次生成：UI 倾向显示 `再次生成`
- 视频或编辑再次生成：可能仍显示真实 prompt
- 后端也无法稳定识别 regenerate 场景

### 修改方式

在 `restoreGenerationInput()` 中给所有再次生成能力统一补：

```ts
displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
extra: { ...(extra ?? {}), skipPromptRefine: true },
useRestoredInputs: true,
```

视频分支建议改成：

```ts
if (result.capability === "video.generate") {
  const refinedPrompt = stringValue(input, "refinedPrompt")
  const originalPrompt = stringValue(input, "prompt")
  const effectivePrompt = stringValue(input, "effectivePrompt") ?? refinedPrompt ?? result.prompt
  return {
    capability: result.capability,
    prompt: effectivePrompt ?? refinedPrompt ?? originalPrompt ?? result.prompt,
    displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
    refinedPrompt,
    effectivePrompt,
    referenceImages: stringArrayValue(recordValue(input, "referenceImages")),
    extra: { ...(extra ?? {}), skipPromptRefine: true },
    videoFrames: restoredVideoFrames(result),
    aspectRatio: nextAspectRatio,
    count: nextCount,
    videoDuration: videoDurationValue(recordValue(extra, "duration")) ?? result.duration,
    videoQualityMode: videoQualityModeValue(recordValue(extra, "mode")) ?? result.videoQualityMode,
    useRestoredInputs: true,
  }
}
```

编辑能力分支建议改成：

```ts
const refinedPrompt = stringValue(input, "refinedPrompt")
const originalPrompt = stringValue(input, "prompt")
const effectivePrompt = stringValue(input, "effectivePrompt") ?? refinedPrompt ?? result.prompt
return {
  capability: result.capability,
  prompt: effectivePrompt ?? refinedPrompt ?? originalPrompt ?? result.prompt,
  displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
  refinedPrompt,
  effectivePrompt,
  sourceImage: stringValue(input, "sourceImage"),
  extra: { ...(extra ?? {}), skipPromptRefine: true },
  aspectRatio: nextAspectRatio,
  count: nextCount,
  useRestoredInputs: true,
}
```

图片分支可以保留现状，但建议确认 `prompt` 优先级仍是：

```ts
effectivePrompt ?? refinedPrompt ?? originalPrompt ?? result.prompt
```

### 预期效果

所有能力的再次生成都具备相同语义：

- UI 展示用 `displayPrompt`
- 真实生成用 `effectivePrompt`
- 不进入 LLM 润色
- 不拼接上下文
- 不读取当前输入区草稿

## 修改 4：优化 pending 与真实 turn 合并逻辑

### 文件

- `packages/app/octoapp/pages/studio-page.tsx`

### 问题

点击再次生成后，前端会先创建本地 pending：

```ts
setPendingResult({
  id: `studio_pending_${Date.now()}`,
  prompt: overrides?.effectivePrompt ?? overrides?.refinedPrompt ?? text,
  displayPrompt: overrides?.displayPrompt,
  ...
})
```

后端随后通过 sync 事件创建真实 turn，真实 generation id 是 `studio_gen_xxx`。

当前 `matchesPendingTurn()` 是：

```ts
function matchesPendingTurn(turn: StudioTurnData | undefined, pending: StudioPendingResult) {
  if (isSamePendingTurn(turn, pending)) return true
  return !pending.displayPrompt && turn?.result?.prompt === pending.prompt
}
```

带 `displayPrompt` 的 pending 不允许用 prompt 匹配，导致在 `createStudioGeneration()` 返回真实 generation id 之前，pending turn 和后端真实 turn 可能短暂同时显示。

### 修改方式

在保持安全性的前提下，为 regenerate 增加严格匹配条件：

```ts
function matchesPendingTurn(turn: StudioTurnData | undefined, pending: StudioPendingResult) {
  if (isSamePendingTurn(turn, pending)) return true
  if (!pending.displayPrompt) return turn?.result?.prompt === pending.prompt
  if (pending.displayPrompt !== STUDIO_REGENERATE_DISPLAY_PROMPT) return false
  return Boolean(
    turn?.result &&
      (turn.userText === STUDIO_REGENERATE_DISPLAY_PROMPT || turn.result.displayPrompt === STUDIO_REGENERATE_DISPLAY_PROMPT) &&
      turn.result.prompt === pending.prompt &&
      turn.result.capability === pending.capability,
  )
}
```

同时 `displayTurns()` 里的 `pendingVisible` 判断可以复用 `matchesPendingTurn()`，避免只看 id：

```ts
const pendingVisible = next.some((turn) => matchesPendingTurn(turn, pending))
```

### 预期效果

当后端真实 turn 已经出现，但前端 pending 还没拿到真实 generation id 时，也能识别它们是同一次再次生成，不再短暂显示两条对话和两张结果卡。

## 修改 5：确认历史水合字段优先级

### 文件

- `packages/app/octoapp/pages/studio/turns.ts`

### 当前逻辑

`buildResult()` 已经有正确方向：

```ts
const prompt = stringField(inputRecord, "effectivePrompt") ??
  stringField(inputRecord, "refinedPrompt") ??
  stringField(inputRecord, "prompt") ??
  extractUserDemand(input.userText)
const displayPrompt = stringField(inputRecord, "displayPrompt")

return {
  userText: displayPrompt || extractUserDemand(input.userText),
  result: {
    prompt,
    displayPrompt,
    ...
  },
}
```

### 是否需要改

如果前面的 HTTP API 字段传递修复完成，这里原则上不需要大改。

但建议补测试覆盖：

- tool input 有 `displayPrompt: "再次生成"`
- tool input 有 `effectivePrompt: "真实最终 prompt"`
- user text part 即使是 `再次生成`
- 水合出的 turn 必须满足：

```ts
expect(turn.userText).toBe("再次生成")
expect(turn.result?.prompt).toBe("真实最终 prompt")
expect(turn.result?.displayPrompt).toBe("再次生成")
```

## 测试计划

### 单元测试 1：后端 fallback 不拼接上一轮

建议在 `packages/opencode` 的 studio service 相关测试中补：

输入：

```ts
{
  capability: "image.generate",
  prompt: "一只大黄狗，阳光草地，胶片质感",
  displayPrompt: "再次生成",
  extra: { skipPromptRefine: true },
}
```

并构造一个 previous successful generation。

断言：

```ts
expect(result.effectivePrompt).toBe("一只大黄狗，阳光草地，胶片质感")
expect(result.effectivePrompt).not.toContain("延续上一轮")
expect(result.assistantText).toBe("好的，我会按当前结果的配置重新生成。")
```

### 单元测试 2：HTTP API handler 保留 regenerate 字段

覆盖 `StudioGenerationPayload` 和 handler 转调结果。

断言 `createGeneration()` 收到：

```ts
displayPrompt: "再次生成"
refinedPrompt: "真实最终 prompt"
effectivePrompt: "真实最终 prompt"
```

如果当前测试体系不方便 mock `createGeneration()`，至少补 schema decode 或 handler 集成测试。

### 单元测试 3：历史水合显示再次生成

在 `packages/app/octoapp/pages/studio/turns.test.ts` 中已有类似用例：

```ts
test("uses display prompt for regenerated turns while keeping the effective generation prompt", ...)
```

建议补一个更贴近 session 切换水合的用例：

- user text part 是 `再次生成`
- tool input 带 `displayPrompt`
- tool input 带 `effectivePrompt`
- completed tool 有结果图片

断言：

```ts
expect(turns[0].userText).toBe("再次生成")
expect(turns[0].result?.prompt).toBe("真实最终 prompt")
expect(turns[0].result?.displayPrompt).toBe("再次生成")
```

### 单元测试 4：pending 与真实 regenerate turn 合并

如果有现成前端 memo 测试能力，覆盖：

- pending id 为 `studio_pending_xxx`
- persisted turn result id 为 `studio_gen_xxx`
- 二者 `displayPrompt` 都是 `再次生成`
- 二者 `prompt/capability` 一致

断言 `displayTurns()` 只有一条，不出现 pending 和 persisted turn 双展示。

## 验证步骤

1. 从 `packages/opencode` 运行类型检查：

```bash
bun typecheck
```

2. 如果修改了 HTTP API schema，按仓库说明重新生成 JavaScript SDK：

```bash
./packages/sdk/js/script/build.ts
```

3. 运行相关测试：

```bash
cd packages/app
bun test octoapp/pages/studio/turns.test.ts
```

4. 手动验证 Studio：

- 新建一次图片生成
- 点击结果上的“再次生成”
- 观察对话区不应出现两条 turn
- 生成中的用户气泡应显示 `再次生成`
- 生成完成后用户气泡仍显示 `再次生成`
- prompt 详情或接口请求应使用原任务最终 prompt
- 切换到其它 session 再切回来，用户气泡仍显示 `再次生成`
- 后端最终 prompt 不应包含 `延续上一轮画面`

## 风险与注意事项

- 改 HTTP API schema 后可能需要同步生成 SDK，否则类型可能不一致。
- `displayPrompt` 只能用于 UI 展示，不能传给最终生成 provider。
- `effectivePrompt` 只能用于真实生成，不应该直接作为用户气泡展示。
- 再次生成必须使用被点击或当前画布选中结果的 prompt，不应该读取输入框当前草稿。
- `skipPromptRefine: true` 是再次生成语义的一部分，不应该依赖 LLM 是否可用。

## 最小修复闭环

如果要先快速解决三个线上问题，最小改动顺序是：

1. HTTP API payload 和 handler 补传 `displayPrompt/refinedPrompt/effectivePrompt`
2. `promptRefineFallback()` 中让 `displayPrompt === "再次生成"` 直接使用 `input.prompt`
3. `matchesPendingTurn()` 为 regenerate 增加严格匹配，消除双 turn 闪烁

完成这三步后：

- `延续上一轮` 拼接问题会被阻断
- session 切换后气泡变 prompt 的问题会消失
- 点击后短暂两个 `studio-result-card` 的问题会明显降低或消失

