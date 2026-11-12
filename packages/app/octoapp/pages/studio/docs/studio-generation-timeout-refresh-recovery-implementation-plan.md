# Studio 生成任务超时异常状态与刷新恢复实施方案

## 1. 背景

Studio 内部生成任务由服务端 worker 持续调用供应商任务查询接口获取排队、进度和结果。当前实现以 Studio 本地记录的 `time_created` 为起点，超过 30 分钟后直接把任务写成 `failed`：

```ts
if (Date.now() - record.time_created > 30 * 60_000) {
  throw new Error(`Studio generation timed out after 30 minutes. id=${record.id}`)
}
```

当前行为存在以下问题：

1. `time_created` 在提示词精炼和供应商 `create_task` 之前写入，前置流程会占用生成轮询时间。
2. 供应商任务可能只是排队或生成较慢，本地达到时限并不代表供应商已经失败。
3. 超时被写成普通 `failed`，UI 无法区分“供应商明确失败”和“供应商状态暂时未知”。
4. 内部英文错误、generation ID 等诊断信息会通过 generation API 和 session tool part 展示给用户。
5. 超时后 worker 停止查询，供应商稍后完成时 Studio 无法自动取回结果。
6. 当前 `query_task` 请求没有独立 HTTP 超时，单次请求挂住时，整体 30 分钟判断反而无法继续执行。

## 2. 已确认的产品与技术决策

本次方案采用以下固定决策：

1. 供应商成功返回 `task_id` 后才开始计算自动轮询时限。
2. 所有异步生成任务共用 60 分钟时限，不按能力、模型或视频时长拆分。
3. 新增 generation 状态 `abnormal`，专门表示“自动轮询达到 60 分钟，供应商最终状态仍未知”。
4. `abnormal` 不等同于生成失败。
5. abnormal 卡片显示“重新编辑”和“刷新状态”，不显示“重新生成”。
6. abnormal 提示文案固定为：`生成耗时较长，状态异常，请刷新状态`。
7. 点击“刷新状态”后，通过原 `task_id` 调用 `queryInternalGeneration()` 查询供应商一次。
8. 供应商仍在排队或生成时，恢复原任务并从刷新时刻重新计算 60 分钟。
9. 供应商成功时直接恢复结果。
10. 供应商明确失败时才进入 `failed`，然后展示现有“重新生成”按钮。
11. 不新增 `failure_code` 字段，`abnormal` 状态本身就是超时异常的机器可读标识。
12. 新增且只新增一个数据库字段 `poll_started_at`。
13. 不处理已经超时并显示为 `failed` 的旧数据。超时本身是极少数场景，本方案只保证发布后的新任务。

## 3. 非目标

- 不迁移或修复历史超时失败记录。
- 不通过旧错误字符串识别历史超时。
- 不新增 `failure_code` 或 `failureCode`。
- 不允许前端直接调用供应商接口。
- 不改变正常 worker 的轮询频率和临时错误退避策略。
- 不为 abnormal 卡片提供直接“重新生成”入口。
- 不改变普通供应商失败任务现有的 `reboot_task` 逻辑。
- 不把单次网络错误、HTTP 500 或供应商临时业务错误转换成 abnormal；60 分钟以内继续按现有策略重试。

## 4. 最终状态模型

### 4.1 类型定义

服务端和前端的 generation status 增加：

```ts
type StudioGenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "create_failed"
  | "failed"
  | "abnormal"
```

`abnormal` 的严格语义是：

> Studio 已经从供应商任务创建成功开始自动查询满 60 分钟，供应商仍未返回明确成功或失败；本地暂停自动查询，等待用户手动刷新状态。

不得把其他错误复用为 abnormal。

### 4.2 状态转换

```text
创建 Studio generation
        │
        │ 提示词精炼 / create_task，此阶段不计算60分钟
        ▼
获得 task_id，写入 poll_started_at
        │
        ├── status 0/1 ───────────────► running
        ├── status 6 ─────────────────► queued
        ├── status 2 ─────────────────► succeeded
        ├── 供应商明确失败 ───────────► failed
        ├── 用户取消 ─────────────────► failed
        └── 自动轮询满60分钟 ─────────► abnormal
                                               │
                                               │ 点击刷新状态
                                               ▼
                                      queryInternalGeneration(task)
                                               │
                         ┌─────────────────────┼─────────────────────┐
                         ▼                     ▼                     ▼
                    queued/running         succeeded               failed
                         │                     │                     │
                    恢复自动轮询            恢复结果          普通失败，可重新生成
                    重置60分钟
```

### 4.3 abnormal 是否属于终态

abnormal 对自动 worker 来说是暂停态：worker 只扫描 `queued/running`，因此不会继续自动查询。

abnormal 对业务来说不是最终结果：用户可以通过刷新将其恢复为 queued、running、succeeded 或 failed。

因此实现中不要把 abnormal 放入“永远不允许回到运行态”的状态回归保护。必须允许：

```text
abnormal → queued
abnormal → running
abnormal → succeeded
abnormal → failed
```

## 5. 数据库设计

### 5.1 修改表定义

文件：

`packages/opencode/src/studio/studio-generation.sql.ts`

修改状态类型：

```ts
export type StudioGenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "create_failed"
  | "failed"
  | "abnormal"
```

新增可空字段：

```ts
poll_started_at: integer(),
```

