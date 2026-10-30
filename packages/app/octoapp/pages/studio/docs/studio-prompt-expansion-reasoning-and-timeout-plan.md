# Studio AI 推荐扩写：思考过程展示修改方案

> 更新日期：2026-10-27。本文为实现方案；下方“实施记录”记录当前编码与验证结果。
> 最终选择：Studio 独立创建轻量展示组件，复用现有 reasoning 协议、消息存储与同步能力，以及 Insight 执行中的思考样式和公共 Markdown。
> “思考过程”指模型接口实际公开返回的 reasoning 内容或摘要，不保证包含完整内部思维链。

## 1. 目标及最终范围

思考过程仅作为“正在丰富提示词”阶段的临时反馈，用于缓解用户对界面卡住的感受，视觉样式与 Insight 执行中的思考区域一致。最终扩写结果就绪后立即移除整个思考区域，只展示现有标签、可编辑正文和确认/忽略按钮。不提供折叠入口、用时或历史思考查看。没有 reasoning 的模型保留当前等待提示。

展示开关以本轮推荐结果 status=running 为准，而不是单个 reasoning-end 事件。reasoning 已结束但最终正文仍在生成或校验时，保留当前内容，避免等待区突然空白。进入 cancelling、completed、failed 或 cancelled 后均隐藏思考区域，使用原有取消、结果或错误视图。

本次只修改 Studio 文件，不修改公共 Provider、Config、LLM、Session、UI、SDK 或 Insight。不接入整个 SessionTurn，不通过伪造消息上下文复用公共 reasoning 渲染器。

超时沿用公共 Provider 的既有机制，以及 Studio 已有的 30 秒准备超时和 120 秒有效输出空闲保护。展示 reasoning 不要求更换超时体系；本次不调整这些数值，也不新增单次调用总时限或网络重试。

保留现有选模、参考图读取、JSON 输出校验、一次结构修复、推荐机会消费、取消、生图和扩写结果编辑逻辑。

## 2. 为什么采用 Studio 独立组件

### 2.1 现有实现的断点

- `src/studio/prompt-expansion.ts` 已接收 reasoning-delta，但只用来统计字节及重置空闲计时，没有保存或展示。
- `prompt-recommendation.ts` 已创建真实 assistant 消息，适合直接关联现有 ReasoningPart。
- Studio 前端已经订阅 message.part.updated 和 message.part.delta。
- `turns.ts` 没有向展示层传递 reasoning；`studio-conversation.tsx` 的扩写执行中分支只显示固定文案。

### 2.2 直接复用公共消息组件的成本

Insight 经 SessionTurn → Part → ReasoningPartDisplay 展示思考。ReasoningPartDisplay 没有单独导出，依赖 DataProvider、完整 assistant message 和兄弟 parts；其流状态、无正文自动展开、标题及用时规则均与通用消息绑定。

Studio 已经使用 StudioTurnData 和推荐结果状态。为一个思考展示块重新接入整套消息上下文会增加数据传递和行为耦合；没有必要。

因此独立实现很少量的运行中条件渲染，公共基础能力继续复用：

| 能力 | 处理方式 |
| --- | --- |
| 模型 reasoning 事件 | 消费既有 LLM.Event |
| 数据类型及保存 | 既有 MessageV2.ReasoningPart、Session 消息服务 |
| 实时同步 | 既有 PartUpdated、PartDelta |
| 临时展示容器及显示条件 | Studio 新组件，无折叠状态 |
| Markdown 解析、安全处理 | 公共 Markdown |
| 字号、颜色、竖线、缩进 | 使用现有 reasoning-part 流式样式标记 |
| 少量 Insight 父容器专属覆盖 | Studio 自己的局部 CSS |

公共组件内部的 PacedMarkdown 未导出。本次不复制其逐字播放算法；通过 Markdown 的 streaming 属性随事件更新内容。仅对齐 Insight 运行中的视觉样式，不复用完成后的折叠交互，不承诺逐字动画节奏完全相同。

## 3. 文件修改清单

