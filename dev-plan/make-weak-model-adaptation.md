# Make 页面弱模型适配方案

## Context

Make 页面在弱模型上表现不好：
1. 子 agent 会话不显示：弱模型不使用 Task 工具或 subSessionID 提取失败
2. HTML 截断：弱模型输出 token 有限，页面被截断

**参考 open-design 核心机制**：

| 机制 | open-design 实现 | 可借鉴点 |
|------|-----------------|----------|
| 截断检测 | `artifact-stub-guard.ts`：对比新旧 artifact 体积，<20% 判定 stub | 体积阈值 + 结构检测双保险 |
| 质量反馈 | `lint-artifact.ts`：grep 检查 AI slop，结果注入 agent 下一轮 | 后验证 → 自纠反馈循环 |
| 输入端防护 | `buildPriorRunContextWarning`：检测大上下文，注入 compact 指令 | 前置预防而非后置修补 |
| 表单循环防护 | `sanitizePriorAssistantTurn`：剥离重复表单结构 | 弱模型常见故障的针对性 strip |
| 校验 | `validate.ts`：最小长度 + 必须开头 + 禁止内部路径 | 写入前校验 |

---

## Step 1: Prompt 分层 + 前置防护

**文件**: `packages/opencode/src/agent/prompt/octo_make.txt`

### 1a. 分层生成策略（替代 MANDATORY Task 工具）

```
## Generation strategy

### Simple requests (single page, form, card, under ~600 lines)
Generate ONE `<artifact>` tag with complete standalone HTML.
Do NOT decompose. Keep it compact.

### Complex requests (dashboard, multi-section, >600 lines)
Choose ONE:

**Strategy A — Sub-agent decomposition:**
1. Plan: List 3-6 sections
2. Spawn: Task tool with subagent_type="make_component", one per section
3. Assemble: Combine into <artifact identifier="xxx-composed">

**Strategy B — Multi-artifact:**
1. Component artifacts (identifier="xxx-component")
2. Final composed (identifier ends with "-composed")

If Task tool is unavailable or returns an error, use Strategy B.
```

### 1b. 自检指令（参考 open-design 的前置防护）

在 "Design output guidelines" 区域新增：

```
- **Self-check before output**: If generating HTML, verify the output contains closing
  `</body></html>` tags. If your output is approaching the token limit, prefer a simpler
  design over a truncated one. A complete simple page is better than a broken complex one.
```

---

## Step 2: 修复 Task 工具调用可见性

**文件**: `packages/app/octoapp/pages/make/components/insight-turn.tsx`

### 问题
`subtasks` memo (line 393) 当 `subSessionID` 为空时 `continue` 跳过，同时 `nonTaskToolCalls` (line 367) 排除 `/task/i` → 调用完全不可见。

### 修复
替换 line 393 `if (!subSessionID) continue` 为降级处理：

```typescript
if (!subSessionID) {
  // 尝试从 output 文本中提取 artifact（降级兜底）
  const degradedArtifacts: typeof artifactOutputs = []
  const parsed = parseAllArtifactsFromText(outputStr)
  for (const a of parsed) {
    degradedArtifacts.push({ identifier: a.artifactIdentifier ?? "", title: a.title, content: a.content })
  }
  if (degradedArtifacts.length === 0
      && /<(?:div|section|style|nav|header|main|article|form|table|html)\b/i.test(outputStr)) {
    degradedArtifacts.push({ identifier: "degraded", title: "HTML 片段", content: outputStr })
  }
  tasks.push({
    taskDescription: (input?.description as string) ?? (input?.prompt as string)?.slice(0, 60) ?? "子任务",
    subSessionID: "",
    status: isError ? "error" : hasOutput ? "done" : "running",
    textParts: [],
    artifactOutputs: degradedArtifacts,
  })
  continue
}
```

---

## Step 3: 子会话数据加载

**文件**: `packages/app/octoapp/pages/make/index.tsx`、`insight-turn.tsx`

参考 Insight 页面使用 `sync.session.sync(id)` 任意 session 加载。

### 3a. index.tsx: 扩展事件过滤 + 按需加载

```typescript
const [childSessionIDs, setChildSessionIDs] = createSignal<Set<string>>(new Set())
const loadedChildSessions = new Set<string>()

function ensureChildSession(subSessionID: string) {
  if (loadedChildSessions.has(subSessionID)) return
  loadedChildSessions.add(subSessionID)
  setChildSessionIDs(prev => { const next = new Set(prev); next.add(subSessionID); return next })
  globalSDK.client.session.messages({ sessionID: subSessionID })
    .then(result => {
      const items = (result.data ?? []) as { info: Message; parts: Part[] }[]
      batch(() => {
        const msgs: Message[] = []
        for (const { info, parts: ps } of items) {
          msgs.push(info)
          const visible = ps.filter(p => !SKIP_PART_TYPES.has(p.type))
          if (visible.length > 0) setDataStore("part", info.id, reconcile(visible, { key: "id" }))
        }
        setDataStore("message", subSessionID, reconcile(msgs, { key: "id" }))
      })
    })
    .catch(() => {})
}
```

