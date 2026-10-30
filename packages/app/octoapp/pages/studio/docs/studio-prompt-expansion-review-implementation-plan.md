# Studio AI 推荐扩写结果：编辑、确认与失效实现方案

> 状态：已按本文完成业务代码实现；关键状态与 DOM 测试已通过。
> 日期：2026-10-21。
> 依据：当前工作区代码及本次需求补充；不以旧方案中“不支持编辑扩写结果”的描述为准。
> 本文给出目标行为、逐文件修改、关键代码及验收方式。代码中的新增函数均在本文定义；标明“插入”的片段应合入现有函数，不是替换整个函数。

## 1. 最终交互约定

扩写完成后按以下顺序展示，纯文字输入和带图输入使用相同文案：

```text
已完成图文反推，以下是基于参考图生成的可执行Prompt，可直接编辑后确认使用：

[标签] [标签] [标签]

已基于您选中的图片风格进行扩写，可直接编辑后确认使用：

┌──────────────────────────────────────┐
│ 可以直接编辑的扩写正文                 │
└──────────────────────────────────────┘

确认，按扩写内容生成    忽略，使用原始描述
```

- 正在扩写：显示“正在丰富提示词…”，去掉旁边的“取消”；取消统一使用 Composer 的停止按钮。
- 正在取消：显示“正在取消扩写…”，不展示完成文案、标签编辑区和确认按钮。
- 完成：标签仅展示，不提供选择或编辑；正文可以直接编辑。
- 点击“确认”：冻结编辑框当前正文，隐藏两个按钮，使用该正文和这一轮参考图开始图片生成。
- 点击“忽略”：同样冻结编辑框当前正文、隐藏按钮，但生成使用这一轮原始描述和参考图。不要把编辑框改回原始描述；它仍表示用户最后查看的扩写稿。
- 用户直接从输入区发送：结束当前确认区，锁定正文、隐藏按钮，使用输入区自己的描述和图片执行原有生成流程。
- 发起其他任务或进入替代工作流时，同样结束当前确认区。
- 生成失败不会恢复旧扩写按钮；重试沿用生成任务已有入口。
- 不强制用户先确认或忽略，不把“等待用户选择”加入推荐锁定状态。

### 1.1 “其他操作”的接入边界

按“任务提交或开始替代工作流”处理，不监听整页任意点击。

| 操作 | 是否结束确认区 | 时机 |
| --- | --- | --- |
| 输入区普通发送、模板生成 | 是 | 通过本地校验，进入 `runGeneration()` 后 |
| 当前结果再次生成、图片编辑提交 | 是 | 同上，共用 `runGeneration()` |
| 历史任务重新生成（reboot） | 是 | 通过 busy、server 检查后，请求前 |
| 进入抠图、高清、重绘、扩图编辑流程 | 是 | 通过推荐锁和模式检查后，修改编辑区状态前 |
| 历史任务“重新编辑”回填 | 是 | 回填条件满足、开始替换输入草稿前 |
| 图片转视频、确认切换能力 | 是 | 实际切换或回填视频首帧时 |
| 再点 AI推荐 | 是 | 通过状态检查后，初始化下一轮推荐前 |
| 新建 Studio 会话 | 是 | 离开旧会话前 |
| 修改比例、数量、模型，上传参考图，输入文字 | 否 | 属于参数准备，允许随后确认扩写 |
| 查看图片、下载、刷新任务状态、取消任务、打开菜单 | 否 | 不启动替代创作流程 |
| 单纯切换并查看另一条历史会话 | 否 | 保留原会话草稿，返回后恢复 |

以上边界是实施默认值。“其他操作”若要求连参数准备也结束确认区，只需扩展接入点，不改状态结构。

### 1.2 刷新恢复范围

本次按“同一页签刷新后恢复正文和锁定状态”实现，沿用项目现有 `Persist.sessionGlobal()`，不新增服务端 API。

- 同一页签刷新、会话切换返回：恢复编辑稿和终态，已隐藏的按钮不重新出现。
- 存储按服务端、项目目录、账号、会话、助手消息 ID 隔离。
- 不把编辑内容写回原始 assistant part，不改变后端扩写正文及 revision。
- 新浏览器、新设备、关闭页签后重新打开不保证恢复本地编辑稿；这不是服务端跨端同步方案。
- 服务端历史中已有后续任务时，旧扩写不能因本地记录缺失而重新变成可操作。
- sessionStorage 不可用时，遵循现有持久化工具降级行为，不能宣称此环境仍保证刷新恢复。

若产品要求跨端同步，应另行把 review 保存到服务端消息 metadata，并提供并发条件更新；不要把前端 sessionStorage 描述成服务端持久化。本次不引入这项范围。

## 2. 当前代码事实与复用点