`poll_started_at` 表示当前 `provider_task_id` 开始接受 Studio 自动轮询的 Unix 毫秒时间戳。

不新增：

```text
failure_code
```

SQLite 中 `status` 当前是普通 `text`，没有 CHECK 枚举约束，因此增加 `abnormal` 不需要修改数据库列；只需要更新 TypeScript 类型和 API schema。

### 5.2 新增 migration

新增目录，例如：

`packages/opencode/migration/20261013090000_studio_generation_poll_started_at/migration.sql`

内容：

```sql
ALTER TABLE `studio_generation` ADD `poll_started_at` integer;
```

字段允许 `NULL`，原因是：

- 提示词精炼阶段还没有 task ID。
- `create_task` 尚未成功时不应开始计时。
- jimeng 同步执行路径可能不使用后台 task ID 轮询。
- 升级前已有记录没有该字段值。

### 5.3 旧数据策略

本次不处理已经因为旧 30 分钟规则而进入 `failed` 的记录：

- 不解析旧英文超时错误。
- 不把旧 failed 自动改成 abnormal。
- 不给旧 failed 显示刷新按钮。
- 不为旧数据补写 `poll_started_at`。

对于发布时仍处于 queued/running、但 `poll_started_at` 为 NULL 的旧任务，不补写计时起点，也不应用新的 60 分钟 abnormal 判断；worker 仍可继续正常查询，直到供应商返回成功或失败。本方案的超时兜底只从新版本创建并成功写入 `poll_started_at` 的任务开始生效。

## 6. 统一超时常量与判断

文件：

`packages/opencode/src/studio/studio-service.ts`

新增：

```ts
const STUDIO_GENERATION_POLL_TIMEOUT_MS = 60 * 60_000
```

提取统一判断：

```ts
function studioGenerationPollExpired(record: StudioGenerationRecord, now = Date.now()) {
  return record.poll_started_at !== null &&
    now - record.poll_started_at >= STUDIO_GENERATION_POLL_TIMEOUT_MS
}
```

当前两处基于 `time_created` 的 30 分钟判断都改为使用该函数：

1. `processGeneration()` 查询供应商前的硬截止判断。
2. catch 中判断临时查询异常是否还能继续退避重试。

不要分别写两份 60 分钟表达式，避免边界条件不一致。

## 7. 从拿到 task_id 开始计时

文件：

`packages/opencode/src/studio/studio-service.ts`

主要函数：

- `runGenerationCreatePipeline()`
- `processGeneration()` 中兼容持久化 provider task 的分支

在 `createProviderTask()` 成功返回 task，并将 `provider_task_id` 写入数据库时，同一次更新写入：

```ts
const pollStartedAt = Date.now()

db.update(StudioGenerationTable).set({
  provider_task_id: task.taskId,
  request: stripUndefined({ input: persistedInput, task }),
  status: "running",
  poll_started_at: pollStartedAt,
  next_poll_at: pollStartedAt,
  time_updated: pollStartedAt,
})
```

约束：

1. `provider_task_id` 与 `poll_started_at` 必须在同一次数据库更新中持久化。
2. `createGeneration()` 初始插入记录时 `poll_started_at` 保持 NULL。
3. 提示词精炼成功不能开始计时。
4. 只有供应商 task ID 已经拿到才开始计时。
5. `time_created` 不修改，继续用于卡片创建时间和历史排序。

## 8. worker 超时转 abnormal

### 8.1 processGeneration 调整

文件：

`packages/opencode/src/studio/studio-service.ts`

将当前抛通用异常的逻辑：

```ts
if (Date.now() - record.time_created > 30 * 60_000) {
  throw new Error(...)
}
```

改为明确状态转换：

```ts
if (studioGenerationPollExpired(record)) {
  await markGenerationAbnormal(record)
  return
}
```

不要把超时送入通用 `failGeneration()`，否则会再次混入普通 failed 语义。

### 8.2 markGenerationAbnormal

建议新增：

```ts
async function markGenerationAbnormal(record: StudioGenerationRecord) {}
```

数据库更新只允许从 `queued/running` 抢占：

```ts
const now = Date.now()
const claimed = Database.use((db) =>
  db.update(StudioGenerationTable)
    .set({
      status: "abnormal",
      error: null,
      last_poll_error: null,
      completed_at: null,
      next_poll_at: Number.MAX_SAFE_INTEGER,
      time_updated: now,
    })
    .where(and(
      eq(StudioGenerationTable.id, record.id),
      inArray(StudioGenerationTable.status, ["queued", "running"]),
    ))
    .returning({ id: StudioGenerationTable.id })
    .get(),
)
```

说明：

- `error` 不保存内部超时错误，UI 根据 abnormal 状态显示固定文案。
- `completed_at` 保持 NULL，因为供应商任务并未确认完成。
- `next_poll_at` 设为最大值，使 worker 停止自动查询。
- 保留最后一次 `progress`、`queue_order` 和 `raw_status`，供卡片展示上下文。
- `poll_started_at` 保留原值，便于日志诊断；刷新恢复时再重置。

### 8.3 服务端日志

进入 abnormal 时记录诊断信息，但不返回前端：

