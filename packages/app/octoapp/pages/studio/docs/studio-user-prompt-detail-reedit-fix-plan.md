# Studio 用户原始提示词、详情展示与重新编辑修复方案

## 1. 背景

Studio 视频生成支持只上传首帧或首尾帧、不填写文本提示词的场景。为了让生成接口始终收到非空 `prompt`，前端会为这类任务补充系统执行文案：

```text
根据首尾帧生成自然连贯的视频
```

当前这段系统执行文案同时进入了以下位置：

1. `studio-user-bubble`，作为当前任务的气泡展示文字；
2. `request.input.prompt`，作为生成任务的原始请求字段；
3. `result.detailPrompt`，作为详情面板的“提示词”；
4. 点击“重新编辑”后的 `studio-composer-input`。

其中第 1 项是现有产品展示要求，可以保留；第 2 项是模型执行需要，也可以保留。但第 3、4 项语义不正确：用户没有输入任何文字时，详情提示词应显示 `-`，重新编辑的输入框也应为空。

## 2. 问题根因

问题不是详情组件或重新编辑按钮直接读取了气泡 DOM，而是上游把“用户原始输入”和“系统执行 prompt”合并成了同一个值。

`packages/app/octoapp/pages/studio-page.tsx` 的 `runGeneration()` 当前先计算用户输入：

```ts
const actualUserPrompt = (overrides?.prompt ?? prompt()).trim()
```

然后在用户输入为空且存在视频帧时，为 `text` 补默认值：

```ts
const text = actualUserPrompt || (
  nextCapability === "video.generate" && nextHasVideoFrames
    ? "根据首尾帧生成自然连贯的视频"
    : ""
)
```

这一步本身没有问题，`text` 是生成接口需要的有效执行文本。问题出在 `detailPrompt` 又回退到了 `text`：

```ts
const detailPrompt = overrides?.detailPrompt ?? (
  actualUserPrompt || (nextCapability === "video.generate" ? text : undefined)
)
```

同时，创建生成任务时 `text` 被写入接口字段 `prompt`：

```ts
prompt: input.text
```

后端将该值保存到 `request.input.prompt`。重新编辑又优先读取 `request.input.prompt`，所以系统默认文案最终被回填到输入框。

此外，会话恢复代码中的 `stringField()` 会把空字符串转换成 `undefined`，即使新任务开始保存 `detailPrompt: ""`，刷新会话后也会丢失这个“用户明确没有输入”的状态。

## 3. 修改目标

修改后需要满足以下规则：

| 场景 | 气泡展示 | 模型执行 `prompt` | `studio-detail-prompt` | 重新编辑输入框 |
|---|---|---|---|---|
| 图片生成，有文本 | 用户原文 | 有效/润色后的 prompt | 用户原文 | 用户原文 |
| 文生视频，有文本 | 用户原文 | 有效/润色后的 prompt | 用户原文 | 用户原文 |
| 首帧/首尾帧视频，有文本 | 用户原文 | 用户原文或有效 prompt | 用户原文 | 用户原文 |
| 首帧/首尾帧视频，无文本 | 系统默认文案 | 系统默认执行 prompt | `-` | 空字符串 |
| 再次生成 | `再次生成` | 继承的有效 prompt | 继承来源任务的用户原文；来源无输入时为 `-` | 不适用 |

本次不要求改变无文本视频任务的气泡文案，也不要求允许生成接口接收空 `prompt`。

## 4. 最终字段语义

继续复用现有字段，不新增 API 字段：

| 字段 | 最终职责 |
|---|---|
| `prompt` | 生成模型实际使用的有效 prompt，必须非空，可以是系统补充或 LLM 润色后的文本 |
| `displayPrompt` | 对话气泡的特殊展示标签，例如“再次生成” |
| `detailPrompt` | 用户在 composer 中实际输入的原文；用户没有输入时必须保存为空字符串 `""` |
| `refinedPrompt` | LLM 润色后的提示词 |
| `effectivePrompt` | 拼接上下文后真正提交给生成模型的提示词 |
| `detailTitle` | 详情标题，与 `detailPrompt` 分开计算；即使 `detailPrompt` 为空也可以从执行 prompt 生成标题 |

这里最重要的约束是：

```text
detailPrompt === ""
```

是一个合法且有业务意义的状态，表示“该任务确认没有用户文本输入”。不能把它转换成 `undefined`。