| 位置 | 当前行为 | 对本次实现的意义 |
| --- | --- | --- |
| `studio-conversation.tsx` | result 分支展示 loading、取消按钮和标签；正文仍由通用 assistant 区渲染 | 完成态要独立渲染，避免正文出现两遍 |
| `studio-01.css` | 标签已有 `gap: 8px`，但颜色、padding、圆角不符合新要求 | 更新局部样式即可 |
| `studio-composer.tsx` | busy 时已展示 `.studio-composer-stop` | 不新做取消控件 |
| `studio-page.tsx` | 两处 Composer 的 `onCancel` 已根据 `recommendation.busy()` 路由到扩写取消 | 保留现有停止调用及错误提示 |
| `studio-prompt-recommendation.ts` | 扩写受理后调用 clear；普通输入的文字和图片被清空 | 两个按钮不能从当前 Composer 取原文和参考图 |
| `turns.ts` | recommendation turn 已带 `userText`、`assistantText`、`inputImages`、`assistantMessageID` | 足以定位本轮数据，不需要改返回 schema |
| `runGeneration()` | 支持 `prompt`、`effectivePrompt`、`refinedPrompt`、`referenceImages`、`useRestoredInputs` | 两个按钮直接复用，不调用普通 `handleSubmit()` |
| `persistStudioGenerationMedia()` | data URL 才上传，已有路径直接透传 | 复用本轮 user file part 的上传路径，不重新下载图片 |
| 后端 `promptRefineFallback()` | 即使跳过 LLM，也可能基于上一轮组合 prompt；优先采用显式 effective/refined prompt | 两个按钮要同时传明确有效正文，不能只传 `skipPromptRefine` |

后端扩写成功时已把正文写入 text part，把标签写入 `metadata.studioPromptExpansion.tags`，原文及参考图保存在配对 user message 中。本次不改扩写模型、不改后端扩写状态，不需要重新生成 SDK。

## 3. 文件变更清单

以下路径均相对仓库根目录。

| 文件 | 修改内容 |
| --- | --- |
| 新增 `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.ts` | review 类型、草稿读写、一次性选择、普通操作失效、历史轮次兜底 |
| 新增 `packages/app/octoapp/pages/studio/studio-prompt-expansion-review-view.tsx` | 完成态独立视图，自适应 textarea、标签、两段文案和文字按钮 |
| 修改 `packages/app/octoapp/pages/studio/studio-conversation.tsx` | 删除 loading 取消按钮，接入 review 视图，完成结果不再走通用正文分支 |
| 修改 `packages/app/octoapp/pages/studio-page.tsx` | 持久化接线、按钮生成回调、参数校验、各任务入口失效处理 |
| 修改 `packages/app/octoapp/pages/studio/studio-session-data.ts` | 增加当前会话完整快照就绪标记，避免 SSE 提前送达时初始化 review |
| 修改 `packages/app/octoapp/pages/studio/studio-01.css` | composer 渐变变量复用、标签、结果框和文字按钮样式 |
| 新增 `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.test.ts` | 状态转换、消息刷新、会话隔离、存储重建后的恢复 |
| 新增 `packages/app/octoapp/pages/studio/studio-prompt-expansion-review-view.test.tsx` | 编辑、只读、两按钮、失败分支不显示完成 UI |
| 修改已有 `packages/app/octoapp/pages/studio/docs/studio-multimodal-prompt-expansion-implementation.md` | 后续实施时更新“非目标”和完成态说明，链接本文，消除旧约定冲突 |

`studio-prompt-state.ts`、`turns.ts`、`studio-composer.tsx`、后端 schema/API 无需为本次新增字段。保留现有 `assistantMessageID`，不要仅为 UI 状态新增 SDK 类型。

状态模块与视图模块分别使用 `studio-prompt-expansion-review.ts` 和 `studio-prompt-expansion-review-view.tsx`，避免 `.ts` / `.tsx` 同名造成无扩展名 import 歧义。

## 4. 独立的结果确认状态

扩写执行状态和结果交互状态是两个维度：

```ts
// 后端已有，不变：
// armed / running / cancelling / completed / failed / cancelled

// 新增前端 review 状态：
export type ExpansionReview = {
  draft?: string
  status: "pending" | "confirmed" | "ignored" | "dismissed"
}

export type ExpansionReviews = Record<string, Record<string, ExpansionReview>>
// 第一层 key：recommendationKey()，已有 scope + session。
// 第二层 key：recommendation.assistantMessageID。
```

- `confirmed` / `ignored` 记录用户明确选择。
- `dismissed` 表示后续任务或替代流程结束了这次选择机会。
- 所有终态只能读取，不能再次编辑或改回 pending。
- `draft` 保存最终编辑稿；忽略时发给生成器的原文从 turn.userText 获取，不覆盖 draft。
- 最多只有当前会话最后一条真实 turn 的 completed result 可处于 pending。不要依赖可能附带临时生成结果的 `displayTurns().isLatest` 来初始化历史数据。

### 4.1 状态模块关键代码

新增 `studio-prompt-expansion-review.ts`。用注入式存储接口支持实际状态测试，持久化在页面接线，不让组件各自持有草稿。

