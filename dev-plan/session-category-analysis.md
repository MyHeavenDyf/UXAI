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
| `octo_studio` | `"creative"` |
| `plan` | `"planning"` |
| 其他 | `"dev"` (默认) |

### 1.3 分类写入时机

| 时机 | 文件位置 | 说明 |
|------|----------|------|
| Session 创建时 | `session.ts:createNext` | 仅当 `result.agent` 有值时 upsert，失败时记录日志 |
| Agent 切换时 | `projectors-next.ts:AgentSwitched.Sync` | 通过 projector 自动同步到 SessionCategoryTable |

---

## 2. Session.Info 中的 category 字段

**文件**: `packages/opencode/src/session/session.ts`

### 2.1 Schema 定义

```typescript
// Info schema 中 category 字段（使用 Schema.Union 而非 Schema.Literal）
category: optionalOmitUndefined(
  Schema.Union([
    Schema.Literal("dev"), Schema.Literal("design"), Schema.Literal("prototype"),
    Schema.Literal("analysis"), Schema.Literal("creative"), Schema.Literal("planning"),
  ])
)
```

### 2.2 fromRow 函数

```typescript
export function fromRow(row: SessionRow, category?: string): Info {
  // ... 其他字段转换 ...
  category: row.category ?? category,
}
```

`fromRow` 接受第二个参数 `category`，用于 LEFT JOIN 查询时传入。

---

## 3. 查询集成（LEFT JOIN）

所有返回 session 的查询都通过 LEFT JOIN SessionCategoryTable 获取 category：

| 函数 | 文件位置 | 状态 |
|------|----------|------|
| `get` | `session.ts:567-578` | LEFT JOIN + fromRow(row.session, row.category) |
| `listByProject` | `session.ts:855-905` | LEFT JOIN + 支持 category 过滤 |
| `listGlobal` | `session.ts:907-975` | LEFT JOIN + fromRow(row.session, row.category) |
| `children` | `session.ts:585-595` | LEFT JOIN + fromRow(row.session, row.category) |
| `listByCategory` | `session-category.ts:103` | INNER JOIN + fromRow(r.session, category) |
| `server/projectors.ts` | `projectors.ts:13-30` | LEFT JOIN + fromRow(row.session, row.category) |
| `stats.ts` | `cli/cmd/stats.ts:82-90` | LEFT JOIN + fromRow(row.session, row.category) |

---

## 4. API category 查询参数

### 4.1 Hono 后端

**文件**: `packages/opencode/src/server/routes/instance/session.ts`

```
GET /session?category=dev
```

Query 参数：
- `category` (optional): 按分类过滤 session（dev/design/prototype/analysis/creative/planning）

### 4.2 HttpApi 后端

**文件**: `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`

`ListQuery` schema 包含 `category: Schema.optional(Schema.String)`。

**注意**: Drizzle 的 `leftJoin` 后 WHERE 子句中引用右表列会导致类型推断失败，需使用 `sql` 模板绕过：

```typescript
// listByProject 中的 category 过滤
input.category
  ? and(...conditions, sql`${SessionCategoryTable.category} = ${input.category}`)
  : and(...conditions)
```

---

## 5. 桌面端 Session 流程

### 5.1 架构

```
Electron (desktop) → 加载 Web App (packages/app) → 通过 SDK 调用 Server API
```

### 5.2 Session 创建

**文件**: `packages/app/src/components/prompt-input/submit.ts:365`

```typescript
const created = await client.session.create()  // 无参数，agent 未传递
```

`CreateInput` schema 支持但未使用 agent 参数。分类在发送第一条消息（触发 AgentSwitched 事件）后才写入。

### 5.3 Session 列表获取

```typescript
// 按分类过滤（可选）
client.session.list({ directory, roots: true, limit, category: "dev" })
```

返回的 `Session.Info` 包含 `category` 字段。

### 5.4 侧边栏分组

当前分组：按 Project → Workspace → Session 三级结构，按更新时间排序。

---

## 6. 关键文件

| 文件 | 改动 |
|------|------|
| `session/session.ts` | Info 添加 category（Schema.Union）、fromRow 签名变更、children LEFT JOIN、listByProject category 过滤 |
| `session/session-category.ts` | listByCategory 使用 fromRow 而非 as unknown as Info |
| `session/projectors-next.ts` | AgentSwitched projector 同步 category |
| `server/projectors.ts` | session.updated 事件 LEFT JOIN category |
| `server/routes/instance/session.ts` | API 添加 category 查询参数 |
| `server/routes/instance/httpapi/groups/session.ts` | HttpApi ListQuery 添加 category |
| `server/routes/instance/httpapi/handlers/session.ts` | HttpApi handler 传递 category |
| `cli/cmd/stats.ts` | LEFT JOIN SessionCategoryTable |

---

## 7. 已知限制

| 限制 | 说明 |
|------|------|
| 旧 session 无分类 | 未触发 AgentSwitched 的旧 session，category 为 undefined |
| create 不传 agent | 创建时分类表为空，首次消息后才写入 |
| Drizzle 类型限制 | leftJoin 后 where 不能直接引用右表列，需 sql 模板 |
