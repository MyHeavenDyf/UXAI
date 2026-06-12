# Make 页面组件分步生成方案

## Context

当前 `octo_make` agent 一次生成完整的 HTML 页面（单个 `<artifact>` 标签）。页面复杂时，较弱模型容易生成失败。需要支持将页面拆分为组件分步生成，或通过子 agent 并行生成组件后组装。

**实施范围**: Phase 1（单回复多 Artifact）+ Phase 2（子 Agent 并行）一起实现。

## 现有能力

- **artifact-parser** 已支持多个 `<artifact>` 标签（while 循环 + `state.inside = false` 重置）
- **tab-store** 已支持多个 tab 共存
- **Task 工具** 已支持子 agent 调度（`general`、`explore`），可并行
- **瓶颈**：`insight-turn.tsx` 的 `outputCard` memo 仅提取第一个 artifact，返回单个 `OutputCard | null`

---

## Step 1: 前端多 Artifact 支持

### 1.1 重构 `parseArtifactFromText` → `parseAllArtifactsFromText`

**文件**: `packages/app/octoapp/pages/make/components/insight-turn.tsx`

- 新函数遍历所有 `artifact:start` / `artifact:chunk` / `artifact:end` 事件
- 返回 `Omit<OutputCard, "id" | "createdAt">[]`（所有 artifact）
- 复用已有的 `createArtifactParser` + `ARTIFACT_TYPE_MAP`

### 1.2 `outputCard` → `outputCards` 返回数组

**文件**: `packages/app/octoapp/pages/make/components/insight-turn.tsx`

- `outputCard: createMemo((): OutputCard | null)` → `outputCards: createMemo((): OutputCard[])`
- Priority 1（write tool HTML）: 单卡片不变
- Priority 2（text parts）: 调用 `parseAllArtifactsFromText`，返回所有卡片
- Priority 3（tool output）: 同理解析多个
- Props 类型: `onOpenResult: (card: OutputCard) => void` 保持不变

### 1.3 `streamingArtifact` → `streamingArtifacts` 返回数组

**文件**: `packages/app/octoapp/pages/make/components/insight-turn.tsx`

- 跟踪所有 streaming 中看到的 artifact，返回 `OutputCard[]`
- `hasSeenArtifact` / `lastSeenCard` 信号改为 `hasSeenCount` / `lastSeenCards` 数组
- `stableStreamingCard` → `stableStreamingCards`

### 1.4 JSX 模板改为多卡片渲染

**文件**: `packages/app/octoapp/pages/make/components/insight-turn.tsx`

- 生成中卡片区: `<Show when={...stableStreamingCard()}>` → `<For each={stableStreamingCards()}>`
- 完成后卡片区: `<Show when={outputCard()}>` → `<For each={outputCards()}>`

### 1.5 `stripArtifact` 移除所有 artifact

**文件**: `packages/app/octoapp/pages/make/utils/artifact-strip.ts`

- 移除 line 63 的 `break`，让 while 循环继续删除所有 artifact 块
- 增加对部分 `<artifact` 前缀的容错处理

### 1.6 MakePage 批量打开

**文件**: `packages/app/octoapp/pages/make/index.tsx`

- `handleOpenResult(card)` 保持不变
- 新增: 当卡片 identifier 以 `-composed` 结尾时自动激活该 tab

---

## Step 2: 后端 `make_component` 子 Agent

### 2.1 注册子 Agent

**文件**: `packages/opencode/src/agent/agent.ts`

在 `explore` agent 定义之后（~line 200）添加:
```typescript
make_component: {
  name: "make_component",
  description: "HTML component generator. Generates a single self-contained HTML fragment for a specified UI component, following design system tokens.",
  prompt: PROMPT_MAKE_COMPONENT,
  permission: Permission.merge(defaults, Permission.fromConfig({ task: "deny", todowrite: "deny" }), user),
  options: {},
  mode: "subagent",
  native: true,
}
```

- `mode: "subagent"` → 出现在 `describeTask` 列表中
- `task: "deny"` → 禁止递归子 agent 调用
- 继承 `defaults` 权限（允许 read/write/bash 等工具）

### 2.2 创建子 Agent Prompt

**新文件**: `packages/opencode/src/agent/prompt/make_component.txt`

核心内容:
- 接收: 组件规格 + 设计系统 tokens + 页面上下文
- 输出: 单个 `<artifact>` 包裹的 HTML 片段
- 约束: 仅 `<section>/<div>` 片段，无 `<html>/<head>/<body>` 包装
- CSS scoped 到组件 class，内联 `<style>`
- 禁止 `<script>` 和外部依赖

### 2.3 导入 prompt 常量

**文件**: `packages/opencode/src/agent/agent.ts`

- 添加 `import PROMPT_MAKE_COMPONENT from "./prompt/make_component.txt"` (与现有 prompt 导入模式一致)

---

## Step 3: 更新 `octo_make` Prompt

**文件**: `packages/opencode/src/agent/prompt/octo_make.txt`

### 移除
- "One artifact per response. After `</artifact>`, stop."

### 新增条件化生成策略

```
## Generation strategies

### Simple requests (single page, under ~800 lines)
Generate ONE artifact containing the complete HTML.

### Complex requests (multi-section, dashboard, >800 lines)

**Strategy A: Multi-artifact decomposition**
Generate multiple <artifact> tags in order:
1. Component artifacts (identifier="xxx-component") for each section
2. Final composed artifact (identifier ends with "-composed") assembling all

**Strategy B: Sub-agent parallel generation**
1. Plan: Identify 3-8 major sections
2. Spawn: Use Task tool with subagent_type="make_component", one per component
   - Include design system tokens and component spec in the prompt
   - Launch all in a single message (parallel)
3. Assemble: Collect <task_result> HTML, combine into final <artifact>

Prefer Strategy A for moderate complexity, Strategy B for very complex pages.
```

---

## 关键文件清单

| 文件 | 改动类型 |
|------|----------|
| `packages/app/octoapp/pages/make/components/insight-turn.tsx` | 重构: 多卡片 memo + JSX |
| `packages/app/octoapp/pages/make/utils/artifact-strip.ts` | 修改: 删除所有 artifact |
| `packages/app/octoapp/pages/make/index.tsx` | 修改: 成品卡片自动激活 |
| `packages/opencode/src/agent/agent.ts` | 修改: 注册 make_component |
| `packages/opencode/src/agent/prompt/octo_make.txt` | 修改: 多 artifact + 子 agent 指令 |
| `packages/opencode/src/agent/prompt/make_component.txt` | **新建**: 子 agent prompt |

## 验证方式

1. 简单页面请求 → 仍为单个 artifact，行为不变（回归测试）
2. 复杂页面 + 强模型 → 验证多 artifact 分解、多卡片显示、成品自动激活
3. 复杂页面 + 弱模型 → 验证 Task 工具调度 make_component 子 agent、工具调用进度展示、组装结果
4. 类型检查: `cd packages/app && bunx tsgo --noEmit`