## 5. 具体修改点

### 5.1 修改 `runGeneration()` 中 `detailPrompt` 的计算

文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

位置：`runGeneration()` 内 `actualUserPrompt`、`text`、`detailPrompt` 和 `detailTitle` 的计算区域。

当前代码：

```ts
const detailPrompt = overrides?.detailPrompt ?? (
  actualUserPrompt || (nextCapability === "video.generate" ? text : undefined)
)
const detailTitle = overrides?.detailTitle ?? buildStudioDisplayPrompt(detailPrompt ?? text)
```

建议修改为：

```ts
const detailPrompt = overrides?.detailPrompt ?? (
  nextCapability === "image.generate" || nextCapability === "video.generate"
    ? actualUserPrompt
    : undefined
)
const detailTitle = overrides?.detailTitle ?? buildStudioDisplayPrompt(detailPrompt || text)
```

说明：

- 图片生成和视频生成的 `detailPrompt` 只记录用户原始输入；
- 无文本视频任务的 `actualUserPrompt` 是 `""`，因此 `detailPrompt` 也必须是 `""`；
- `text` 仍保留系统默认文案并继续作为创建任务的 `prompt`；
- `detailTitle` 使用 `detailPrompt || text`，避免空 `detailPrompt` 让生成中标题变成“新建对话”；
- 放大、抠图、重绘、扩图等编辑能力不展示“提示词”区块，不需要把内部操作指令写成用户详情提示词。

不要写成：

```ts
const detailPrompt = overrides?.detailPrompt || actualUserPrompt
```

因为 `||` 会丢弃再次生成时显式继承的空字符串。这里必须使用 `??`。

### 5.2 保持创建请求携带空 `detailPrompt`

文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

以下现有传递链路应保留：

```ts
body: JSON.stringify({
  prompt: input.text,
  detailPrompt: input.detailPrompt,
})
```

以及：

```ts
const generation = await createStudioGeneration({
  text,
  detailPrompt,
  // ...
})
```

`JSON.stringify()` 会保留空字符串，因此无文本视频任务的请求应包含：

```json
{
  "prompt": "根据首尾帧生成自然连贯的视频",
  "detailPrompt": ""
}
```

不要为了精简 payload 对 `detailPrompt` 使用 truthy 过滤，否则空状态会再次丢失。

### 5.3 保持 pending、创建响应和轮询合并中的空字符串

文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

以下现有写入需要继续保留：

```ts
setPendingResult({
  // ...
  detailPrompt,
})
```

以下合并方式也是正确的：

```ts
detailPrompt: current?.detailPrompt ?? generation.detailPrompt
```

`??` 会保留 `""`；不要改成：

```ts
detailPrompt: current?.detailPrompt || generation.detailPrompt
```

否则生成中正确的空值可能被服务端或有效 prompt 覆盖。

需要检查所有创建响应、轮询响应和 pending turn 合并位置，确保都使用 `??` 或字段存在性判断。

### 5.4 修改会话恢复逻辑，允许读取空字符串

文件：

```text
packages/app/octoapp/pages/studio/turns.ts
```

当前通用 helper：

```ts
function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}
```

适合读取 `prompt`、模型等非空字段，但不适合读取 `detailPrompt`。

建议新增一个保留空字符串的 helper：

```ts
function optionalStringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}
```

然后将当前逻辑：

```ts
const detailPrompt = stringField(inputRecord, "detailPrompt") ?? (
  displayPrompt ? undefined : extractUserDemand(input.userText)
)
```

修改为字段存在性感知的逻辑：

```ts
const persistedDetailPrompt = optionalStringField(inputRecord, "detailPrompt")
const detailPrompt = persistedDetailPrompt !== undefined
  ? persistedDetailPrompt
  : displayPrompt
    ? undefined
    : extractUserDemand(input.userText)
```

效果：

- 新任务保存 `detailPrompt: ""` 时，刷新后仍然得到 `""`；
- 新任务保存用户原文时，刷新后得到原文；
- 旧任务不存在 `detailPrompt` 时，仍执行原有兼容回退；
- “再次生成”的旧任务不会把 `displayPrompt: "再次生成"` 当成详情提示词。

成功、生成中、创建失败和生成失败四种 `StudioGenerationResult` 构建分支都应继续携带同一个 `detailPrompt` 变量。