路径相对仓库根目录。仅允许写入 `packages/opencode/src/studio/`、`packages/opencode/test/studio/` 和 `packages/app/octoapp/pages/studio/`。

| 文件 | 具体修改 |
| --- | --- |
| `packages/opencode/src/studio/prompt-expansion.ts` | 在既有流消费中接入 Effect 型 reasoning 回调；每次调用结束时关闭本次思考段；保留原计时及解析逻辑 |
| `packages/opencode/src/studio/prompt-expansion-reasoning.ts`（新增） | 少量 Studio 消息适配：按供应商事件 ID 管理 ReasoningPart，复用 SyncEvent 保存及 Bus 增量事件，幂等结束当前段 |
| `packages/opencode/src/studio/prompt-recommendation.ts` | 为本轮 assistant 创建 reasoning 适配器并传入扩写；终态前关闭思考段；恢复中断任务时结束遗留段 |
| `packages/app/octoapp/pages/studio/turns.ts` | 仅为 status=running 的推荐 result turn 提取 reasoning parts，不增加 assistant 起止时间 |
| `packages/app/octoapp/pages/studio/studio-prompt-expansion-reasoning.tsx`（新增） | 独立临时展示组件：仅 running 且有内容时渲染，离开 running 立即卸载 |
| `packages/app/octoapp/pages/studio/studio-conversation.tsx` | 在原 running 等待分支接入思考展示；completed 直接切到结果编辑区；保留原错误和取消文案 |
| `packages/app/octoapp/pages/studio/studio-prompt-state.ts` | 为 Studio reasoning 增加明确的元数据识别和快照合并规则，不改原推荐 text revision 规则 |
| `packages/app/octoapp/pages/studio/studio-session-data.ts` | 已结束 reasoning 忽略迟到 delta；运行快照与终态全量合并；保留删除和会话隔离保护 |
| `packages/app/octoapp/pages/studio/studio-08.css` | 只补 Studio 局部的行内代码颜色、分隔线间距等覆盖 |
| Studio 对应测试 | 覆盖事件转接、终态保存、组件状态、快照合并及现有流程回归 |

不修改 `studio-page.tsx`，不需要它向组件额外传入 DataProvider 或整个 store。展示数据经 turns.ts 现有路径下传。

不新增 prompt-expansion-policy.ts，不修改推荐结果 schema、公共路由、日志模块或 SDK。原文档中的进度阶段、重试预算、deadline 和心跳方案全部移出本次实现。

## 4. 后端：接通 reasoning 事件

### 4.1 复用现有数据类型

每段 reasoning 使用独立 PartID，关联本次 assistant 消息。供应商事件 ID 只作为一次模型调用内的映射键，不用作数据库主键。

```ts
const value = {
  id: PartID.ascending(),
  sessionID: assistant.sessionID,
  messageID: assistant.id,
  type: "reasoning" as const,
  text: "",
  time: { start: Date.now() },
  metadata: { studioPromptExpansionReasoning: { version: 1 } },
} satisfies MessageV2.ReasoningPart
```

只增加一个 Studio 标记用于筛选，不新增业务状态、progress 字段、revision 协议或前端尝试分组。原始 providerMetadata 不作为本次展示所需数据保存；本流程也不把历史 reasoning 回传给模型。

### 4.2 回调使用 Effect，避免后台异步 writer

新增类型放在 Studio 扩写文件内，签名如下；错误必须通过 Effect 返回主执行链。

```ts
type ReasoningEvent = Extract<LLM.Event, {
  type: "reasoning-start" | "reasoning-delta" | "reasoning-end"
}>

export type ExpansionReasoning = {
  event: (event: ReasoningEvent) => Effect.Effect<void, unknown>
  end: () => Effect.Effect<void, unknown>
}
```

`readExpansionStream()` 增加可选 reasoning 适配参数。expandPrompt() 在现有 services 参数之后增加该可选参数，旧调用及未传参数的测试保持兼容。

在 Stream.runForEach 内顺序处理，不启动独立 timer、后台 Promise 或 fiber 来写消息：