```ts
console.warn("[studio.worker] generation polling became abnormal", {
  id: record.id,
  taskId: record.provider_task_id,
  pollStartedAt: record.poll_started_at,
  elapsedMs: record.poll_started_at ? Date.now() - record.poll_started_at : undefined,
  progress: record.progress,
  rawStatus: record.raw_status,
  pollAttempts: record.poll_attempts,
  lastPollError: record.last_poll_error,
})
```

## 9. session tool part 的 abnormal 表达

文件：

`packages/opencode/src/studio/studio-service.ts`

数据库变成 abnormal 后，session tool part 不能继续保持 running，否则页面和 session 状态可能一直 busy。

建议新增：

```ts
function markStudioSessionAbnormal(input: {
  sessionID: SessionID
  turn: StudioPersistedTurn
  taskId?: string
  rawStatus?: number | string
  progress: number
  order?: number
}) {}
```

底层 tool state 使用现有可终止 running 的 `error` 形态，但 Studio metadata 必须写入业务状态：

```ts
state: {
  status: "error",
  input: turn.toolPart.state.input,
  error: "生成耗时较长，状态异常，请刷新状态",
  metadata: {
    ...turn.toolPart.state.metadata,
    statusCode: 500,
    studio: {
      generationID: record.id,
      status: "abnormal",
      taskId: record.provider_task_id,
      rawStatus: record.raw_status,
      progress: record.progress,
      order: record.queue_order,
    },
  },
  time: {
    start: turn.toolPart.state.time.start,
    end: now,
  },
}
```

`turns.ts` 必须优先读取 `metadata.studio.status`。即使底层 tool state 是 error，也要重建成 `result.status = "abnormal"`，不能显示为普通 failed。

刷新恢复到 queued/running 时，再通过 `restoreStudioSession()`：

- 清除 assistant completed/error。
- 把 tool state 改回 running。
- 清除 tool error。
- metadata studio status 改回 queued/running。
- 写回供应商最新 progress/order/rawStatus。

## 10. 供应商 query_task 请求超时

文件：

`packages/opencode/src/tool/internel_image_generate.ts`

当前私有 `queryTask()` 的 fetch 没有 AbortSignal。增加：

```ts
const DEFAULT_QUERY_TIMEOUT_MS = 30_000
```

支持环境变量：

```text
IMAGE_QUERY_TIMEOUT_MS
```

实现结构与 `cancelInternalGeneration()`、`rebootInternalGeneration()` 一致：

```ts
const controller = new AbortController()
const timeout = setTimeout(
  () => controller.abort(),
  timeoutMsFor("IMAGE_QUERY_TIMEOUT_MS", DEFAULT_QUERY_TIMEOUT_MS),
)

const response = await fetch(queryUrl, {
  method: "GET",
  headers,
  signal: controller.signal,
}).finally(() => clearTimeout(timeout))
```

正常 worker 中，该异常保持现有可重试网络错误语义；刷新操作中则转换成友好提示，generation 继续保持 abnormal。

## 11. 刷新状态的供应商调用链

### 11.1 职责边界

刷新接口不实现新的供应商协议，也不复制 query URL、鉴权、状态解析或媒体提取逻辑。

调用链必须是：

```text
结果卡“刷新状态”
        │
        ▼
POST /studio/generations/:generationID/refresh
        │
        ▼
studio-service.refreshGeneration(generationID)
        │
        ├─ 读取 studio_generation
        ├─ 校验 status === abnormal
        ├─ 从 request + provider_task_id 还原 ImageGenerationTask
        │
        ▼
queryInternalGeneration(task)
        │
        ├─ 调用供应商 query_task?task_id=...
        ├─ 归一化 status/progress/order
        ├─ 成功时提取图片或视频 URL
        └─ 返回 ImageGenerationQuery
        │
        ▼
refreshGeneration 根据 query.status 更新 generation 和 session
```

真正调用供应商的唯一公开函数是：

```ts
export async function queryInternalGeneration(
  task: ImageGenerationTask,
): Promise<ImageGenerationQuery>
```

位于：

`packages/opencode/src/tool/internel_image_generate.ts`

`studio-service.ts` 不直接调用私有 `queryTask()`，也不重新拼供应商地址。

### 11.2 为什么仍需 Studio refresh endpoint

HTTP refresh endpoint 除了触发一次供应商查询，还负责：

1. 使用数据库中的可信 task ID，而不是接受浏览器传入 task ID。
2. 校验 generation 属于当前 workspace。
3. 使用服务端供应商凭据和环境配置。
4. 把供应商结果原子写回 generation。
5. 恢复 session assistant/tool part。
6. 成功时复用完成逻辑并触发缩略图。
7. running 时重启 worker 和新的 60 分钟窗口。
8. 防止用户重复点击造成并发状态覆盖。

## 12. 从记录还原 ImageGenerationTask

文件：

`packages/opencode/src/studio/studio-service.ts`

`queryInternalGeneration()` 需要完整 `ImageGenerationTask`，不只接收 task ID：

```ts
function internalGenerationTask(record: StudioGenerationRecord): ImageGenerationTask {
  if (record.provider !== "internel") {
    throw new Error(`Studio generation provider cannot be queried: ${record.provider}`)
  }
  if (!record.provider_task_id) {
    throw new Error(`Studio generation has no provider task id: ${record.id}`)
  }

  const data = generationRequest(record)
  return {
    provider: "internel",
    model: data.task?.model ?? data.input.styleModel ?? "internel",
    capability: data.task?.capability ?? data.input.capability,
    toolAction: data.task?.toolAction ?? toolActionForCapability(data.input.capability),
    taskId: record.provider_task_id,
    input: data.task?.input ?? data.input,
    request: data.task?.request ?? {},
  }
}
```