### 5.5 修改 `studio-detail-prompt`，禁止回退到有效 prompt

文件：

```text
packages/app/octoapp/pages/studio/studio-conversation.tsx
```

组件：`StudioDetails`。

当前代码：

```tsx
<p class="studio-detail-prompt">
  {(props.result.detailPrompt ?? props.result.prompt).split("\n")[0]}
</p>
```

建议修改为：

```tsx
<p class="studio-detail-prompt">
  {props.result.detailPrompt?.trim().split("\n")[0] || "-"}
</p>
```

这里必须删除 `props.result.prompt` 回退，因为 `result.prompt` 是有效执行提示词，不代表用户原始输入。

保留当前 `Show when={!isEditResult()}` 条件，编辑类结果继续不展示“提示词”区块。

### 5.6 修改“重新编辑”的 prompt 来源

文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

函数：`restoreGenerationEditDraft()`。

当前代码：

```ts
prompt: stringValue(input, "prompt") ?? result.displayPrompt ?? result.prompt,
```

`request.input.prompt` 是生成任务的执行请求，在无文本首尾帧场景中就是系统默认文案，不能继续作为新任务的首选回填值。

建议修改为：

```ts
prompt: result.detailPrompt !== undefined
  ? result.detailPrompt
  : stringValue(input, "prompt") ?? result.displayPrompt ?? result.prompt,
```

说明：

- 新任务 `detailPrompt: ""` 时，重新编辑回填空字符串；
- 新任务有用户输入时，回填用户原文；
- 旧任务不存在 `detailPrompt` 时，才沿用原来的兼容优先级；
- 不能写成 `result.detailPrompt || ...`，否则空字符串会被系统执行 prompt 覆盖。

### 5.7 确认“再次生成”继承空 `detailPrompt`

文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

函数：`restoreGenerationInput()`。

当前图片和视频分支已经包含：

```ts
detailPrompt: result.detailPrompt,
```

该逻辑应保留。因为 `runGeneration()` 使用 `overrides?.detailPrompt ?? ...`，显式的空字符串会被继承，来源无文本时再次生成结果仍显示 `-`。

同时确认后续没有对 `detailPrompt` 调用 `.filter(Boolean)`、`||` 或“空字符串转 `undefined`”的 helper。

## 6. 后端检查项

### 6.1 接口 schema 不需要新增字段

以下位置已经声明 `detailPrompt` 为可选字符串，空字符串可以通过校验：

```text
packages/opencode/src/server/routes/instance/studio.ts
packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts
packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts
```

现有定义类似：

```ts
detailPrompt: z.string().optional()
```

和：

```ts
detailPrompt: Schema.optional(Schema.String)
```

无需改成 `.min(1)`，否则无输入状态无法持久化。

### 6.2 `studioToolInput()` 必须保留空字符串

文件：

```text
packages/opencode/src/studio/studio-service.ts
```

现有代码：

```ts
detailPrompt: request.detailPrompt,
```

应保留。`stripUndefined()` 只删除 `undefined`，不会删除 `""`，因此数据库 `request.input` 和消息 tool part 都能够保存空字符串。

### 6.3 `generationSnapshot()` 必须原样返回空字符串

现有代码：

```ts
detailPrompt: data.input.detailPrompt,
```

应保留，不要增加 `|| data.input.prompt` 之类的服务端回退。

### 6.4 SDK 不需要重新生成

`detailPrompt` 已经存在于接口 schema 和生成后的 SDK 类型中，本次只改变字段语义和空值处理，不新增字段，因此不需要运行 JavaScript SDK 生成脚本。

如果实现过程中改为新增 `userPrompt` 等新字段，则必须同步修改两套服务端 schema、handler、前后端类型，并按仓库要求运行：

```text
./packages/sdk/js/script/build.ts
```

但本方案不建议扩大改动范围。

## 7. 历史数据兼容

### 7.1 可以无损兼容的历史任务

旧任务完全没有 `detailPrompt` 时，可以继续使用 `turn.userText` 作为普通图片/视频任务的兼容回退。这样旧的有文本任务仍能展示用户当时的气泡文字。

### 7.2 无法判断的历史任务不做兼容

对于已经保存、且现有字段无法判断用户当时是否输入过提示词的首帧/首尾帧视频任务，本次不做兼容处理：

