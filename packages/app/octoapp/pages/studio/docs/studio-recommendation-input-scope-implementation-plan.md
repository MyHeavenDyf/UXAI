# Studio 推荐模式限制收敛到输入区域：修改方案

> 日期：2026-10-30。
>
> 状态：核心实现及定向测试已完成；实施记录见第 13 节。真实第三方生成与页面人工验收尚未执行。
>
> 交互修订：推荐偏好只在图片生成能力下生效。切换视频后隐藏 AI 推荐块，发送视频生成任务；切回图片再恢复已记录的推荐偏好。
>
> 路径均相对仓库根目录 `/Users/ucd/Documents/GitHub/UXAI`。
>
> 本方案替代 `studio-ai-recommendation-mode-implementation-plan.md` 中关于推荐期间锁定能力、限制编辑流程、`armed` 阻止生成的约定。旧方案的幂等、恢复、取消和会话隔离机制继续保留。
>
> 下文关键代码是实施示意；省略部分沿用现有实现，不代表可以整段直接替换。

## 1. 已确认的交互规则

AI 推荐是图片生成输入框的发送模式，不再是 Studio 的全局能力模式。必须区分“已保存的图片推荐偏好”和“当前输入区是否启用推荐”：只有 capability 为 `image.generate` 且偏好开启时，才显示推荐块并将发送改为扩写。

| 操作 | 推荐开启后的行为 | 是否改变推荐开关 |
| --- | --- | --- |
| 图片生成输入框发送、Enter | 当前图片推荐生效时执行扩写；否则正常图片生成 | 保留 |
| 视频生成输入框发送、Enter | 不显示推荐块，执行视频生成；不进入图片扩写分支 | 保留图片推荐偏好 |
| 扩写结果“确认，按扩写内容生成” | 使用扩写内容执行图片生成 | 保留 |
| 扩写结果“忽略，使用原始描述” | 使用该轮原始描述执行图片生成 | 保留 |
| 切换到视频或编辑能力 | 允许，隐藏推荐块，使用所选能力的正常输入/编辑交互 | 保留图片推荐偏好 |
| 切回图片生成能力 | 若已保存偏好为开启，恢复推荐块与扩写发送；若为关闭则正常生图 | 保留 |
| 切换风格模型 | 图片能力下正常选择，不因推荐开启或 `armed` 禁用 | 保留 |
| 选择风格模板 | 仅当前图片推荐生效时禁用模板选择及应用；其他能力遵循原有支持范围 | 保留 |
| @ 引用 | 仅当前图片推荐生效时禁用引用入口、键盘触发及引用插入；普通文字中的 @ 不禁止输入 | 保留 |
| 画布“再次生成” | 按目标历史任务的能力和参数发起新生成 | 保留 |
| 结果卡片“重新生成” | 按目标失败任务执行 reboot | 保留 |
| 结果卡片“刷新状态” | 按原有规则查询或恢复目标异常任务 | 保留 |
| 画布变清晰、抠图、智能重绘、扩图 | 正常打开对应编辑器；编辑器提交执行自己的任务 | 保留 |
| 画布“视频生成” | 正常切换视频能力并回填首帧，隐藏推荐块，发送正常视频任务；沿用权限与风险提示 | 保留图片推荐偏好 |
| 图片任务“重新编辑” | 退出推荐，恢复该任务原始输入、模型、参数、参考图，以及原有模板/@信息 | **关闭：用户已明确指定的例外** |
| 视频任务“重新编辑” | 切换视频能力，隐藏推荐块，恢复原输入/首尾帧/参数，发送视频生成任务 | 保留图片推荐偏好 |
| 点击推荐标记 × | 关闭后续默认扩写；保留输入和历史结果 | 关闭 |
| 扩写成功、失败、停止、快捷操作成功或失败 | 不自动修改用户的推荐开关 | 保留 |

“允许”表示不受推荐开关和空闲 `armed` 限制；已有权限、参数合法性、实际任务占用和重复提交保护继续生效。本次不扩展为视频提示词扩写，也不要求所有任务并行执行。

不能出现“工具栏是视频生成、输入区仍显示图片 AI 推荐、发送仍做图片扩写”的状态。切换能力不会把已保存偏好写成 false，但当前是否显示标记及怎样发送，必须严格跟随当前能力。

## 2. 当前问题与修改依据

### 2.1 前端把推荐开关混入能力锁

`studio-recommendation-mode.ts` 当前实现：

```ts
const taskLocked = () => input.active() || (!input.ready() && Boolean(input.entries()[input.key()]))
const locked = () => Boolean(input.enabled?.()) || taskLocked()
```

同时存在三处额外耦合：

- `studio-page.tsx` 向 `active` 传入 `recommendation.armed()`；因此即使改用 `taskLocked()`，空闲引导也会被当成任务。
- `capability()` 在推荐开启或 active 时强制返回 `image.generate`，effect 也持续写入图片能力。
- `select()` 和 `capture()` 都依赖 `locked()`；只改按钮 disabled，能力切换和异步回填仍会被拦截。

### 2.2 后端把未发送的引导当成生成占用

`prompt-recommendation-state.ts / assertCanGenerate()` 目前同时拦截：

- guide 的 `armed`；
- expansion 的 `running/cancelling`。

它被 `createGenerationImpl()`、`rebootGenerationImpl()`、`refreshGenerationOnce()`、`createEditorEntryImpl()` 共用。因此前端放行后，仍可能在新建生成、失败任务重试、异常任务刷新、编辑入口消息保存处得到 `SESSION_BUSY / 409`。

### 2.3 解除能力锁会暴露原来被图片能力假设遮住的路径

- 直接用持久化 enabled 驱动 UI/发送，会导致切到视频后仍显示推荐块、误发图片扩写；必须增加当前生效状态。
- 视频下粘贴、拖入图片应继续进入 `videoFrames`，不能因图片推荐偏好仍为 true 而改道到扩写 `assets()`。
- `applyStudioCapability()` 的草稿处理要区分能力；保留的是图片推荐偏好，不能要求所有能力共用推荐正文和素材。
- 编辑器的 `runGeneration()` 默认清空并在失败时恢复左侧 prompt/assets，可能修改与快捷任务无关的扩写草稿。
- 图片与视频共用参数访问器。扩写确认必须显式使用图片参数，不能读取当前视频比例、张数和尺寸。