以 `record.provider_task_id` 为最终可信 task ID。`record.request.task` 提供 model、capability、toolAction、input 和 request 摘要。

如果 `data.task.taskId` 与 `record.provider_task_id` 不一致，只记录 warning，查询必须使用数据库列中的当前 task ID。

## 13. refreshGeneration 服务实现

### 13.1 服务签名

文件：

`packages/opencode/src/studio/studio-service.ts`

新增：

```ts
export async function refreshGeneration(
  id: string,
): Promise<StudioGenerationResult & { sessionID: string }>
```

只有以下状态会实际查询供应商：

```ts
record.status === "abnormal"
record.provider === "internel"
Boolean(record.provider_task_id)
```

其他状态调用该接口时不重复查询供应商，直接返回 `getGeneration(id)` 的当前快照。这样刷新接口具备幂等性，可以处理重复点击、跨页面刷新和客户端超时后重试。

### 13.2 并发保护

新增：

```ts
const refreshingGenerations = new Map<
  string,
  Promise<StudioGenerationResult & { sessionID: string }>
>()
```

同一 workspace、同一 generation 的并发刷新复用正在执行的 Promise，而不是让第二个请求失败。数据库更新仍必须使用：

```ts
where(and(
  eq(StudioGenerationTable.id, id),
  eq(StudioGenerationTable.status, "abnormal"),
  eq(StudioGenerationTable.provider_task_id, task.taskId),
))
```

防止查询期间记录已被其他操作改变。

### 13.3 主函数骨架

```ts
async function refreshGenerationOnce(
  id: string,
): Promise<StudioGenerationResult & { sessionID: string }> {
  const record = loadGenerationRecord(id)
  if (!record) throw new Error(`Studio generation not found: ${id}`)
  if (record.status !== "abnormal") return getGeneration(id)

  const task = internalGenerationTask(record)
  const query = await queryInternalGeneration(task)

  if (query.status === "queued" || query.status === "running") {
    if (restoreAbnormalGeneration(record, task, query)) startStudioGenerationWorker()
    return getGeneration(id)
  }

  if (query.status === "succeeded") {
    if (!restoreAbnormalGeneration(record, task, query)) return getGeneration(id)
    startStudioGenerationWorker()
    const latest = loadGenerationRecord(id)
    if (!latest) throw new Error(`Studio generation not found: ${id}`)
    await completeGeneration(latest, query)
    return getGeneration(id)
  }

  markAbnormalGenerationFailed(record, query)
  return getGeneration(id)
}

export function refreshGeneration(id: string) {
  const key = `${Instance.directory}:${id}`
  const current = refreshingGenerations.get(key)
  if (current) return current
  const operation = refreshGenerationOnce(id).finally(() => refreshingGenerations.delete(key))
  refreshingGenerations.set(key, operation)
  return operation
}
```

约束：

- `/refresh` 不接收 task ID request body。
- `queryInternalGeneration()` 每次点击只调用一次。
- 查询异常时不改变数据库和 session，任务继续保持 abnormal。
- 所有成功响应最终通过 `getGeneration(id)` 返回。

## 14. 刷新结果落库

### 14.1 queued/running：恢复原任务

新增 helper：

```ts
function restoreAbnormalGeneration(
  record: StudioGenerationRecord,
  task: ImageGenerationTask,
  query: ImageGenerationQuery,
) {}
```

关键更新：

```ts
const now = Date.now()
const status = query.status === "succeeded" ? "running" : query.status
const nextPollAt = query.status === "succeeded"
  ? now + 60_000
  : now + (query.status === "queued" ? 4000 : 2500)

db.update(StudioGenerationTable).set({
  status,
  raw_status: String(query.rawStatus),
  progress: query.progress,
  queue_order: query.order,
  error: null,
  last_poll_error: null,
  poll_started_at: now,
  poll_attempts: 0,
  completed_at: null,
  next_poll_at: nextPollAt,
  time_updated: now,
})
```

where 条件必须同时检查：

```ts
status === "abnormal"
provider_task_id === task.taskId
```

修改数据库前先读取并构造完整的 session assistant/tool part，提前暴露缺失消息或 tool part 等错误。数据库抢占成功后再应用准备好的 session 更新。

如果 session 更新失败，使用本次 `time_updated`、task ID 和 active status 作为条件，把数据库补偿回滚到原 abnormal 状态；如果条件回滚失败，说明状态已经被其他流程推进，此时确保 worker 已启动，不能覆盖较新的状态。

恢复成功后调用：

```ts
restoreStudioSession({ record, task, query })
```

`restoreStudioSession()` 需要支持传入 query，把 session metadata 恢复为真实的 queued/running、progress、order、rawStatus，而不是固定进度 0。

恢复后调用：

```ts
startStudioGenerationWorker()
```

从 `poll_started_at = now` 开始获得新的完整 60 分钟窗口。

### 14.2 succeeded：恢复结果

现有 `completeGeneration()` 只允许从 queued/running 完成，并且要求 tool part 是 running。因此：

1. 先准备 session 恢复内容，再通过 `restoreAbnormalGeneration()` 临时恢复成 running。
2. session tool part 恢复为 running。
3. 重新加载最新 record。
4. 调用：

