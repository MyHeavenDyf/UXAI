# Studio 独立异步标题精炼实现方案

## 1. 背景

Studio 用户输入可能很长，直接把用户提示词用于以下位置会造成标题过长、可读性差：

- 右侧详情区域 `studio-detail-title`；
- 画布顶部 `studio-canvas-tab`；
- 首轮生成对应的 Studio 会话标题。

当前代码已经引入 `detailTitle`，并完成了前端展示、历史恢复和会话标题同步，但标题并不是独立任务。当前 `refineStudioPrompt()` 要求一次 LLM 调用同时返回：

```json
{
  "assistantText": "好的，我会根据你的描述创作画面。",
  "refinedPrompt": "扩写后的生成提示词",
  "detailTitle": "雨中木屋"
}
```

生成链路会先等待 `refineStudioPrompt()`，再创建图片或视频供应商任务。因此标题生成与提示词润色耦合，且标题所在的 LLM 请求会阻塞供应商任务创建。

## 2. 本次目标

本次仅改造 Studio，不抽取普通会话与 Studio 共用的标题生成服务。

目标如下：

1. Studio 提示词润色 LLM 只负责生成 `assistantText` 和 `refinedPrompt`。
2. 新增 Studio 专用 `generateStudioDetailTitle()`，单独调用 LLM 精炼标题。
3. 标题任务在提示词润色完成后启动：有润色结果时使用 `refinedPrompt`，没有润色任务或润色降级时使用用户输入。
4. 图片/视频供应商任务创建成功并开始轮询后，标题任务与生成轮询并行执行。
5. 标题任务失败、超时或没有可用文本模型时，不影响图片/视频任务创建、轮询和完成。
6. 标题完成后更新 generation、会话 tool part 和前端展示。
7. 首轮生成的标题仍可同步到 `Session.title`，但不得覆盖用户手动重命名。
8. 再次生成、编辑能力等已有标题语义保持不变。
9. 同步改造 Studio 提示词润色的模型选择：润色任务与标题任务都优先使用合法、可见的小模型，未命中后再执行当前模型选择逻辑。

## 3. 非目标

本次不做以下事项：

- 不改造普通会话的 `SessionPrompt.ensureTitle()`；
- 不抽取跨模块通用 `generateTitle()`；
- 不让用户在 Studio UI 中选择标题模型；
- 不把 Seedream、即梦等图片/视频生成模型当作标题模型；
- 不改变 `studio-detail-copy` 展示完整有效提示词的语义；
- 不改变再次生成继承原结果标题的行为；
- 不为历史数据批量补生成标题。

## 4. 当前实现

### 4.1 标题生成与提示词润色耦合

文件：`packages/opencode/src/studio/studio-service.ts`

当前 `StudioPromptRefineResult` 包含：

```ts
export type StudioPromptRefineResult = {
  assistantText: string
  refinedPrompt: string
  effectivePrompt: string
  detailTitle: string
  fallback?: boolean
  raw?: unknown
}
```

`IMAGE_PROMPT_REFINE_SYSTEM` 和 `VIDEO_PROMPT_REFINE_SYSTEM` 都要求 LLM 同时输出 `detailTitle`，`promptRefineSchema` 也负责解析该字段。

`runGenerationCreatePipeline()` 当前按以下顺序执行：

```text
await refineStudioPrompt()
  ↓
更新 detailTitle/refinedPrompt/effectivePrompt
  ↓
更新会话标题和 tool part
  ↓
await createProviderTask()
```

所以标题不是独立子任务，并且被绑定在生成任务必须等待的提示词润色阶段中。

### 4.2 已完成的消费链路

以下能力已经存在，应保留：

- `StudioGenerationRequest`、`StudioGenerationResult` 和 SDK 中已有 `detailTitle`；
- `generationSnapshot()` 会返回 `detailTitle`；
- `studioToolInput()` 会把标题写入 tool part；
- `turns.ts` 会从 tool input 恢复 `detailTitle`；
- `studio-detail-title` 优先展示 `result.detailTitle`；
- `studio-canvas-tab` 优先展示 `result.detailTitle`；
- Canvas 已有 effect，可在结果标题变化后刷新 Tab 标签；
- 首轮标题更新前会比较 `initialSessionTitle`，避免覆盖手动重命名。

## 5. 目标架构

```text
POST /studio/generations
  ↓
创建 generation、message、tool part
  ↓
立即返回带本地 fallback detailTitle 的 pending snapshot
  ↓
后台 runGenerationCreatePipeline()
  ↓
refineStudioPrompt()
  ├─ 正常完成：得到 refinedPrompt
  └─ 跳过/失败降级：使用用户输入形成 effectivePrompt
  ↓
更新 assistantText/refinedPrompt/effectivePrompt
  ↓
createProviderTask(effectivePrompt)
  ↓
持久化 provider task 并启动生成轮询
  ├─ 分支 A：poll generation，持续更新进度和最终结果
  └─ 分支 B：generateStudioDetailTitle(effectivePrompt)
       └─ 更新 detailTitle
            ├─ Studio generation request
            ├─ session tool part input
            └─ 首轮 Session.title（条件更新）
```