## 3. 涉及文件

### 3.1 业务实现

| 文件 | 修改内容 |
| --- | --- |
| `packages/app/octoapp/pages/studio-page.tsx` | 重新接入模式状态；调整能力/模型切换、模板应用、视频入口、四类编辑入口、重新编辑、生成提交、素材路由、扩写确认和两处 Composer props |
| `packages/app/octoapp/pages/studio/studio-recommendation-mode.ts` | 移除推荐强制图片能力；将模板限制、真实任务占用、异步会话校验分开；保留现有会话能力存储 |
| `packages/app/octoapp/pages/studio/studio-draft-restore.ts` | 统一草稿快照与素材准备后整体回填；用视频帧 id/dataUrl 检测 Store 原地更新 |
| `packages/app/octoapp/pages/studio/studio-composer.tsx` | 能力和风格模型解除推荐锁；只按当前图片推荐生效状态显示标记、限制模板/@和显示扩写文案；视频保留原有输入/素材/发送 |
| `packages/app/octoapp/pages/studio/studio-recommendation-input.ts` | 推荐占位文案改为明确的图片描述；保留原子标记、正文序列化和 @ 转普通文字逻辑 |
| `packages/app/octoapp/pages/studio/studio-prompt-recommendation.ts` | 保留持久模式和请求恢复；为图片重新编辑明确退出完成条件；防止迟到响应修改回填草稿；不在能力切换时退出 |
| `packages/app/octoapp/pages/studio/studio-recommendation-settings.ts` | 核对并补齐图片参数快照初始化，使视频/编辑能力下确认扩写仍使用图片参数 |
| `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.ts` | 保持确认固定图片生成；显式输出图片尺寸，避免回落到当前能力参数 |
| `packages/opencode/src/studio/prompt-recommendation-state.ts` | `assertCanGenerate()` 移除 armed 判断，仅把真实执行中的扩写作为占用；保留提交互斥 |

### 3.2 联动核查，不预设必须修改

| 文件 | 核查内容 |
| --- | --- |
| `packages/app/octoapp/pages/studio/studio-conversation.tsx` | `studio-canvas-floating-actions` 的 disabled、菜单模式和回调；不新增 recommendationEnabled 全局禁用条件 |
| `packages/app/octoapp/pages/studio/studio-result-card.tsx` | 重新生成/编辑/刷新仍由动作占用和任务状态决定，不按推荐开关禁用 |
| `packages/app/octoapp/pages/studio/studio-shared.ts` | 保留 `studioRegenerationExtra()` 和历史任务 @/模板参数；若抽取输入动作判断，只抽取有实际复用的逻辑 |
| `packages/opencode/src/studio/studio-service.ts` | 核对四条统一 guard 调用及 create/reboot/refresh 的持锁范围；不为每个入口额外增加推荐模式分支 |
| `packages/opencode/src/studio/prompt-recommendation.ts` | 核对 armed 与生成共存时的 submit/init 并发保护；保留受理事务中的二次检查 |
| `packages/opencode/src/server/routes/instance/studio.ts` | 核对 legacy Hono 路由的状态码和公开行为 |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts` | 核对 Effect HttpApi 的相同行为和 RecommendationError 映射 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` | 保留真实占用的 409 契约；本次不新增输入参数 |
| `packages/app/octoapp/pages/studio/docs/studio-ai-recommendation-mode-implementation-plan.md` | 标注能力锁、编辑限制及 armed 占用约定已由本方案替代，避免后续按旧文档回改 |

### 3.3 测试

| 文件 | 修改内容 |
| --- | --- |
| `packages/app/octoapp/pages/studio/studio-recommendation-mode.test.ts` | 替换“推荐锁定图片能力”的旧预期；覆盖 enabled、armed 与能力选择独立 |
| `packages/app/octoapp/pages/studio/studio-prompt-recommendation.test.ts` | 扩写生命周期、显式退出、回填竞争和保留用户意图 |
| `packages/app/octoapp/pages/studio/studio-recommendation-settings.test.ts` | 视频/编辑能力下的图片参数快照及图片视频隔离 |
| `packages/app/octoapp/pages/studio/studio-recommendation-input.test.ts` | 图片扩写文案、标记与正文隔离、@限制 |
| `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.test.ts` | 图片确认、历史素材和显式尺寸，不跟随视频参数 |
| `packages/app/octoapp/pages/studio/studio-recommendation-actions.test.tsx`（新增） | 实际挂载 Composer/动作接线，覆盖选择、发送、素材归属、重新编辑及快捷任务草稿保护 |
| `packages/app/octoapp/pages/studio/studio-draft-restore.test.ts`（新增） | 延迟素材读取、整批提交、用户正文/帧修改、会话切换及动作失效 |
| `packages/opencode/test/studio/prompt-recommendation.test.ts` | armed 不再阻止生成；真实运行仍阻止；dismiss 仍幂等 |
| `packages/opencode/test/studio/studio-generation-service.test.ts` | 统一 guard 在编辑入口和生成服务中的实际行为 |
| `packages/opencode/test/server/httpapi-bridge.test.ts` | 两套 HTTP 栈 armed 放行和真实任务占用 409 的一致性 |

新增前端测试不得通过读取源码字符串、复制生产条件来代替行为验证。需要页面上下文的用例复用现有测试环境；服务依赖优先使用已有 fixture，只有传输边界使用受控替身。

## 4. 前端状态与能力切换

### 4.1 分清偏好、生效状态与任务状态

| 状态 | 含义 | 消费者 |
| --- | --- | --- |
| `recommendationEnabled()` | 当前会话已保存的图片推荐偏好，沿用现有 enabled 存储 | 模式持久化、恢复、显式退出；不直接决定当前 UI/发送 |
| `recommendationActive()` | `capability() === "image.generate" && recommendationEnabled()` | 推荐标记、输入发送分流、模板/@禁用、扩写上传规则 |
| `recommendation.armed()` | 未消费 guide，可用于下一次扩写 | 扩写准备与提交；不限制快捷操作 |
| 真实占用/状态待确认 | 正在准备或提交、扩写运行/取消、生成执行、请求结果未知等 | 请求重复提交与并发保护 |

