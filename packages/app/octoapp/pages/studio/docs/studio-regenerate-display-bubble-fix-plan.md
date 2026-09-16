# Studio 再次生成气泡展示修复方案

## 目标

Studio 点击“再次生成”后，对话区应满足三件事：

- 用户气泡：固定显示 `再次生成`
- assistant 文案：固定显示 `好的，我会按当前结果的配置重新生成。`
- 实际生成 prompt：继续使用当前被点击或选中结果的真实创作 prompt，优先级为 `effectivePrompt -> refinedPrompt -> prompt`，不能把 `再次生成` 当成生成提示词

这个方案只处理“再次生成”的对话展示和 prompt 解耦问题，不处理参考图恢复、取消 LLM 请求、视频再次生成策略等其它议题。

## 需求澄清

“再次生成”不是“上一轮对话再次生成”，而是“按当前被点击或选中的预览结果再次生成”。

因此它应该复用的是被操作 result 创建时的输入，而不是时间顺序上的上一轮：

- prompt：被操作 result 的 `effectivePrompt/refinedPrompt/prompt`
- 配置：被操作 result 的 `styleModel/aspectRatio/count`
- 参考图：被操作 result 创建时提交的 `referenceImages/sourceImage/videoFrames/extra`
- 展示：新增一轮固定用户气泡 `再次生成`

后续文档里的“当前结果”均指“用户点击再次生成按钮时对应的 result”，不是最新 turn，也不是对话最后一轮。

## 当前现象

目前改动后仍未达到预期：

- 使用历史消息里的某个结果点击“再次生成”，用户气泡仍可能显示该结果的真实 prompt。
- 新建一轮生成成功后立刻点击“再次生成”，也可能不显示 `再次生成`。
- 有时实际生成 prompt 会被展示文案或旧消息链路影响。

这些现象说明问题不是单点字段缺失，而是 pending 状态、历史 turn、轮询结果、消息重建之间的匹配逻辑仍然把“展示文案”和“真实 prompt”混在了一起。

## 关键链路

### 1. 点击入口

画布和详情里的“再次生成”最终都会调用：

- `packages/app/octoapp/pages/studio-page.tsx`
- `regenerateCurrentResult()`
- `restoreGenerationInput(current)`
- `runGeneration(overrides)`

当前 `restoreGenerationInput()` 对 `image.generate` 设置：

```ts
displayPrompt: "再次生成"
refinedPrompt
effectivePrompt
extra: { skipPromptRefine: true }
```

这一步方向是对的：`displayPrompt` 用于 UI 展示，`effectivePrompt/refinedPrompt` 用于真实生成。

### 2. pendingResult 创建

`runGeneration()` 会先创建本地 pending：

```ts
setPendingResult({
  prompt: overrides?.effectivePrompt ?? overrides?.refinedPrompt ?? text,
  displayPrompt: overrides?.displayPrompt,
  ...
})
```

这一步方向也是对的：pending 的 `prompt` 是真实生成 prompt，`displayPrompt` 是气泡展示文案。

### 3. 气泡渲染

对话气泡最终渲染来自：

- `packages/app/octoapp/pages/studio/studio-conversation.tsx`

```tsx
{turn.userText || props.result?.prompt?.split("\n")[0] || "Octo Studio"}
```

因此气泡是否显示 `再次生成`，最终取决于 `displayTurns()` 产出的 `turn.userText`。

### 4. displayTurns 组装

`displayTurns()` 会把：

- 历史消息重建出的 `turns()`
- 当前 `pendingResult()`
- 编辑入口 pending

合并为最终展示列表。

这里应保证：只要当前存在一次“再次生成”pending，且这次 pending 尚未被同一个 generation id 的历史消息替代，就必须稳定展示一个用户气泡为 `再次生成` 的 turn。

## 根因分析

### 根因 1：同步 effect 用 prompt 匹配 pending 和历史 turn

当前有两个 effect 会同步 `pendingResult()` 与历史最新 turn：

- `packages/app/octoapp/pages/studio-page.tsx`
- pending 与 `studioTurn()` 同步状态

其中存在类似判断：

```ts
if (turn?.userText !== pendingUserText && turn?.result?.prompt !== pending.prompt) return
```

这个判断对普通生成可以作为兜底，但对“再次生成”是错误的。

“再次生成”的本质就是复用当前被操作结果的真实 prompt，所以：

