# Studio AI 推荐模式：可关闭标记与连续扩写实现方案

> 日期：2026-10-29。
> 状态：已编码实现。实施说明与已完成验证见第 11 节；尚未进行真实页面视觉验收。
> 依据：当前工作区的 Studio Composer、推荐扩写、结果确认及两套 HTTP 路由实现。
> 下文路径相对仓库根目录。关键代码是设计片段，不是可直接整段替换的补丁；新增方法的职责、返回值和并发约束均在相邻文字中说明。

## 1. 目标与交互约定

点击 AI推荐后，在输入区展示一个可关闭的 `AI推荐 ×` 块。块存在时，输入区发送按钮及 Enter 始终执行提示词扩写。扩写成功、失败、停止、确认结果生图均不自动退出推荐模式，只有点击 × 才退出。

```text
┌──────────────────────────────────────────┐
│ [ AI推荐  × ] 描述你想生成的图片            │
│                                          │
│ 图片生成   模型   参数              扩写   │
└──────────────────────────────────────────┘
```

具体约定：

- 块与输入文字处于同一个段落流，正文紧随块后，随可用宽度自然换行；不独占一行，不新增上下分区。
- 推荐开启且正文为空时，块后显示占位文案“描述你想生成的图片”；输入正文后占位文案消失，块继续保留。
- 实现为输入编辑器中的不可编辑内联原子节点（`contenteditable="false"`）；不进入提示词，退格、选区删除、剪切和清空正文均不能使推荐模式退出，退出只由 × 触发。
- 视觉暂沿用 `studio-composer-tool-btn` 的灰底、圆角、高度、字号；右侧使用关闭图标，不显示下拉箭头。
- 正文仅展示状态，只有 × 执行退出；关闭按钮提供 `aria-label="退出AI推荐"`。
- 退出保留输入文字、参考图、历史扩写及结果编辑稿。
- × 表示退出后续默认扩写，不取消已经受理的扩写；当前任务继续执行，用户仍可点击停止取消。
- 停止只取消任务，不退出推荐模式。
- 任务占用未解除时，不允许下一次普通生成，即使用户已退出模式。
- 结果卡片的“确认，按扩写内容生成”和“忽略，使用原始描述”仍直接生图；这两个动作不属于输入区发送，不关闭推荐模式。
- 同一页签刷新和切换会话返回恢复模式；新设备、关闭页签后重开不承诺恢复本地开关。
- 推荐期间保持图片生成能力，隐藏不兼容的模板和编辑流程。退出后保持当前会话的图片能力和参数，不强行恢复其他会话的全局视频偏好。

## 2. 当前代码事实

| 文件 / 方法 | 当前行为 | 本次需要处理 |
| --- | --- | --- |
| `packages/app/octoapp/pages/studio-page.tsx` / `initializeRecommendation()` | 点击入口，结束旧 review，然后初始化引导 | 写入用户模式意图，区分显式进入与后续轮次准备 |
| 同文件 / `handleSubmit()` | 仅 `recommendation.armed()` 时扩写，否则普通生成 | 改按用户模式分流，补下一轮准备 |
| 同文件 / `canSubmit()` | `armed` 决定文字、图片、权限校验分支 | 推荐模式持续使用扩写校验 |
| 同文件 / `effectiveMaxReferenceImages()` | `armed` 时上限 3 张 | 改按模式判断 |
| 同文件 / `canGenerateExpansion()` | 使用 `!recommendationMode.locked()` | 模式存在不能永久禁止结果生图 |
| `studio/studio-prompt-recommendation.ts` | 管理单次初始化、提交、恢复和取消；无退出接口 | 增加模式相关操作协调、静默准备、释放与恢复 |
| `studio/studio-recommendation-mode.ts` | `active` 同时决定 capability、模板隐藏和锁 | 分开持续模式约束和任务占用 |
| `studio/studio-prompt-expansion-review.ts` | 最后一个可见轮次的 completed 结果才可操作 | 内部引导不能进入可见轮次列表 |
| `packages/opencode/src/studio/prompt-recommendation.ts` | 一条 guide 只记录一份 submission，受理后 consumed | 每次新的扩写使用独立 guide，不循环复用 consumed guide |
| 同文件 / `initializeRecommendation()` | 创建“点击AI推荐”及欢迎消息 | 后续准备必须支持不展示欢迎轮次 |
| 同文件 / `cancelExpansion()` | 要求已存在任务的 assistantMessageID | 无法释放尚未提交的 armed guide，需要独立 dismiss |
| `prompt-recommendation-state.ts` / `assertCanGenerate()` | 任意 armed guide 或执行中扩写会阻止生图 | 退出时真实释放 armed，不删除并发保护 |

根本问题：`armed` 是单次任务的准备状态，不是用户选择的持续模式。任务完成后它自然消失，因此不能继续用它代表 UI 模式。

## 3. 状态模型

### 3.1 用户意图和任务状态分开

在 `studio-page.tsx` 现有 `recommendationModes` 存储上增加可选的模式字典，便于读取旧数据：

```ts
createStore<{
  entries: Record<string, StudioCapability>
  settings: Record<string, RecommendationImageSettings>
  enabled?: Record<string, boolean>
}>({ entries: {}, settings: {}, enabled: {} })

const recommendationEnabled = () =>
  recommendationModes.enabled?.[recommendationKey()] === true
```