标题任务依赖提示词润色的语义结果，因此不与润色 LLM 并发。供应商任务开始轮询后，标题精炼与图片/视频生成并行：生成轮询是必要路径，标题是非关键旁路任务。

标题分支的任何失败只能记录日志并保留本地 fallback，不能调用 `failGenerationCreationByID()`，也不能修改 generation 的业务状态。

## 6. 标题语义

### 6.1 `detailTitle`

`detailTitle` 表示单个 Studio 生成结果的短标题：

- 中文优先，必要的英文专有名词可以保留；
- 建议 4–12 个中文字，服务端最终最多保留 16 个字符；
- 只概括主体、核心画面或核心动作；
- 不包含模型、工具、比例、数量、时长、质量模式等参数；
- 不包含“生成一张”“帮我制作”“画面描述”等解释性文字；
- 不使用引号、句号、Markdown；
- 图片示例：`雨中木屋`、`晨雾山谷`；
- 视频示例：`海边奔跑`、`咖啡馆镜头推进`。

### 6.2 标题输入

标题必须描述本轮最终生效的画面语义，不能只看当前用户的一句话。

例如：

```text
第一轮：生成一个黄毛小狗
第二轮：把狗换成猫
```

第二轮如果只把“把狗换成猫”交给标题模型，模型缺少第一轮主体、场景和构图信息；而提示词润色结果已经把本轮修改合并到完整画面语义中。因此标题输入按以下优先级确定：

```ts
const text = promptRefine.refinedPrompt.trim() ||
  promptRefine.effectivePrompt.trim() ||
  input.detailPrompt?.trim() ||
  input.prompt.trim()
```

具体规则：

- 正常执行润色任务：标题使用 `refinedPrompt`；
- 润色 LLM 失败并进入 fallback：标题使用 fallback 后的 `effectivePrompt`；
- 参考图、编辑能力或显式 `skipPromptRefine` 导致没有润色调用：标题使用用户原始输入；
- 不使用 `displayPrompt` 中的“再次生成”等操作标签；
- 再次生成直接继承来源 result 的 `detailTitle`，不启动新的标题任务；
- 固定标题的编辑能力继续使用“智能重绘”“扩图”“变清晰”“抠图”等能力标题，不调用标题 LLM。

标题请求仍不额外传入模型、比例、数量、时长、图片 URL、上传句柄等配置。润色后的有效提示词本身已经包含标题需要的完整语义。

对于极长输入，构造标题消息时增加字符上限，例如 4,000 字符。建议保留开头和结尾：

```ts
function studioTitleInput(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (normalized.length <= 4_000) return normalized
  return `${normalized.slice(0, 3_000)}\n…\n${normalized.slice(-1_000)}`
}
```

避免只截取开头导致用户放在结尾的核心要求丢失。

### 6.3 本地 fallback

创建 generation 时继续同步计算 `fallbackDetailTitle()`，确保接口立即返回可展示标题：

```text
优先 detailPrompt
  ↓
其次 prompt
  ↓
取第一行、清理标点和连续空白、截断 16 字
  ↓
为空时使用“图片创作”或“视频创作”
```

LLM 标题成功后覆盖 fallback；失败时一直保留 fallback。

## 7. Studio 文本任务模型选择

Studio 页面没有让用户主动选择文本标题模型，因此不能照搬普通会话“回退当前业务模型”的逻辑，更不能回退到图片/视频生成模型。

本次不是只给标题任务增加小模型判断，而是直接改造 Studio 文本任务的统一模型选择器。`refineStudioPrompt()` 和 `generateStudioDetailTitle()` 都必须调用同一个选择器，并遵守相同优先级。

当前 `refineStudioPrompt()` 调用 `selectStudioPromptRefineModel()`，现有顺序大致是：

```text
session model
  ↓ 未找到
第一个已连接、可见的文本模型
  ↓ 旧客户端无白名单时
provider.defaultModel()
```

本次在这套逻辑最前面增加小模型判断，并将函数改名为更符合职责的 Studio 私有选择器，例如 `selectStudioTextModel()`：

