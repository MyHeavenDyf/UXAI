# /session list 读取侧加固：分层防御（接纳 + 容错）

## 背景

过去一周发生 3 次因单行 session 脏数据导致整个列表 400/500 的事故：

| Commit | 说明 |
|---|---|
| `900f347be` | session category schema 缺少 "subagent" 导致 400 empty body |
| `dd13676aa` | category schema 补全 "subagent" + 同步 SDK 类型 |
| `624a94ae3` | session.list 补 error 声明 + errorLayer 兜底 typed fails |

每次都是"一行脏数据 = 整个列表瘫痪 + 必须删库"的脆弱性体现。

---

## 1. 根因分析

### 1.1 错误传播链路

```
SQLite 坏行（category="unknown_value"）
  ↓
fromRow() 用 `category as Info["category"]` 强转，无校验
  ↓
session-category-query.ts 循环 yield，无 try/catch
  ↓
HTTP handler 返回 Info[]
  ↓
effect HttpApi encode 响应时跑 Session.Info schema
  ↓
category 不在枚举 → 抛 HttpApiSchemaError
  ↓
errorLayer: HttpApiSchemaError 实现 HttpServerRespondable
  ↓
被 isRespondable(defect)===true 过滤 → passthrough
  ↓
Hono 框架默认 → 400 空 body
```

### 1.2 关键发现

- **errorLayer 兜不住出口 schema 错误**：`HttpApiSchemaError` 实现 `HttpServerRespondable`，被 `error.ts:56` 的 `isRespondable` 过滤掉，直接 passthrough。在出口做 schema 校验已经太晚。
- **fromRow 是无校验的强转**：`session.ts:73` 的 `category as Info["category"]` 直接强转，TypeScript 不报错，但运行时 schema 校验会失败。
- **5 个读取点都无 try/catch**：`session-category-query.ts` 的所有 fromRow 调用都没有错误兜底，单行抛错整个 generator 抛错。

---

## 2. 两层防御总览

| 层级 | 思路 | 目标 | 状态 |
|---|---|---|---|
| **第一层：读取侧接纳** | schema 补全 | 已知合法值能正常编码返回 | ✅ 已完成（commit 900f347be + dd13676aa） |
| **第二层：读取侧容错** | try/catch + 字段降级 | 未来任何未知脏数据都不炸整列 | ⏳ 待实施（本计划） |

**为什么两层都要做：**
- 只做接纳：下一次出现新的脏数据（比如某个 brand 字段格式不对、model 字段结构异常）还会再炸。
- 只做容错：对 subagent 这种合法值的脏数据，跳过/降级会让正常会话丢失或字段缺失，本可避免。
- 两层组合：已知合法值正常显示，未知脏数据隔离，不互相干扰。

---

## 3. 第一层：读取侧接纳（已完成）

**目标**：让旧 db 里的 subagent 行能正常编码返回，中招客户的库直接能加载、无需删库。

**已完成内容**：
- `Session.Info.category` 的 Union 补 `Schema.Literal("subagent")`（`session.ts:183-191`）
- `SessionCategory` 类型同步（`session-category.sql.ts:6`）
- SDK 类型重新生成（`packages/sdk/js/src/v2/gen/types.gen.ts:747,1399`）

**对应 commit**：`900f347be` + `dd13676aa`

**效果验证**：旧 db 中 category="subagent" 的行现在能正常通过 HTTP 序列化返回，列表不再 400。

---

## 4. 第二层：读取侧容错（待实施）

**目标**：对任何未来的脏数据免疫，不只 subagent。一行脏数据不再拖垮整个列表。