```ts
turn.result.prompt === pending.prompt
```

很可能成立。

于是其它历史成功 turn，尤其是当前被操作结果所在 turn，会被误判为“已经代表当前 pending”。随后又因为该旧 turn 已经有图片：

```ts
studioTurn()?.result?.images.length
```

pending 会被提前清掉：

```ts
setPendingResult(undefined)
```

最终结果是：`displayTurns()` 还没来得及稳定展示 `displayPrompt: "再次生成"`，pending 就没了。

这解释了两类失败：

- 历史消息再次生成：被操作结果或最新历史 turn 的 prompt 等于 pending prompt，误匹配。
- 新生成后再次生成：刚成功的当前结果就是最新 turn，prompt 也等于 pending prompt，误匹配。

### 根因 2：再次生成入口必须绑定被操作 result，而不是默认最新 result

`regenerateCurrentResult()` 当前从 `result()` 读取当前结果：

```ts
const current = result()
```

`result()` 由 `selectedResult() ?? defaultResult()` 推导而来，其中 `defaultResult()` 又可能来自 `studioTurn()?.result` 或 `latestCompletedTurn()?.result`。

这意味着再次生成是否真的基于用户点击的预览结果，取决于点击前 `selectedResultId` 是否正确指向该 result。

如果用户在历史对话里看着某个预览结果操作，但 `selectedResultId` 没有被更新，或者画布/详情按钮对应的是全局 `result()` 而不是按钮所属 result，就可能错误复用最新 turn 或其它结果的输入。

因此修复时要确认：

- 结果卡片缩略图点击后，`selectedResultId` 必须指向该 result。
- 画布和详情里的“再次生成”必须基于 `canvasResult()` 或明确传入的 operated result。
- 不应在再次生成开始时过早 `setSelectedResultId(undefined)`，否则会把“当前被操作结果”切回默认最新结果。
- 如果未来在结果卡片上直接增加“再次生成”按钮，应把该 card 的 `turn.result` 直接传给 regenerate，而不是再从全局 `result()` 读取。

### 根因 3：请求返回和轮询更新会覆盖 pending 展示字段

创建接口返回后当前逻辑会：

```ts
setPendingResult({
  ...generation,
  sourceImage: overrides?.sourceImage,
})
```

轮询更新时也会：

```ts
return { ...generation, sourceImage: current?.sourceImage }
```

如果接口返回或轮询结果没有带 `displayPrompt`，或者因为历史数据/兼容路径缺失该字段，本地 pending 的 `displayPrompt` 会被覆盖掉。

这会导致：

- pending 创建时有 `displayPrompt`
- 请求返回后 `displayPrompt` 丢失
- `displayTurns()` 只能退回显示真实 prompt

### 根因 4：displayTurns 的“已有历史 turn”早退逻辑不适合固定展示操作

`displayTurns()` 里曾经有逻辑：当已有历史 turns 且不在 sending 时，直接返回历史 turns。

这对普通生成可以减少重复展示，但对“再次生成”不适合。

再次生成是一个新的操作 turn，即使真实 prompt 和当前被操作结果一致，也应该展示一个新的固定用户气泡。

### 根因 5：历史消息重建应以 tool input 的 displayPrompt 为准

服务端持久化消息时，用户 text part 和 tool input 都应该包含展示文案：

```ts
displayPrompt: input.request.displayPrompt
```

前端从历史消息重建 turn 时应优先读取 tool input 的 `displayPrompt`：

```ts
userText: displayPrompt || extractUserDemand(input.userText)
```

这能保证消息 reload 后，气泡仍显示 `再次生成`。

但这只能解决“历史消息已经正确持久化”的场景，不能解决 pending 被提前清空的问题。

## 修改原则

### 1. 展示文案和真实 prompt 必须彻底分离

定义：

- `displayPrompt`：只用于用户气泡展示。
- `assistantText`：只用于 assistant 自然回复展示。
- `prompt/effectivePrompt/refinedPrompt`：只用于生成接口和多轮上下文，来源必须是当前被操作 result 的创建输入。

禁止把 `displayPrompt` 作为生成 prompt。

### 2. 再次生成不能用 prompt 匹配 pending

如果 `pending.displayPrompt` 存在，尤其是 `再次生成`，则 pending 与历史 turn 的匹配必须只看：