- 前端通过 `promptRefineModels` 传入当前可见文本模型白名单；
- 服务端把 `selectStudioPromptRefineModel()` 调整为 Studio 通用文本模型选择器，例如 `selectStudioTextModel()`；该函数仍只在 `studio-service.ts` 内使用，不抽成公共能力；
- 提示词润色任务和标题任务都只允许从白名单及 Studio 当前可连接 provider 中选择文本 LLM；
- 首先按照“session provider 在前、其他已连接 provider 在后”的顺序调用 `provider.getSmallModel(providerID)`；该方法会优先返回配置的 `small_model`，未配置时再按 Haiku、Flash、Nano 等关键词自动寻找轻量模型；
- 对 `getSmallModel()` 返回的每个候选做 Studio 可用性校验，第一个合法候选即为本次文本模型；
- 小模型没有选中时，再执行当前逻辑：优先合法的 session model，其次第一个已连接可见模型；
- 存在白名单但找不到模型时，标题任务直接降级，不调用图片/视频模型；
- 仅在旧客户端没有传 `promptRefineModels` 时，保留当前 `provider.defaultModel()` 兼容路径。

最终优先级为：

```text
provider.getSmallModel() 返回的首个合法可见小模型
  ↓ 未选中
合法且可见的 session model
  ↓ 未找到
当前已有的 connected/default 选择逻辑
  ↓ 仍未找到
标题任务使用 fallback；润色任务沿用自身 fallback
```

`provider.getSmallModel()` 在存在全局 `small_model` 时可能忽略传入的 providerID，返回另一个 provider 的模型，因此不能直接信任返回值。Studio 选择器必须用 `Effect.option` 隔离解析失败，并再次校验：

- provider 未被禁用且具备连接凭证；
- model 可以通过 `provider.getModel()` 解析；
- model 位于 `promptRefineModels` 白名单内；
- 该模型是文本 LLM，不能是图片或视频生成模型。

标题与提示词润色通常会使用同一个 Studio 文本模型，但它们仍是两个独立 LLM 请求。

为减少重复逻辑，可以在 `studio-service.ts` 内将模型解析提取为 Studio 私有函数，但不导出为公共能力：

```ts
async function resolveStudioTextModel(input: {
  request: StudioGenerationRequest
  session: typeof SessionTable.$inferSelect
  signal?: AbortSignal
}) {
  // 调用现有 selectStudioPromptRefineModel()
  // 返回 resolved Provider.Model
}
```

调用方式明确如下：

```ts
// 提示词润色任务：也先尝试小模型
const refineModel = yield* selectStudioTextModel(
  provider,
  session,
  disabledProviders,
  enabledModels,
)

// provider task 开始轮询后，标题任务重新按同一规则选模型
const titleModel = yield* selectStudioTextModel(
  provider,
  latestSession,
  disabledProviders,
  enabledModels,
)
```

提示词润色先调用该函数选择模型。标题任务在润色和供应商任务创建完成后再次调用该函数，避免依赖已经结束的润色调用状态，并允许配置在两次调用之间发生变化。

### 7.1 小模型候选解析

在 `studio-service.ts` 内新增 Studio 私有 helper，例如：

```ts
const selectStudioSmallModel = Effect.fn("Studio.selectSmallModel")(function* (
  provider: Provider.Interface,
  session: typeof SessionTable.$inferSelect,
  disabledProviders: Set<string>,
  enabledModels?: Set<string>,
) {
  // 1. session provider 优先，其次其他已连接 provider
  // 2. 对每个 provider 调用 provider.getSmallModel(providerID)
  // 3. 用 Effect.option 隔离模型不存在、配置失效等错误
  // 4. 校验 provider 连接状态、disabledProviders 和 enabledModels
  // 5. 返回第一个合法小模型；没有则返回 undefined
})
```

`selectStudioTextModel()` 先调用它：

```ts
const smallModel = yield* selectStudioSmallModel(
  provider,
  session,
  disabledProviders,
  enabledModels,
)
if (smallModel) return smallModel

// 以下完整保留当前逻辑
const sessionModel = sessionPromptRefineModel(session, enabledModels)
// session model -> connected model -> default model
```

小模型选择异常只代表该候选不可用，不能让整个模型选择提前失败；应继续走原有 session/connected/default 回退链路。

### 7.2 对提示词润色的影响

`refineStudioPrompt()` 的调用时机、超时、fallback 和有效提示词构建规则不变，只改变它选中的文本模型：

- 有合法小模型时，使用小模型完成 `assistantText/refinedPrompt`；
- 小模型不可用时，行为与改造前一致；
- 小模型调用成功但输出非法时，仍按现有 `normalizeStudioPromptRefineResult()` 和 fallback 规则处理；
- 小模型在实际 LLM 调用阶段超时或报错时，本次不自动切换到下一个大模型重试，继续使用现有 prompt refine fallback，避免延迟供应商任务创建；
- `PROMPT_REFINE_TIMEOUT_MS` 保持 45 秒，本次不调整润色超时策略。

这里的“小模型优先”是调用前的模型选型回退，不是 LLM 调用失败后的动态换模型。

## 8. 服务端详细实现

### 8.1 将提示词润色结果恢复为单一职责

文件：`packages/opencode/src/studio/studio-service.ts`

将 `StudioPromptRefineResult` 改为：

```ts
export type StudioPromptRefineResult = {
  assistantText: string
  refinedPrompt: string
  effectivePrompt: string
  fallback?: boolean
  raw?: unknown
}
```