```ts
import { createEffect, createMemo } from "solid-js"
import type { StudioTurnData } from "./turns"
import type { RecommendationImageSettings } from "./studio-recommendation-settings"

export type ExpansionReview = {
  draft?: string
  status: "pending" | "confirmed" | "ignored" | "dismissed"
}

export type ExpansionReviews = Record<string, Record<string, ExpansionReview>>

export function createExpansionReview(input: {
  key: () => string
  ready: () => boolean
  turns: () => StudioTurnData[]
  resultID?: () => string | undefined
  entries: () => ExpansionReviews
  save: (key: string, id: string, value: ExpansionReview) => void
}) {
  const visit = createMemo(() => ({ key: input.key() }))
  const turns = createMemo(input.turns)
  let revision = 0
  const id = (turn: StudioTurnData) => turn.recommendation?.assistantMessageID
  const completed = (turn: StudioTurnData) =>
    turn.recommendation?.kind === "result" && turn.recommendation.status === "completed" && Boolean(id(turn))
  const saved = (turn: StudioTurnData) => input.entries()[input.key()]?.[id(turn) ?? ""]
  const editable = (turn: StudioTurnData) =>
    input.ready() && completed(turn) && turns().at(-1)?.id === turn.id && saved(turn)?.status === "pending"

  createEffect(() => {
    if (!input.ready()) return
    const key = input.key()
    const last = turns().at(-1)
    turns().filter(completed).forEach((turn) => {
      const messageID = id(turn)
      if (!messageID) return
      const value = input.entries()[key]?.[messageID]
      if (!value) {
        input.save(key, messageID, {
          draft: turn.assistantText,
          status: turn.id === last?.id ? "pending" : "dismissed",
        })
        return
      }
      if (value.draft === undefined) {
        input.save(key, messageID, { ...value, draft: turn.assistantText })
        return
      }
      if (value.status === "pending" && turn.id !== last?.id)
        input.save(key, messageID, { ...value, status: "dismissed" })
    })
  })

  return {
    editable,
    text: (turn: StudioTurnData) => saved(turn)?.draft ?? turn.assistantText,
    update: (turn: StudioTurnData, draft: string) => {
      const messageID = id(turn)
      if (!messageID || !editable(turn)) return
      input.save(input.key(), messageID, { draft, status: "pending" })
    },
    choose: (turn: StudioTurnData, status: "confirmed" | "ignored") => {
      const messageID = id(turn)
      const value = saved(turn)
      if (!messageID || !value || !editable(turn)) return false
      revision++
      input.save(input.key(), messageID, { ...value, status })
      return true
    },
    dismiss: () => {
      revision++
      const key = input.key()
      const resultID = input.resultID?.()
      if (resultID && !input.entries()[key]?.[resultID])
        input.save(key, resultID, { status: "dismissed" })
      // Seed results even before the full snapshot arrives, so an action cannot
      // reopen an expansion when its history finishes loading afterwards.
      turns().filter(completed).forEach((turn) => {
        const messageID = id(turn)
        if (!messageID || input.entries()[key]?.[messageID]) return
        input.save(key, messageID, { draft: turn.assistantText, status: "dismissed" })
      })
      Object.entries(input.entries()[key] ?? {}).forEach(([messageID, value]) => {
        if (value.status === "pending") input.save(key, messageID, { ...value, status: "dismissed" })
      })
    },
    capture: () => {
      const target = visit()
      const version = revision
      return () => target === visit() && version === revision
    },
  }
}

export function expansionGenerationInput(turn: StudioTurnData, text: string, settings?: RecommendationImageSettings) {
  return {
    capability: "image.generate" as const,
    prompt: text,
    detailPrompt: text,
    refinedPrompt: text,
    effectivePrompt: text,
    referenceImages: turn.inputImages?.map((image) => image.url) ?? [],
    mentionImages: {},
    extra: { skipPromptRefine: true },
    useRestoredInputs: true,
    ...(settings ? {
      aspectRatio: settings.aspectRatio,
      count: settings.count,
      ...(settings.isCustom && settings.customWidth > 0 && settings.customHeight > 0
        ? { width: settings.customWidth, height: settings.customHeight } : {}),
    } : {}),
  }
}
```

关键约束：

1. 同步 effect 只补缺失草稿，不在每次消息刷新时重新赋 `assistantText`。
2. `choose()` 同步写终态，连点第二次返回 false；提交失败不会回滚。
3. `dismiss()` 仅修改当前 namespace，不把其他会话的草稿一起关闭。
4. `editable()` 同时检查最后一轮，防止 effect 尚未运行时旧结果仍可操作。
5. 只有完整当前会话快照加载后才允许初始化；加载失败期间只读，不能提前把缺失状态当作 pending。
6. 初始化缺失记录仅针对 completed turn，不为 running/failed/cancelled 建立确认区。

## 5. 页面状态接线

在 `studio-page.tsx` 中，`sessionDataLoaded` 已定义后创建 review 控制器，供 return JSX 和事件函数闭包使用。不要在声明执行前同步调用事件函数。

```ts
import {
  createExpansionReview,
  type ExpansionReviews,
} from "./studio/studio-prompt-expansion-review"

const reviewPersistence = persisted(
  Persist.sessionGlobal("studio.prompt-expansion.reviews.v1"),
  createStore<{ entries: ExpansionReviews }>({ entries: {} }),
)

const expansionReview = createExpansionReview({
  key: recommendationKey,
  ready: () => reviewPersistence[3]() && sessionDataLoaded() && snapshotReady() &&
    recommendation.ready() && !recommendation.state()?.unknown,
  turns: () => buildStudioTurns({
    messages: params.id ? dataStore.message[params.id] ?? [] : [],
    parts: dataStore.part,
    currentSessionID: params.id,
  }),
  resultID: () => recommendation.state()?.state?.recommendation?.assistantMessageID,
  entries: () => reviewPersistence[0].entries,
  save: (key, id, value) => reviewPersistence[1]("entries", key, (entries) => ({ ...entries, [id]: value })),
})
```

使用不带 `pendingResult()` fallback 的真实会话 turn，不依赖 optimistic generation 初始化历史状态。显式操作的即时失效由第 8 节入口负责。