- `turn.result?.id === pending.id`
- `turn.id === pending.id`
- `turn.id === studio_${pending.id}`
- 或 tool metadata 中的 generation id 等明确任务 id

不能用：

```ts
turn.result?.prompt === pending.prompt
```

因为再次生成天然会复用当前被操作 result 的 prompt，而其它历史结果也可能有相同 prompt。

### 3. pending 更新时必须保留展示字段

接口创建返回和轮询返回都只能更新任务状态、进度、图片、错误等字段，不应丢掉本地展示字段：

```ts
displayPrompt: current?.displayPrompt ?? generation.displayPrompt
```

assistant 固定文案也应通过 pending 或历史消息保留。

### 4. displayTurns 必须把“再次生成”视为独立操作 turn

只要当前有 `pending.displayPrompt === "再次生成"`，并且历史消息中还没有同 generation id 的 turn，就应该追加一个新的展示 turn：

- `userText: "再次生成"`
- `assistantText: "好的，我会按当前结果的配置重新生成。"`
- `result.prompt: pending.prompt`

## 具体修改方案

## 一、增加再生成展示常量

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

建议新增局部常量或工具函数：

```ts
const STUDIO_REGENERATE_DISPLAY_PROMPT = "再次生成"
const STUDIO_REGENERATE_ASSISTANT_TEXT = "好的，我会按当前结果的配置重新生成。"
```

如果其它文件也需要使用，可以放到 `packages/app/octoapp/pages/studio/studio-shared.ts`。

作用：

- 避免到处硬编码字符串。
- 让“是否为固定展示操作”判断更清晰。

## 二、修正 restoreGenerationInput

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

图片生成再次生成时返回：

```ts
{
  capability: "image.generate",
  prompt: originalPrompt,
  displayPrompt: STUDIO_REGENERATE_DISPLAY_PROMPT,
  refinedPrompt,
  effectivePrompt,
  extra: { ...extra, skipPromptRefine: true },
  useRestoredInputs: true,
}
```

其中：

- `prompt` 保留当前被操作 result 的原始 prompt。
- `effectivePrompt/refinedPrompt` 保留当前被操作 result 的实际创作 prompt。
- `displayPrompt` 只用于气泡。
- `skipPromptRefine` 避免再次调用 LLM，把再次生成变成新的创作意图。

如果 `effectivePrompt/refinedPrompt` 都缺失，则兜底使用 `result.prompt`，但仍不能使用 `再次生成`。

## 三、修正 runGeneration 的 pending 创建

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

pending 应明确区分：

```ts
const generationPrompt = overrides?.effectivePrompt ?? overrides?.refinedPrompt ?? text
const displayPrompt = overrides?.displayPrompt
```

pending 设置为：

```ts
setPendingResult({
  prompt: generationPrompt,
  displayPrompt,
  ...
})
```

创建接口 body：

```ts
prompt: text,
displayPrompt,
refinedPrompt: overrides?.refinedPrompt,
effectivePrompt: overrides?.effectivePrompt,
```

注意：

- `prompt: text` 仍然是当前被操作 result 的原始 prompt，不是 `再次生成`。
- `effectivePrompt/refinedPrompt` 交给后端作为真实生成优先项。

## 四、修正创建接口返回后的 pending 覆盖

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

当前风险写法：

```ts
setPendingResult({
  ...generation,
  sourceImage: overrides?.sourceImage,
})
```

建议改为函数式更新：

```ts
setPendingResult((current) => ({
  ...generation,
  displayPrompt: current?.displayPrompt ?? generation.displayPrompt,
  sourceImage: current?.sourceImage ?? overrides?.sourceImage,
}))
```

这样接口返回缺字段时，不会丢掉本地展示文案。

## 五、修正轮询返回后的 pending 覆盖

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

当前风险写法：

```ts
return { ...generation, sourceImage: current?.sourceImage }
```

建议改为：

```ts
return {
  ...generation,
  displayPrompt: current?.displayPrompt ?? generation.displayPrompt,
  sourceImage: current?.sourceImage,
}
```

如果未来 pending 上新增 `assistantText` 或 operation 类型，也要同样保留。

## 六、修正 pending 与历史 turn 的匹配规则

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

新增判断函数：

```ts
function isPromptMatchAllowedForPending(pending: StudioPendingResult) {
  return !pending.displayPrompt
}
```

或者更直接：

```ts
const allowPromptMatch = !pending.displayPrompt
```