实际写入方式需要保证旧存储没有 `enabled` 时先建立该对象；不能假设嵌套路径始终存在。也可以通过持久化数据迁移统一补齐，二者选择一种。

继续复用当前 key：

```ts
const recommendationScope = () =>
  JSON.stringify([server.current?.http.url, projectDir(), uiplusUserAccount()])
const recommendationKey = () =>
  JSON.stringify([recommendationScope(), params.id ?? "blank"])
```

三个字典含义不同：`entries` 保存会话 capability，`settings` 保存图片参数，`enabled` 保存用户模式意图。禁止通过 capability 或“曾经有推荐记录”推导模式一直开启。

推荐 hook 另行管理每个 key 的运行态：

```ts
// 示意：合入现有 store 的每会话记录，不新建多个互相依赖的 signal。
{
  ready: false,
  pending: false,
  unknown: false,
  exiting: false,
  operationRevision: 0,
  state: undefined,
}
```

`exiting` 表示释放或核实尚未完成，与持久化的 `enabled=false` 并存。模式已关不等于可以立即开始新任务。

### 3.2 对外暴露清晰的判断

| 判断 | 含义 | 主要消费者 |
| --- | --- | --- |
| `recommendationEnabled()` | 用户选择推荐模式 | 块、输入区发送、提示文案、3 张上限 |
| `recommendation.armed()` | 当前 guide 仍可提交 | 本轮扩写准备逻辑 |
| `recommendation.busy()` | 准备、提交、运行、取消中 | 禁止冲突发送、显示停止按钮 |
| `recommendation.state()?.unknown` | 请求是否受理尚未确认 | 恢复原请求，禁止新任务 |
| `recommendation.exiting()` | 退出清理尚未完成 | 禁止普通发送，允许重试退出 |
| `recommendationMode.selectionLocked()` | 禁止能力及不兼容工作流切换 | capability、模板、图片编辑入口 |
| `recommendationMode.taskLocked()` | 不能新建任务 | 结果确认生图等任务入口 |

现有 `busy()` 包含本地 pending，不能仅用它决定“能否取消模型任务”；停止时仍需判断有没有已经受理的 assistantMessageID。准备阶段的取消或退出走操作协调，不发送无目标的 cancel 请求。

### 3.3 初始化和旧数据迁移

1. 等待模式存储 hydration 和推荐状态读取完成，再决定发送路径。
2. `enabled[key]` 已有 true/false：严格保留用户意图。
3. 字段缺失，且已恢复 armed/running/cancelling：补为 true。
4. 字段缺失，只有 completed/failed/cancelled/dismissed 历史：保持关闭。
5. 显式 false + 服务端 armed：进入清理，释放 guide，不能被刷新改回 true。
6. 初始化从 blank 导航到真实 sessionID 时，将模式意图和操作版本迁移到返回会话；清除对应 blank 意图，避免下一次新会话继承。
7. 用户在初始化完成前退出时，迁移的是最新 false 意图，并释放迟到创建的 guide。

不要把当前 `entries` / `settings` 清空来实现退出，否则会破坏已有会话参数隔离。

## 4. 前端逐文件修改

### 4.1 `packages/app/octoapp/pages/studio/studio-composer.tsx`

新增或调整 props：

```ts
recommendationEnabled?: boolean
recommendationExiting?: boolean
onExitRecommendation?: () => void
```

将现有 `recommendationArmed` 用于 UI 模式的地方统一改成 `recommendationEnabled`；若没有任务层用途，删除这个旧 prop，避免同一块 UI 混用两套状态。

将块作为现有 `.studio-composer-input` 编辑器开头的不可编辑内联节点，与正文共同排版。不要增加独占一行的 row，也不要将标签与文本做成左右两列。块的 DOM 结构示意如下，需接入现有编辑器 DOM 同步流程，不可直接插入后继续让 `innerText` 覆盖整个编辑器：

```tsx
<Show when={props.recommendationEnabled}>
    <span
      class="studio-composer-recommendation-chip"
      data-studio-recommendation-chip
      contenteditable={false}
    >
      <span>AI推荐</span>
      <button
        type="button"
        class="studio-composer-recommendation-close"
        aria-label="退出AI推荐"
        title="退出AI推荐"
        onClick={(event) => {
          event.stopPropagation()
          props.onExitRecommendation?.()
        }}
      >
        <img src="/studio/studio_template_close.svg" alt="" />
      </button>
    </span>
</Show>
```

关闭不使用 `disabled={isBusy()}`，否则任务期间又无法退出。重复点击由操作层合并。退出后块消失；若后端清理失败，以独立的状态提示和可重试入口处理，不重新展示一个代表“仍开启”的块。

相关 UI 调整：