### 5.1 完整快照就绪标记

现有 `sessionDataLoaded()` 只检查 messages 数组存在，SSE 的 `message.updated` 可能在全量 messages/parts 请求前创建该数组。因此需要在 `studio-session-data.ts` 增加单独标记，而不是假设 messages 存在就已加载完整历史。

```ts
// createStudioSessionData 内，与 dataStore 并列：
const [snapshot, setSnapshot] = createStore<{ sessionID?: string }>({})

// loadSessionMessages 内，现有有效 token/session 检查通过、
// messages 和 parts 的 batch 写入完成时，在同一个 batch 最后加入：
setSnapshot("sessionID", sessionID)

// 原有 on(input.sessionID, ...) 回调最开始加入：
setSnapshot("sessionID", undefined)
// 然后继续原有清理或 loadSessionMessages(id)，不是另起一个 load。

// 返回值新增 snapshotReady：
return {
  dataStore,
  loadSessionMessages,
  sessionStatus,
  snapshotReady: () => Boolean(input.sessionID() &&
    snapshot.sessionID === input.sessionID()),
}
```

页面从现有 `createStudioSessionData()` 返回值中接入 `snapshotReady`。读取失败不设置标记。`session.deleted`、非 Studio session 的清理分支也清空 snapshot 标记。后台再次刷新同一会话无需先清空标记，保留已经成功加载的快照可用性；只有访问会话变化时重置。

不把 review pending 接到 `recommendationMode.active`。扩写完成后普通发送和能力切换必须继续可用。

## 6. 完成态视图与原组件改造

### 6.1 新增视图组件

文件：`studio-prompt-expansion-review-view.tsx`。

```tsx
import { createEffect, For, onCleanup, Show } from "solid-js"
import type { StudioTurnData } from "./turns"

export function StudioPromptExpansionReviewView(props: {
  turn: StudioTurnData
  text: string
  editable: boolean
  busy: boolean
  canGenerate: boolean
  onInput: (text: string) => void
  onChoose: (choice: "confirmed" | "ignored") => void
}) {
  const element: { current?: HTMLTextAreaElement } = {}
  const resize = () => {
    if (!element.current) return
    element.current.style.height = "auto"
    element.current.style.height = `${element.current.scrollHeight}px`
  }
  createEffect(() => {
    if (!element.current) return
    if (element.current.value !== props.text) element.current.value = props.text
    resize()
  })
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize)
  onCleanup(() => observer?.disconnect())

  return (
    <div class="studio-prompt-expansion-review">
      <p class="studio-prompt-expansion-copy">
        已完成图文反推，以下是基于参考图生成的可执行Prompt，可直接编辑后确认使用：
      </p>
      <Show when={props.turn.recommendation?.tags?.length}>
        <div class="studio-prompt-expansion-tags">
          <For each={props.turn.recommendation?.tags}>
            {(tag) => <span title={tag}><span>{tag}</span></span>}
          </For>
        </div>
      </Show>
      <p class="studio-prompt-expansion-copy">
        已基于您选中的图片风格进行扩写，可直接编辑后确认使用：
      </p>
      <div class="studio-prompt-expansion-editor" ref={(node) => observer?.observe(node)}>
        <textarea
          ref={(node) => { element.current = node }}
          aria-label="扩写提示词"
          value={props.text}
          readOnly={!props.editable}
          onInput={(event) => {
            props.onInput(event.currentTarget.value)
            resize()
          }}
        />
      </div>
      <Show when={props.editable}>
        <div class="studio-prompt-expansion-actions">
          <button
            type="button"
            disabled={props.busy || !props.canGenerate || !props.text.trim()}
            onClick={() => props.onChoose("confirmed")}
          >
            确认，按扩写内容生成
          </button>
          <button
            type="button"
            disabled={props.busy || !props.canGenerate || !props.turn.userText.trim()}
            onClick={() => props.onChoose("ignored")}
          >
            忽略，使用原始描述
          </button>
        </div>
      </Show>
    </div>
  )
}
```

只读使用 `readOnly`，不使用 `disabled`，保留文本选择、复制、滚动能力。不要给整个可编辑区域加 `aria-live`，否则每次输入都会被读屏重复播报。只对 loading 提示保留状态播报。

### 6.2 `StudioConversation` 接口

删除 `onCancelExpansion`；新增下面这些属性，类型以实际 import 为准：

```ts
expansionText: (turn: StudioTurnData) => string
expansionEditable: (turn: StudioTurnData) => boolean
expansionCanGenerate: boolean
onExpansionInput: (turn: StudioTurnData, text: string) => void
onExpansionChoose: (turn: StudioTurnData, choice: "confirmed" | "ignored") => void
```

替换原 result 展示块：

```tsx
<Show when={turn.recommendation?.kind === "result"}>
  <Show when={turn.recommendation?.status === "running" ||
    turn.recommendation?.status === "cancelling"}>
    <div class="studio-prompt-expansion" role="status">
      {turn.recommendation?.status === "cancelling"
        ? "正在取消扩写…" : "正在丰富提示词…"}
    </div>
  </Show>
  <Show when={turn.recommendation?.status === "completed"}>
    <StudioPromptExpansionReviewView
      turn={turn}
      text={props.expansionText(turn)}
      editable={props.expansionEditable(turn)}
      busy={props.actionBusy}
      canGenerate={props.expansionCanGenerate}
      onInput={(text) => props.onExpansionInput(turn, text)}
      onChoose={(choice) => props.onExpansionChoose(turn, choice)}
    />
  </Show>
</Show>
```

