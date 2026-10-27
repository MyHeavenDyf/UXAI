# Studio AI 推荐扩写：仅展示正文流的实现方案

> 日期：2026-10-27。本文为实现方案；正文流预览已按方案编码，验证结果见“实施记录”。
> 基于当前已实现的 reasoning 临时展示，改为所有模型统一展示扩写正文预览，不展示思考内容。
> 本文替代上一份 reasoning 方案中的内容来源与组件设计；修改范围仍限制在 Studio 内。

## 1. 最终行为与范围

用户等待扩写时，逐步看到模型正在生成的 expandedPrompt，避免一直显示静态等待文案。预览只是等待反馈，不是已校验的正式扩写结果，不可编辑、不可确认生成。

| 当前情况 | 页面展示 |
| --- | --- |
| running，只有 reasoning、没有正文 | 正在丰富提示词…；不显示思考内容 |
| running，正文 JSON 尚未到 expandedPrompt 字符串 | 正在丰富提示词… |
| running，已有可提取的 expandedPrompt | 流式展示解码后的扩写正文；隐藏重复等待文案 |
| expandedPrompt 已输出完整，但 tags/流结束/校验尚未完成 | 保留正文预览，继续等待，不提前开放编辑和生成 |
| 原有 JSON 结构修复开始 | 立即清空上一轮预览，新正文到达后重新显示 |
| completed | 立即移除预览，只显示原标签、扩写编辑框、确认/忽略按钮 |
| cancelling、failed、cancelled | 隐藏预览，使用现有状态或错误文案 |

没有折叠入口、历史预览入口、思考展示、用时或重试倒计时。刷新已完成会话也不展示预览。

只修改以下目录：

- `packages/opencode/src/studio/`
- `packages/opencode/test/studio/`
- `packages/app/octoapp/pages/studio/`

不修改公共 Provider、LLM、Session、Config、UI、SDK 或 Insight/Design；不修改 `studio-page.tsx`；不新增网络自动重试、总时限或公共配置。

## 2. 当前实现与调整依据

当前 `prompt-expansion.ts` 同时接收 reasoning-delta 和 text-delta，但仅把 reasoning 转发到临时展示；text-delta 在后端累积成 JSON，完整流结束后才解析并保存正式结果。

模型输出要求为：

```json
{"expandedPrompt":"雨后的城市街道，霓虹灯映照积水。","tags":["场景：城市","天气：雨后","光线：霓虹"]}
```

因此新功能不能直接显示原始 text-delta，否则会显示 JSON 字段名、引号、标签及转义字符。应在后端流式提取顶层 expandedPrompt 的字符串值，仅把正文增量送到前端。

复用当前实现中的消息保存、PartDelta、临时区域和运行状态判断；替换 reasoning 类型与提取逻辑。正式结果 part 和预览 part 必须独立。

## 3. 文件修改清单