```ts
await completeGeneration(latest, query)
```

5. 临时恢复成功后立即确保 worker 已启动。
6. 复用现有结果持久化、session completed 更新和缩略图入队逻辑。

succeeded 的临时 running 记录把 `next_poll_at` 设置为 `now + 60_000`，避免 worker 在 `completeGeneration()` 完成前抢先查询。如果当前进程意外退出，worker 仍能在 lease 到期后接管。

### 14.3 failed：转成普通失败

供应商明确失败或取消时，完全复用当前已有的错误文案规则，不新增、不改写真正失败和取消的展示文案：

```ts
const message = Number(query.rawStatus) === 4
  ? "用户取消生成"
  : query.error?.trim() || "生成任务失败"
```

其中：

- `rawStatus === 4`：保持显示 `用户取消生成`。
- 供应商返回 `error_message`：保持原样显示 `query.error`。
- 供应商没有返回有效错误文案：保持现有兜底 `生成任务失败`。

数据库更新：

```ts
db.update(StudioGenerationTable).set({
  status: "failed",
  raw_status: String(query.rawStatus),
  error: message,
  last_poll_error: null,
  completed_at: Date.now(),
  next_poll_at: Number.MAX_SAFE_INTEGER,
  time_updated: Date.now(),
})
```

同时必须把 abnormal session tool part 更新为普通 failed：

```ts
state.status = "error"
state.error = message
metadata.studio.status = "failed"
metadata.studio.rawStatus = query.rawStatus
metadata.studio.taskId = query.taskId
```

不能只更新 `studio_generation.error`。当前结果卡优先读取 `turn.toolError`；如果 session tool part 仍保留 abnormal 固定文案，前端会用旧文案覆盖最新的真实失败信息。

更新完成后刷新按钮消失，结果卡恢复当前普通 failed 的展示逻辑和现有“重新生成”按钮。

本方案唯一新增的固定文案仅用于 abnormal：

```text
生成耗时较长，状态异常，请刷新状态
```

真正的失败和取消继续沿用现有文案解析与展示优先级，不做任何产品文案调整。

### 14.4 查询异常

以下情况不修改 generation：

- 网络失败。
- query HTTP 超时。
- 408、409、425、429、500、502、503、504。
- `resp_code !== 200` 且供应商没有明确失败状态。
- 无法解析出可信状态。

接口返回：

```text
任务状态查询失败，请稍后重试
```

数据库仍为 abnormal，用户可以再次刷新。

## 15. 新增 refresh HTTP 接口

### 15.1 HttpApi 路径与 schema

文件：

`packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

增加路径：

```ts
generationRefresh: `${root}/generations/:generationID/refresh`,
```

增加 endpoint：

```ts
HttpApiEndpoint.post("refreshGeneration", StudioPaths.generationRefresh, {
  params: { generationID: Schema.String },
  success: described(StudioGenerationResult, "Refreshed Studio generation"),
  error: [HttpApiError.BadRequest, ApiStudioGenerationError],
})
```

`StudioGenerationResult.status` schema 增加：

```ts
Schema.Literal("abnormal")
```

不增加 `failureCode`。

### 15.2 Effect handler

文件：

`packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

修改：

1. 导入 `refreshGeneration`。
2. 新增 `StudioHttpApi.refreshGeneration` handler。
3. 使用 `Instance.restore(instance, () => refreshGeneration(id))`。
4. 注册 `.handle("refreshGeneration", refresh)`。

### 15.3 兼容 Hono 路由

文件：

`packages/opencode/src/server/routes/instance/studio.ts`

增加：

```ts
.post(
  "/generations/:generationID/refresh",
  async (c) => c.json(await refreshGeneration(c.req.param("generationID"))),
)
```

### 15.4 SDK 生成

HttpApi schema 修改后执行：

```sh
./packages/sdk/js/script/build.ts
```

生成文件不要手工修改。

## 16. 普通重新生成逻辑：仅补充 poll_started_at 重置

文件：

`packages/opencode/src/studio/studio-service.ts`

函数：

`rebootGeneration()`

本节不修改现有重新生成的产品逻辑、接口语义或供应商调用流程。单独列出本节的唯一原因是新增了 `poll_started_at` 字段：供应商 `reboot_task` 返回新 task ID 后，必须同步记录这个新任务的轮询计时起点。

以下现有行为全部保持不变：

1. 仍然只允许符合现有条件的普通 failed 任务重新生成。
2. 仍然调用现有 `rebootInternalGeneration()`。
3. 仍然使用原 task ID 调用供应商 `reboot_task`。
4. 仍然以供应商返回的新 task ID 替换 `provider_task_id`。
5. 仍然清空旧进度、队列位置、错误和结果。
6. 仍然恢复 session tool part 并启动 worker。
7. 现有校验、失败文案、按钮行为和接口返回均不改变。

明确不增加以下逻辑：

- 不在 reboot 前调用 `queryInternalGeneration()`。
- 不检查旧任务是否仍在生成。
- 不为 abnormal 任务开放 reboot。
- 不修改 `rebootInternalGeneration()` 的供应商请求。

实际代码修改点只有一处：在现有 reboot 成功后的数据库 `.set(...)` 中增加：

```ts
poll_started_at: updatedAt,
```