原通用 assistant fallback 的条件改为：

```tsx
<Show when={!(turn.recommendation?.kind === "result" &&
  ["running", "cancelling", "completed"].includes(turn.recommendation.status))}>
  <Show when={sanitizeStudioAssistantText(turn.assistantText)}>
    {(assistantText) => <div class="studio-assistant-copy">{assistantText()}</div>}
  </Show>
</Show>
```

这样 guide 的引导文本、failed/cancelled 的说明仍正常展示，completed 正文只出现一次。

### 6.3 页面 JSX 接线

删除 `StudioConversation` 上的 `onCancelExpansion`，新增：

```tsx
expansionText={expansionReview.text}
expansionEditable={expansionReview.editable}
expansionCanGenerate={canGenerateExpansion()}
onExpansionInput={expansionReview.update}
onExpansionChoose={(turn, choice) => void generateFromExpansion(turn, choice)}
```

两处 Composer 的 `onCancel` 保持现有扩写取消路由，不删除它们。

## 7. 两个按钮的生成关键代码

放在 `studio-page.tsx`，复用 `StudioTurnData` 类型。按钮不是“回填 composer 再模拟点击发送”，否则会覆盖新草稿，也可能意外进入模板流程。

```ts
const canGenerateExpansion = () =>
  recommendation.ready() && !recommendation.state()?.unknown &&
  !recommendationMode.locked() && !isActionBusy() && imageSettingsReady() &&
  (studioPermissionStatus() !== "loading" || !styleModelRequiresSeedreamPermission(styleModel())) &&
  (canUseSeedream() || !styleModelRequiresSeedreamPermission(styleModel()))

async function generateFromExpansion(turn: StudioTurnData, choice: "confirmed" | "ignored") {
  if (!canGenerateExpansion() || !expansionReview.editable(turn)) return
  const text = (choice === "confirmed" ? expansionReview.text(turn) : turn.userText).trim()
  if (!text) return
  if ((turn.inputImages?.length ?? 0) > referenceImageLimit(styleModel())) {
    showFloatingNotice("info", "参考图数量超过当前模型上限，请调整模型后重试。")
    return
  }
  if (!expansionReview.choose(turn, choice)) return
  await runGeneration({
    ...expansionGenerationInput(turn, text, recommendationSettings.image()),
    styleModel: styleModel(),
    detailTitle: buildStudioDisplayPrompt(text),
  })
}
```

这里显式传 `aspectRatio` / 自定义尺寸，是因为当前 `runGeneration(overrides)` 中：

```ts
const nextIsCustom = overrides
  ? Boolean(overrides.width && overrides.height)
  : isCustomStore() && nextWidth > 0 && nextHeight > 0
```

只传 prompt overrides 会使自定义画幅失效。`expansionGenerationInput(turn, text, recommendationSettings.image())` 使用独立图片参数快照，在启用自定义尺寸且宽高有效时显式传入宽高，不读取当前视频输入区参数。

其他约束：

- `refinedPrompt` / `effectivePrompt` 与 `prompt` 一致，防止后端 fallback 基于历史生成再组合语义。
- 两按钮都 skip refine；“忽略”按原始描述字面执行。输入区正常发送则保留原有自动润色策略。
- `referenceImages` 使用服务端保存的路径，不使用预览用 artifact HTTP URL，更不能重新读取当前 `assets()`。
- `useRestoredInputs: true` 复用现有能力：不清空当前 Composer 新草稿，不带入当前草稿里的 @资源，不组合普通会话上下文。
- 不携带当前选中的模板参数；用户点的是本轮扩写的确认。模板入口本身开始替代流程时应 dismiss，见第 8 节。
- 这里无图片下载 await，`choose()` 后立即进入 `runGeneration()`；先写终态可阻止重复点击。
- 权限、空内容、参考图上限等本地校验失败时仍保留待选择状态。通过校验并消费操作后，即使网络失败也不恢复按钮。

## 8. 普通发送与其他入口的统一失效

### 8.1 共用生成入口

在 `runGeneration()` 中，保留现有 text / busy / video frame 检查，在第一处异步调用及 pending generation 创建之前插入：

```ts
if (!text || isActionBusy() || nextHasInvalidVideoFrames) return
expansionReview.dismiss()
```

这自动覆盖普通输入发送、模板生图、画布再次生成、重绘/扩图/高清/抠图提交。

不能只在 `handleSubmit()` 调用：`regenerateCurrentResult()`、编辑器提交和模板生成都可能绕过它。也不要在 `runGeneration` 最开头就 dismiss，否则空输入或本地拒绝会误消费。

### 8.2 下一轮 AI推荐

新增包装函数：

```ts
function initializeRecommendation() {
  if (!recommendation.ready() || recommendation.busy()) return
  if (recommendation.state()?.unknown) {
    void recommendation.recover()
    return
  }
  expansionReview.dismiss()
  void recommendation.initialize()
}
```

两处 Composer 均替换：

```tsx
onRecommend={initializeRecommendation}
```

不改 `createPromptRecommendation` 的现有 pending/replay 协议。不把请求结果未知当作可开始新流程。

### 8.3 不经过 `runGeneration()` 的操作