同步修改：

1. `promptRefineSchema` 删除 `detailTitle`；
2. `completePromptRefineResult()` 不再补充标题；
3. `studioPromptRefineInvalidFields()` 不再校验标题；
4. `normalizeStudioPromptRefineResult()` 只规范 `assistantText/refinedPrompt/effectivePrompt`；
5. `promptPassthroughRefine()`、`promptRefineFallback()`、`submittingPromptRefine()` 不再返回标题；
6. 图片和视频润色 system prompt 删除标题规则；
7. LLM 输出日志删除 `detailTitleLength`。

润色 LLM 的目标 JSON 改为：

```json
{
  "assistantText": "好的，我会根据你的描述创作画面。",
  "refinedPrompt": "扩写后的提示词"
}
```

### 8.2 新增 Studio 专用标题结果和 Schema

仍在 `studio-service.ts` 内新增，不创建公共模块：

```ts
type StudioDetailTitleResult = {
  title: string
  fallback?: boolean
  raw?: unknown
}

const studioDetailTitleSchema = z.object({
  title: z.string().min(1).max(32),
})
```

建议标题 LLM 输出 JSON，而不是自由文本：

```json
{"title":"雨中木屋"}
```

这样可复用现有 JSON 提取思路，并降低模型附带解释文字的概率。

新增：

```ts
function parseStudioDetailTitleText(text: string)
function normalizeStudioDetailTitle(input: StudioGenerationRequest, title?: string)
async function generateStudioDetailTitle(input, session, options)
```

`normalizeStudioDetailTitle()` 负责：

- 去除 `<think>...</think>`；
- 取 JSON 中的 `title`；
- 清理换行、引号、Markdown 和首尾标点；
- 把连续空白折叠为单个空格；
- 最多保留 16 个字符；
- 无意义结果返回 `undefined`，由调用方继续保留 fallback。

### 8.3 新增标题专用 Prompt

在 `studio-service.ts` 内新增：

```ts
const STUDIO_DETAIL_TITLE_SYSTEM = [
  "你是 Octo Studio 的标题精炼助手。",
  "根据用户当前输入生成一个简短标题。",
  "只概括主体、核心画面或核心动作。",
  "使用中文，必要的英文专有名词可以保留。",
  "建议 4 到 12 个中文字，最多 16 个字符。",
  "不要包含模型、工具、比例、数量、时长或质量参数。",
  "不要包含生成一张、帮我制作、画面描述等解释性文字。",
  "不要使用句号、引号或 Markdown。",
  "只输出 JSON：{\"title\":\"雨中木屋\"}。",
].join("\n")
```

标题任务使用 `toolChoice: "none"`、`tools: {}`，并关闭 skills/MCP，避免产生额外行为。

标题 timeout 建议为 10 秒：

```ts
const STUDIO_DETAIL_TITLE_TIMEOUT_MS = 10_000
```

标题是非关键 UI 元数据，不应沿用提示词润色的 45 秒超时。

### 8.4 标题 Agent

本次不调用普通会话的内置 `title` agent，避免引入普通会话历史构造和默认标题判断。

在 `studio-service.ts` 内基于 `octo_studio` agent 构造一个无工具、无 skill 的 Studio 私有 agent：

```ts
function studioDetailTitleAgent(agent: Agent.Info | undefined): Agent.Info {
  return {
    ...(agent ?? studioAgentFallback),
    prompt: "You are a Studio title refinement assistant. Follow the task instructions exactly.",
    options: {},
    temperature: 0.2,
    topP: undefined,
    skills: undefined,
    mcp: undefined,
  }
}
```

温度低于提示词润色任务，减少标题格式和措辞波动。

### 8.5 修改 `studioToolInput()`

当前 `studioToolInput(request, promptRefine)` 从 `promptRefine.detailTitle` 读取标题。解耦后改为从 request 读取：

```ts
function studioToolInput(request: StudioGenerationPromptInput, promptRefine: StudioPromptRefineResult) {
  return {
    // ...
    detailTitle: request.detailTitle,
    refinedPrompt: promptRefine.refinedPrompt,
    effectivePrompt: promptRefine.effectivePrompt,
    // ...
  }
}
```

创建阶段 `generationInput.detailTitle` 始终先写入本地 fallback。

### 8.6 并发编排

标题依赖润色后的完整语义，所以 `runGenerationCreatePipeline()` 的正确顺序是：

```ts
const promptRefine = await refineStudioPrompt(input, session, {
  signal: createController.signal,
})

const generationInput = await persistStudioPromptRefine(id, promptRefine)
const task = await createProviderTask(generationInput, record.provider)

await persistStudioProviderTask(id, task)
startStudioGenerationWorker()

const runTitle = Instance.bind(() =>
  runStudioDetailTitleTask({
    id,
    text: studioDetailTitleInput(generationInput, promptRefine),
  }).catch((error) => {
    console.warn("[studio.service] detail title failed", { id, error })
  }),
)
void runTitle()
```