`recommendation.busy()` 目前不包含 armed，继续保持。不要把 enabled 或 armed 加入 `isActionBusy()`。

```ts
const recommendationEnabled = () => recommendationModes.enabled?.[recommendationKey()] === true
const recommendationActive = () => capability() === "image.generate" && recommendationEnabled()
```

推荐 hook 的 `mode.enabled/save` 继续读写持久偏好。切换到视频或编辑能力只会令 active=false，不调用 exit/dismiss，也不写 enabled=false；切回图片自然恢复 active。仅点击 × 或图片任务重新编辑按约定清除偏好。

实现时按用途审查现有 enabled 调用点，不能全局替换：

| 消费位置 | 使用的状态 |
| --- | --- |
| `createPromptRecommendation` 的 `mode.enabled/save`、初始化恢复、显式关闭和会话迁移 | 持久 `recommendationEnabled()` |
| `handleSubmit()`、`canSubmit()` 的扩写分支 | 当前 `recommendationActive()` |
| `effectiveMaxReferenceImages()`、`selectStyleModel()` 的扩写专用分支 | 当前 `recommendationActive()` |
| 两处 Composer、推荐块、placeholder、发送文案、模板/@限制 | 当前 `recommendationActive()` |
| 已完成扩写结果的确认/忽略入口 | 该结果的 review 状态、真实任务保护和图片权限；不要求当前 active |
| 停止、恢复、unknown 和已受理任务占用 | 实际任务生命周期；不按 active 隐藏后当作任务已结束 |

因此 enabled=true、capability=video.generate、active=false 是合法状态：已记住图片推荐，但当前完整运行视频输入流程。

新任务入口统一使用任务保护；能力/模型选择沿用现有真实 busy 保护。状态未就绪或 unknown 时不得新建存在冲突风险的任务，但不能因为“曾有推荐记录”或 enabled 持续为 true 永久锁定能力。

### 4.2 改写 createRecommendationMode

保留已有 `entries` 及全局 capability 的兼容读写，移除“推荐自动写入 image.generate”的 effect。用有明确用途的方法取代泛化 `locked()`。

```ts
// 示意：沿用当前函数参数，active 改为 busy，不再传 armed。
const visit = createMemo(() => ({ key: input.key() }))
const capability = () => input.entries()[input.key()] ?? input.global()
const active = () => capability() === "image.generate" && Boolean(input.enabled?.())

return {
  templateDisabled: active,
  taskBlocked: () => input.busy() || !input.ready(),
  capability,
  select: (value: StudioCapability) => {
    if (input.busy()) return
    if (input.enabled?.() || input.entries()[input.key()]) input.save(input.key(), value)
    input.setGlobal(value)
  },
  capture: () => {
    const target = visit()
    return () => visit() === target && !input.busy()
  },
  hideTemplate: (owner: string | undefined) =>
    active() || Boolean(input.entries()[input.key()] && owner !== input.key()),
}
```

实施时增加 `busy: () => boolean` 参数，替换原 active。`ready` 由推荐状态已就绪、非 unknown、非退出待确认共同构成；`busy` 来自实际动作占用。注意 page 内 `isActionBusy` 声明晚于模式构造，传 accessor，不在构造函数顶部立即求值未初始化的变量。

原有 `capture()` 只保留会话访问身份与动作占用校验，不再要求推荐关闭。跨能力/草稿竞争使用第 7 节的动作版本保护，不能把模式开关当作统一回填资格。

持久化兼容：不重命名 `studio.recommendation.modes`，不删除 entries/settings/enabled。旧 entries 中的图片能力作为历史选择保留，之后允许用户覆盖；本次不尝试猜测旧值是不是被旧 effect 写入。

### 4.3 studio-page.tsx 调用点逐项处理

| 当前入口 | 修改方式 |
| --- | --- |
| `selectStudioCapability()`、`applyStudioCapability()` | 移除 recommendationMode.locked；使用正常动作 busy 判断；不调用 exit；纯选择图片/视频时不 dismiss 扩写 review；视频权限与风险确认不变 |
| `confirmVideoRiskDialog()` | 不再因推荐开启拒绝确认；确认后真实切换视频，不关闭推荐；仅确认风险/切换选择不 dismiss 扩写 review |
| `selectStyleModel()` | 移除包含 armed 的 taskLocked；继续执行权限、尺寸合法性逻辑；仅当前图片推荐生效时走扩写参考图保护分支 |
| `openEditorEntry()`、`createEditorEntry()` | 移除模式锁；保留重复动作保护和编辑能力原有输入行为；不修改推荐偏好 |
| `openHD/openCutout/openInpaint/openOutpaint` | 只保留图片类型、选中图片和正常动作条件；设置对应 capability 后推荐不强制改回图片生成 |
| `generateVideoFromSelectedImage()` | 移除模式锁，保留权限、异步图片读取和风险确认；不退出推荐 |
| `showVideoGeneration` 两处传参 | 从 `canGenerateVideo() && !recommendationMode.locked()` 改为正常权限条件；disabled 仍使用动作占用 |
| `applyStyleTemplate()` | 当前图片推荐 active 时拒绝；其余按原有能力支持规则 |
| `selectedStyleTemplate()` | 当前图片推荐 active 时不可见/不参与输入；保留原 owner 隔离机制 |
| 初始化模式的 effect | 仅当前图片推荐 active 时关闭模板菜单和模板描述编辑器；不再关闭所有 openMenu，也不取消视频风险弹窗 |
| `canGenerateExpansion()` | 移除含 armed 的 taskLocked，改为真实动作保护和图片生成权限/参数校验 |
| 两处 `<StudioComposer>` | recommendationEnabled 展示 prop 传 active 而非持久 enabled；同时调整其余 props，避免空态和对话态行为不一致 |