必须明确修改以下函数，不遗漏独立 HTTP 路径。

```ts
// rebootStudioGeneration：existing busy/server guard 后，setRebooting... 前
expansionReview.dismiss()

// createEditorEntry / openEditorEntry：推荐锁与 nextMode guard 后，batch 前
expansionReview.dismiss()

// editGenerationDraft（普通路径）：draft/权限/template 分支处理之后，batch 前
expansionReview.dismiss()

// editTemplateGenerationDraft：模板、图片恢复及 canRestore 检查通过，真正回填前
expansionReview.dismiss()

// startNewStudioConversation：函数开头，navigate 及旧 session 状态清理前
expansionReview.dismiss()
```

能力切换需要在实际选择提交时结束，而不是打开菜单时结束：

```ts
function selectStudioCapability(value: StudioCapability) {
  if (recommendationMode.locked()) {
    showFloatingNotice("info", "请先完成本次提示词扩写。")
    return
  }
  if (value !== "video.generate") {
    if (value !== capability()) expansionReview.dismiss()
    pendingVideoFirstFrame = undefined
    applyStudioCapability(value)
    return
  }
  if (!canGenerateVideo()) return
  pendingVideoFirstFrame = undefined
  if (params.id ? videoRiskConfirmedSessionID() === params.id : draftVideoRiskConfirmed()) {
    if (value !== capability()) expansionReview.dismiss()
    applyStudioCapability(value)
    return
  }
  setVideoRiskDialogOpen(true)
}

// confirmVideoRiskDialog：guard 后、applyStudioCapability 前加入 dismiss。
// generateVideoFromSelectedImage：图片解析完成且 canRestore() 通过后，
// 真正回填视频首帧之前 dismiss；解析失败、风险弹窗取消则保留。
```

风格模板的实际应用入口是 `applyStyleTemplate()`；在推荐锁检查通过后、`seedreamAtSnapshot = undefined` 和 batch 前插入：

```ts
expansionReview.dismiss()
```

普通工具栏和溢出菜单统一调用此函数，不在“打开模板列表”时结束确认。历史模板回填由 `editTemplateGenerationDraft()` 单独覆盖；重置 `setSelectedStyleTemplate(undefined)` 不应自动结束确认，避免页面同步状态时误消费。

### 8.4 异步与会话切换

`editTemplateGenerationDraft`、图片转视频已有 `recommendationMode.capture()`；它只验证推荐模式/访问轮次，不等于 review 草稿版本锁。保持原有 canRestore 检查，并在涉及异步回填前增加 review 访问快照，例如：

```ts
const target = recommendationKey()
// await 模板/图片处理……
if (target !== recommendationKey() || !canRestore()) return
expansionReview.dismiss()
// 继续实际回填
```

若需要防止同一会话中“旧图片读取完成覆盖较新的输入动作”，应复用或新增页面已有操作序号，在同一类回填入口检查序号。不能仅比较 sessionID 就宣称处理了所有异步乱序。

单纯路由切换历史会话不调用 dismiss：保存每个 namespace 的状态；新建会话属于明确新流程，离开前 dismiss 旧 namespace。

## 9. CSS 关键实现

在 `studio-01.css` 为 composer 提取原渐变值，保持其现有颜色、透明度、角度不变：

```css
/* 页面真实根容器 class 为 studio-page，两个区域均可继承。 */
.studio-page {
  --studio-composer-border-gradient: linear-gradient(135deg,
    rgba(246, 97, 23, 0.7) 1%, rgba(95, 45, 255, 0.7) 8%,
    rgba(61, 93, 255, 0.7) 22%, rgba(104, 138, 255, 0.7) 43%,
    rgba(28, 171, 111, 0.7) 54%, rgba(61, 93, 255, 0.7) 87%,
    rgba(206, 7, 232, 0.7) 92%);
}

/* 仅替换 composer 原 background 声明，其他规则保留。 */
.studio-composer {
  background:
    linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
    var(--studio-composer-border-gradient) border-box;
}

.studio-prompt-expansion-review {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  margin-top: 12px;
}

.studio-prompt-expansion-copy {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
}

.studio-prompt-expansion-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.studio-prompt-expansion-tags > span {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  border-radius: 4px;
  background: rgba(25, 25, 25, 0.05);
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.studio-prompt-expansion-editor {
  box-sizing: border-box;
  min-width: 0;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background:
    linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
    var(--studio-composer-border-gradient) border-box;
}

.studio-prompt-expansion-editor textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 100px;
  max-height: 480px;
  padding: 0;
  border: 0;
  resize: none;
  overflow-y: auto;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}

.studio-prompt-expansion-editor textarea:focus-visible {
  outline: 2px solid #5f2dff;
  outline-offset: 4px;
}

.studio-prompt-expansion-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.studio-prompt-expansion-actions button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #0969ff;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

.studio-prompt-expansion-actions button:hover { text-decoration: underline; }
.studio-prompt-expansion-actions button:disabled { opacity: 0.5; cursor: default; }
```

已核对 `studio-page.tsx` 的根容器为 `.studio-page`。不能把变量只定义在 `.studio-composer` 本身，否则旁边结果框无法继承。

结果框复用彩色边框，不直接加 `.studio-composer` 类，避免带入 composer 的 margin、最小高度及工具栏布局。当前需求只指定边框颜色表现，默认不复制 composer 外发光。结果框圆角 12px、padding 12px、最大高 480px 是实施默认值，标签圆角严格使用要求的 4px。

