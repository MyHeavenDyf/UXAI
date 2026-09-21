# Studio LLM 无意义提示词输出兜底方案

## 1. 背景与问题

Studio 的普通文生图、文生视频会先调用 LLM，将用户输入转换为以下 JSON：

```json
{
  "assistantText": "好的，我会根据你的描述创作画面。",
  "refinedPrompt": "一只在阳光草地上奔跑的金毛犬，胶片质感",
  "detailTitle": "阳光草地金毛"
}
```

目前的 `promptRefineSchema` 只校验三个字段为非空字符串。因此下列响应虽然没有业务意义，仍会被视为成功：

```json
{
  "assistantText": "...",
  "refinedPrompt": "...",
  "detailTitle": "..."
}
```

随后 `refinedPrompt` 会直接写入 `effectivePrompt`，并传给最终图片/视频生成接口，导致 Studio 对话文案和生成提示词同时显示为“...”。

这不是前端 CSS 的省略显示，也不是典型的输出 token 截断：中途截断通常无法构成完整 JSON，会进入已有的解析失败 fallback；本问题的关键是“完整、可解析、但无语义”的 JSON 被放行。

## 2. 目标

当 LLM 的 prompt refine 结果包含确定性的无意义占位内容时：

1. 不将无意义的 `refinedPrompt` 发送给最终生成接口。
2. 将用户原始输入 `input.prompt.trim()` 作为 `refinedPrompt` 和 `effectivePrompt`。
3. 保持 Studio 任务继续创建，不将 LLM 润色异常扩大为最终生图/视频失败。
4. 修复对话展示中的无意义 `assistantText` 和 `detailTitle`。
5. 记录足以定位异常模型/网关的日志。

## 3. 非目标与适用范围

### 3.1 适用范围

只处理真正调用 LLM 的普通 `image.generate` 和 `video.generate` 请求，且没有参考图/首尾帧、没有编辑能力。

校验位置应在 `refineStudioPrompt()` 中：LLM stream 已解析出 JSON 后、结果写入 `effectivePrompt` 前。

### 3.2 明确不处理的场景

以下路径已经绕过 LLM，不应复用或触发本方案：

- **再次生成**：前端恢复上一次保存的 `effectivePrompt/refinedPrompt`，并传递 `extra.skipPromptRefine: true`。
- **参考图、首帧、尾帧生成**：走 `promptPassthroughRefine()`，直接透传用户提示词。
- **超分、抠图、局部重绘、扩图等编辑能力**：走 `promptPassthroughRefine()`。
- provider 任务失败后的 `/reboot`：直接重启 provider 任务，不调用 prompt refine。

不要仅按 `displayPrompt === "再次生成"` 判断是否跳过 LLM；当前正式判断仍应以 `extra.skipPromptRefine === true` 为准。

### 3.3 不使用的策略

- 不按字符串长度判定无意义。`猫`、`日落` 等短提示词是有效输入。
- 不引入模型再次判定、embedding 或复杂的自然语言语义判断。
- 不阻止用户本人输入 `...`；该方案用于阻止模型将正常用户输入替换为占位值。
- 不修改模型选择策略；该策略是后续根据日志定位 provider/model 后的独立问题。

## 4. 改动文件

| 文件 | 改动 |
| --- | --- |
| `packages/opencode/src/studio/studio-service.ts` | 新增无意义字段判定与结果归一化；在 LLM 成功返回后应用；新增命中兜底日志。 |
| `packages/opencode/test/studio/...`（按现有 Studio 服务测试目录落位） | 覆盖 prompt refine 结果归一化的单元测试。若当前没有可复用的服务测试文件，新增最小测试文件。 |

不需要改动 Studio 前端、HTTP route、数据库 schema 或最终图片/视频 provider。

## 5. 后端实现设计

### 5.1 保持现有 JSON 格式校验

继续保留现有的 `promptRefineSchema`：它负责判断 LLM 是否返回了可解析的结构化 JSON。

```ts
const promptRefineSchema = z.object({
  assistantText: z.string().min(1),
  refinedPrompt: z.string().min(1),
  detailTitle: z.string().min(1).max(32).optional(),
})
```

不要将“语义是否有效”的规则直接塞进 Zod schema。结构校验与业务兜底分开，便于日志、测试和后续扩展。

### 5.2 新增确定性占位值识别 helper

在 `packages/opencode/src/studio/studio-service.ts` 的 prompt refine helper 区域新增一个纯函数，例如：

```ts
function isMeaninglessStudioPromptRefineText(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return true
  if (["null", "undefined", "none", "n/a", "na"].includes(normalized)) return true
  return /^[.。…·、,，;；:：!！?？~～_\-]+$/.test(normalized)
}
```

规则应仅覆盖确定性占位值：

- 空字符串/全空白；
- 纯省略号、句点、中文句号、连字符、下划线或常见标点组合；
- `null`、`undefined`、`none`、`N/A` 等明确占位词。

不要使用 `\p{P}` 或“去除所有符号后是否为空”这种宽泛规则，以免误判用户可能使用的 emoji、符号化创作提示词或其他有效内容。

### 5.3 新增字段级归一化 helper

新增一个只在 LLM 成功解析后调用的 helper，例如 `normalizePromptRefineResult()`。输入为：

- `input: StudioGenerationRequest`
- `parsed: StudioPromptRefineResult`（或相应的 parsed schema 类型）

行为如下：