放入现有更新后的关键结构示意：

```ts
const updatedAt = Date.now()

db.update(StudioGenerationTable).set({
  provider_task_id: task.taskId,
  status: "running",
  progress: 0,
  queue_order: null,
  raw_status: null,
  error: null,
  last_poll_error: null,
  result: null,
  request: stripUndefined({ input: data.input, task }),
  poll_started_at: updatedAt,
  poll_attempts: 0,
  completed_at: null,
  next_poll_at: updatedAt,
  time_updated: updatedAt,
})
```

必须重置该字段，因为新 task ID 对应一个新的供应商任务。如果沿用旧 `poll_started_at`，新任务会继承旧任务已消耗的轮询时间，可能提前甚至立即进入 abnormal。

`time_created` 不重置，它仍表示 Studio 卡片最初创建时间。除新增 `poll_started_at: updatedAt` 外，当前 `rebootGeneration()` 逻辑保持原样。

## 17. generation API 返回

文件：

`packages/opencode/src/studio/studio-service.ts`

修改：

- `StudioGenerationAccepted` / `StudioGenerationResult` 服务端类型。
- `generationSnapshot()`。
- `getGeneration()`。

abnormal 响应示例：

```json
{
  "id": "studio_gen_xxx",
  "status": "abnormal",
  "capability": "video.generate",
  "provider": "internel",
  "taskId": "provider_task_xxx",
  "progress": 68,
  "rawStatus": 1,
  "images": []
}
```

abnormal 不需要返回 `error`。前端根据 status 显示固定产品文案，避免 API 文案和 session tool error 优先级冲突。

`generationSnapshot()` 和 `getGeneration()` 当前只在 `create_failed/failed` 返回 error，这一规则可以保持不变。

## 18. 前端类型与历史解析

### 18.1 类型

文件：

`packages/app/octoapp/pages/studio/types.ts`

在 `StudioGenerationStatus` 增加：

```ts
| "abnormal"
```

不增加 `failureCode`。

### 18.2 公共状态判断

文件：

`packages/app/octoapp/pages/studio/studio-shared.ts`

修改：

- `studioResultCardStatus()` 显式识别 abnormal。
- `isStudioGenerationFailure()` 继续只把 `create_failed/failed` 视为失败，不包含 abnormal。
- `isStudioGenerationStatusRegression()` 应把 abnormal 视为自动同步链路中的停止态，阻止旧 session 事件或旧 GET 结果把它回退成 queued/running。用户点击“刷新状态”后，由刷新接口响应在 `refreshStudioGeneration()` 中显式写入 queued/running，不经过这条自动状态合并保护，因此仍能完成 `abnormal → queued/running` 恢复。

建议：

```ts
if (generationStatus === "abnormal") return "abnormal"
```

### 18.3 session 历史解析

文件：

`packages/app/octoapp/pages/studio/turns.ts`

修改 `studioProgress()` 和失败 tool part 重建逻辑：

- 允许 metadata studio status 为 abnormal。
- 即使底层 tool state 是 error，只要 metadata status 是 abnormal，就构造 `result.status = "abnormal"`。
- 保留 taskId、progress、order、rawStatus。
- 不把 tool error 覆盖成普通 failed 状态。

测试文件：

`packages/app/octoapp/pages/studio/turns.test.ts`

增加 abnormal session metadata 的重建用例。

## 19. 前端刷新请求

文件：

`packages/app/octoapp/pages/studio-page.tsx`

### 19.1 刷新中状态

新增：

```ts
const [refreshingGenerationIDs, setRefreshingGenerationIDs] =
  createSignal<ReadonlySet<string>>(new Set())
```

### 19.2 refreshStudioGeneration

新增：

```ts
async function refreshStudioGeneration(id: string) {}
```

请求：

```http
POST /studio/generations/:id/refresh
```

客户端 AbortController timeout 建议 35 秒，略高于服务端 query_task 的 30 秒 timeout。

成功后完全以响应状态为准：

- queued/running：更新 `pendingResult` 和页面 status，现有轮询 effect 自动恢复。
- succeeded：更新结果、重新加载 session messages、执行缩略图逻辑。
- failed：更新失败卡，展示重新生成。
- abnormal：表示并发操作没有获得状态转换权或后端仍保持异常，继续显示异常卡。

请求失败：

- 不把 abnormal 改成 failed。
- 不清空原任务。
- 先额外执行一次普通 generation GET；如果服务端实际已恢复为 queued、running、succeeded 或 failed，使用 GET 结果修正页面，不显示查询失败提示。
- 显示 floating notice：`任务状态查询失败，请稍后重试`。
- 保留刷新按钮。

### 19.3 常规 GET 轮询错误

当前 generation GET 失败一次就执行 `setStatus("failed")`，会把网络错误错误转换成业务失败。本次一并调整：

1. 保持当前 queued/running。
2. 记录前端日志。
3. 继续调度下一次 GET。
4. 只有服务端明确返回 failed、create_failed、abnormal 或 succeeded 才改变业务状态。

## 20. 结果卡交互

涉及文件：

- `packages/app/octoapp/pages/studio-page.tsx`
- `packages/app/octoapp/pages/studio/studio-conversation.tsx`
- `packages/app/octoapp/pages/studio/studio-result-card.tsx`
- `packages/app/octoapp/pages/studio/studio-03.css`

### 20.1 Props

新增：