| 文件（相对仓库根目录） | 修改内容 |
| --- | --- |
| `packages/opencode/src/studio/prompt-expansion.ts` | ExpansionReasoning 改为 ExpansionPreview 回调；text-delta 接入正文提取；reasoning 仅保留计时与长度统计；每次调用开始/结束管理预览 |
| `packages/opencode/src/studio/prompt-expansion-text.ts`（新增） | 仅供预览使用的顶层 JSON 字符串增量提取器，输出已解码正文增量 |
| `packages/opencode/src/studio/prompt-expansion-reasoning.ts` → `prompt-expansion-preview.ts` | 将现有消息适配器改为独立 TextPart；增加 attempt 及关联结果标记；复用既有 SyncEvent/Bus 保存和同步 |
| `packages/opencode/src/studio/prompt-recommendation.ts` | 替换适配器导入及创建；完成/失败/取消/遗留任务恢复时关闭预览；不改变受理、正式结果和取消状态机 |
| `packages/app/octoapp/pages/studio/studio-prompt-state.ts` | 增加预览标记解析与类型守卫；合并规则适配 text preview；保留旧 reasoning 识别用于历史数据保护 |
| `packages/app/octoapp/pages/studio/studio-session-data.ts` | 对预览应用同会话、删除和段结束后的迟到增量保护；保留原快照加载方式 |
| `packages/app/octoapp/pages/studio/turns.ts` | reasoningParts 改为 previewPart；只取本轮最新 attempt，包含空预览；assistantText 汇总排除预览 |
| `packages/app/octoapp/pages/studio/studio-prompt-expansion-reasoning.tsx` → `studio-prompt-expansion-preview.tsx` | 独立临时正文组件，接收 previewPart/status；无思考分支和折叠状态 |
| `packages/app/octoapp/pages/studio/studio-conversation.tsx` | 使用最新预览替换等待区域；completed 直接切换原结果编辑区 |
| `packages/app/octoapp/pages/studio/studio-08.css` | 沿用当前临时区域的公共视觉规则；按需仅补 Studio 局部样式，不复制公共 CSS |
| 后端 `prompt-expansion.test.ts`、`prompt-expansion-integration.test.ts` | 调整回调测试，增加真实正文流、reasoning 不展示、修复重置和取消覆盖 |
| 后端 `prompt-expansion-reasoning.test.ts` → `prompt-expansion-preview.test.ts` | 改为测试临时 TextPart 的开始、追加、关闭、修复轮和删除保护 |
| 后端 `prompt-expansion-text.test.ts`（新增） | 测试 JSON 分块、字段定位、转义和容错提取 |
| 前端 `studio-prompt-state.test.ts`、`studio-session-data.test.ts` | 覆盖预览识别、正文排除、最新轮选择、合并和迟到事件 |
| 前端 `studio-prompt-expansion-reasoning.test.tsx` → `studio-prompt-expansion-preview.test.tsx` | 正文流临时展示、完成隐藏、修复空轮清空及历史隐藏 |

重命名文件后更新所有引用；旧测试中“保存并展示 reasoning”的断言应替换，不能同时留下两套展示通路。旧 reasoning part 不删除，也不作为正文兜底。

## 4. 预览数据模型

### 4.1 每次调用单独创建预览 TextPart

不能使用 ReasoningPart 承载正文，也不能把未校验内容追加到正式结果 part。新增标记放在既有开放 metadata 中，不修改公共消息协议：

```ts
const part = {
  id: PartID.ascending(),
  sessionID: assistant.sessionID,
  messageID: assistant.id,
  type: "text" as const,
  text: "",
  time: { start: Date.now() },
  metadata: {
    studioPromptExpansionPreview: {
      version: 1,
      attempt, // 首次调用为 1，现有 JSON 结构修复调用为 2
      resultPartID,
    },
  },
} satisfies MessageV2.TextPart
```

一个调用内多个 text-delta/text 流段累积到同一个原始输出缓冲和同一个预览 part，行为与当前 parseExpansion 接收的完整字符串一致。attempt 变化时使用新 PartID 和全新提取器，不复用旧正文。

### 4.2 必须先发布空的新轮预览

每次调用开始前保存空 part；不能等第一个正文字符到达才创建。这样修复调用开始时，前端能够立即识别 attempt=2，并停止展示 attempt=1 的内容。

前端必须先选最新 attempt，再判断 text 是否为空；若先过滤空文本，会继续选中第一轮非空预览，导致“清空”失效。

结束时保存完整预览文本并补 time.end。预览持久化只是复用当前消息机制，不提供完成后的查看入口。不为隐藏而删除消息或修改正式结果 revision。

## 5. 后端正文增量提取

### 5.1 提取器职责与接口

新增 createExpandedPromptReader()，每次 LLM 调用创建一份，仅负责预览，不判断最终业务输出成功：

