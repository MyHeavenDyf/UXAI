# Session 分类机制分析及桌面端获取方案

## 1. Session 分类机制

### 1.1 数据库 Schema

**文件**: `packages/opencode/src/session/session-category.sql.ts`

```typescript
type SessionCategory = "dev" | "design" | "prototype" | "analysis" | "creative" | "planning"

SessionCategoryTable:
  - session_id: PK, FK → SessionTable (cascade delete)
  - category: SessionCategory
  - time_created, time_updated
  - 索引: session_category_category_idx
```

### 1.2 Agent → Category 映射

**文件**: `packages/opencode/src/session/session-category.ts`

| Agent | Category |
|-------|----------|
| `octo_ai`, `build` | `"dev"` |
| `octo_design` | `"design"` |
| `octo_make` | `"prototype"` |
| `octo_insight` | `"analysis"` |
| `octo_canva` | `"creative"` |
| `plan` | `"planning"` |
| 其他 | `"dev"` (默认) |

### 1.3 分类写入时机

**文件**: `packages/opencode/src/session/session.ts:526-541`

Session 创建时，如果 `result.agent` 有值，自动 upsert 到 `SessionCategoryTable`。

---

## 2. 桌面端当前 Session 流程

### 2.1 架构

```
Electron (desktop) → 加载 Web App (packages/app) → 通过 SDK 调用 Server API
```

### 2.2 Session 创建

**文件**: `packages/app/src/components/prompt-input/submit.ts:365`

```typescript
const created = await client.session.create()  // 无参数，agent 未传递
```

`CreateInput` schema 支持但未使用 agent 参数：

```typescript
// session.ts:220-229
export const CreateInput = Schema.optional(Schema.Struct({
  agent: Schema.optional(Schema.String),  // ✓ 支持但未使用
  // ...
}))
```

### 2.3 Session 列表获取

```typescript
client.session.list({ directory, roots: true, limit })
```

返回的 `Session.Info` 不包含 category 字段。

### 2.4 侧边栏分组

当前分组：按 Project → Workspace → Session 三级结构，按更新时间排序。

---

## 3. 核心问题

| 问题 | 说明 |
|------|------|
| create 不传 agent | 分类表可能为空 |
| Session.Info 不含 category | API 不返回分类 |
| SessionCategory.Service 未使用 | 有 CRUD 方法但无人调用 |
| 前端无分组逻辑 | 侧边栏不按分类展示 |

---

## 4. 方案：API 返回分类字段

### Step 1：确保分类在 agent 更新时写入

**文件**: `packages/opencode/src/session/session.ts`

当 session 的 agent 被设置或更新时（如 promptAsync），触发分类写入。

### Step 2：扩展 Session.Info

**文件**: `packages/opencode/src/session/session.ts`

在 Info schema 中添加：

```typescript
category: Schema.optional(Schema.Literal(
  "dev", "design", "prototype", "analysis", "creative", "planning"
))
```

在查询 session 列表/详情时 join `SessionCategoryTable` 填充 category。

### Step 3：前端分组

**文件**: `packages/app/src/pages/layout/sidebar-*.tsx`

session 列表按 category 分组渲染。

---

## 5. 关键文件

| 文件 | 改动 |
|------|------|
| `session/session.ts` | Info 添加 category + agent 更新时写入分类 |
| `session/session-category.ts` | 确保 categorize() 在 agent 变更时被调用 |
| `app/src/components/prompt-input/submit.ts` | 可选：create 时传入 agent |
| `app/src/pages/layout/sidebar-*.tsx` | 按 category 分组渲染 |