- `title={props.recommendationEnabled ? "扩写" : "生成"}`。
- 推荐开启时空输入文案固定为“描述你想生成的图片”，展示在块后，与块处于同一段落；占位文案不属于正文，不参与发送。
- 原占位文案中的 AI推荐入口仅在推荐关闭时出现。
- recipe 输入切换等原 `recommendationArmed` 条件改按持续模式处理。
- 推荐块不加入 `toolbarOverflow()`，窄屏时也保持可见。
- 保留输入框 ref、普通模式的 @ 引用、IME 和 paste 行为；推荐模式禁用 @ 引用入口、键盘触发和引用图片映射，已有或回填的引用块转为普通文字；同步改造正文读写、选区与序列化；输入 DOM 内新增的模式块必须被明确排除，不能继续把整个编辑器 `innerText` 当成用户正文。
- `recommendationExiting` 用于显示退出处理中/失败提示入口，不改变原停止按钮目标。

编辑器接入要求：

1. 在现有正文读取与 @ 引用遍历中，遇到 `[data-studio-recommendation-chip]` 就跳过整个子树。`onInput`、`onCompositionEnd`、mention 同步和发送序列化必须使用同一正文读取规则，防止出现“AI推荐”或关闭按钮文字混入提示词。
2. 原 `inputRef.innerText = props.prompt`、空正文 `innerHTML = ""`、提示词回填等整体写入位置必须调整为保留/重建模式节点，只更新用户正文。不能只修 onInput 而保留其他覆盖入口。
3. 块后维护可输入的文本落点，进入模式和清空正文后光标可落在块后；内部若使用零宽字符，仅用于定位，序列化时排除，不能写入持久化提示词。
4. 接管可能删除原子节点的 Backspace/Delete、跨块选区删除、剪切和粘贴替换。正文可以清空，但节点由模式状态保持；必要时在输入事件后恢复节点，并正确恢复光标。删除节点本身不调用退出。
5. 关闭时只移除模式节点，不改正文；推荐期间已转成普通文字的引用不自动还原为引用块；选择范围随节点移除调整，不能让后续输入丢失或跳到段首。复制/剪切对外输出正文和已有引用语义，不输出模式标签。
6. 推荐占位提示使用编辑器内不可编辑的内联占位节点，与模式块共同排版，并明确排除在读取、复制和发送之外。不要继续使用覆盖编辑器起点的绝对定位 placeholder，否则会和块重叠；占位节点也不能被读成用户输入。
7. DOM 节点的创建/更新由现有编辑器同步逻辑统一管理，避免 Solid 条件渲染和浏览器原生编辑同时修改同一节点产生重复标签。上面的 JSX 仅说明结构和事件语义。

### 4.2 `packages/app/octoapp/pages/studio/studio-01.css`

复用视觉属性，新增独立类，不给外层 span 套按钮行为：

```css
.studio-composer-recommendation-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 4px 8px 4px 12px;
  border-radius: 999px;
  background: #f3f3f3;
  color: #191919;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
  vertical-align: middle;
  margin-right: 6px;
}

.studio-composer-recommendation-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.studio-composer-recommendation-close:hover {
  background: #dfdfdf;
}

.studio-composer-recommendation-close img {
  width: 12px;
  height: 12px;
}
```

沿用项目 focus-visible 规范补键盘焦点样式；验证空态、对话态及窄宽输入区高度。块保持 inline-flex，与普通文本同段排版，不给它增加 display:block 的父容器；32px 高度可增加首行行盒高度，但不能强制正文另起一行。长正文换行后正常使用输入区宽度，不能变成固定缩进的右侧文本列。视觉复用不代表复用现有 `ToolButton`，其菜单箭头与本交互不符。

### 4.3 `packages/app/octoapp/pages/studio-page.tsx`

修改位置清单：

| 位置 | 修改 |
| --- | --- |
| `recommendationModes` | 增加 enabled 持久化与 hydration 等待 |
| `createPromptRecommendation(...)` | 注入按目标 key 读写模式意图的回调，接入新操作 |
| `createRecommendationMode(...)` | 传持续 enabled、任务占用和就绪状态 |
| `effectiveMaxReferenceImages()` | enabled 时返回 3 |
| `canSubmit()` | enabled 时走扩写规则；退出处理中、未知状态和占用时禁止发送 |
| `handleSubmit()` | 统一保护并按 enabled 分流，调用连续扩写入口 |
| `initializeRecommendation()` | 显式进入，持久化 true；已开启时不重复创建欢迎引导 |
| 新增 `exitRecommendation()` | 写入 false，并请求操作层清理尚未消费的 guide |
| `canGenerateExpansion()` | 使用 taskLocked，不使用持续模式选择锁 |
| 两处 `<StudioComposer>` | 同步传 enabled、退出状态和关闭回调 |
| 所有 `recommendationMode.locked()` 调用点 | 按选择约束/任务占用重新分类，不能全局机械替换 |

发送入口结构示意：

```ts
function handleSubmit() {
  if (!canSubmit()) return
  if (recommendation.state()?.unknown || recommendation.exiting()) return
  if (recommendationEnabled()) {
    // 在这里保留现有图片格式、单张和总大小校验。
    // 快照 prompt/assets/session/key；不能在 await 后重新读取成另一份草稿。
    void recommendation.expand(submissionSnapshot, clearIfUnchanged)
    return
  }
  // 保留原模板、图片编辑、视频和普通生成分支。
}
```