```ts
export function createExpandedPromptReader() {
  // 私有状态：扫描位置、对象/数组栈、字符串状态、转义状态、目标字段及已输出位置。
  return {
    push(delta: string): string {
      // 消费新增输入；只返回这次新增的、已经完整解码的 expandedPrompt 文本。
      // 未闭合字段名、转义和 Unicode 代理对保留到下一次 push。
      // 未找到目标或输入不确定时返回空串，不返回原始 JSON。
      return "" // 接口示意，具体实现遵循下方状态规则。
    },
  }
}
```

这不是用正则截取字段，也不是对每个 chunk 执行 JSON.parse。应使用带状态的轻量扫描器；字符位置持续前进，避免每个 token 重扫全部缓冲。

状态规则：

1. 在代码围栏或前导说明之后找到第一个候选顶层对象，字符串中的花括号不改变对象层级。
2. 只识别对象第一层的键；键名按 JSON 字符串解码后与 expandedPrompt 比较。嵌套对象内的同名键不展示。
3. 跳过其他字段的完整值，正确追踪数组、对象和字符串；tags 即便在前也不得误认作正文。
4. 目标值必须以双引号开始。非字符串类型不产生预览，交由原有最终校验决定失败/修复。
5. 目标字符串内逐步解码普通字符、反斜杠转义、换行转义和 Unicode 转义；字符串闭合后停止追加，不把后续 tags 混入。
6. 尾部只有反斜杠或不完整的 Unicode 转义时暂不输出。高代理项等待低代理项或后续确定的边界，不把一个完整 emoji 错拆成两次替换字符。
7. 预览遇到无效转义、重复目标键或多个候选对象时停止继续追加，不猜测后续内容、不拼接第二个对象。最终 parseExpansion 仍完整执行原有校验语义，不由预览扫描器改变。
8. 原始正文及 reasoning 总量仍由现有上限控制。预览最多展示 1000 Unicode 码点，超过后停止追加预览；最终输出是否合格仍由 validateExpansion 决定。

允许流结束前已经显示的预览最终被判为不合格，进入修复或失败；UI 始终不能据此开放正式结果操作。提取器本身的“预览无效”不触发提前成功、不新增模型重试。

以下为字符串解码部分的关键规则示意：

```ts
// JSON 字符串内部的反斜杠转义：先缓冲，再原子提交解码结果。
// JSON.parse 只用于已经收齐的单个转义 token，不解析未闭合的整个对象。
const token = source.slice(escapeStart, escapeEnd)
const decoded = JSON.parse(`"${token}"`) as string
// Unicode 高低代理项还需按上述规则合并后才发布。
```

实现时将扫描与解码保持在同一 Studio 提取模块内，不新增公共 JSON 工具库。

### 5.2 流消费改造

在 `prompt-expansion.ts` 将 ExpansionReasoning 替换为：

```ts
export type ExpansionPreview = {
  start: (attempt: 1 | 2) => Effect.Effect<void, unknown>
  append: (delta: string) => Effect.Effect<void, unknown>
  end: () => Effect.Effect<void, unknown>
}
```

readExpansionStream 的关键逻辑调整如下。示意中保留现有 error/abort/finish 校验和原始 text 缓冲：

```ts
const reader = createExpandedPromptReader()

// Stream.runForEach 内：
if (event.type !== "text-delta" && event.type !== "reasoning-delta") return Effect.void
if (!event.text) return Effect.void

progressBytes += Buffer.byteLength(event.text)
if (event.type === "text-delta") {
  textBytes += Buffer.byteLength(event.text)
  text += event.text
}
if (textBytes > 64 * 1024 || progressBytes > 1024 * 1024)
  return Effect.fail(new RecommendationError("OUTPUT_LIMIT_EXCEEDED"))

progress() // 两种有效输出都重置原 120 秒空闲计时
if (event.type !== "text-delta") return Effect.void
const delta = reader.push(event.text)
return delta ? preview?.append(delta) ?? Effect.void : Effect.void
```

移除 reasoning-start/delta/end 的展示回调，但继续计入 reasoning 字节及有效输出计时。正式 text 缓冲保持原值，不能替换成 reader 输出；最终仍需要完整 JSON 和 tags。