```ts
if (event.type === "reasoning-start" ||
    event.type === "reasoning-delta" ||
    event.type === "reasoning-end") {
  return reasoning?.event(event) ?? Effect.void
}
```

该片段只表示事件转接，实施时必须放在现有校验、有效输出计时和字节统计之后，不能通过提前 return 绕开 reasoning-delta 的进度重置与长度上限。

正文仍仅由 text-delta 构建；reasoning 不进入 JSON 缓冲。保持 system 的“只输出 JSON”约束，不要求模型在正文中输出推理。

### 4.3 保存和同步规则

新增 Studio 适配器沿用 prompt-recommendation.ts 已有的 SyncEvent.run 保存方式，并用 Bus.publish 发送现有 PartDelta 事件；与 Session.updatePart/updatePartDelta 使用相同消息协议和存储投影。保存时在同步事务内检查任务状态，避免删除与写入竞争。不新增 Session 运行时，也不建立另一套 Provider/Config/LLM 运行环境。

规则与通用 reasoning 流一致：

1. start：创建内存 part，并经 SyncEvent.run 保存空段。
2. delta：累加内存文本，经 Bus.publish 发布 PartDelta 新增文字，不重复发送全量正文。
3. end：经 SyncEvent.run 保存完整文本、补 time.end，然后移除当前活动映射。
4. 缺 start 的非空 delta：惰性创建 part，再发送 delta，避免丢失供应商返回的内容。
5. 重复 start/end：同一调用内幂等处理；已结束 ID 不重新打开。
6. 每次模型调用的 finally 中执行 end()，保存并结束所有剩余段。JSON 修复开始前已结束上一轮，清空本次调用的 ID 映射，后续可创建新段。

end() 的含义仅为“结束当前调用的段”，不永久禁用适配器。它可重复调用；结构修复调用仍可复用同一个适配器创建全新 PartID。前端按 part 顺序展示，不增加“第几次尝试”标签。

不新增每 100ms 全量持久化、周期检查点或自定义 revision 协议。流式增量用于当前展示，完整内容在段结束及异常收尾时保存。

### 4.4 终态、取消及写入错误

- 每次 LLM 调用结束先保存未关闭的 reasoning，再交给现有 JSON 校验或错误处理。
- 最终 finish() 写扩写结果及 assistant 完成时间之前，保证剩余 reasoning 已关闭。
- 保留现有用户取消信号和单次空闲超时 controller，超时不能被错误标成用户取消。
- 取消中允许保存已收到内容，但不再启动新模型调用；已有 finish() 对 cancelling 的终态收敛逻辑保持不变。
- end() 在流中断后的独立清理 Effect 中执行，不能继续使用已 abort 的调用 signal，否则最后保存也会立即被取消。
- 写入错误进入现有失败处理与诊断；最终释放 runs 记录和执行额度。不得因为保存失败跳过外层资源释放，也不能把任务标记为成功。
- 数据库 guard 与写入放在同一事务边界检查：session/assistant 仍存在、结果仍为 running/cancelling；删除会话后跳过保存，不重新创建消息。
- getRecommendationState() 已会将不存在活动 run 的 running 任务标为中断，在同一路径关闭该 assistant 下带 Studio 标记的未结束 reasoning；不恢复已经消失的内存内容。

## 5. 超时与重试：沿用现有行为

| 能力 | 本次决定 |
| --- | --- |
| Provider 请求超时、chunkTimeout | 沿用既有实现及配置，不修复、不包装、不修改全局配置 |
| Studio 准备超时 | 保留现有 30 秒 |
| Studio 有效输出空闲 | 保留现有 120 秒，正文或 reasoning 非空 delta 均重置 |
| 首个输出等待 | 使用现有同一计时器，不另建一层 |
| Studio 请求总时限 | 不新增 |
| 网络自动重试 | 不新增，llm.stream 的 retries: 0 保持不变 |
| JSON 无效结构修复 | 保留现有一次修复调用 |
| 前端长等待计时、重试倒计时 | 不新增 |

120 秒是连续无有效内容限制，不是整次扩写总时长上限。持续返回 reasoning 的任务可以超过两分钟；展示功能只让这些已有输出可见。