要求：

- 提示词润色完成前不启动标题任务；
- provider task 必须先成功创建、持久化并进入 worker 轮询，再启动标题任务；
- 标题任务使用本轮最终 `refinedPrompt/effectivePrompt`，不能重新读取原始短指令替代它；
- `runStudioDetailTitleTask()` 是独立的 fire-and-forget 后台任务；
- 标题任务内部吞掉非取消错误，只记录 warning；
- 标题任务不被 `runGenerationCreatePipeline()` await，因此标题耗时不会延长供应商创建链路；
- 标题任务启动时，generation worker 已经可以查询供应商进度，两者并行运行；
- provider task 创建失败时不启动标题 LLM，失败卡片继续使用本地 fallback，避免无结果任务产生额外模型成本。

由于标题任务会在创建 pipeline 返回后继续运行，需要独立管理取消控制器：

```ts
const activeGenerationTitleControllers = new Map<
  string,
  { controller: AbortController; directory: string }
>()
```

`runStudioDetailTitleTask()` 创建并登记自己的 controller，标题完成后在 `finally` 中删除。现有 generation cancel 路径需要同时 abort：

- `activeGenerationControllers.get(id)`：润色和 provider 创建阶段；
- `activeGenerationTitleControllers.get(id)`：provider 已创建后的标题阶段。

标题 controller 自身还需叠加 10 秒 timeout signal。

### 8.7 避免并发写覆盖

标题任务和 generation worker 可能同时修改：

- `StudioGenerationTable.request`；
- tool part 的 `state.input`。

如果两个分支都基于启动时读取的旧 request 整体覆盖，会出现：

- 标题任务覆盖 provider task 或最新状态数据；
- worker 完成 tool part 时把 LLM 标题覆盖回 fallback；
- tool part 与 generation request 不一致。

实现中不增加异步 Promise 锁。当前 Database 和 `SyncEvent.run()` 写入都是同步操作，只要持久化函数内部不出现 `await`，同一个 JavaScript 事件循环不会在“读最新值—合并—写入”的临界段中切换到 worker。

新增同步 `persistStudioDetailTitle()`，每次执行时重新读取最新 generation 和任意状态的 tool part：

```ts
function persistStudioDetailTitle(id: string, title: string) {
  const record = loadGenerationRecord(id)
  if (!record || isGenerationCancelled(record)) return
  const data = generationRequest(record)
  const request = { ...data.input, detailTitle: title }

  // 同步更新 StudioGenerationTable.request，保留最新 task。
  // 随后通过 loadAnyPersistedTurn(record) 读取最新 tool state，
  // 只合并 state.input.detailTitle 并发送 message.part.updated。
}
```

调用约束：

1. provider task 必须先持久化，再启动标题任务，因此标题不会覆盖创建阶段的 request；
2. 标题完成后重新调用 `loadGenerationRecord(id)`，不能使用任务启动前的旧 record；
3. request 写回时保留最新 `data.task`；
4. 写入 tool part 时基于最新 `state` 和最新 `state.input` 做字段合并；
5. 标题可能晚于生成完成，必须使用 `loadAnyPersistedTurn()` 支持 running、completed、error 三种 tool state；
6. worker 的进度、完成和失败更新继续从数据库读取最新 tool part，从而保留已经写入的标题；
7. request 与 tool part 的连续写入之间不得增加 `await`。

标题更新只 patch 一个字段：

```ts
const request = {
  ...generationRequest(loadGenerationRecord(id)!).input,
  detailTitle: title,
}
```

润色和 provider task 的持久化都发生在标题任务启动之前；标题任务只覆盖 `detailTitle`，不重新构造或回退 `refinedPrompt/effectivePrompt`。

### 8.8 持久化标题并更新 Session

新增：

```ts
function persistStudioDetailTitle(id: string, title: string) {
  // 同步合并 generation request 和任意状态 tool part
  // 根据最新 request 判断是否同步首轮 Session.title
}
```

Session 标题更新继续遵守：

```ts
if (
  input.shouldSetSessionTitle &&
  (!latestSession.title || latestSession.title === input.initialSessionTitle)
) {
  SyncEvent.run(Session.Event.Updated, {
    sessionID: record.session_id,
    info: { title },
  })
}
```

判断时必须重新读取 session，不能使用标题任务启动时的 session 快照。

后续 generation 的 `shouldSetSessionTitle` 为空，因此只更新自身 `detailTitle`，不改变会话标题。

### 8.9 取消、失败和终态处理

标题结果允许在 generation 处于以下状态时写入：

- `queued`；
- `running`；
- `succeeded`；
- provider 已接受任务后产生的非用户取消 `failed`，便于失败卡片和历史记录仍显示短标题。