`submissionSnapshot` 是现有 prompt、images、availableModels 的不可变快照；`clearIfUnchanged` 延用当前会话、文字和 asset ID 均未变化才清空的保护。片段中的标识符需在现有取值代码上定义，不是新增全局变量。

`expand()` 的实现见 4.5。Enter 和按钮继续共用此入口，不另设分流。

校验保持现有扩写限制：文字 1–2000 个 Unicode 字符、最多 3 图、PNG/JPEG/WebP、单张 10MiB、总计 20MiB。当前模型无扩写能力时由现有模型筛选和错误码提示处理，不套用普通生图的 seedream 权限作为扩写前提。

### 4.4 `packages/app/octoapp/pages/studio/studio-recommendation-mode.ts`

把 `active` 拆成持续模式和任务占用两个输入，建议接口：

```ts
enabled: () => boolean
occupied: () => boolean
ready: () => boolean

const taskLocked = () => input.occupied() || !input.ready()
const selectionLocked = () => input.enabled() || taskLocked()
```

其中 occupied 包含准备、提交、运行、取消、unknown、退出清理以及未释放的 armed；不要只包含模型 running。

对外行为：

- `capability()`：enabled 或活动推荐占用时保持 image.generate；结束后沿用已有 entries/global 规则。
- `select()`：检查 selectionLocked。
- `hideTemplate()`：enabled 或活动推荐时隐藏模板，保留原 owner 隔离。
- `capture()`：继续用于异步工作流回填保护，检查 visit、模式操作版本和 selectionLocked，避免退出再进入后旧回填仍被接受。
- capability、模板、转视频、高清/抠图/重绘/扩图入口使用 selectionLocked。
- 结果确认使用 taskLocked；模型选择可在任务空闲时开放，模板仍保持隐藏。Composer 中共用 recommendationLocked 的模型按钮需要单独改成任务锁。
- 持续 enabled 期间不要反复执行原“锁定时关闭所有菜单”的 effect，否则模型、参数菜单可能被模式状态阻止打开；只在进入模式或任务开始时关闭不兼容菜单。

已完成结果确认生图前不能残留下一轮 armed，因此采用下面的按需准备。

### 4.5 `packages/app/octoapp/pages/studio/studio-prompt-recommendation.ts`

建议对外增加三个操作，复用现有 initialize/submit/recover 内核：

| 方法 | 契约 |
| --- | --- |
| `enter()` | 同步记录 true 意图；首次显式点击准备可见引导；返回会话与 guide 结果或明确未受理结果 |
| `expand(value, clear)` | 捕获输入；若缺少 armed，静默准备；准备成功且用户仍开启时提交；全程占用一个操作锁 |
| `exit()` | 同步记录 false 意图；合并重复关闭；核实未知请求，释放 armed；已受理任务继续执行 |

不能让“准备”和“submit”各自独立设置同一个 pending，造成中间释放或自锁。建议抽出内部准备/提交核心，由外层 expand 管理完整的 pending 生命周期；保留原 HTTP 错误处理、上传缓存和 replay 语义。

连续扩写伪代码：

```ts
async function expand(value: ExpansionSubmission, clear: () => void) {
  // beginOperation：捕获 scope/key/revision、占用并持久化操作目标。
  const operation = beginOperation()
  if (!operation) return
  try {
    if (operation.unknown) {
      await recoverOperation(operation)
      return
    }
    const guide = operation.armed
      ? operation.guide
      : await prepareGuide(operation, { showGuide: false })
    if (!guide) return
    if (!canContinueExpansion(operation)) {
      await dismissUnusedGuide(operation, guide)
      return
    }
    await submitPrepared(operation, guide, value, clear)
  } finally {
    finishOperation(operation)
  }
}
```

这里 `ExpansionSubmission` 可复用现有 `Omit<Submission, "requestID" | "sessionID" | "guidePartID">` 定义；辅助函数是职责示意，不要求按每行拆函数。`canContinueExpansion` 必须检查会话访问、操作版本和最新 enabled；上传后、实际提交前再检查一次。`finally` 只释放本操作持有的锁，不能覆盖更新的操作。

重要调整：

1. initialize 内部返回结构化结果，不让调用方仅凭 `await initialize()` 正常返回就认定成功；当前函数有 catch 后提示并返回的路径。
2. 初始化延续 expectedStateToken 和 requestID；失败、409、响应丢失都必须先同步/恢复，不能无限重新初始化。
3. 不在扩写 completed 后自动创建 armed；用户下一次发送时才准备。
4. `expand()` 在校验通过、开始替代本轮创作流程时结束旧 review；只输入文字、改参数不 dismiss。旧 review 不因初始化失败或退出被重开。
5. 原提交的 clear 回调继续只在确认受理后执行；退出模式不直接调用 clear。
6. 扩写错误文案由“请重新点击 AI推荐后提交”调整为“请重试”；模式仍开启时无需重新进入。
7. 状态读取失败不能将已有 enabled 或待确认操作降级成普通发送；即便读取 hook 保持原普通模式降级，页面也必须保留推荐分流意图。

## 5. 后端状态与接口

### 5.1 `packages/opencode/src/studio/prompt-recommendation-schema.ts`

给初始化增加可选 `showGuide`，默认 true，兼容旧调用；给 guide 增加 dismissed 和可见性信息：