每次 call(repair) 的生命周期：

```ts
// start 在创建 LLM 调用之前执行；开始新轮先结束旧轮，保存全新的空预览。
if (preview) await Effect.runPromise(attach(preview.start(repair ? 2 : 1)))
try {
  // 原有 llm.stream、组合取消信号、readExpansionStream 和完成校验。
} finally {
  clearTimeout(timer)
  if (preview) await Effect.runPromise(attach(preview.end()))
}
```

该片段为生命周期示意。实际 try/finally 必须覆盖 start，保证 start 保存失败时也清理计时器；end 必须在独立清理上下文执行，不使用已 abort 的 LLM signal。旧调用未传 preview 时保持兼容。

### 5.3 消息适配与结果提交

将现有 createExpansionReasoning 改为 createExpansionPreview：

- start：关闭旧活动 part，保存本 attempt 的新空 TextPart。
- append：更新活动 part 的内存 text，经 Bus.publish 发送现有 PartDelta，field 固定为 text。
- end：经 SyncEvent.run 保存完整 TextPart 和结束时间，幂等清理活动引用。
- 保存事务内继续检查 session/message/result 的关联及状态；允许 running/cancelling 保存收尾，禁止删除后的迟到写入复活数据。
- closeExpansionPreview 在 finish/中断恢复中关闭遗留预览，只匹配本轮结果关联的标记，不误处理正常 text 或历史 reasoning。

最终结果仍写回原 resultPartID；只有正式 JSON 校验成功才更新 completed、tags 和最终正文。写预览不得修改 guide/result 的 revision，避免 token 更新触发推荐状态接口请求。

## 6. 前端解析与正文隔离

### 6.1 预览元数据识别

在 `studio-prompt-state.ts` 增加小型内部 schema，不改公共 SDK：

```ts
const preview = z.object({
  version: z.literal(1),
  attempt: z.union([z.literal(1), z.literal(2)]),
  resultPartID: z.string().min(1),
})

export function previewMetadata(part?: Part) {
  if (part?.type !== "text") return
  const parsed = preview.safeParse(part.metadata?.studioPromptExpansionPreview)
  return parsed.success ? parsed.data : undefined
}
```

提供对应类型守卫 isExpansionPreview。旧 isExpansionReasoning 可以继续用于旧消息合并保护，但不进入新展示路径。

### 6.2 必须排除预览 text

在 `turns.ts` 的 assistantText 汇总路径排除预览：

```ts
const assistantText = assistantParts
  .filter(isTextPart)
  .filter((part) => !previewMetadata(part))
  .map((part) => part.text)
  .join("\n")
  .trim()
```

同步检查本文件其他 assistant text 汇总及 buildStudioConversationContext 使用的路径，避免预览进入历史上下文或正式生成输入。现有推荐 text 的 promptMetadata 匹配仍只处理 guide/result，preview 不携带这些标记。

StudioTurnData 将 reasoningParts 替换为：

```ts
previewPart?: Extract<Part, { type: "text" }>
```

只为 status=running 的 result turn 填充；先找到携带本轮 result 元数据的正式 part，按 resultPartID 筛选其预览，再按 attempt 选最新轮。选取时不能排除空 text。若同 attempt 异常出现多个 part，以 PartID 顺序选择最新一个，不合并正文。

### 6.3 独立组件

重命名现有组件为 StudioPromptExpansionPreview，保留临时区域的视觉样式。使用 reasoning-part 仅作为复用 CSS 的容器标记，不意味着内容来自 reasoning：

```tsx
export function StudioPromptExpansionPreview(props: {
  part?: Extract<Part, { type: "text" }>
  status: string
}) {
  return (
    <Show when={props.status === "running" && props.part?.text.trim()}>
      <div data-component="reasoning-part" data-streaming>
        <Markdown
          text={props.part?.text.trim() ?? ""}
          cacheKey={props.part?.id}
          streaming={props.part?.time?.end === undefined}
        />
      </div>
    </Show>
  )
}
```