`selectStyleModel()` 的推荐分支改按 `recommendationActive()` 判断，在普通模型素材裁剪之前返回；扩写自身仍使用现有 3 张上限，不能切换到低参考图上限的生成模型后悄悄删掉扩写图片。确认生成时继续按最终模型校验参考图数量。

review 与 enabled 是不同状态。纯能力/模型选择、打开编辑器、准备视频首帧不应仅因选择变化调用 `expansionReview.dismiss()`；真正发送新任务或执行重新编辑时沿用 review 消费规则。如果切换编辑能力确实创建了新的 editor-entry 对话轮次，则保留现有“仅最后可见轮次可确认”的历史顺序约束，不重新开放旧 review，也不删除其文本。不要把 review 的 dismissed 状态反向当作退出推荐。

### 4.4 能力切换时保留偏好，输入按能力处理

保留推荐偏好不等于所有能力共享同一份推荐输入。处理方式：

1. `applyStudioCapability()` 保留原有能力、工作区和草稿切换策略，按进入前的 capability 保存图片/视频参数；不能写 enabled=false。
2. 切到视频后使用视频正文/首尾帧及原有校验，不把隐藏的图片参考图传给视频任务，也不按扩写规则接管视频素材上传。
3. 切到编辑能力后使用对应编辑工作区，隐藏推荐块，输入区发送沿用该能力原有逻辑。
4. 本次必须保留的是推荐偏好；不新增全能力草稿保存系统。已有暂存草稿机制继续按能力隔离，不能为“保留推荐”把图片/视频参数与素材混成一份。
5. 图片能力内的独立快捷任务仍按第 7 节保护未消费的当前输入，避免任务失败回滚覆盖用户新草稿。
6. `seedreamAtSnapshot` 的恢复按 `recommendationActive()` 判断；图片推荐生效时不得恢复引用芯片，视频/编辑能力不能因隐藏偏好被套用图片推荐规则。

## 5. Composer、模板、@ 与素材路由

### 5.1 拆分 Composer props

删除或停止使用模糊的 `recommendationLocked`、`recommendationTaskLocked`。建议显式传递：

```ts
recommendationEnabled?: boolean
recommendationExiting?: boolean
actionsBlocked: boolean
```

这里 Composer 的 `recommendationEnabled` 是当前输入生效状态，page 必须传 `recommendationActive()`，不能传原始持久偏好。也可将该 prop 一并重命名为 recommendationActive，避免同名歧义。hook 的 mode.enabled 仍读取原始偏好，两者不可混用。

其中 `actionsBlocked` 是任务提交保护，不包含 enabled/armed。能力和风格模型按钮按真实 busy 决定；模板按钮按 `isBusy() || props.recommendationEnabled` 决定。推荐块、placeholder、发送 tooltip、@入口、正文过滤等所有展示判断都用该生效 prop；后台真实任务的停止/恢复仍依据任务状态，不因 active=false 丢失。

```tsx
<ToolButton
  label={capabilityLabel(props.capability)}
  disabled={isBusy()}
/>

<ToolButton
  label={styleModelLabel(props.styleModel)}
  disabled={isBusy()}
/>

<ToolButton
  label="风格模板"
  disabled={isBusy() || props.recommendationEnabled}
/>
```

菜单渲染、工具栏折叠后的“更多”菜单、SelectedTemplateButton、模板描述编辑入口也要同步处理，不能只改主按钮。

@ 继续复用现有 `showMentionEntry`、`mentionUnavailableReason`、`stripComposerMentions` 和序列化过滤。当前图片推荐生效时已有引用芯片转普通正文；禁止芯片插入，不禁止普通 @ 字符。推荐标记与占位文案不得进入实际 prompt。

图片推荐生效时只隐藏/挂起当前模板，禁止模板继续限制正文编辑和参考图上传；用户关闭推荐后按既有 owner 与模板状态恢复，不能在切换模型/能力时意外复活旧模板覆盖新草稿。图片任务重新编辑则以目标历史任务的模板信息为准。

### 5.2 素材路由按当前能力处理

| 输入位置 | 目标数据 | 实际处理 |
| --- | --- | --- |
| 图片能力的参考图按钮、正文粘贴/拖入、对话图片加入输入 | `assets()` | active 时参与扩写，否则参与普通图片生成 |
| 视频能力下的正文粘贴/拖入、首帧/尾帧按钮和拖放槽 | `videoFrames.first/last` | 参与视频生成，不受已保存图片推荐偏好影响 |
| 右侧编辑器上传的源图、蒙版、合成图 | workspace/source/composite 等原数据 | 只参与对应编辑任务 |

图片参考图区域继续按 `isImageGeneration()` 显示，视频只显示原有首尾帧区域，编辑能力沿用编辑素材区。不能使用原始 `recommendationEnabled || isImageGeneration()` 在视频/编辑能力下额外显示扩写素材区。

素材路由保留当前能力判断；图片推荐只决定图片素材的扩写校验，不覆盖视频路由：

```ts
function handleDropFiles(files: File[], slot?: StudioVideoFrameSlot) {
  if (slot) {
    addVideoFrame(slot, files)
    return
  }
  if (capability() === "video.generate") {
    addVideoFrame(nextVideoFrameSlot(), files)
    return
  }
  addAssets(files)
}
```

同步核查 `handlePasteReferenceImage`、`handleDropImageUrl`、`useConversationInputImage`、`canDropImages`、`handlePaste` 和 reference slot 的条件。编辑能力正文是否允许图片沿用原规则，不因隐藏推荐偏好新增上传入口。URL 解码/下载等异步过程必须快照操作目标和会话，不能 await 后按变化了的 capability 把图片写入另一个目标。

`addAssets()`、`addReferenceAsset()` 当前使用 imageTool 对应的扩展名/大小规则。仅 `recommendationActive()` 时使用扩写协议已有的 PNG/JPEG/WebP、单张 10MiB、总量 20MiB、最多 3 张规则；普通图片及视频分别沿用其上传校验。`effectiveMaxReferenceImages()` 的推荐分支也改用 active，不能让隐藏的推荐偏好影响其他能力。实际字节大小、格式嗅探及服务端检查仍保留。

