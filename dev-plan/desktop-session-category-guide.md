# 桌面端 Session 分类集成指南

## 概述

后端已完成 Session 分类功能，API 在 `Session.Info` 中返回 `category` 字段，支持按分类过滤。桌面端可基于此字段实现分类分组展示。

---

## 后端已完成的改动

### 1. Session.Info category 字段

```typescript
// packages/opencode/src/session/session.ts
// 使用 Schema.Union（非 Schema.Literal，后者只接受单值）
category: optionalOmitUndefined(
  Schema.Union([
    Schema.Literal("dev"), Schema.Literal("design"), Schema.Literal("prototype"),
    Schema.Literal("analysis"), Schema.Literal("creative"), Schema.Literal("planning"),
  ])
)
```

### 2. fromRow 签名变更

```typescript
// 旧签名
function fromRow(row: SessionRow): Info

// 新签名（第二个参数用于 LEFT JOIN 传入的 category）
function fromRow(row: SessionRow, category?: string): Info
```

所有调用 fromRow 的位置（get、listByProject、listGlobal、children、projectors、stats）均已适配新签名。

### 3. 分类的 6 种类型

```typescript
type SessionCategory = "dev" | "design" | "prototype" | "analysis" | "creative" | "planning"
```

### 4. Agent → Category 映射

```typescript
// packages/opencode/src/session/session-category.ts:13-21
const AGENT_TO_CATEGORY = {
  octo_ai:      "dev",
  build:        "dev",       // backward compat
  octo_design:  "design",
  octo_make:    "prototype",
  octo_insight: "analysis",
  octo_studio:  "creative",
  plan:         "planning",
  // 其他所有 agent 默认 "dev"
}
```

### 5. 分类写入时机

| 时机 | 位置 | 说明 |
|------|------|------|
| Session 创建时 | `session.ts:createNext` | 仅当 `result.agent` 有值时写入，失败时记录日志 |
| Agent 切换时 | `projectors-next.ts:AgentSwitched.Sync` | 自动 upsert 到 SessionCategoryTable |

**注意**：桌面端 `submit.ts:365` 调用 `client.session.create()` 时传空 body（不含 agent），所以创建时不会写入分类。分类在发送第一条消息（触发 AgentSwitched 事件）后才写入。

### 6. 查询自动 LEFT JOIN

所有返回 session 的查询均已 LEFT JOIN `SessionCategoryTable`：

```typescript
db.select({ session: SessionTable, category: SessionCategoryTable.category })
  .from(SessionTable)
  .leftJoin(SessionCategoryTable, eq(SessionTable.id, SessionCategoryTable.session_id))
```

覆盖范围：`get`、`listByProject`、`listGlobal`、`children`、`listByCategory`、`server/projectors.ts`、`stats.ts`。

### 7. API 支持按分类过滤

```
GET /session?category=dev
GET /session?category=design&limit=50
```

两个后端均已支持：
- **Hono 后端**: `server/routes/instance/session.ts` — query 参数 `category`
- **HttpApi 后端**: `server/routes/instance/httpapi/groups/session.ts` — `ListQuery` schema

---

## 桌面端需要修改的文件

### 1. SDK 类型：`packages/sdk/js/src/v2/gen/types.gen.ts`

`Session` 类型需包含 `category`（已手动添加，后续 SDK 自动生成会覆盖）：

```typescript
export type Session = {
  // ... 现有字段 ...
  agent?: string
  category?: "dev" | "design" | "prototype" | "analysis" | "creative" | "planning"
  model?: { ... }
  // ...
}
```

### 2. i18n 翻译：`packages/app/octoapp/i18n/en.ts` + `zh.ts`

已添加（仅中英文）：

```typescript
// en.ts
"category.dev": "Development",
"category.design": "Design",
"category.prototype": "Prototype",
"category.analysis": "Analysis",
"category.creative": "Creative",
"category.planning": "Planning",

// zh.ts
"category.dev": "开发",
"category.design": "设计",
"category.prototype": "原型",
"category.analysis": "分析",
"category.creative": "创意",
"category.planning": "规划",
```

### 3. 侧边栏分组：`packages/app/src/pages/layout/sidebar-workspace.tsx`

在 `WorkspaceSessionList` 组件中，将 flat session 列表按 `category` 分组渲染。

**修改思路**：

```tsx
// 定义分类显示顺序
const CATEGORY_ORDER = ["dev", "design", "prototype", "analysis", "creative", "planning"] as const

// 在 WorkspaceSessionList 内部：
const grouped = createMemo(() => {
  const sessions = props.sessions()
  const groups = new Map<string, Session[]>()
  for (const s of sessions) {
    const cat = s.category ?? "dev"  // 无分类的旧 session 默认归入 "dev"
    let list = groups.get(cat)
    if (!list) { list = []; groups.set(cat, list) }
    list.push(s)
  }
  return groups
})

// 渲染：按固定顺序遍历分类，只渲染有 session 的分组
<For each={CATEGORY_ORDER}>
  {(category) => (
    <Show when={grouped().get(category)}>
      {(sessions) => (
        <div>
          <div class="text-12-medium text-text-weak px-2 pt-2 pb-0.5 select-none">
            {props.language.t(`category.${category}`)}
          </div>
          <For each={sessions()}>
            {(session) => <SessionItem session={session} ... />}
          </For>
        </div>
      )}
    </Show>
  )}
</For>
```

**关键点**：
- `CATEGORY_ORDER` 保证分组按固定顺序显示（开发在前，规划在后）
- `<Show when={grouped().get(category)}>` 跳过无 session 的分类，不显示空分组
- `s.category ?? "dev"` 确保无分类的旧 session 归入"开发"组

### 4. 按分类过滤查询（可选）

桌面端可通过 SDK 调用带 category 参数的 session list：

```typescript
// 只获取开发类 session
client.session.list({ directory, category: "dev" })
```

---

## 数据流图

```
用户发送消息 → submit.ts 传递 agent 到 message API
  → prompt.ts 检测 agent 变化 → 触发 AgentSwitched 事件
    → projectors-next.ts 更新 SessionTable.agent + SessionCategoryTable.category
      → 前端调用 session.list → API LEFT JOIN 返回带 category 的 Session[]
        → sidebar-workspace.tsx 按 category 分组渲染
```

---

## 验证方式

1. 启动桌面端 `bun dev:desktop`
2. 使用不同 agent 创建多个 session（octo_ai → dev, octo_design → design, octo_make → prototype）
3. 侧边栏应按分类分组显示，每组带分类标题
4. 无分类的旧 session 应归入"开发"组
5. API 过滤：`GET /session?category=dev` 只返回开发类 session