组件无状态、无折叠、无计时。Markdown 复用已有解析及安全渲染，沿用根级 MarkedProvider。正文含 Markdown 时按公共规则渲染，不使用 innerHTML，不复制公共组件。

`studio-conversation.tsx` 中，把原 reasoningParts 判断替换为 previewPart.text 判断；尚无有效正文回退等待文案。completed 分支完全沿用 StudioPromptExpansionReviewView，预览不能通过 assistantText fallback 再次显示。

## 7. 快照、修复与迟到事件

- 每次调用独立 PartID，避免修复正文与上一轮拼接；新空 part 是立即切换轮次的依据。
- mergePromptPart 对相同预览 ID 沿用“运行快照不得覆盖已结束全量、同段前缀保留较完整文本、最终全量校正”的合并原则；跨 part 不做长度比较、不拼接。
- studio-session-data 对 preview 的 delta 检查 sessionID、field=text、删除标记以及 time.end；已关闭 part 不接收迟到增量。
- 第一轮迟到事件即使进入 store，也不会覆盖 attempt=2 的选择；completed 后任何 part 更新都不能重新挂载预览。
- 运行中刷新只保证恢复已落库的预览；未落库的活动段可能暂缺前缀，段末完整保存补齐。不增加周期全量写入、检查点或新序号协议。
- 正式任务已完成时无需等待预览补齐，直接显示最终结果；历史记录只显示正式结果。
- 旧 reasoning 数据不作为正文兜底；无须迁移或删除旧数据。

## 8. 保持不变的运行策略

| 项目 | 策略 |
| --- | --- |
| Provider 请求/网络流超时 | 沿用现有实现与配置 |
| Studio 受理准备超时 | 保留 30 秒 |
| 有效输出空闲超时 | 保留 120 秒；非空 text-delta 和 reasoning-delta 都重置 |
| 展示未提取出正文的 JSON 增量 | 仍算有效输出，重置空闲计时 |
| LLM 网络重试 | 保持 retries:0，不新增 |
| JSON 结构修复 | 原有一次修复，预览随新轮重置 |
| 正式结果校验及结果编辑 | 保持原流程，预览不能作为可信输入 |

模型仅返回 reasoning 时仍会等待正文，不因不展示 reasoning 而超时。模型/供应商完全不发送中间内容时，前端保留等待提示，不生成虚构进度或思考文字。

## 9. 实施步骤

1. 新增正文增量提取器和独立测试，明确解码及容错边界。
2. 将后端 reasoning 消息适配重命名并改为 preview，接入每次调用 start/append/end，保留计时及最终校验。
3. 前端识别 preview 并排除 assistantText，按最新 attempt 选择单个临时预览。
4. 重命名并接入预览组件，删除当前运行路径的思考展示逻辑，沿用现有样式。
5. 执行正文分块、修复重置、取消、刷新及结果确认回归；最后打开本次修改文件审查并统计增删行数。

## 10. 验收与测试

### 10.1 提取器

- 在 JSON 的每个字符边界切分输入，提取结果与完整 expandedPrompt 一致。
- 同时覆盖每次只送一个字符、随机大小块和整段一次到达。
- 引号、反斜杠、换行、制表符、Unicode 转义和 emoji 代理对跨 chunk。
- 正文包含花括号、字段名样式文字及转义引号，不误结束字段。
- tags 在前、对象空白和换行、代码围栏、前导说明、嵌套同名字段。
- 不完整/非法 JSON、不完整转义、非字符串正文、重复键和多对象；不泄漏原始 JSON 或 tags。
- 超过预览 1000 码点时停止预览，但原始输出仍参与最终校验和原有限额。

### 10.2 后端真实消息及模型流