Provider 既有超时仍可能先触发。Studio 继续使用现有错误路径处理，不推断底层网络阶段，不新增“网络 chunk 超时”等错误码。公共模块发现的问题不作为本功能的实施前置条件。

## 6. 前端数据与展示组件

### 6.1 Turn 只增加必要数据

在 StudioTurnData 增加一个可选字段，不改变其他 turn 的必填数据：

```ts
reasoningParts?: Extract<Part, { type: "reasoning" }>[]
```

只在推荐 result 的 status=running 时，从 assistantParts 筛选 type=reasoning 且 Studio 元数据通过校验的 parts，按既有顺序传递。其他状态不向展示层提供 reasoningParts，无需 assistantTime 或 durationMs。

Studio 标记使用小型 Zod schema 验证 version=1。assistantText 仍仅收集 text parts，确认和忽略操作的数据来源不变。

### 6.2 独立组件及关键结构

新增 StudioPromptExpansionReasoning，只接收 parts 和现有扩写 status。组件不读取 DataProvider，不接收 SDK、整个 store、原始 message 或模型配置。不需要本地折叠状态、计时器、按钮或图标。

各 part 单独交给 Markdown，避免不同段落的代码围栏等 Markdown 结构意外拼接。组件自身也检查 running，防止外层条件遗漏时在历史记录中显示。

```tsx
const parts = () => props.parts.filter((part) => part.text.trim())

return (
  <Show when={props.status === "running" && parts().length > 0}>
    <div data-component="reasoning-part" data-streaming>
      <For each={parts()}>
        {(part) => (
          <Markdown
            text={part.text.trim()}
            cacheKey={part.id}
            streaming={part.time.end === undefined}
          />
        )}
      </For>
    </div>
  </Show>
)
```

组件不强制滚动、不新增内部固定高度滚动框，父级继续使用现有对话滚动行为。应用根部已有 MarkedProvider 和 UI 国际化上下文，公共 Markdown 可直接使用；Studio 不使用 innerHTML，也不复制 PacedMarkdown。

在 studio-conversation.tsx 原有 running 分支中，有非空 reasoning 时显示新组件，否则显示“正在丰富提示词…”。取消中保留原“正在取消扩写…”；completed 分支只显示 StudioPromptExpansionReviewView。隐藏与结果展示使用同一个 recommendation.status，不能依赖定时器或动画结束后再移除。

### 6.3 状态对应关系

| 扩写状态 | 思考区域 | 原扩写区域 |
| --- | --- | --- |
| running、无思考内容 | 不渲染 | 保留“正在丰富提示词…” |
| running、有思考内容 | 临时显示，随事件更新 | 隐藏重复的固定等待文案；不展示结果编辑区 |
| running、reasoning 已结束但结果未就绪 | 保留已显示内容 | 继续等待最终扩写结果，不提前显示结果编辑区 |
| cancelling | 隐藏 | 保留“正在取消扩写…” |
| completed | 立即卸载，无折叠入口 | 只显示原标签、编辑框和确认/忽略按钮 |
| failed/cancelled | 隐藏，无历史查看入口 | 保留现有失败/取消文案 |

completed 以最终 JSON 已解析、校验并提交结果为准，不以 reasoning-end 或第一段正文到达为准。结构修复期间状态仍为 running，继续按同一临时反馈规则展示，不新增修复分组。

## 7. 样式：直接复用 Insight 视觉规则

公共 `packages/ui/src/components/message-part.css` 已全局加载。新组件使用 data-component="reasoning-part" 和 data-streaming 即可继承运行中样式，不修改或复制这份文件；不使用折叠标题的 data-slot。

需要对齐的样式已经存在：

- 执行中左侧 1px 竖线及 12px 缩进。
- 思考 Markdown 12px 字号、18px 行高、#777 文字颜色。
- 流式正文的段落和列表规则。

没有完成标题、折叠按钮、箭头或用时区域。

Insight 的少量 Markdown 覆盖依赖 session-turn 父容器。Studio 在 studio-08.css 中补相同视觉值，限定自己的思考区域：