如果 generation 已被用户取消，标题任务收到自己的 abort signal 后直接退出，不再更新标题。

错误隔离规则：

| 场景 | 标题行为 | 生成任务行为 |
|---|---|---|
| 标题 LLM 超时 | 保留 fallback，记录 warning | 继续 |
| 标题输出非法 | 保留 fallback，记录 warning | 继续 |
| 没有可用文本模型 | 保留 fallback，记录 warning | 润色按自身策略处理 |
| 提示词润色失败 | 与标题任务无关 | 使用现有润色 fallback |
| 供应商创建失败 | 不启动标题 LLM，保留 fallback | generation 进入 `create_failed` |
| 用户取消 | 中止标题请求 | 执行现有取消流程 |

## 9. 前端实现

### 9.1 保留现有展示逻辑

以下文件原则上无需改变核心展示：

- `packages/app/octoapp/pages/studio/studio-conversation.tsx`
- `packages/app/octoapp/pages/studio-page.tsx`
- `packages/app/octoapp/pages/studio/turns.ts`
- `packages/app/octoapp/pages/studio/types.ts`

继续使用：

```ts
result.detailTitle ?? buildStudioDisplayPrompt(result.prompt)
```

Canvas Tab 继续使用：

```ts
result.detailTitle ?? extractKeywords(result.prompt)
```

### 9.2 Pending 标题

`runGeneration()` 创建 pending result 时继续计算本地标题，但建议统一为与服务端相同的 16 字 fallback 规则。

当前前端通过 `buildStudioDisplayPrompt()` 生成 pending 标题，需要确认它的最大长度与服务端一致。如果不一致，新增 Studio 前端私有 helper：

```ts
function fallbackStudioDetailTitle(text: string, capability: StudioCapability)
```

该标题只用于 LLM 标题返回前的即时展示。

### 9.3 实时更新来源

标题持久化到 tool part 后，现有 `message.part.updated` 事件会进入 `dataStore`，`turns()` 重建结果，进而更新：

- 右侧 `studio-detail-title`；
- Canvas Tab label；
- 当前结果标题。

首轮 `Session.title` 更新通过 `session.updated` 更新顶部标题和左侧会话列表。

不新增单独的标题轮询接口。

## 10. API 与数据结构

本次保留现有 API 字段：

```ts
detailTitle?: string
initialSessionTitle?: string
shouldSetSessionTitle?: boolean
promptRefineModels?: Array<{ providerID: string; modelID: string }>
```

原因：

- `detailTitle` 仍用于客户端 fallback 和再次生成继承；
- `initialSessionTitle/shouldSetSessionTitle` 仍用于首轮会话标题竞态保护；
- `promptRefineModels` 当前实际承担 Studio 可用文本模型白名单的作用，标题任务可直接复用。

因此正常情况下不需要修改 REST Schema，也不需要重新生成 SDK。

如果实现时决定把 `promptRefineModels` 重命名为更通用的 `studioTextModels`，则必须同步修改 API Schema、Effect HTTP API、handler、前端请求和 JS SDK；本方案为控制改动范围，不建议在本次重命名。

## 11. 涉及文件

### 11.1 必改文件

| 文件 | 修改内容 |
|---|---|
| `packages/opencode/src/studio/studio-service.ts` | 拆除润色结果中的 `detailTitle`；为 Studio 文本模型选择增加小模型优先；新增 Studio 标题 prompt/schema/LLM 调用；在 provider 轮询开始后异步启动标题；标题持久化；按 generation 串行更新；错误和取消隔离 |

### 11.2 需核验、可能小改文件

| 文件 | 修改内容 |
|---|---|
| `packages/app/octoapp/pages/studio-page.tsx` | 核验 pending fallback 长度；必要时统一 fallback helper；确认异步标题到达后 Tab label 自动刷新 |
| `packages/app/octoapp/pages/studio/studio-conversation.tsx` | 核验详情标题仍优先使用 `detailTitle`，通常无需修改 |
| `packages/app/octoapp/pages/studio/turns.ts` | 核验 tool part 更新后能恢复新标题，通常无需修改 |
| `packages/app/octoapp/pages/studio/types.ts` | 保留 `detailTitle?: string`，通常无需修改 |

### 11.3 测试文件

| 文件 | 修改内容 |
|---|---|
| `packages/opencode/src/studio/studio-service.test.ts` 或现有 Studio service 测试文件 | 新增标题解析、normalize、fallback、并发、失败隔离和竞态测试 |
| `packages/app/octoapp/pages/studio/turns.test.ts` | 保留并补充 tool input 标题更新后的恢复测试 |

### 11.4 本方案默认不改

以下文件已有字段定义，本次不新增 API 字段时无需修改：

- `packages/opencode/src/server/routes/instance/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/agent/prompt/title.txt`

## 12. 分阶段实施步骤

### 阶段一：拆分类型和 Prompt