1. 不增加默认文案匹配等启发式判断；
2. 不修改或迁移已有数据库记录；
3. 不保证这部分历史任务的详情提示词和重新编辑回填结果发生变化；
4. 只保证修复上线后新创建的任务按本方案准确保存和恢复 `detailPrompt`。

## 8. 测试修改

### 8.1 `turns.test.ts`

文件：

```text
packages/app/octoapp/pages/studio/turns.test.ts
```

至少增加以下用例：

1. 工具 input 中 `detailPrompt: ""`，`buildStudioTurns()` 输出的 `result.detailPrompt` 仍然严格等于 `""`；
2. 工具 input 中没有 `detailPrompt`，普通旧任务仍回退到用户消息原文；
3. `displayPrompt: "再次生成"` 且 `detailPrompt: ""` 时，气泡为“再次生成”，详情字段仍为 `""`；
4. 成功、运行中和失败 tool part 都能保留空 `detailPrompt`；
5. 用户手动输入“根据首尾帧生成自然连贯的视频”时，`detailPrompt` 为该文本而不是空字符串。

### 8.2 页面行为验证

当前仓库没有单独的 `studio-page` 单元测试文件，建议进行以下手动或后续补充的组件测试：

#### 用例 A：首尾帧无文本

1. 选择视频生成；
2. 上传首帧和尾帧；
3. 输入框保持为空；
4. 提交任务；
5. 确认气泡显示“根据首尾帧生成自然连贯的视频”；
6. 确认右侧 `studio-detail-prompt` 显示 `-`；
7. 点击“重新编辑”，确认 `studio-composer-input` 为空；
8. 刷新页面后再次确认第 6、7 项。

#### 用例 B：首尾帧有文本

1. 上传首尾帧；
2. 输入“人物回头并看向镜头”；
3. 提交任务；
4. 确认详情和重新编辑均为该用户原文；
5. 确认没有显示 LLM 润色后的 prompt。

#### 用例 C：再次生成无文本任务

1. 对用例 A 的结果执行“再次生成”；
2. 确认新气泡显示“再次生成”；
3. 确认新结果详情提示词仍显示 `-`；
4. 刷新后仍显示 `-`。

#### 用例 D：用户输入与默认文案完全相同

1. 用户手动输入“根据首尾帧生成自然连贯的视频”；
2. 提交任务；
3. 确认详情显示该文字；
4. 点击重新编辑，确认输入框回填该文字。

该用例用于证明实现依赖显式 `detailPrompt`，而不是通过比较文字内容猜测用户是否输入。

## 9. 验证命令

测试和类型检查不能从仓库根目录运行。完成代码修改后建议执行：

```bash
cd packages/app
bun test octoapp/pages/studio/turns.test.ts
bun typecheck
```

如果修改了 `packages/opencode` 中的代码或测试，再执行：

```bash
cd packages/opencode
bun typecheck
```

本方案预计后端业务代码无需修改，只需确认现有空字符串透传能力。

## 10. 建议实施顺序

1. 修改 `runGeneration()`，让新任务写入真实的 `detailPrompt`，包括空字符串；
2. 修改 `turns.ts`，保证空字符串刷新后不丢失；
3. 修改详情组件，移除 `result.prompt` 回退并显示 `-`；
4. 修改重新编辑 prompt 来源，优先使用存在性感知的 `result.detailPrompt`；
5. 增加 `turns.test.ts` 用例；
6. 运行 app 单测和类型检查；
7. 按首尾帧无文本、刷新、重新编辑、再次生成的完整链路手动验收。

## 11. 验收标准

1. 首帧或首尾帧视频未输入文字时，`studio-user-bubble` 仍显示系统默认文案；
2. 同一任务的 `studio-detail-prompt` 显示 `-`；
3. 点击“重新编辑”后 `studio-composer-input` 为空；
4. 刷新页面或重新进入会话后，第 2、3 项保持不变；
5. 用户填写了提示词时，详情和重新编辑始终使用用户原文，而不是 `refinedPrompt` 或 `effectivePrompt`；
6. 再次生成能够继承来源任务的空 `detailPrompt`；
7. 生成中、成功、创建失败、生成失败四种状态的数据语义一致；
8. 不改变模型实际收到的执行 prompt，不影响无文本首尾帧视频的生成能力。