### 5.3 发送与提示文案

`handleSubmit()` 先判断当前图片推荐是否生效；只有持久偏好和图片能力同时满足才扩写：

```ts
if (recommendationActive()) {
  // 快照正文和扩写参考图，沿用格式/大小校验与受理后条件清空。
  // 不提交 capability、videoFrames、视频时长或视频清晰度。
  void recommendation.expand(submission, clearAcceptedDraft)
  return
}

// 当前推荐不生效时，按实际能力进入普通图片、视频或编辑入口。
// 即使 recommendationEnabled() 为 true，视频仍走视频生成。
```

`canSubmit()` 同样按 active 分支。图片推荐生效时校验扩写正文/素材；视频能力下沿用视频权限、首尾帧和正文校验，不能因隐藏推荐偏好跳过这些条件；编辑能力沿用对应工作区发送策略。

当前图片推荐生效时：

- 发送 tooltip/aria-label 表达“图片提示词扩写”；按钮可继续用简短“扩写”。
- 推荐占位文案使用“描述你想生成的图片”。
- 切到视频后，推荐块及扩写占位/tooltip 隐藏，恢复视频原有文案与生成发送；不必手动点 ×。
- 切到编辑能力后，推荐块隐藏，恢复该编辑能力的正常提示与操作。
- 切回图片后，按保留的 enabled 偏好恢复推荐块及扩写发送；不自动切回图片，也不把偏好清零。

## 6. 扩写确认固定使用图片生成参数

`expansionGenerationInput()` 现有 `capability: "image.generate"` 保持不变。当前选择视频或编辑能力时，确认扩写也不修改 capability 选择记录。

`generateFromExpansion()` 在提交前快照图片模型和 `recommendationSettings.image()`；不调用 `setCapability("image.generate")` 来达成生成。

```ts
const settings = recommendationSettings.image()
const model = styleModel()

await runGeneration({
  ...expansionGenerationInput(turn, text, settings),
  styleModel: model,
  detailTitle: buildStudioDisplayPrompt(text),
  inputPolicy: "preserve",
})
```

`inputPolicy` 是第 7 节新增的前端选项，不进入 HTTP payload。

为避免 `runGeneration()` 中 `overrides?.width ?? customWidth()` 等默认值从当前能力泄漏，扩写输入要明确给出图片尺寸边界：

```ts
// 放入 expansionGenerationInput 的 settings 分支。
...(settings ? {
  aspectRatio: settings.aspectRatio,
  count: settings.count,
  width: settings.isCustom ? settings.customWidth : 0,
  height: settings.isCustom ? settings.customHeight : 0,
} : {}),
```

实施时保留宽高必须同时大于 0 的自定义尺寸校验；不能只按 isCustom 接受非法值。

图片参数保存需满足：

- 进入推荐时即准备可用图片参数快照，不要求当前已经选图片能力。
- 从图片切到视频时，视频比例/张数写回视频状态，不能覆盖保存的图片参数。
- 图片参数存储现有 `current()/set()` 路由仍按实际 capability 决定；`image()` 始终能读取独立图片快照。
- Seedream 权限和模型参考图数量在真正生成时校验；切换风格模型本身不把推荐参考图按生成上限截断。

## 7. 快捷任务与输入草稿解耦

### 7.1 两种重新生成都不退出推荐

- `regenerateCurrentResult()` 继续使用 `restoreGenerationInput(current)`。
- `rebootStudioGeneration()` 继续调用 `/studio/generations/:id/reboot`。
- `refreshStudioGeneration()` 继续调用 refresh。
- 不先调用 recommendation.exit/dismiss，不增加 enabled/armed 判断，不改用户选择的能力和模型。

`restoreGenerationInput()` 恢复的是目标历史任务的实际生成参数：原模型、有效 prompt、参考图、@映射、模板 extra、视频首尾帧/参数、编辑源图等。不能因为当前输入禁用模板/@就清理历史请求中的对应信息。

保留 `studioRegenerationExtra()` 的来源清理行为：再次生成不应继续伪装为扩写结果的首次确认，但原模板/引用参数不能被连带删除。

### 7.2 给 runGeneration 增加前端输入处理选项

`StudioGenerationOverrides` 新增：

```ts
inputPolicy?: "consume" | "preserve"
```

在函数入口计算：

```ts
const consumesInput = overrides?.inputPolicy
  ? overrides.inputPolicy === "consume"
  : !overrides?.useRestoredInputs
```

然后将清空 prompt/assets、失败恢复 prompt/assets、清理输入引用快照、成功清空视频首尾帧等副作用按实际消费对象执行。`preserve` 下不清空、不恢复、不覆写当前输入草稿。

四类编辑提交都显式使用 preserve：

```ts
void runGeneration({
  capability: "image.upscale",
  sourceImage: sourceUrl,
  aspectRatio: sourceAspectRatio,
  prompt: "将当前图片变清晰，提升分辨率和细节",
  extra: { mode: input.mode },
  inputPolicy: "preserve",
})
```

`submitCutout/submitInpaint/submitOutpaint` 同样处理。源图处理失败或请求失败不能把提交前的左侧草稿重新写回来，覆盖用户刚编辑的内容。

画布再次生成与扩写确认已使用 `useRestoredInputs`，仍建议显式 preserve 表达来源；`useRestoredInputs` 继续负责是否读取当前素材，不能用 inputPolicy 替代。

该选项只控制前端草稿副作用，不能用来绕过权限、真实 busy、后端 guard 或取消逻辑，也不序列化到 API 请求。

### 7.3 异步动作版本

在 page 内使用一个 createStore 保存草稿动作版本，配合会话访问身份；开始重新编辑、用户修改草稿、切换能力/模型、切换会话等会使旧异步动作失效。不要只比较 sessionID 字符串，避免 A→B→A 后旧请求写入。

```ts
const [draftAction, setDraftAction] = createStore({ revision: 0 })
const draftVisit = createMemo(() => ({ key: recommendationKey() }))

function beginDraftAction() {
  setDraftAction("revision", (value) => value + 1)
  const revision = draftAction.revision
  const visit = draftVisit()
  return () => draftVisit() === visit && draftAction.revision === revision
}
```