```ts
// 合入现有 initializeSchema。
showGuide: z.boolean().optional()

// 合入现有 guideSchema。
status: z.enum(["armed", "consumed", "dismissed"])
visible: z.boolean().optional()
```

Effect `InitializePayload` 同步增加 `Schema.optional(Schema.Boolean)`。`RecommendationSummary.status` 与前端 summary 增加 `dismissed`；不要给 resultSchema/ExpansionStatus 加 dismissed，任务终态仍是 completed/failed/cancelled。

初始化幂等摘要包含 showGuide 的语义。保持旧请求未传该字段时的历史 digest 兼容，不能先默认填 true 再计算摘要导致旧请求重放冲突。内部行为使用 `input.showGuide !== false` 判断即可。

旧 guide 无 visible 时视为 true；新增静默引导写 visible=false。该字段通过前端 promptMetadata 解析后参与轮次过滤。

### 5.2 `packages/opencode/src/studio/prompt-recommendation.ts`

修改 `initializeRecommendation()`：

- 首次 enter 仍创建真实会话与欢迎引导，保留当前标题、category、scope 和 token 校验。
- 后续轮次准备传 showGuide=false；仍创建独立 guide 和当前数据结构要求的配对消息，但标记为内部准备轮次，不展示欢迎语。
- 内部消息可以继续使用现有 synthetic 标记，额外以 guide.visible=false 明确过滤，不依赖 synthetic 自动隐藏。
- 不复用 consumed guide，不覆盖旧 submission；旧任务 requestID 重放、assistantMessageID、resultPartID 均保持可查询。
- 每轮静默准备仍遵守 assertNoGeneration 和 active guide 冲突检查。
- 初始化结果包含 dismiss 后的新状态，不能把 dismissed 当成 failed。

修改 `summarize()` 的状态分支：

```ts
status: found.metadata.status === "armed"
  ? "armed"
  : found.metadata.status === "dismissed"
    ? "dismissed"
    : result?.success
      ? result.data.status
      : "failed"
```

新增 `dismissRecommendation(sessionID, guidePartID)`，核心操作示意：

```ts
export function dismissRecommendation(sessionID: string, guidePartID: string) {
  session(sessionID)
  return Database.transaction(() => {
    const found = guide(guidePartID, sessionID)
    if (found.metadata.status !== "armed") return accepted(sessionID, guidePartID)
    writePart({
      ...found.part,
      metadata: {
        ...found.part.metadata,
        studioPromptRecommendation: {
          ...found.metadata,
          revision: found.metadata.revision + 1,
          status: "dismissed",
        } satisfies Guide,
      },
    })
    return accepted(sessionID, guidePartID)
  }, { behavior: "immediate" })
}
```

契约：重复 dismiss 幂等；只操作目标 guide；consumed 不取消关联任务、不删除历史；找不到或不属于会话返回既有受控错误。返回现有 RecommendationResponse 形状，目标 guide 的 summary 配合最新 stateToken，随后客户端刷新最新状态。

提交在准备前和事务受理时已经两次检查 guide.status。释放与受理都在事务中决定最终结果：释放先发生则提交拒绝；提交先发生则释放不影响运行。不能在事务外读状态后无条件写回，否则会覆盖 consumed。

调整 finish() 和提交错误提示，去掉强制重新点击 AI推荐的旧文案。

### 5.3 `packages/opencode/src/studio/prompt-recommendation-state.ts`

保留 assertCanGenerate 的原则：armed 和 running/cancelling 继续阻止生图。dismissed 自然不阻塞；禁止为了让关闭可用而移除 armed 检查。

补真实数据库测试，证明关闭 armed 后普通生成检查通过，执行中仍被拒绝。新 guideSchema 必须在这里正确解析，否则可能因解析失败跳过原本应该生效的保护。

### 5.4 新增 dismiss HTTP 操作，两套路由同步

```http
POST /studio/sessions/:sessionID/prompt-recommendations/:guidePartID/dismiss
```

无需 body，返回 `RecommendationResponse`，operationId 建议为 `studio.prompt-recommendations.dismiss`。

| 文件 | 具体修改 |
| --- | --- |
| `packages/opencode/src/studio/prompt-recommendation-http.ts` | action 增加 dismiss，调用服务层；使用具名 params 区分 guidePartID 与 assistantMessageID |
| `packages/opencode/src/server/routes/instance/studio.ts` | Hono 注册新路由，path 参数与 OpenAPI 响应 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` | Effect 增加 dismissRecommendation endpoint，同步初始化 payload 和状态 schema |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts` | action union、params 增加 guidePartID，注册 handleRaw |

HTTP adapter 不能把 guidePartID 塞进名为 assistantMessageID 的参数混用。建议将现有可选位置参数整理为具名对象，并同步四个既有操作的调用。保留 scope 校验、授权、错误封装和日志路径。

新增公开契约后，实施时在仓库根目录执行 `./packages/sdk/js/script/build.ts`，检查生成结果。不要手写生成文件。

## 6. 退出、请求恢复与竞态

### 6.1 pending 记录扩展

现有 pending 只有 initialize/submit。至少增加 dismiss，同时 initialize 需要记录 showGuide 和必要的模式操作上下文：