1. 从 `StudioPromptRefineResult` 删除 `detailTitle`。
2. 从 prompt refine Schema、解析、normalize、日志中删除标题逻辑。
3. 修改图片和视频润色 system prompt，只输出 `assistantText/refinedPrompt`。
4. 修改 `studioToolInput()`，从 request 读取 `detailTitle`。
5. 确认原有润色 fallback 不再负责标题。

### 阶段二：统一 Studio 文本模型选择

1. 新增 `selectStudioSmallModel()`，按 session provider、其他 connected provider 的顺序寻找小模型。
2. 对 `provider.getSmallModel()` 的结果做 provider 连接、禁用状态、可见白名单和模型可解析校验。
3. 将 `selectStudioPromptRefineModel()` 重命名或重构为 `selectStudioTextModel()`。
4. 把小模型选择放在原有 session/connected/default 逻辑之前。
5. `refineStudioPrompt()` 改为调用新的统一选择器。
6. 标题任务也调用同一个统一选择器。
7. 小模型未命中或候选解析失败时，确认仍可进入原有回退链路。

### 阶段三：实现 Studio 标题任务

1. 新增 `StudioDetailTitleResult` 和 Schema。
2. 新增 Studio 专用标题 system prompt 和 agent 包装。
3. 新增标题输入裁剪、输出解析和 normalize。
4. 标题输入优先使用本轮润色后的 `refinedPrompt/effectivePrompt`，没有润色调用时使用用户输入。
5. 使用增加了小模型优先判断的 Studio 文本模型选择器调用 LLM。
6. 增加 10 秒 timeout 和独立 abort controller。
7. 标题失败时返回 `undefined`，不抛到 generation 主链路。

### 阶段四：实现并发安全持久化

1. 新增同步 `persistStudioDetailTitle()`，执行时重新读取最新 generation request。
2. 保留最新 provider task，只 patch `detailTitle`。
3. 通过 `loadAnyPersistedTurn()` 支持 running、completed、error tool state。
4. 合并最新 `state.input` 后发出 `message.part.updated`。
5. 确保持久化临界段中没有 `await`。
6. 保留首轮 Session 标题条件更新。

### 阶段五：异步编排

1. 保持 `refineStudioPrompt()` 位于 provider 创建之前。
2. 用润色后的最终有效提示词创建 provider task。
3. provider task 持久化并启动 worker 后，fire-and-forget 启动标题任务。
4. 标题任务与生成轮询并行运行，主 pipeline 不 await 标题。
5. 标题任务使用独立 controller，取消 generation 时同时中止创建阶段和标题阶段。
6. provider 创建失败时不启动标题任务。

### 阶段六：前端与回归验证

1. 统一前后端 fallback 长度。
2. 验证详情标题异步替换。
3. 验证已经打开的 Canvas Tab 异步改名。
4. 验证首轮 Session 标题异步更新。
5. 验证手动重命名不会被覆盖。
6. 验证刷新后从 tool input 恢复标题。

## 13. 测试方案

### 13.1 单元测试

标题解析：

- 合法 JSON 标题；
- Markdown code fence 包裹的 JSON；
- 带 `<think>` 的返回；
- 空字符串、`null`、纯标点；
- 超过 16 字自动截断；
- 标题包含引号、句号和换行时正确清理。

标题输入：

- 普通短输入保持不变；
- 4,000 字以内不截断；
- 超长输入保留头 3,000 字和尾 1,000 字；
- 有润色结果时使用 `refinedPrompt`；
- 润色失败时使用 fallback 后的 `effectivePrompt`；
- 不执行润色的路径使用 `detailPrompt ?? prompt`；
- 第二轮“把狗换成猫”场景的标题输入包含替换完成后的完整画面语义；
- “再次生成”不作为标题输入。

模型选择：

- `refineStudioPrompt()` 和标题任务都调用统一的 `selectStudioTextModel()`；
- `provider.getSmallModel()` 返回且通过白名单/连接校验的小模型优先于 session model；
- 没有配置 `small_model` 时，可从 session provider 或其他已连接可见 provider 自动匹配 Haiku、Flash、Nano；
- 小模型不可用时才使用白名单内的 session model；
- session model 不可用时使用当前已有的已连接可见文本模型逻辑；
- `getSmallModel()` 返回白名单外或禁用 provider 的模型时拒绝该候选并继续回退；
- 有白名单但没有候选时返回失败并走 fallback；
- 不会选择图片/视频模型。

提示词润色模型回归：

- 配置合法 `small_model` 时，润色实际使用该模型；
- 未配置 `small_model` 但当前 provider 有 Haiku、Flash 或 Nano 时，润色使用自动识别的小模型；
- 小模型不在 `promptRefineModels` 白名单时，润色回退到原有 session/connected 模型；
- 小模型 provider 被禁用或未连接时，润色回退到原有选择逻辑；
- `getSmallModel()` 解析失败时不会导致润色任务直接失败；
- 小模型 LLM 输出非法或调用失败时，润色继续走现有 fallback，不阻塞 provider task 创建。