```ts
refreshing: boolean
onRefreshGeneration: (generationID: string) => void
```

### 20.2 状态与操作矩阵

| 状态 | 标题 | 提示/内容 | 操作 |
| --- | --- | --- | --- |
| queued/running | 生成中/排队中 | 进度条 | 取消生成 |
| abnormal | 状态异常 | 生成耗时较长，状态异常，请刷新状态 | 重新编辑、刷新状态 |
| failed | 生成失败 | 供应商或业务失败原因 | 重新编辑、重新生成 |
| create_failed | 创建失败 | 创建失败原因 | 按现有规则 |
| succeeded | 生成完成 | 媒体结果 | 重新编辑 |

### 20.3 按钮条件

刷新按钮：

```ts
const refreshable = () =>
  status() === "abnormal" &&
  props.turn.result?.provider === "internel" &&
  Boolean(props.turn.result?.taskId) &&
  Boolean(props.turn.result?.id.startsWith("studio_gen"))
```

重新生成按钮保持：

```ts
const rebootable = () =>
  status() === "failed" &&
  props.turn.result?.provider === "internel" &&
  Boolean(props.turn.result?.taskId) &&
  Boolean(props.turn.result?.id.startsWith("studio_gen"))
```

重新编辑当前条件是 `!generating()` 且能力为图片/视频；加入 abnormal 后应明确确认 abnormal 能进入 editable 分支。

### 20.4 文案

abnormal 固定展示：

```text
生成耗时较长，状态异常，请刷新状态
```

其旁边或卡片 header 的原“重新生成”位置显示文字按钮：

```text
刷新状态
```

刷新中：

```text
刷新中...
```

abnormal 文案不得读取 `turn.toolError` 或 `result.error`，否则底层 tool error 可能覆盖产品文案。

### 20.5 样式与可访问性

新增 abnormal 卡片 class，例如：

```text
studio-result-card abnormal
```

刷新必须使用真实 button：

```tsx
<button type="button" ...>刷新状态</button>
```

要求：

- 支持键盘聚焦。
- 刷新中 disabled。
- disabled 使用 wait cursor。
- 与重新编辑操作互斥，避免用户在刷新响应过程中切换当前卡片状态。
- abnormal 不使用普通 failed 的强错误视觉；可保留警示图标，但语义是“状态待确认”。

## 21. worker 与页面恢复行为

### 21.1 worker

worker 查询条件继续保持：

```ts
status IN ("queued", "running")
```

abnormal 不会被自动选中，符合暂停查询语义。

### 21.2 页面轮询

`pollingGenerationID` 继续只返回 queued/running ID。abnormal 后 effect 自动 cleanup 并停止前端 GET。

刷新返回 queued/running 后，pendingResult status 改变，`pollingGenerationID` 再次产生 ID，现有 effect 自动启动。

### 21.3 应用重启

abnormal 已持久化在 generation status 和 session tool metadata 中。应用重启后：

- worker 不会自动恢复它。
- history 可以重建异常卡。
- 用户仍可以点击刷新状态。

## 22. 测试方案

### 22.1 服务端测试

建议新增：

`packages/opencode/test/studio/studio-generation-timeout-recovery.test.ts`

覆盖：

1. 新 generation 初始 `poll_started_at` 为 NULL。
2. create_task 返回 task ID 时，同一更新写入 `provider_task_id` 和 `poll_started_at`。
3. `time_created` 超过 60 分钟但 `poll_started_at` 未超过时不进入 abnormal。
4. `poll_started_at` 达到 60 分钟时进入 abnormal。
5. abnormal 保留 progress、order 和 rawStatus。
6. abnormal 的 `completed_at` 为 NULL，`next_poll_at` 为最大值。
7. abnormal session metadata 正确写入。
8. refresh 确实调用 `queryInternalGeneration()`，且使用数据库中的 provider_task_id。
9. refresh 返回 queued 时恢复 queued 并重置 poll_started_at。
10. refresh 返回 running 时恢复 running 并重启 worker。
11. refresh 返回 succeeded 时恢复结果并更新 session。
12. refresh 返回 failed 时转换为普通 failed。
13. refresh 遇到网络错误、HTTP timeout 或 5xx 时仍保持 abnormal。
14. 并发刷新复用同一个进行中的 Promise，只有一次供应商查询和一次状态修改。
15. 刷新查询期间 task ID 被替换时不会覆盖新任务。
16. 普通 failed 卡片不提供 refresh 按钮；如果因重试或旧页面直接调用 refresh API，接口幂等返回当前 failed 快照，不调用供应商查询。
17. abnormal 不能调用 reboot。
18. 普通 failed reboot 后 poll_started_at 重置为新 task 创建时间。
19. query_task 永久不响应时被 30 秒 HTTP timeout 中止。

不增加旧 30 分钟超时 failed 数据的兼容测试。

### 22.2 前端测试

建议新增或扩展：

- `packages/app/octoapp/pages/studio/turns.test.ts`
- `packages/app/octoapp/pages/studio/studio-result-card.test.tsx`

覆盖：