```ts
z.object({
  kind: z.literal("dismiss"),
  sessionID: z.string(),
  guidePartID: z.string(),
})
```

关闭意图必须先持久化 false，再执行网络操作。操作记录、clear 回调和写入 key 都基于捕获的目标，不在响应回来后使用已切换到会话 B 的 storageKey()。现有 save()/pending() 必要时改成显式接收目标 key。

一个 key 的 pending 由操作协调器串行维护：不能用 dismiss 覆盖尚待确认的 submit/initialize。先核实旧请求，再决定是否释放它产生的 guide。submitted 请求的 payload/requestID/replay 必须保留；用户退出后不自动重放一个尚未受理的新扩写。

### 6.2 按阶段退出

| 关闭时阶段 | 前端与后端处理 |
| --- | --- |
| 已完成/失败/取消，无 armed | 写 false，直接结束退出 |
| armed | 写 false，保存 dismiss pending，调用释放并刷新；确认不占用后允许普通发送 |
| 静默初始化中 | 写 false，保留初始化恢复记录；返回成功则释放新 guide，不继续 submit |
| 图片上传/模型准备前 | 写 false，停止后续提交；清理 armed；保留草稿和已上传缓存 |
| submit 可能已发出、响应未知 | 先查询请求是否受理；未受理且仍 armed 则释放，不发起新的扩写 |
| 已受理 running/cancelling | 写 false，任务继续；仍 taskLocked，停止按钮保持可用 |
| dismiss 响应未知或失败 | 保留退出意图和待清理记录；阻止新任务，提供“重试退出/同步状态”入口 |

初始化先创建了新会话、前端尚未拿到 sessionID 时退出：pending 的原 requestID 仍可重放恢复这个初始化，拿到真实会话后释放。不能清掉 pending 后另建新会话。

### 6.3 版本与访问保护

每次 enter/exit 增加目标 key 的 operationRevision。网络响应更新业务事实可以落回原 key，但响应触发的 UI 导航、继续提交、清空输入必须同时验证：

```ts
operation.scope === input.scope()
operation.key === currentKey()
operation.revision === currentOperationRevision()
```

清理旧 key 可以使用捕获的 session/guide 独立完成，不要求仍显示该会话；跨 scope 后不要使用新 scope 的凭据请求旧目标，保留待恢复记录，返回原 scope 再处理。

关闭期间重新开启：等待旧请求与释放确认后，按新版本执行 enter；不能让迟到 dismiss 清理新创建的 guide。接口始终带具体 guidePartID，不能提供“把当前最新 guide 关掉”的模糊操作。

## 7. 结果确认、轮次和流式展示

### 7.1 `packages/app/octoapp/pages/studio/studio-prompt-state.ts`

- guide 的 status 增加 dismissed。
- guide 增加可选 visible。
- 保留 revision 单调合并，旧事件不能覆盖较新的 dismiss/consumed。
- 不将 visible 字段加到 result schema；不改流式 preview 与 reasoning 合并规则。

### 7.2 `packages/app/octoapp/pages/studio/turns.ts`

在 buildStudioTurns 构造轮次时过滤内部 guide，过滤发生在最终 isLatest 和 review 最后轮次判断之前：

```ts
const recommendation = promptMetadata(recommendationPart)
if (recommendation?.kind === "guide" && recommendation.visible === false) return undefined
// 原 guide/result 分支保持，结尾以类型守卫过滤 undefined。
```

不能把全部 guide 隐藏，首次显式进入的欢迎语仍应可见。旧消息无 visible 按可见处理。

### 7.3 `studio-prompt-expansion-review.ts` 与 `studio-page.tsx`

- 继续按 assistantMessageID 保存结果草稿和 confirmed/ignored/dismissed。
- generateFromExpansion 继续调用 expansionGenerationInput() 和 runGeneration()。
- canGenerateExpansion 使用任务锁；enabled 本身不禁止结果生成。
- 确认、忽略、runGeneration 中的 expansionReview.dismiss 不写 enabled。
- 开始下一轮扩写时关闭旧确认区；单纯退出模式保留结果草稿及确认资格。
- 不在结果完成后预建下一轮 armed，避免前后端同时阻塞结果确认。

流式预览继续使用现有 studio-prompt-expansion-preview，不增加新的结果卡片或流式协议。

## 8. 文件变更总表