生产接入需要把用户正文、附件、能力/模型变更及手动开启/关闭推荐连到 revision 失效逻辑。动作自身的 batch 回填及图片重新编辑发起的内部退出不能按“用户修改”再次使自己失效；区分用户事件入口和内部 setter。每个 await 和 queueMicrotask 之后、写入素材或引用前检查有效性。

保留 `expansionReview.capture()` 的 review 版本校验，避免用户已经确认/忽略或开始新任务后，旧回填继续写入。不要机械删除原有 capture 防护。

## 8. 结果卡片重新编辑

### 8.1 图片任务：退出后按历史任务完整回填

顺序固定为：

1. 校验目标 capability、当前动作占用、目标模型权限。
2. 快照目标任务并创建第 7.3 节动作令牌。
3. 仅图片任务请求 recommendation.exit()。
4. 确认模式已关闭、迟到准备已协调、无 unknown/退出待确认；确认动作令牌仍有效。
5. 有 templateID 时走模板恢复分支；没有时恢复普通图片输入。
6. 切换图片 capability、恢复模型和参数，再恢复正文、参考图与 @ 芯片。

退出失败时保留当前输入，不执行部分回填，显示现有“退出推荐尚未确认”提示并允许重试。不能把已关闭的本地 enabled 当作清理已完成。

当前 `exit()` 在 pending/preparing 时可能提前返回，因此实现时要明确一个 awaitable 的退出完成接口。例如在 recommendation hook 内新增 `exitForDraftRestore()`，复用原 exit、pending/recover 和晚到 guide 的协调逻辑，满足：

- 若本轮只有空闲 armed，完成 dismiss 并同步本地状态后 resolve。
- 若旧准备尚未完成，作废其版本，等其受理结果被核实及迟到 guide 处理完成后 resolve。
- 未确认请求不能靠固定 sleep、无限轮询或直接清空 pending 来放行。
- 按同一会话合并重复退出；真正失败则 reject，不伪装成功。
- 已受理 running/cancelling 不被自动取消；当前页面沿用真实 busy 阻止冲突重新编辑。
- 手动点击 × 仍可以先立即移除标记，再异步协调；不要求 UI 等待才关闭标记。

```ts
// editGenerationDraft 中的顺序示意。
const draft = restoreGenerationEditDraft(result)
if (!canEditGenerationDraft(draft)) return
const valid = beginDraftAction()

if (draft.capability === "image.generate") {
  await recommendation.exitForDraftRestore()
  if (!valid()) return
  // 此后再开始模板查找、参考图恢复和 @ 回填。
}

// 视频分支直接恢复，不调用 exitForDraftRestore/exit/dismiss。
```

不得直接把目前 `recommendationMode.capture()` 放在 exit 前再沿用“模式必须关闭”的旧实现；它会让后面的素材恢复失败。

### 8.2 视频任务：保留推荐，恢复视频输入

`editGenerationDraft()` 视频分支：

- 不调用 exit，不修改 enabled。
- 恢复 video capability、原始 prompt、比例/张数、时长/清晰度和首尾帧。
- 视频素材仍只写 videoFrames，不作为扩写参考图自动提交。
- 图片参考图不参与视频任务；现有草稿切换/清理策略照常，不能仅因保留 enabled 就把图片素材放进视频输入。
- active=false，推荐块隐藏，显示和提交均为视频生成；用户不需要先关闭图片推荐偏好。
- 之后切回图片时 enabled 仍为原值，为 true 则恢复推荐块和扩写行为。

`restoreGenerationEditDraft()` 的正文优先级继续保留：`detailPrompt` → 输入快照 prompt → 旧展示字段；不能改用再次生成的 effective/refined prompt 替代用户原始输入。

## 9. 后端 armed 放行与并发边界

### 9.1 仅修改统一 guard 的占用定义

```ts
export function assertCanGenerate(sessionID: string) {
  const busy = Database.use((db) =>
    db.select().from(PartTable)
      .where(eq(PartTable.session_id, SessionID.make(sessionID)))
      .all(),
  ).some((row) => {
    const part = row.data as Omit<MessageV2.TextPart, "id" | "messageID" | "sessionID">
    if (part.type !== "text") return false
    const result = resultSchema.safeParse(part.metadata?.studioPromptExpansion)
    return result.success && (result.data.status === "running" || result.data.status === "cancelling")
  })
  if (busy) throw new RecommendationError("SESSION_BUSY", 409)
}
```

删除本文件不再使用的 guideSchema import。armed 记录不删除、不消费、不自动 dismiss；生成完成后它仍可用于下一次图片扩写。

不增加 `ignoreRecommendation`、`force` 或按 capability 例外放行的请求参数。新语义对所有调用 assertCanGenerate 的入口一致生效。

### 9.2 保留真实任务并发保护

- `withStudioSubmission()` 继续保护生成、reboot、refresh 和编辑入口提交。
- `submitExpansion()` 继续检查 submissions.sessions、guide 状态和 `assertNoGeneration()`。
- 素材读取和模型选择之后，受理事务中的同样检查必须保留。
- 如果生成先受理，创建/排队/运行等状态会让后续扩写按原规则拒绝；如果扩写先进入 running，生成 guard 继续返回 409。
- 允许 armed 与生成记录共存，不意味着允许两个实际任务无条件并行。
- 多页签请求竞争必须由后端决定，不能只依赖页面 disabled。

`assertNoGeneration()` 对 abnormal 的现有定义暂不扩大修改；异常任务允许按原入口 refresh/reboot。不要把本次模式修复变成生成状态机重构。

### 9.3 HTTP 契约

两套路由都复用同一服务，因此优先在共享 guard 修复。原始请求/响应 schema 不变，真实 SESSION_BUSY 仍返回原 409 body，不能删掉声明的错误类型。

需要在 legacy Hono 和 Effect HttpApi 各验证：

- armed + 创建编辑入口能正常成功；
- armed + 创建生成能通过推荐占用检查并正常受理；
- armed + 合法 failed 任务 reboot / abnormal 任务 refresh 不被推荐 guard 拦截；
- running/cancelling + 冲突生成仍得到相同 409。