事件处理器中扩展过滤（line 228, 240）：
```typescript
if (info.sessionID !== sessionId && !childSessionIDs().has(info.sessionID)) return
```

### 3b. insight-turn.tsx: 通知父组件

新增 prop `onChildSession`：
```typescript
export function InsightTurn(props: {
  ...
  onChildSession?: (subSessionID: string) => void
})
```

添加 effect 监听新 subSessionID：
```typescript
createEffect(() => {
  for (const t of subtasks()) {
    if (t.subSessionID) props.onChildSession?.(t.subSessionID)
  }
})
```

---

## Step 4: 截断检测 + 自动续写（参考 open-design stub guard + 反馈循环）

参考 open-design 的 `artifact-stub-guard.ts`（体积对比）+ `lint-artifact.ts`（反馈循环）+ `validate.ts`（结构校验），实现**前端截断检测 + 自动续写**。

### 4a. 检测/修复工具函数

**文件**: `packages/app/octoapp/pages/make/utils/artifact-parser.ts`

```typescript
/** 仅检测完整文档（<!DOCTYPE 或 <html 开头），组件片段不算截断 */
export function isTruncatedHtml(content: string): boolean {
  const isFullDoc = /<!DOCTYPE\s+html/i.test(content) || /<html[\s>]/i.test(content)
  if (!isFullDoc) return false
  return !content.toLowerCase().includes("</html>")
}

/** 修复截断 HTML：移除不完整尾部标签 + 补闭合 */
export function repairTruncatedHtml(content: string): string {
  if (!isTruncatedHtml(content)) return content
  let fixed = content.replace(/<[^>]*$/, "")
  if (!fixed.toLowerCase().includes("</body>")) fixed += "\n</body>"
  if (!fixed.toLowerCase().includes("</html>")) fixed += "\n</html>"
  return fixed
}
```

### 4b. OutputCard 扩展 + 截断修复

**文件**: `insight-turn.tsx`

```typescript
export type OutputCard = { ...; truncated?: boolean }
```

在 `outputCards` memo 中，创建 HTML 卡片时应用修复：
```typescript
const repaired = repairTruncatedHtml(content)
return [{ ..., content: repaired, truncated: isTruncatedHtml(content) }]
```

### 4c. 截断卡片 UI + 续写按钮

**文件**: `insight-turn.tsx`，outputCards 渲染区

截断卡片显示：
- 橙色 "输出被截断" 标记
- "续写" 按钮 → 触发 `props.onContinue` 回调

```jsx
<Show when={capturedCard.truncated}>
  <span class="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(234,179,8,0.1)", color: "#ca8a04" }}>
    输出被截断
  </span>
  <button type="button" onClick={() => props.onContinue?.(capturedCard)}
    class="text-[11px] px-1.5 py-0.5 rounded hover:opacity-80"
    style={{ background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>
    续写
  </button>
</Show>
```

### 4d. 续写逻辑

**文件**: `insight-turn.tsx`、`index.tsx`

InsightTurn 新增 prop：
```typescript
onContinue?: (card: OutputCard) => void
```

MakePage 实现续写：
```typescript
function handleContinue(card: OutputCard) {
  const sid = params.id
  if (!sid) return
  const lastChars = card.content.slice(-300)
  setPrompt(`请继续完成上一个设计。上次的输出在以下位置被截断：\n\`\`\`\n${lastChars}\n\`\`\`\n\n请从截断点继续，输出完整 HTML。`)
  void handleSubmit()
}
```

---

## 关键文件清单

| 文件 | 改动 |
|------|------|
| `packages/opencode/src/agent/prompt/octo_make.txt` | 修改: 分层策略 + 自检指令 |
| `packages/app/octoapp/pages/make/components/insight-turn.tsx` | 修改: Task 可见性 + 子会话 prop + 截断 UI + 续写 |
| `packages/app/octoapp/pages/make/index.tsx` | 修改: 子会话加载 + 事件过滤扩展 + 续写处理 |
| `packages/app/octoapp/pages/make/utils/artifact-parser.ts` | 修改: 截断检测/修复导出 |

## 实施顺序

1. **Step 2** — Task 可见性修复
2. **Step 1** — Prompt 分层 + 自检
3. **Step 4** — 截断检测 + 自动修复 + 续写按钮
4. **Step 3** — 子会话数据加载

## 验证

1. 弱模型 + 简单请求 → 单 artifact 直接显示
2. 弱模型 + Task 失败 → 降级子任务卡片可见
3. 截断 HTML → 自动补全 + "续写" 按钮可用
4. 续写点击 → 发送续写 prompt → 新生成完成页面
5. 强模型 + Task 成功 → 子会话数据加载，artifact 提取
6. `bunx tsgo --noEmit`