1. 若 `parsed.refinedPrompt` 无意义：
   - 使用 `input.prompt.trim()` 作为 `refinedPrompt` 和 `effectivePrompt`；
   - 使用 `buildSubmittingAssistantText(input)` 作为 `assistantText`；
   - 使用 `fallbackDetailTitle(input)` 作为 `detailTitle`；
   - 将 `fallback` 设为 `true`。
2. 若 `parsed.refinedPrompt` 有效，但 `assistantText` 无意义：
   - 保留 LLM 的 `refinedPrompt/effectivePrompt`；
   - 仅用 `buildSubmittingAssistantText(input)` 修复 `assistantText`。
3. 若 `detailTitle` 缺失或无意义：
   - 仅使用 `fallbackDetailTitle(input)` 修复标题；
   - 不影响有效的 `assistantText/refinedPrompt`。
4. 三个字段都有效：保持当前行为不变。

`refinedPrompt` 是最终生成输入，风险最高；它无效时应采用整组安全 fallback，而不是保留模型生成的对话文案。`assistantText` 和 `detailTitle` 分别只影响展示与标题，可以独立修复，避免丢弃有效 prompt。

### 5.4 为什么不用 `promptRefineFallback()`

当前 `promptRefineFallback()` 在普通多轮场景会调用 `buildEffectivePromptFromPrevious()`，把上一轮生成内容拼接进新提示词。

本方案的语义是“模型润色结果无效时，原样透传用户当前输入”，因此 `refinedPrompt` 无效时不应调用该函数。应使用 `input.prompt.trim()`，其语义与 `promptPassthroughRefine()` 一致。

如果未来产品决定优先保留多轮上下文，可单独修改这一产品策略；不要在此次故障兜底中隐式引入上下文扩写。

### 5.5 在 `refineStudioPrompt()` 中接入

现有成功路径在 LLM 结果返回后直接执行：

```ts
return {
  assistantText: result.assistantText.trim(),
  refinedPrompt: result.refinedPrompt.trim(),
  effectivePrompt: result.refinedPrompt.trim(),
  detailTitle: result.detailTitle?.trim() || fallbackDetailTitle(input),
  raw: result,
}
```

将上述构造替换为：

```ts
return normalizePromptRefineResult(input, result)
```

或先构造当前的标准结果、再将该结果传入 normalize helper。这样只影响 LLM 成功解析后的分支；解析失败、超时、取消及已有 fallback 逻辑均不改变。

## 6. 可观测性

当前成功路径只记录模型选择和请求长度，不记录 LLM 成功输出是否触发异常兜底。命中无意义兜底时新增一条 `console.warn`，建议字段包括：

```ts
{
  sessionID,
  capability: input.capability,
  providerID: resolved.providerID,
  modelID: resolved.id,
  invalidFields: ["refinedPrompt", "assistantText"],
  assistantTextLength: result.assistantText.length,
  refinedPromptLength: result.refinedPrompt.length,
  detailTitleLength: result.detailTitle?.length ?? 0,
  refinedPromptPreview: result.refinedPrompt.slice(0, 80),
}
```

日志只在命中兜底时打印，避免扩大常规日志量。preview 需遵循现有日志脱敏要求；如 prompt 可能包含敏感业务信息，则只记录长度、哈希或明确允许的短 preview。

日志目标是确认异常是否集中在某一个 `connected` provider/model，而不是记录完整用户输入。

## 7. 测试矩阵

为归一化 helper 编写纯单元测试，避免依赖真实 LLM 或 mock stream。

| 场景 | LLM 结果 | 预期 |
| --- | --- | --- |
| 正常结果 | 三字段均正常 | 原样保留，`fallback` 不设置 |
| 双省略号 | `assistantText/refinedPrompt` 都为 `...` | prompt 改为 `input.prompt`，固定 assistant 文案，fallback title，`fallback: true` |
| 中文省略号 | `refinedPrompt: "……"` | 同上 |
| 纯空白 | `refinedPrompt: "   "` | 同上 |
| 占位词 | `refinedPrompt: "undefined"` | 同上 |
| 仅 assistant 异常 | `assistantText: "..."`、prompt 正常 | 保留 prompt，仅修复 assistant 文案 |
| 仅标题异常 | `detailTitle: "..."`、其他正常 | 保留其他字段，仅修复标题 |
| 短有效提示词 | `refinedPrompt: "猫"` | 必须视为有效，不能触发 fallback |
| 再次生成 | `skipPromptRefine: true` | 不调用 LLM；现有透传逻辑保持不变（可在现有请求级测试中覆盖） |
| 参考图/编辑能力 | 对应 passthrough 条件 | 不调用 LLM；现有逻辑保持不变 |

## 8. 验证步骤

1. 从 `packages/opencode` 运行 `bun typecheck`。
2. 从 `packages/opencode` 运行新增/相关 Studio 单元测试，禁止在仓库根目录执行测试。
3. 手工验证普通文生图与文生视频：确认正常模型输出不受影响。
4. 用单元测试或可控的 LLM stub 输入 `{"assistantText":"...","refinedPrompt":"..."}`：确认最终 provider request 使用原始用户 prompt，而不是“...”。
5. 验证再次生成、参考图生图、图生视频、编辑能力：确认没有新增 LLM 调用。
6. 检查命中兜底时的日志：应包含实际 provider/model 与 `invalidFields`，不应泄露完整敏感 prompt。

## 9. 验收标准

- 任何 LLM 返回的纯占位 `refinedPrompt` 都不能到达最终生成接口。
- `studio-assistant-copy` 不再显示模型返回的“...”。
- 正常短提示词不被误判。
- 再次生成及所有现有 passthrough 路径行为不变。
- 可通过日志追踪到异常返回对应的 provider/model。