1. abnormal metadata 重建为 abnormal result。
2. abnormal 显示“状态异常”。
3. abnormal 显示固定提示文案。
4. abnormal 显示“重新编辑”和“刷新状态”。
5. abnormal 不显示“重新生成”。
6. failed 显示“重新编辑”和“重新生成”，不显示刷新状态。
7. 刷新中按钮 disabled 并显示“刷新中...”。
8. 刷新返回 running 后恢复进度条和取消按钮。
9. 刷新返回 succeeded 后展示媒体。
10. 刷新返回 failed 后显示重新生成。
11. refresh 请求失败后仍保持 abnormal。
12. generation GET 偶发失败不会把 running 改成 failed。

### 22.3 验证命令

测试不能从仓库根目录运行。服务端从 package 目录执行：

```sh
cd packages/opencode
bun test test/studio/studio-generation-timeout-recovery.test.ts
bun typecheck
```

前端测试和 typecheck 从实际 app package 目录执行，不直接运行 `tsc`。

HttpApi schema 修改后执行 SDK 生成：

```sh
./packages/sdk/js/script/build.ts
```

## 23. 涉及文件汇总

| 文件 | 修改内容 |
| --- | --- |
| `packages/opencode/src/studio/studio-generation.sql.ts` | status 增加 abnormal，新增 `poll_started_at` |
| `packages/opencode/migration/20261013090000_studio_generation_poll_started_at/migration.sql` | 新增一个可空 `poll_started_at` 字段 |
| `packages/opencode/src/studio/studio-service.ts` | 60 分钟计时、abnormal 转换、refresh service、session 恢复；现有 reboot 落库增加 `poll_started_at` |
| `packages/opencode/src/tool/internel_image_generate.ts` | query_task 增加独立 HTTP timeout |
| `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` | status schema 增加 abnormal，新增 refresh endpoint |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts` | 注册 refresh handler |
| `packages/opencode/src/server/routes/instance/studio.ts` | 注册兼容 Hono refresh 路由 |
| `packages/sdk/js/src/v2/gen/*` | SDK 脚本自动生成更新 |
| `packages/app/octoapp/pages/studio/types.ts` | 前端 status 增加 abnormal |
| `packages/app/octoapp/pages/studio/studio-shared.ts` | abnormal 状态判断与恢复转换 |
| `packages/app/octoapp/pages/studio/turns.ts` | 从 session metadata 重建 abnormal |
| `packages/app/octoapp/pages/studio/turns.test.ts` | abnormal 历史解析测试 |
| `packages/app/octoapp/pages/studio-page.tsx` | refresh 请求、刷新中状态、轮询恢复、GET 错误语义 |
| `packages/app/octoapp/pages/studio/studio-conversation.tsx` | 透传刷新 props |
| `packages/app/octoapp/pages/studio/studio-result-card.tsx` | abnormal 文案、重新编辑、刷新按钮、隐藏重新生成 |
| `packages/app/octoapp/pages/studio/studio-03.css` | abnormal 卡与刷新按钮样式 |
| `packages/opencode/test/studio/studio-generation-timeout-recovery.test.ts` | 服务端状态转换测试 |
| `packages/app/octoapp/pages/studio/studio-result-card.test.tsx` | 结果卡状态和操作测试 |

## 24. 推荐实施顺序

1. 修改数据库 schema 并新增 `poll_started_at` migration。
2. 服务端和 API status union 增加 abnormal。
3. 在 task ID 成功落库时写入 poll_started_at。
4. 将 30 分钟判断改为 poll_started_at 起算的统一 60 分钟函数。
5. 实现 `markGenerationAbnormal()` 和 session abnormal metadata。
6. 给 query_task 增加 HTTP timeout。
7. 实现 `internalGenerationTask()` 和 `refreshGeneration()`。
8. 实现 abnormal → queued/running/succeeded/failed 的原子恢复。
9. 新增两套路由和 HttpApi endpoint。
10. 仅在现有 reboot 成功落库的 `.set(...)` 中增加 `poll_started_at: updatedAt`，其余 reboot 逻辑不变。
11. 更新前端类型、共享判断和 turns 历史解析。
12. 实现前端 refresh 请求和 loading 状态。
13. 更新结果卡文案、按钮与样式。
14. 修正常规 generation GET 一次失败即业务失败的问题。
15. 重新生成 SDK。
16. 增加测试并执行 package 级测试、typecheck 和端到端验收。

## 25. 验收标准

1. 新任务的 60 分钟从供应商 task ID 成功落库时开始。
2. 提示词精炼和 create_task 耗时不占用 60 分钟窗口。
3. 达到 60 分钟后任务进入 abnormal，而不是 failed。
4. abnormal 停止服务端 worker 和前端自动轮询。
5. abnormal 卡显示“生成耗时较长，状态异常，请刷新状态”。
6. abnormal 卡显示“重新编辑”和“刷新状态”，不显示“重新生成”。
7. 刷新操作直接复用 `queryInternalGeneration(task)`。
8. 刷新仍在运行的任务后恢复自动轮询，并从刷新时刻重新获得 60 分钟。
9. 刷新已成功任务后直接恢复媒体结果。
10. 刷新明确失败任务后转为 failed，并显示“重新生成”。
11. 刷新查询异常不会改变 abnormal 状态。
12. 普通 failed 继续使用现有 reboot 逻辑。
13. reboot 获得新 task ID 后重置 poll_started_at。
14. 内部超时诊断信息不会展示给用户。
15. 应用重启后 abnormal 卡仍可从数据库和 session metadata 恢复。
16. 不对旧超时 failed 数据做迁移、识别或恢复。