无 API schema 改动时不需要 SDK 生成。实施中如果确实改动公开 schema，先同步两套声明，再按仓库要求运行 `./packages/sdk/js/script/build.ts`。

## 10. 测试与验收

### 10.1 自动化用例

| 场景 | 必须断言 |
| --- | --- |
| enabled=true，图片能力，armed，未发送 | active=true；推荐块显示；capability/style 可选；模板/@不可选；无真实 busy |
| enabled=true，切到视频，再切回图片 | enabled 始终为 true；视频 active=false 且隐藏推荐块；返回图片 active=true 并恢复扩写；参数不串用 |
| enabled=true，视频能力下发送 | 发 generations 且 capability=video.generate；不发 prompt-expansions；使用视频正文/首尾帧/参数 |
| enabled=true，视频仅有尾帧或无有效输入 | 正常视频校验生效，不能误套扩写校验放行 |
| enabled=true，编辑能力 | 隐藏推荐块；输入区和编辑器按该能力原有规则工作；不误发图片扩写 |
| 图片推荐生效时正文粘贴/拖图 | 进入扩写 assets；切到视频后粘贴/拖图进入 videoFrames |
| 风格模型切换 | 不退出推荐，不按模型上限裁掉扩写图片；真实生成前校验模型限制 |
| 模式开启时再次生成历史模板/@任务 | 原任务素材、模型、有效 prompt 和模板参数保持，当前输入不被清空 |
| 模式开启时点击变清晰等 | 打开正确编辑器，capability 不被 effect 改回 image.generate |
| 编辑器成功/失败 | 对应任务正常执行；左侧推荐正文和素材不被清空或失败回滚覆盖 |
| 视频能力下确认/忽略历史扩写结果 | 独立结果动作新建 image.generate，使用图片参数；enabled 与视频能力保留；视频输入区仍无推荐块，发送仍是视频生成 |
| 扩写完成后只切换图片/视频或风格模型 | 未确认 review 仍可确认；真正插入后续对话轮次时才沿用历史顺序失效规则 |
| 图片普通任务重新编辑 | 退出完成后完整回填原输入，引用芯片可恢复 |
| 图片模板任务重新编辑 | 同上，恢复目标模板、recipe 字段和参考图，不受原模板 owner 残留影响 |
| 视频任务重新编辑 | enabled 保留、active=false、推荐块隐藏；恢复视频输入并可直接发送视频任务；切回图片恢复推荐 |
| 重新编辑期间切会话、再次编辑或用户改草稿 | 旧异步素材、模板和 @ 回填不覆盖新操作 |
| 退出失败或响应丢失 | 不半恢复草稿；保留 pending 幂等恢复；重试后能完成 |
| armed 后 create/reboot/refresh/editor-entry | 不因 armed 报 SESSION_BUSY；检查实际服务结果，不只断言 status != 409 |
| running/cancelling 与冲突提交 | 仍保持原 409；两套 HTTP 栈一致 |
| 生成与扩写并发准备 | 受理事务二次检查有效，不出现两个不允许并行的已受理任务 |
| 停止扩写/重复发送/断线恢复 | 原 requestID、取消意图、幂等和标记持久化保持 |
| 空态/对话态与窄窗口 | 两处 Composer 和折叠菜单行为一致 |

后端测试优先使用真实临时数据库和已有 Effect fixture；涉及第三方图像服务的断言在现有受控服务边界完成，不调用真实收费任务。不能只修改旧断言让测试变绿。

旧用例调整：

- `persistent mode locks capability choices but completed results may generate` 改为“推荐保持、能力可选、任务占用独立”。
- “推荐 A 始终保持 image”改为会话选择隔离，不再期待 enabled 强制图片。
- `dismissing an unused guide releases generation and is idempotent` 不再断言 armed 时禁止生成；仍验证 dismiss 幂等、revision 变化、dismiss 后旧 guide 无法提交。
- 其他断言 `assertCanGenerate` 抛错的用例逐项确认是否真有 running/cancelling，不能批量反转。

### 10.2 执行命令

前端，从 `packages/app` 执行：

```sh
bun test --conditions=browser --preload ./happydom.ts ./octoapp/pages/studio/studio-recommendation-mode.test.ts ./octoapp/pages/studio/studio-prompt-recommendation.test.ts ./octoapp/pages/studio/studio-recommendation-settings.test.ts ./octoapp/pages/studio/studio-recommendation-input.test.ts ./octoapp/pages/studio/studio-prompt-expansion-review.test.ts ./octoapp/pages/studio/studio-recommendation-actions.test.tsx
bun typecheck
```

必须带 browser 条件，避免 Solid server 导出不执行 effect 导致测试环境假失败。默认 `test:unit` 仅扫描 `src`，不能假定覆盖 octoapp 的这些文件。

后端，从 `packages/opencode` 执行：

```sh
bun run test ./test/studio/prompt-recommendation.test.ts ./test/studio/studio-generation-service.test.ts ./test/server/httpapi-bridge.test.ts
bun typecheck
```

前后端检查可独立并行。不得从仓库根目录跑测试，不直接调用 tsc，不重启现有应用或服务器。

### 10.3 页面验收顺序

1. 打开有成功图片、失败图片及视频任务的 Studio 会话，进入推荐但不发送。
2. 验证能力/风格模型可切换，模板/@禁用；检查普通菜单与折叠菜单。
3. 点击画布再次生成、失败卡片重新生成、异常卡片刷新，确认不再因 armed 报错。
4. 分别打开并提交四种编辑任务，检查当前扩写草稿未变化。
5. 图片推荐偏好保持开启，切换视频；确认推荐块隐藏、视频素材入口正常，输入并发送，检查请求为视频生成且不是图片扩写。
6. 视频任务结束后切回图片；确认推荐块和扩写发送恢复。另验证保留的历史扩写 review 如仍可确认，在视频能力下点击其确认仍按图片参数生成；这是结果卡片独立操作，不改变视频输入区的正常发送语义。
7. 分别重新编辑普通图片、模板图片和视频任务，核对退出例外与原输入恢复。
8. 最后验证关闭、停止、刷新页面、切会话返回、请求失败恢复，检查用户意图与草稿未被迟到响应覆盖。