把当前判断：

```ts
if (turn?.userText !== pendingUserText && turn?.result?.prompt !== pending.prompt) return
```

改为：

```ts
const samePendingTurn =
  turn?.id === pending.id ||
  turn?.id === `studio_${pending.id}` ||
  turn?.result?.id === pending.id

const samePromptFallback =
  !pending.displayPrompt &&
  turn?.result?.prompt === pending.prompt

if (turn?.userText !== pendingUserText && !samePendingTurn && !samePromptFallback) return
```

核心点：

- `pending.displayPrompt` 存在时，不允许通过 prompt 兜底匹配。
- 只有明确同一个 generation id 才能认为历史 turn 代表当前 pending。

两个同步 effect 都要改。

## 七、修正 pending 清理条件

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

当前逻辑在看到 `studioTurn()?.result?.images.length` 后可能清掉 pending。

修改后必须先确认该 `studioTurn` 确实是当前 pending 对应的 turn：

```ts
if (samePendingTurn && studioTurn()?.result?.images.length) {
  setPendingResult(undefined)
  setStatus("succeeded")
  return
}
```

不能因为“最新历史 turn 有图”就清理 pending。

否则再次生成会被其它历史成功结果，尤其是当前被操作结果所在的旧 turn 误杀。

## 八、修正 displayTurns 追加逻辑

文件：

- `packages/app/octoapp/pages/studio-page.tsx`

`displayTurns()` 中判断 pending 是否已展示时，也应使用 generation id：

```ts
const pendingVisible = next.some((turn) =>
  turn.id === pending.id ||
  turn.id === `studio_${pending.id}` ||
  turn.result?.id === pending.id
)
```

如果 `pending.displayPrompt` 存在且 `pendingVisible` 为 false，就追加一个新的 turn：

```ts
{
  id: pending.id,
  userText: pending.displayPrompt,
  assistantText: pending.displayPrompt === STUDIO_REGENERATE_DISPLAY_PROMPT
    ? STUDIO_REGENERATE_ASSISTANT_TEXT
    : pendingAssistantText,
  result: normalizeResultValue(pending),
}
```

普通生成可以继续保留原来的“已有历史 turn 时不追加 pending”的策略。

## 九、后端持久化确认

文件：

- `packages/opencode/src/studio/studio-service.ts`

确认以下位置完整：

### user text part

```ts
const displayPrompt = input.request.displayPrompt?.trim() || input.request.prompt
...
text: displayPrompt
```

### tool input

```ts
input: {
  prompt: input.request.prompt,
  displayPrompt: input.request.displayPrompt,
  refinedPrompt: input.promptRefine.refinedPrompt,
  effectivePrompt: input.promptRefine.effectivePrompt,
}
```

### generationSnapshot

```ts
prompt: generationPrompt(data.input),
displayPrompt: data.input.displayPrompt,
```

这些可以保证 reload 历史消息后，展示字段和真实 prompt 都能恢复。

## 十、前端历史消息重建确认

文件：

- `packages/app/octoapp/pages/studio/turns.ts`

确认 `buildResult()` 中：

```ts
const prompt = effectivePrompt ?? refinedPrompt ?? prompt
const displayPrompt = stringField(inputRecord, "displayPrompt")
```

返回 turn 时：

```ts
userText: displayPrompt || extractUserDemand(input.userText)
```

返回 result 时：

```ts
prompt,
displayPrompt,
```

这能保证持久化消息回来后，用户气泡仍显示 `再次生成`，结果详情仍显示真实 prompt。

## 验证用例

### 用例 1：新生成后立刻再次生成

步骤：

1. 新建 Studio 对话。
2. 输入 `生成一只大黄狗` 并生成成功。
3. 点击当前预览结果对应的画布或详情里的“再次生成”。

预期：

- 新增一轮用户气泡显示：`再次生成`
- assistant 显示：`好的，我会按当前结果的配置重新生成。`
- 结果卡片进入生成中。
- 最终提交给生成接口的 prompt 不是 `再次生成`，而是当前被操作结果的真实创作 prompt。

### 用例 2：历史消息再次生成

步骤：

1. 打开已有 Studio 历史对话。
2. 选择一条成功图片生成结果，使预览区展示该结果。
3. 点击该预览结果对应的“再次生成”。

预期：