### 4.1 修改文件清单

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/session/session.ts` | 改造 `fromRow`，对 category 做防御性校验 |
| `packages/opencode/src/session/session-category-query.ts` | 4 个列表方法 + 1 个单条方法加 try/catch 容错 |
| `packages/opencode/test/server/session-list.test.ts` | 新增脏数据测试用例 |

### 4.2 Step 1: `fromRow` 内部对 category 做防御性降级

**文件**: `packages/opencode/src/session/session.ts:73`

将：
```ts
category: category as Info["category"],
```
改为：
```ts
category: CATEGORY_VALUES.has(category ?? "") ? (category as Info["category"]) : undefined,
```

复用 `AGENT_TO_CATEGORY` 的 values 构建合法值集合（避免三处枚举不同步）：
```ts
import { AGENT_TO_CATEGORY } from "./session-category"
const CATEGORY_VALUES = new Set(Object.values(AGENT_TO_CATEGORY))
```

> **设计取舍**：对 category 做"降级为 undefined"而非"跳过整行"，因为它是可选字段，单字段异常不应让整个 session 不可见。其他字段（如 model 异常）才走"跳过整行"路径。

### 4.3 Step 2: `session-category-query.ts` 列表方法加 try/catch 容错

**文件**: `packages/opencode/src/session/session-category-query.ts`

引入 log：
```ts
import { log } from "@/util/log"
```

#### 4.3a. `listByProjectWithCategory`（line 84-86）

```ts
for (const row of rows) {
  try {
    yield fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)
  } catch (err) {
    log.error("session-list:skip-bad-row", { sessionID: row.session.id, error: String(err) })
  }
}
```

#### 4.3b. `childrenWithCategory`（line 33）

```ts
return rows.flatMap((row) => {
  try {
    return [fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)]
  } catch (err) {
    log.error("session-children:skip-bad-row", { sessionID: row.session.id, error: String(err) })
    return []
  }
})
```

#### 4.3c. `listGlobalWithCategory`（line 153-156）

```ts
for (const row of rows) {
  try {
    const project = projects.get(row.session.project_id) ?? null
    yield { ...fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined), project }
  } catch (err) {
    log.error("session-global-list:skip-bad-row", { sessionID: row.session.id, error: String(err) })
  }
}
```

#### 4.3d. `getAllWithCategory`（line 159-167）

```ts
return Database.use((db) => ...).flatMap((row) => {
  try {
    return [fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)]
  } catch (err) {
    log.error("session-all:skip-bad-row", { sessionID: row.session.id, error: String(err) })
    return []
  }
})
```

#### 4.3e. `getWithCategory`（line 11-22）— 单条查询加保护

```ts
export function getWithCategory(id: SessionID): Info | null {
  const row = Database.use((db) => ...)
  if (!row) return null
  try {
    return fromRow(row.session as typeof SessionTable.$inferSelect, row.category ?? undefined)
  } catch (err) {
    log.error("session-get:bad-row", { sessionID: id, error: String(err) })
    return null
  }
}
```

### 4.4 Step 3: 修改记录

按项目规范，在 `packages/opencode/opencode_modify/` 目录新增 markdown 记录本次修改。

---

## 5. 覆盖范围说明

读取侧加固（`fromRow` + `session-category-query.ts`）同时覆盖：
- **httpapi 表**：`handlers/session.ts` → `Session.list` → `CategoryQuery.listByProjectWithCategory` → `fromRow`
- **Hono 旧表**：`routes/instance/session.ts` → 同一路径
- **v2 cursor 版**：`SessionV2.Service.list` 不含 category 字段，不受影响

---

## 6. 关键文件清单

| 用途 | 文件路径 |
|---|---|
| fromRow 函数（加固点 1） | `packages/opencode/src/session/session.ts:51-93` |
| 5 个读取方法（加固点 2） | `packages/opencode/src/session/session-category-query.ts` |
| Session.Info schema（第一层已补 subagent） | `packages/opencode/src/session/session.ts:171-200` |
| 合法 category 集合源 | `packages/opencode/src/session/session-category.ts:13-26` (`AGENT_TO_CATEGORY`) |
| SessionCategory TS 类型（第一层已同步） | `packages/opencode/src/session/session-category.sql.ts:6` |
| safeParse 参考样例 | `packages/opencode/src/session/prompt.ts:1292-1314` |
| errorLayer 定义（兜不住出口 schema 错误） | `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts:36-86` |
| httpapi list handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:61-81` |
| Hono list handler | `packages/opencode/src/server/routes/instance/session.ts:43-100` |
| 现有 list 测试（无脏数据用例） | `packages/opencode/test/server/session-list.test.ts` |
| SDK v2 生成类型（第一层已同步） | `packages/sdk/js/src/v2/gen/types.gen.ts:747,1399` |

---

## 7. 验证方案

### 7.1 单元测试

在 `test/server/session-list.test.ts` 中新增测试用例：
- 往 SQLite 插入一条 category 为非法值（如 `"unknown_category"`）的 session → 验证列表中该 session 的 category 为 `undefined`（降级）而非抛错
- 插入一条 model 字段为非法结构的 session → 验证该行被跳过，列表正常返回其他行

### 7.2 手动验证

1. 启动 dev server
2. 调用 `GET /session` 接口
3. 确认列表正常返回，无 400/500

### 7.3 构建检查

```bash
pnpm --filter opencode build
```

确保 TypeScript 编译通过。

---

## 8. 后续可考虑的延伸加固（不在本次范围）

- **第三层：写入侧校验**：`Session.createNext` 在写库前对 Info 做 schema 校验，从源头防止脏数据进库（治本，但需评估性能影响）
- **数据库迁移脚本**：扫描历史脏数据，清理或修复非法 category 值
- **统一 category 枚举**：`SessionCategory` 类型、`Session.Info` schema、`AGENT_TO_CATEGORY` 三处目前分散，可考虑抽到单一源（已有部分复用）