并发和隔离：

- 润色未完成时标题任务不会启动；
- provider task 持久化并开始轮询后标题任务才启动；
- 标题进行时 generation worker 可以持续更新进度；
- 生成先完成、标题后完成时，completed tool part 仍能补写标题；
- 标题先完成、生成后完成时，worker 不会把标题覆盖回 fallback；
- 供应商 request 更新与标题更新同时发生，不丢失 task 信息；
- 标题超时不触发 generation failed；
- 标题 LLM 抛错不触发 `failGenerationCreationByID()`；
- 提示词润色失败时标题仍可成功；
- 供应商创建失败时不启动标题 LLM，并保留 fallback。

Session 标题：

- 第一轮临时标题未变时替换成 LLM 标题；
- 用户先手动重命名时不覆盖；
- 第二轮及以后不修改 Session 标题。

### 13.2 前端测试

- `turns.ts` 从 running tool part 恢复 `detailTitle`；
- completed、failed、create_failed 结果均能恢复标题；
- 无 `detailTitle` 的历史结果继续使用旧 fallback；
- 多图 Tab 展示 `标题-1`、`标题-2`；
- 异步标题到达后已打开 Tab 更新，但选中状态和图片不变化。

### 13.3 手工验证

使用一段明显超过 Tab 宽度的中文提示词：

1. 点击生成后立即看到本地截断标题和生成中状态；
2. 网络面板确认先完成提示词润色，再创建 provider task；
3. provider task 开始轮询后，标题 LLM 请求与生成轮询时间重叠；
4. 第二轮输入“把狗换成猫”时，确认标题基于润色后的完整提示词，而不是只概括这句修改指令；
5. 标题返回后详情标题与 Canvas Tab 自动替换；
6. 图片/视频生成轮询和完成不受标题请求耗时影响；
7. 模拟标题接口超时，生成任务仍正常完成；
8. 生成期间手动修改会话标题，LLM 标题返回后不覆盖；
9. 刷新页面，短标题仍能恢复。

## 14. 验收标准

满足以下条件视为完成：

- Prompt refine LLM 不再返回或校验 `detailTitle`；
- 每个非继承标题的 Studio generation 都会启动独立标题任务；
- 标题使用润色后的最终有效提示词；没有润色调用时才使用用户输入；
- 小模型判断位于现有 Studio 文本模型选择逻辑之前，并同时作用于润色和标题任务；
- provider task 开始轮询后才异步启动标题任务；
- 标题任务和图片/视频生成轮询并发执行；
- 标题失败不会改变 generation 状态；
- 标题成功后详情标题、Canvas Tab 和历史恢复一致；
- 首轮会话标题正确更新且不覆盖手动改名；
- 并发写入不会丢失标题、润色结果或供应商 task 字段；
- 不依赖 Studio 页面选择文本模型，也不会把图片/视频生成模型作为标题模型；
- 普通会话标题生成逻辑无改动。

## 15. 风险与注意事项

### 15.1 LLM 调用次数增加

原来一次请求同时返回润色结果和标题；拆分后，文生图/文生视频通常会产生两次顺序发生的文本 LLM 调用：先润色，再基于润色结果生成标题。第二次调用与图片/视频生成轮询并行。应在日志中记录标题调用耗时、模型和 fallback 原因，便于评估成本。

### 15.2 Provider 并发限制

润色与标题请求不再同时调用同一文本 provider，但标题请求会与图片/视频供应商轮询并行。标题属于低优先级任务，应优先超时降级，不能占用或阻塞生成 worker。

### 15.3 JSON 整体覆盖竞态

这是本改造最大的实现风险。`StudioGenerationTable.request` 和 `PartTable.data` 都是 JSON 整体字段，必须通过统一的按 generation 更新入口读取最新值并合并。仅仅使用两个 `Promise` 并行而不改持久化方式，会产生偶发字段回退。

### 15.4 进程退出

标题任务是进程内后台 Promise，不是持久化任务队列。应用在标题完成前退出时，fallback 标题仍然存在，但本次不会自动恢复 LLM 标题任务。由于标题属于非关键 UI 元数据，本方案接受该行为；如未来要求强一致，再增加可恢复的标题任务状态字段和 worker。

### 15.5 再次生成与编辑能力

- 再次生成应继承来源 result 的 `detailTitle`，不再次调用标题 LLM；
- `image.upscale`、`image.cutout`、`image.inpaint`、`image.outpaint` 等编辑能力继续使用固定能力标题；
- 只有需要从新用户文本产生新标题的 `image.generate`、`video.generate` 才启动标题任务；
- 带参考图但用户输入了新文本的 image/video generation 仍应生成标题，不能因为 prompt refine passthrough 而跳过标题任务。