极长标签需要能查看完整内容，可在标签 span 增加 `title={tag}`，正常标签保持单行 28px。单个 flex span 的省略号效果需浏览器确认，必要时在 span 内再包一个可省略文本节点，不改变块高度。

## 10. 关键测试代码与验证

### 10.1 状态模块实际实现测试

`studio-prompt-expansion-review.test.ts` 使用真实 Solid store，不 mock 控制器。下面给出核心用例骨架；其余用例复用同一 setup。

```ts
import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createExpansionReview, type ExpansionReviews } from "./studio-prompt-expansion-review"
import type { StudioTurnData } from "./turns"

const turn: StudioTurnData = {
  id: "user-1",
  userText: "原始描述",
  assistantText: "LLM 扩写正文",
  recommendation: {
    kind: "result", status: "completed", assistantMessageID: "assistant-1",
    tags: ["柔光"],
  },
  createdAt: 1,
  isLatest: true,
}

test("编辑稿不被同步覆盖，选择后不可编辑且不能再次选择", async () => {
  const setup = createRoot((dispose) => {
    const [store, setStore] = createStore<{
      entries: ExpansionReviews
      turns: StudioTurnData[]
    }>({ entries: {}, turns: [turn] })
    const review = createExpansionReview({
      key: () => "scope/session-a",
      ready: () => true,
      turns: () => store.turns,
      entries: () => store.entries,
      save: (key, id, value) => setStore("entries", key, (entries) => ({ ...entries, [id]: value })),
    })
    return { dispose, store, setStore, review }
  })
  try {
    await Bun.sleep(0)
    expect(setup.review.editable(turn)).toBe(true)
    setup.review.update(turn, "用户编辑后的正文")
    setup.setStore("turns", [{ ...turn, assistantText: "重新同步的原始结果" }])
    await Bun.sleep(0)
    expect(setup.review.text(turn)).toBe("用户编辑后的正文")
    expect(setup.review.choose(turn, "confirmed")).toBe(true)
    expect(setup.review.editable(turn)).toBe(false)
    expect(setup.review.choose(turn, "ignored")).toBe(false)
    setup.review.update(turn, "不应写入")
    expect(setup.review.text(turn)).toBe("用户编辑后的正文")
  } finally {
    setup.dispose()
  }
})
```

还必须覆盖以下行为：

- `ignored` 保留编辑稿；生成回调实际使用 userText，而不是 draft。
- `dismiss()` 冻结待选择稿，confirmed/ignored 不被改为 dismissed。
- 同一 namespace 新增后续 user turn，即使本地无记录，旧 completed result 也默认只读。
- 加载未 ready 时不创建 pending，不闪现按钮。
- 切到 B 再返回 A，A 的 draft 和终态不丢；对 B dismiss 不改变 A。
- 完成后再次 AI推荐、模板入口、独立 reboot 路径均结束旧 review。
- 持久化测试：使用 `persisted` 底层同一个 `makePersisted` 原语与真实 `sessionStorage` 写 draft 和终态，dispose 后从存储重新创建 store/controller，确认恢复；测试结束清除本用例独立 key。测试不 mock 存储，也不复用旧内存 store；平台包装器本身不在该用例覆盖范围内。

### 10.2 UI 与请求级验证

新增 view 测试直接渲染 `StudioPromptExpansionReviewView`，检查：

- pending 可编辑；两个文字按钮存在；空白正文只禁用确认，不禁用有原文的忽略。
- 状态终结后 textarea.readOnly 为 true，按钮从 DOM 消失。
- loading 只有状态文案，Composer 停止按钮仍存在。
- failed/cancelled 仍展示说明，不出现完成文案和编辑框。
- 纯文字及带图使用同样两段文案；没有标签时不渲染空标签容器。
- 不重复渲染 assistant 正文。

浏览器/现有端到端环境通过实际任务提交请求确认：

| 场景 | 请求必须满足 |
| --- | --- |
| 确认扩写 | prompt、refinedPrompt、effectivePrompt 均为编辑后正文，skipPromptRefine=true |
| 忽略扩写 | 上述正文均为本轮原文，参考图仍为本轮图片 |
| 直接发送 | 使用 Composer 当前新描述和图片，不携带旧扩写内容及 skip 标记 |
| 两按钮生成 | 当前 Composer 新草稿不清空，自定义尺寸不丢失 |
| 网络失败 | 正文仍锁定，两个按钮不恢复，任务失败入口可重试 |
| 换会话 | 请求和 review 都不能串到其他会话 |

### 10.3 执行命令

从 `packages/app` 执行，不能在仓库根目录跑测试：

```sh
bun --conditions=browser test --preload ./happydom.ts ./octoapp/pages/studio/studio-prompt-expansion-review.test.ts ./octoapp/pages/studio/studio-prompt-expansion-review-view.test.tsx
bun --conditions=browser test --preload ./happydom.ts ./octoapp/pages/studio/studio-prompt-recommendation.test.ts ./octoapp/pages/studio/studio-recommendation-mode.test.ts ./octoapp/pages/studio/studio-recommendation-settings.test.ts
bun typecheck
```