- 纯正文模型和同时返回 reasoning/text 的模型都只发布正文预览。
- reasoning 仍触发计时进度和原字节限制，但不新增 reasoning part 或展示事件。
- begin 保存空 part；新增正文通过 PartDelta 到达；结束保存完整预览且不污染正式结果。
- 首轮无效、修复轮开始但尚未输出时，最新空 part 已创建；修复正文不拼接首轮。
- 取消/失败/超时后清理不使用已 abort signal，删除会话后不重建消息。
- 预览提取无效不改变最终 JSON 校验；写库失败由主流程感知，不误报成功、不泄漏执行额度。

### 10.3 前端

- 无正文等待、有正文流式显示、正文完成但结果未校验时保持预览。
- completed/cancelling/failed/cancelled 隐藏，历史会话不提供查看入口。
- 新空 attempt 清掉旧预览，旧轮迟到事件不复活旧正文。
- 最终 assistantText 仅包含正式扩写内容，编辑框不重复、不含 tags JSON 或原始转义字符。
- 原确认/忽略、参考图、草稿和后续生成上下文不受预览影响。
- 同会话及删除保护、旧快照不回退、完成后迟到增量不重复。

### 10.4 建议执行命令

测试从 package 目录运行，不从仓库根目录运行；类型检查只使用 bun typecheck。新增/重命名测试实现后再执行：

```sh
# 工作目录：packages/opencode
bun test test/studio/prompt-expansion-text.test.ts test/studio/prompt-expansion-preview.test.ts test/studio/prompt-expansion.test.ts test/studio/prompt-expansion-integration.test.ts test/studio/prompt-recommendation.test.ts --timeout 30000
bun typecheck

# 工作目录：packages/app
bun test --conditions=browser --preload ./happydom.ts ./octoapp/pages/studio/studio-prompt-state.test.ts ./octoapp/pages/studio/studio-session-data.test.ts ./octoapp/pages/studio/studio-prompt-expansion-preview.test.tsx ./octoapp/pages/studio/studio-prompt-expansion-review-view.test.tsx ./octoapp/pages/studio/studio-prompt-expansion-review.test.ts
bun typecheck
```

DOM 测试必须加载 Solid 浏览器实现，沿用现有测试的 Solid 编译方式及公共 Markdown 上下文。不得为验收重启现有应用或服务。既有无关失败单独记录，不扩大修改范围。

## 11. 公共接口与数据影响

复用既有 TextPart、PartUpdated、PartDelta 和消息读取端点。新标记仅在 Studio 内解析，不修改公共 HTTP schema、数据库表列、SDK 或 Provider 配置，无须数据库迁移和 SDK 再生成。

预览与正式结果通过 resultPartID 关联；正文提取器与显示状态均为 Studio 内部实现。本次已完成编码；功能代码、测试及重命名均限制在 Studio 目录。


## 12. 实施记录

- 已实现仅正文预览：提取顶层 `expandedPrompt`，解码 JSON 转义和 Unicode，不转发或保存新的 reasoning 内容。
- 已重命名后端消息适配、前端展示组件及其测试，移除旧 reasoning 展示入口；旧消息的合并保护保留。
- 每次调用先创建空预览，结构修复以独立 `attempt=2` 和新 PartID 清空旧轮；前端先选择最新轮，再判断正文是否为空。
- 正式 `assistantText` 排除预览；completed/cancelling/failed/cancelled 隐藏临时区域，原编辑、确认、忽略流程保持不变。
- 保留原 30 秒准备超时、120 秒有效输出空闲计时和 `retries:0`；reasoning 增量仍参与计时重置及字节限制。
- 后端专项及真实 SSE 集成测试：28 项通过；包含逐字符分块、转义、emoji、无 reasoning 模型、修复和取消。
- 前端相关测试：47 项通过；覆盖正文隔离、空修复轮、快照合并、迟到事件及原扩写结果交互。
- `packages/opencode`、`packages/app` 的 `bun typecheck` 均通过；未修改公共模块，未重启现有应用或服务。
- 未运行真实页面视觉对照；临时区域继续复用已有样式规则。