```css
.studio-conversation [data-component="reasoning-part"] [data-component="markdown"] :not(pre) > code {
  color: var(--octo-brand);
}

.studio-conversation [data-component="reasoning-part"] [data-component="markdown"] hr {
  margin: 24px 0;
}
```

不伪造 data-component=session-turn，不引入 Insight 页面样式文件，不修改全局 PART_MAPPING 或注册替代渲染器。

## 8. 刷新、快照与增量的明确边界

### 8.1 恢复保证

采用现有“增量展示、段结束全量保存”的机制，本次保证：

- 已完成、失败或取消的轮次，刷新后不显示思考；只恢复既有结果或错误视图。数据库仍可保存 reasoning part，保存不代表向用户提供历史查看。
- 仅当任务仍为 running 时，刷新恢复已落库的段，当前未结束段从后续增量继续显示；段结束全量保存可补齐内容。如果扩写已完成，则直接隐藏，不等待思考内容补齐。
- 不保证刷新瞬间恢复当前未结束段中全部历史增量。这与仅在段末持久化的机制一致，本次不为此增加检查点、后台 writer 或新传输协议。
- 进程异常退出时未保存的内存内容无法恢复；按原有执行中断逻辑收尾，不能伪造完整思考。

### 8.2 Studio 本地合并规则

同一 part ID 的内容在单段内只追加，段末保存完整终态。mergePromptPart 中对 Studio reasoning 单独处理，不改变原推荐 text 的 revision 逻辑：

1. previous 已有 time.end、next 未结束：保留 previous，拒绝旧运行快照回退。
2. next 已结束：使用完整 next；如果双方都已结束，保留已知较完整的同段文本，不重开段。
3. 双方未结束：同段文本存在前缀关系时保留更完整者，避免数据库空段快照覆盖当前增量。不存在前缀关系时以服务端快照重新建立基线，不拼接冲突文本。
4. 段最终全量保存是权威校正；不能声称前缀比较就提供了通用流事件精确去重。

studio-session-data 的 delta 分支为 Studio reasoning 加入 sessionID 校验、删除标记检查，以及 time.end 已存在时忽略迟到增量，避免终态快照先到后重复追加排队中的 delta。其他模块 part 的行为保持不变。

继续保留既有 loadToken、会话切换、删除保护和新增消息合并逻辑。reasoning 不更新推荐结果 text 的 revision，因此不会因每个 token 触发推荐状态接口刷新。

可见性始终以推荐结果 status 为准：即便数据库或 store 仍有 reasoning，或迟到事件再次更新了 part，只要本轮不是 running，就不能重新挂载思考组件。不为隐藏而删除持久化 part，也不新增历史查询、清理端点或查看入口。

## 9. 修改顺序与验收

### 9.1 实施顺序

1. 后端接入 Effect 型 reasoning 回调和 Studio 消息适配，跑通 start/delta/end 及异常关闭。
2. turns.ts 提取思考数据，补 Studio 本地快照/增量合并规则。
3. 新增独立展示组件并接入 studio-conversation.tsx，使用公共样式和基础组件。
4. 补局部 CSS，回归结果编辑、确认/忽略、取消、结构修复及刷新行为。
5. 检查最终变更路径全部在第 3 节允许范围内。

### 9.2 后端测试

扩展现有 `test/studio/prompt-expansion.test.ts`、`prompt-expansion-integration.test.ts` 和 `prompt-recommendation.test.ts`。新增 `test/studio/prompt-expansion-reasoning.test.ts` 验证消息适配的真实数据库及事件行为。

- start/delta/end、多段、重复事件、缺 start 的 delta、修复调用复用供应商 ID。
- 回调未传时原有扩写测试和输出行为不变。
- reasoning 不进入 JSON 正文，不影响 tags 和确认后的生图输入。
- 既有字节上限及非空 reasoning 重置空闲计时的行为不回归。
- 成功、失败、取消、空闲超时后完整保存已收到内容，time.end 正确，额度只释放一次。
- 最后保存不使用已取消 signal；写入失败能被主流程感知。
- 删除会话后不重建数据；恢复遗留任务时关闭 reasoning 段。
- 没有网络重试或新总时限；一次 JSON 结构修复行为保持不变。