- 新增一轮用户气泡显示：`再次生成`
- 不复用历史用户气泡里的真实 prompt 作为展示文案。
- 实际生成 prompt 和配置仍使用该历史结果的 `effectivePrompt/refinedPrompt/result.prompt/styleModel/aspectRatio/count/referenceImages` 等创建输入。

### 用例 3：再次生成期间请求返回但任务仍在 running/queued

步骤：

1. 点击“再次生成”。
2. 创建接口返回 generation id，但任务还未完成。

预期：

- `pendingResult.displayPrompt` 不丢失。
- 对话区仍显示 `再次生成`。
- 不因为其它历史 turn 已有图片而清掉 pending。

### 用例 4：轮询更新后 displayPrompt 不丢失

步骤：

1. 点击“再次生成”。
2. 等待轮询多次更新进度。

预期：

- 每次 `getStudioGeneration()` 返回后，pending 仍保留 `displayPrompt: "再次生成"`。
- 气泡不会闪回真实 prompt。

### 用例 5：生成成功并 reload 历史消息

步骤：

1. 点击“再次生成”并等待成功。
2. 触发 `loadSessionMessages()` 或刷新页面。

预期：

- 历史中新增一轮用户气泡仍显示 `再次生成`。
- assistant 文案仍显示 `好的，我会按当前结果的配置重新生成。`
- 结果详情中的真实 prompt 仍是 effective/refined prompt。

## 建议补充测试

### 1. turns.ts 单测

已有或新增：

- tool input 中有 `displayPrompt: "再次生成"`
- user text part 即使是旧 prompt
- `buildStudioTurns()` 输出：
  - `turn.userText === "再次生成"`
  - `turn.assistantText === "好的，我会按当前结果的配置重新生成。"`
  - `turn.result.prompt === effectivePrompt`

### 2. displayTurns 抽离测试

如果可行，建议把 `displayTurns()` 里 pending 合并逻辑抽成纯函数，例如：

```ts
buildStudioDisplayTurns({
  turns,
  pending,
  pendingEditorEntries,
  sending,
})
```

这样可以直接测试：

- 普通生成 pending
- 再次生成 pending
- 历史 turn prompt 与 pending prompt 相同
- pending 不应被旧 turn 吞掉

目前该逻辑在 `studio-page.tsx` 内部，难以单测，所以容易反复回归。

## 实施顺序

1. 确认再次生成入口拿到的是当前被操作 result，必要时让 `regenerateCurrentResult()` 接收明确的 result 参数，避免隐式依赖全局 `result()`。
2. 修改 pending 更新逻辑，确保创建返回和轮询返回保留 `displayPrompt`。
3. 修改两个同步 effect，禁止带 `displayPrompt` 的 pending 使用 prompt 匹配历史 turn。
4. 修改 pending 清理条件，只允许同 generation id 的历史 turn 清理 pending。
5. 检查 `displayTurns()`，确保带 `displayPrompt` 的 pending 未被同 generation id 历史 turn 覆盖时一定展示。
6. 确认后端持久化和前端历史重建字段完整。
7. 增加单测或至少手动验证上述五个用例。

## 风险点

- 普通生成仍可能依赖 prompt 兜底匹配历史 turn，所以不能完全删除 prompt 匹配，只能对 `displayPrompt` pending 禁用。
- 历史旧数据没有 `displayPrompt`，刷新后无法还原成 `再次生成`，这是旧数据兼容限制。
- 视频再次生成当前没有纳入固定展示策略。如果产品希望视频也显示 `再次生成`，需要让 `video.generate` 的 `restoreGenerationInput()` 同样带 `displayPrompt`，并确认视频 prompt/首尾帧恢复策略。
- 如果未来增加更多固定操作文案，建议将 `displayPrompt` 扩展为更明确的 operation 字段，例如 `displayAction: "regenerate"`，避免依赖中文字符串判断。

## 最终判断

这次问题的本质是：再次生成复用当前被操作 result 的真实 prompt，而现有前端状态同步又用 prompt 判断 pending 是否已被历史 turn 覆盖，导致新 pending 被旧结果误匹配并清掉。

正确修复不是继续单纯传 `displayPrompt`，而是让“固定展示操作”走独立匹配规则：

- 展示看 `displayPrompt`
- 生成看 `effectivePrompt/refinedPrompt`
- pending 生命周期看 generation id
- 不用 prompt 匹配再次生成 pending