## 11. 实施顺序与完成标准

建议按以下顺序提交实现，减少共享状态一半新一半旧的时间：

1. 修改后端统一 guard，补 armed 放行和真实占用测试。
2. 重构 recommendation-mode 的能力与限制定义，完成 page 调用点替换。
3. 同步两处 Composer，展示/发送/模板/@限制统一使用 active；保持视频/编辑能力正常素材展示与路由。
4. 补齐图片参数快照与扩写确认的显式参数。
5. 快捷任务增加输入保护；实现图片重新编辑的退出完成协调与所有回填的动作令牌。
6. 更新旧预期和 HTTP parity 覆盖，执行定向测试与包级类型检查。
7. 按页面矩阵验收，标记旧方案被替代的约定。

完成标准：推荐偏好不再被能力切换或快捷操作清除；它只在图片能力下显示标记并接管发送。视频/编辑能力下隐藏推荐块，走自身正常任务；切回图片恢复偏好。空闲 armed 不阻止合法操作，真实任务互斥与恢复逻辑保持；图片重新编辑按约定关闭偏好，视频重新编辑保留偏好且可直接发送视频任务。扩写永远只生成图片，模板/@限制只作用于当前图片推荐输入而不破坏历史任务。

## 12. 本方案产出时的验证范围

- 已对照当前工作区的模式 helper、Composer、page 动作入口、生成服务、推荐提交事务及两套路由检查方案所列调用点。
- 前一轮分析已用 browser 条件执行现有 recommendation-mode 与 prompt-recommendation 两个前端测试文件：40 项通过。这些是旧行为基线，不代表本方案已实施。
- 上述为方案初次产出时的基线；后续编码与验证结果见第 13 节。

## 13. 编码实施记录

### 13.1 已落实

- `createRecommendationMode()` 区分已保存 enabled 与当前 active，不再强制图片能力。所有输入发送和展示分支使用 active，视频/编辑能力保留偏好但不执行扩写。
- 能力与模型选择解除推荐锁；模板/@只在当前图片推荐生效时限制。模板 owner 保留，不用清空 owner 来隐藏模板。
- 空闲 armed 不再阻止 create/reboot/refresh/editor-entry 共用的后端 guard；running/cancelling 及提交互斥保留。
- 画布快捷编辑正常进入对应工作区，独立生成增加 inputPolicy=preserve；源图预处理后核对会话/草稿，避免迟到动作误提交。
- 图片重新编辑执行 exitForDraftRestore，退出确认成功后恢复历史输入与模板/@；视频重新编辑不修改 enabled，并恢复视频输入与发送。
- 回填使用会话、草稿快照和动作版本校验；素材上传同样快照当前能力与 active，不能完成后改写另一个能力的素材。
- 推荐上传按扩写协议校验 PNG/JPEG/WebP、3 张、10MiB/20MiB；视频仍按视频上传和首尾帧规则处理。
- 扩写结果确认保留图片参数快照，自定义尺寸关闭时显式传 0，避免回落到当前视频或编辑尺寸。

`exitForDraftRestore` 的具体实现先拒绝 pending/preparing/recovering 或真实运行任务；页面本身也先按 taskBlocked 限制该入口。因此本次未增加等待正在执行的准备任务的队列或轮询。对空闲 armed 执行并等待 dismiss，对未知清理结果保留恢复状态并拒绝回填，不把 enabled=false 当作退出已确认。

`studio-recommendation-settings.ts`、输入原子节点和两套 HTTP 路由继续复用现有实现；通过调用方与统一 guard 修正行为，无需改变公开 schema、SDK 或数据库。

### 13.2 验证结果

- 前端首次 7 个定向文件为 86 项通过；review 修复新增草稿回填用例后的结果见第 13.3 节。
- 后端推荐/生成服务：15 项通过，覆盖 armed 下四类编辑入口实际保存、幂等及 running/cancelling 的真实占用保护。
- `packages/app` 与 `packages/opencode` 的 `bun typecheck` 均通过。
- Studio 两套 HTTP 栈初始化/重放/校验/armed 编辑入口回归通过；完整 `httpapi-bridge.test.ts` 为 19 项通过、2 项失败。
- 这两项失败来自路由契约比较：Effect 多出的 `/workspace-upgrade/preview`、`/workspace-upgrade/run`，以及 portable-share 的 `scope` schema 在两栈分别输出 const/enum。本次未修改这些接口及断言，未将全量路由检查记为通过。
- HTTP 测试在沙箱内受 macOS FSEvents 限制，获准在沙箱外重跑后，文件监听相关失败消失。
- `git diff --check` 通过；未调用真实第三方图像/视频生成，未重启现有应用或服务器。

### 13.3 Review 后的异步回填修复

- 普通图片和视频重新编辑改为先读取目标素材，再校验当前会话、草稿和动作版本，最后通过一次 batch 同时更新正文、参数和素材。读取期间保持原有完整草稿，不再提前写入目标正文并留下旧素材。
- 读取期间用户修改正文、换帧或开始其他动作时，整次迟到回填失效，保留用户当前输入，不提交半套目标草稿。
- `createStudioDraftCapture()` 对首尾帧读取 id/dataUrl 原始字段，不再只记录 Store 对象引用；替换同一槽位或只更新原对象的内容都能使旧快照失效。
- @ 回填在批量更新完成、Solid 响应已刷新后执行。模板重新编辑沿用原有先准备素材的路径，并复用修正后的草稿快照。
- 新增 10 项回归，覆盖图片/视频的整批回填、等待期间正文修改、首帧/尾帧原地替换、相同 id 内容变化、A→B→A 会话访问、动作版本及批量更新后的 DOM 操作。
- 包含新增用例在内的前端 8 个定向文件共 96 项通过；app 包 `bun typecheck` 与 `git diff --check` 通过。本轮只修改前端回填逻辑，未重复运行后端及 HTTP 契约检查。