注意 `bun test:unit` 当前只扫描 `./src`，不会自动覆盖 `octoapp` 新用例，因此上面明确指定路径。DOM 交互测试如不能直接用 Bun JSX 转换正确执行 Solid DOM 编译，应使用仓库已有浏览器测试设施验证视图，不写只检查源码字符串的伪 DOM 测试。

手动视觉验收：标签 28px / 4px / 12px / 400 / 20px / 8px，窄屏换行、长正文滚动、焦点可见、只读复制、渐变边框颜色与 composer 一致。不要为验收重启已有 app/server。

## 11. 实施顺序与交付边界

1. 状态模块和实际状态测试：先固定 pending 到终态的单向规则。
2. 完整快照就绪标记、页面持久化接线及历史恢复，验证刷新、会话隔离。
3. 完成态视图、CSS、删除冗余取消入口和重复正文。
4. 两个按钮复用 runGeneration，验证有效正文、参考图、权限、自定义尺寸及新草稿保留。
5. 接入普通发送、独立 reboot、编辑回填、能力切换、模板应用、AI推荐、新建会话等失效点。
6. 执行定向回归、package typecheck、浏览器视觉和请求验收，再更新旧文档中冲突描述。

### 11.1 落地补充

- 状态模块增加可选 `resultID`：快照未到达时也可以按服务端已知助手消息 ID 写入 dismissed 标记。该标记暂不包含 draft；完整正文到达后补齐 draft，保持 dismissed，避免重新出现按钮。
- 写入 namespace 时使用 `setStore("entries", key, (entries) => ({ ...entries, [id]: value }))`，先建立中间对象；不能直接穿透尚不存在的 namespace 设置嵌套 id。
- `capture()` 同时检查会话访问对象及操作 revision。较早的异步模板/图片回填不能覆盖随后开始的新任务；模板回填自己的 dismiss 之后重新 capture，供 mention 的 microtask 使用。
- 新增视图测试使用项目现有 `vite-plugin-solid` 的 DOM transform 编译真实组件，不用 React JSX 转换，也不新增依赖。
- Solid 响应式测试必须加 `--conditions=browser`；默认 Node 条件会选择 Solid 服务端实现，effect 不运行。
- 实际生成参数复用状态模块导出的 `expansionGenerationInput()`，传入独立图片参数快照，页面补充图片模型和详情标题。
- 本次未调用真实 LLM 或生图服务；本地现有前端页面在浏览器内为空白，完整链路及真实浏览器视觉验收待可用环境验证。


### 11.2 视频模式下直接采用扩写结果

- 两个按钮不再通过 `capability() === "image.generate"` 判断可用性；点击后固定提交图片任务，不先切换 Composer 模式，也不触发切换模式的 dismiss。
- `createRecommendationSettings.image()` 独立于当前模式取值：当前会话图片快照 → 上次完整图片设置 → 图片默认值。
- 新增 `Persist.global("studio.image.last-settings.v1")`，按服务端、账号及目录 scope 保存比例、数量、自定义尺寸开关与宽高；模型继续使用现有独立的 `imageSettingStore.styleModel`。
- 图片模式下调整参数即保存；视频设置不覆盖这份记录。初次迁移等持久化就绪后，从现有图片设置补齐；缺失历史图片记录且当前为视频时只使用图片默认值，不能把视频参数当图片记录。
- 保存完整快照时复制对象，避免独立图片记录与共享输入参数引用同一底层 Solid store 对象。
- 图片/视频模式切换使用 batch；切回图片时恢复完整图片设置，移除仅保存比例、数量的临时 savedImage 变量。
- 权限、请求忙碌、数据尚未就绪、空白正文等校验仍保留；当前 Composer 模式本身不禁用按钮。
- 52 项定向测试通过，包含视频模式确认/忽略、会话图片参数优先、视频不能覆盖图片记录，以及持久化重建后自定义宽高恢复；`bun typecheck` 通过。

### 11.3 按钮生成任务隐藏重复用户气泡

- 确认/忽略提交的 `extra.promptExpansionSource.assistantMessageID` 关联原扩写结果。
- 后端 `persistStudioSession()` 在用户文本 part 的 `metadata.studioPromptExpansionSource` 保存来源，不删除真实消息或提示词。
- `buildStudioTurns()` 将用户 part metadata 或生成工具请求中的来源转换为 `hideUserBubble`。用户文本 part 尚未到达时暂缓显示气泡，避免 SSE 分批到达造成闪现。
- 临时生成结果同时携带 `hideUserBubble`，页面 pending turn 的创建、合并、失败状态和服务端响应替换均保留该值。
- `studio-conversation.tsx` 根据此值同时跳过重复的文字气泡与 `studio-user-input-images` 参考图区域；参考图数据及生图请求仍完整保留，生成进度、结果和失败信息继续正常显示。原扩写轮次、普通生成及再次生成仍按原逻辑显示参考图。
- `restoreGenerationInput()` 的所有分支使用 `studioRegenerationExtra()` 清除扩写来源，保留其他参数并继续 skip refine。因此再次生成仍显示原有“再次生成”气泡。
- 新增 8 个气泡状态回归用例全部通过；后端 service 测试通过；前后端 `bun typecheck` 通过。
- 完整旧 `turns.test.ts` 有 32 个既有失败；以 HEAD 原实现和原有用例复跑仍为相同 32 个失败，主要涉及 fixture 的 assistant.parentID 与 user.id 不匹配。本次新增用例单独运行全部通过，未扩展修复旧 fixture。