超时相关测试使用已有可控时间手段或仅限 Studio 内部的测试时长注入，不等待真实 120 秒，不为测试新增通用策略模块。

### 9.3 前端测试

扩展 `turns.test.ts`、`studio-prompt-state.test.ts`，新增 `studio-prompt-expansion-reasoning.test.tsx` 和 `studio-session-data.test.ts`。DOM 测试沿用现有 review-view 测试的 Solid 编译方式，并提供公共 Markdown 所需的已有上下文。

- 无 reasoning 时显示等待提示，有内容时实时显示；completed 到来后思考 DOM 立即移除，只留下扩写结果。
- 多段 Markdown 按序显示；reasoning-end 到来但结果仍 running 时保留当前反馈。
- cancelling/failed/cancelled 均隐藏思考，原状态文案不重复，确认按钮仍按原规则展示。
- 旧运行快照不覆盖新内容；终态全量补齐；终态后迟到 delta 不重复追加。
- 刷新恢复满足第 8 节边界；已完成轮次和历史记录不显示思考，迟到 reasoning 事件不能让它重新出现；切换及删除不串会话、不回流。
- 原扩写编辑、确认/忽略及参考图传递不变。
- 实际浏览器中与 Insight 运行中的思考区域对照字体、颜色、竖线和缩进；不显示完成标题、箭头或用时，不将逐字播放节奏作为一致性要求。

### 9.4 执行命令

从所属 package 目录运行，不从仓库根目录运行测试；类型检查使用 bun typecheck。

```sh
# 工作目录：packages/opencode
bun test test/studio/prompt-expansion.test.ts test/studio/prompt-expansion-integration.test.ts test/studio/prompt-recommendation.test.ts test/studio/prompt-expansion-reasoning.test.ts
bun typecheck

# 工作目录：packages/app
bun test --conditions=browser --preload ./happydom.ts ./octoapp/pages/studio/turns.test.ts ./octoapp/pages/studio/studio-prompt-state.test.ts ./octoapp/pages/studio/studio-session-data.test.ts ./octoapp/pages/studio/studio-prompt-expansion-reasoning.test.tsx ./octoapp/pages/studio/studio-prompt-expansion-review-view.test.tsx
bun typecheck
```

新增测试文件已随实现创建。DOM 测试需要 --conditions=browser，以加载 Solid 的浏览器实现。人工验收使用现有运行环境，不重启应用或服务进程。

## 10. 公共接口及数据影响

全部复用既有消息端点、ReasoningPart、PartUpdated 和 PartDelta。唯一新增存储信息是 reasoning part 上的 Studio 识别标记；不新增表、列、结果状态枚举、HTTP schema 或公共配置。

不需要数据库迁移或 SDK 重新生成，不修改公共模块，不将公共 Provider 的已知问题作为本次功能的一部分。

## 11. 实施记录

- 已接通 reasoning 事件、增量展示及段结束保存，补齐 JSON 修复和取消时的清理。
- 思考组件只在 status=running 时挂载；completed/cancelling/failed/cancelled 均隐藏，无完成标题、用时或历史查看入口。
- 未修改公共模块；30 秒准备超时、120 秒空闲保护和网络 retries:0 保持原样。
- 后端专项及集成测试：24 项通过，包含真实本地 SSE 的 reasoning、JSON 修复和取消保存。
- 前端相关测试：46 项通过，包含临时展示、快照合并、迟到事件和原扩写编辑/确认流程。
- packages/opencode 与 packages/app 的 bun typecheck 均通过。
- turns.test.ts 另有 32 项既有失败；以 HEAD 的原始 turns.ts 复测为 23 通过、32 失败，与本次变更后的失败集合一致。未扩大范围修复这些既有问题。
- 未启动或重启应用，未进行真实页面的视觉对照；样式复用现有全局 reasoning-part 规则及两条 Studio 局部覆盖。