| 文件 | 类型 | 范围 |
| --- | --- | --- |
| `packages/app/octoapp/pages/studio-page.tsx` | 修改 | 模式持久化、发送、退出、校验、锁及两处 Composer |
| `packages/app/octoapp/pages/studio/studio-composer.tsx` | 修改 | 同段模式块、关闭事件、精确占位文案、正文序列化及选区保护 |
| `packages/app/octoapp/pages/studio/studio-01.css` | 修改 | 模式块和关闭按钮样式 |
| `packages/app/octoapp/pages/studio/studio-recommendation-mode.ts` | 修改 | selectionLocked / taskLocked 和 capability 约束 |
| `packages/app/octoapp/pages/studio/studio-prompt-recommendation.ts` | 修改 | enter/expand/exit、串行操作、静默准备、恢复 |
| `packages/app/octoapp/pages/studio/studio-prompt-state.ts` | 修改 | dismissed 与 visible 元数据 |
| `packages/app/octoapp/pages/studio/turns.ts` | 修改 | 内部 guide 过滤 |
| `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.ts` | 原则上复用 | 核查最新轮次规则，优先通过 turns 过滤解决 |
| `packages/app/octoapp/pages/studio/studio-recommendation-settings.ts` | 原则上复用 | 关闭不清参数；核查 enabled 接入后参数来源 |
| `packages/opencode/src/studio/prompt-recommendation-schema.ts` | 修改 | payload、guide、summary 契约 |
| `packages/opencode/src/studio/prompt-recommendation.ts` | 修改 | 静默初始化、dismiss、状态汇总、旧提示文案 |
| `packages/opencode/src/studio/prompt-recommendation-state.ts` | 核查 | 保留生图并发保护，覆盖新状态 |
| `packages/opencode/src/studio/prompt-recommendation-http.ts` | 修改 | dismiss 分发与具名目标参数 |
| `packages/opencode/src/server/routes/instance/studio.ts` | 修改 | Hono 路由和 OpenAPI |
| `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` | 修改 | Effect endpoint 和 schema |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts` | 修改 | Effect handler 和适配调用 |
| `packages/sdk/js` 下生成文件 | 按生成结果 | 运行构建脚本产生，不手工修改 |

本方案沿用消息 metadata 持久化 guide，不新增数据库表或 SQL 列，因此不需要数据库 schema migration；需要做的是旧 JSON metadata 和前端 session storage 的兼容。

## 9. 测试与验收

### 9.1 前端测试

扩展现有测试：

- `studio-prompt-recommendation.test.ts`：连续两轮、退出、重复退出、初始化迟到、提交未知、刷新恢复、切 scope、同 key 退出再进入。
- `studio-recommendation-mode.test.ts`：enabled 持续强制图片能力，任务空闲时允许结果生图，普通会话仍沿用原 capability。
- `studio-recommendation-settings.test.ts`：退出保留推荐会话参数，不覆盖其他会话视频参数。
- `studio-prompt-state.test.ts`：dismissed 解析和 revision 防回退。
- `studio-prompt-expansion-review.test.ts`：静默准备不抢占最后可见结果，下一轮真实提交后旧 review 失效。
- 轮次相关现有测试或新增对应测试：visible=false 不进入 turns，旧 guide 仍可见。
- 新增 Composer DOM 测试：模式块和占位文案不进入提示词；占位文案精确为“描述你想生成的图片”；有正文时占位消失；点击 × 不发送；两种标题正确；退格、全选删除、剪切和粘贴保留模式块；外部回填和清空不重复标签；普通模式的 @ 引用与 IME 输入正常，推荐模式不弹出引用菜单且回填不保留引用块。优先覆盖行为，不对 CSS 细节做快照测试。

网络失败、丢响应和竞态可在现有 request 注入边界控制 Promise；不要模拟整套推荐内部逻辑。

### 9.2 后端测试

扩展：

- `packages/opencode/test/studio/prompt-recommendation.test.ts`。
- `packages/opencode/test/studio/prompt-recommendation-http.test.ts`。
- `packages/opencode/test/studio/prompt-expansion-integration.test.ts`。

关键用例：

1. armed 释放后 assertCanGenerate 通过；重复释放不增加 revision。
2. consumed 释放不取消任务；running/cancelling 仍阻止新生图。
3. 释放先于受理，提交被拒绝；受理先于释放，submission 不被覆盖。
4. showGuide=false 创建独立 guide；旧 requestID 重放返回原结果，不重复消息。
5. 未传 showGuide 的历史初始化重放 digest 兼容。
6. 旧 consumed guide 与新 guide 并存时，旧请求查询/重放仍正确。
7. 两套路由同样支持 dismiss，跨会话/项目目标不能被修改。
8. 静默初始化失败保留草稿；响应丢失恢复不额外创建一轮。

### 9.3 实施后的检查命令

从包目录执行，不能在仓库根目录跑测试或直接调用 tsc：

```sh
# 工作目录：packages/app
bun typecheck
bun test --conditions=browser --preload ./happydom.ts ./octoapp/pages/studio/studio-prompt-recommendation.test.ts ./octoapp/pages/studio/studio-recommendation-mode.test.ts ./octoapp/pages/studio/studio-recommendation-settings.test.ts ./octoapp/pages/studio/studio-prompt-state.test.ts ./octoapp/pages/studio/studio-prompt-expansion-review.test.ts

# 工作目录：packages/opencode
bun typecheck
bun test --timeout 30000 ./test/studio/prompt-recommendation.test.ts ./test/studio/prompt-recommendation-http.test.ts ./test/studio/prompt-expansion-integration.test.ts

# 工作目录：仓库根目录，接口变更后生成 SDK
./packages/sdk/js/script/build.ts
```

新增 DOM/轮次测试按最终文件名补入命令。生成 SDK 后再完成受影响包的类型检查。这些命令用于后续回归；本次实施已执行的检查见第 11 节。

人工验收顺序：空态进入 → 两次连续扩写 → 确认结果生图 → 再次输入仍扩写 → 运行中 × 退出但任务继续 → 停止 → 普通发送 → 刷新 → 切换另一会话并返回。补测有图、无图、长文本、窄屏及无网络场景；确认块后立即跟占位或正文，块不独占一行，长正文和块处于同一段落并自然换行。

## 10. 推荐实施顺序

1. 后端 schema、静默初始化、dismiss 及事务测试。
2. 两套 HTTP 路由、adapter 和 SDK 生成。
3. 前端元数据解析及内部轮次过滤。
4. 推荐 hook 的操作协调、pending 恢复和连续扩写。
5. 模式持久化、锁拆分、发送校验、结果生图接入。
6. Composer 块、关闭按钮和样式。
7. 定向测试、包级类型检查及完整交互验收。

交付必须同时包含前后端。只上 UI 会出现“块已关闭但 armed 仍阻塞生图”；只把发送改为 enabled 会出现“第二轮使用 consumed guide 被拒绝”；把 enabled 直接当原 locked 会导致推荐期间结果确认永久不可用。


## 11. 实施记录（2026-10-29）

- 已增加独立的 enabled 会话模式状态，并保留原 capability/settings 存储；进入沿用现有 initialize 方法名，连续发送使用 expand，退出使用 exit。
- 保留原 locked() 作为能力及工作流选择锁，新增 taskLocked() 供结果确认和模型选择使用。
- 新增 `studio-recommendation-input.ts` 统一维护不可编辑的同段标签、精确占位文案、正文/HTML 序列化、剪切和删除恢复；新增同名 `.test.ts` 验证真实 DOM 行为。该辅助模块应加入第 8 节文件清单。
- 两处 Composer 已接入相同的模式、关闭与恢复操作；标签由输入编辑器维护，不交给 JSX 重复管理其可编辑子节点。
- 后端已实现 showGuide=false 和 dismissed，新增针对具体 guidePartID 的 dismiss 路由，两套 HTTP 栈共用具名目标参数的 adapter。
- 已通过仓库指定脚本重新生成 JavaScript SDK。
- 前端定向测试覆盖连续扩写、上传/初始化途中退出、空白页创建会话后的关闭意图迁移、响应丢失恢复、停止保留模式、标签 DOM 与结果 review。
- 后端测试覆盖 guide 释放与幂等、独立静默准备、原扩写集成流程；HTTP 一致性测试覆盖两套路由的公开 schema、释放和静默初始化。
- `packages/app` 与 `packages/opencode` 的包级 `bun typecheck` 已通过。测试 Solid 响应式代码时必须使用 `--conditions=browser`；缺少该条件会加载 Solid 服务端实现，导致 effect 不运行。
- 沙箱内临时端口监听及文件监听测试失败后，已获准在沙箱外完成对应定向验证；SDK 生成同样已在获准后完成。
- 未启动或重启应用，也未使用真实用户模型执行付费生成。正式页面的同段换行、窄屏、光标及输入法视觉行为仍应在运行中的应用验收，DOM 测试不能代替浏览器视觉验收。


## 12. 错误恢复边界修复

以下问题由隔离的请求故障注入验证，不代表正常网络下的页面流程必现：

- 空白页首次初始化明确失败后，再次发送可能创建会话但中止扩写。现在 expand 为本次操作保存 continuation，仅在自身创建会话时迁移操作目标、访问标识和准备锁，并继续提交原输入。navigate 的 preserveDraft 标识让页面在这次受控迁移中保留文字和参考图；受理后的 clear 回调带实际会话 ID，仍核对原草稿是否改变。提交被拒绝时保留输入，用户自行切换会话仍中止旧发送。
- 提交响应丢失且运行状态事件尚未到达时，停止意图可能被提前清除。现在使用独立的恢复中/取消中状态，核实请求之前不消耗停止意图：已受理则对原 guide 的任务取消，未受理则释放该 guide 阻止迟到提交，并保留推荐模式和输入。恢复失败继续保留停止意图；不会用旧任务的停止请求取消随后出现的新 guide。
- 补充定向回归：初始化失败后重试发送成功与拒绝、有状态事件/无状态事件的提交响应丢失、状态查询失败后再次恢复、未受理请求的停止，以及旧任务停止意图与新任务隔离。


## 13. 推荐模式禁用 @ 引用

- `studio-composer.tsx` 的 showMentionEntry/canInsertMention 同时限制工具栏、“更多”菜单、键盘 @ 触发及引用插入；工具栏布局测量同步排除 @ 项，进入推荐后关闭已打开的引用菜单和悬浮预览。
- 推荐模式的 serializeMentionImages() 返回空映射；参考图仍通过原 assets 上传给扩写，不受影响。
- `studio-recommendation-input.ts` 复用 stripComposerMentions() 将推荐输入中已有或回填的引用块转为普通名称文字，去掉引用图标和定位零宽字符；不清空其他文字，也不删除已上传参考图。
- 手动输入 @ 字符仍作为普通文本，不能唤起图片选择或创建引用关系。退出推荐后，普通模式的引用功能按模型条件恢复，已转成普通文字的旧块不自动重建。
- DOM 回归覆盖推荐模式移除引用、普通模式保留引用、回填和粘贴不恢复推荐引用，以及普通 @ 字符保留。
