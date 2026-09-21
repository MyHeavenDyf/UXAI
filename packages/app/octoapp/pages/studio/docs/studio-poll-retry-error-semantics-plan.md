# Studio 轮询可重试错误语义改造方案

## 背景与目标

Studio 的内部生成任务由服务端 worker 持续调用供应商 `query_task`。供应商偶发返回 408、429、500、502、503、504 时，worker 已按退避策略继续轮询，并且数据库任务状态保持为 `queued` 或 `running`。

但当前实现把这类可重试异常写入 `studio_generation.error`。查询 generation 时又把 `error` 原样返回；前端 `StudioResultCard` 将任何 `result.error` 视为失败。因此会出现同一任务的两个 UI 同时成立：

- `studio-composer` 根据 `status=running` 显示生成中和停止按钮；
- `studio-result-card` 根据 `error` 显示“生成失败”。

本方案的目标是让终态只由 `status` 决定，并将临时轮询异常严格限制在服务端诊断范围内，不返回给前端，也不展示在 Studio UI。

## 最终状态契约

### 生命周期字段

`status` 是 generation 是否终态的唯一依据：

| `status` | 是否终态 | `error` 语义 |
| --- | --- | --- |
| `queued` | 否 | 不返回 |
| `running` | 否 | 不返回 |
| `succeeded` | 是 | 不返回 |
| `failed` | 是 | 最终失败原因 |
| `create_failed` | 是 | 创建阶段最终失败原因 |

### 服务端可重试轮询诊断字段

在数据库和服务端日志中保留以下信息，供排障、监控与重试控制使用：

| 存储字段 | 含义 |
| --- | --- |
| `last_poll_error` | 最近一次供应商状态查询的可重试异常信息 |
| `next_poll_at` | worker 计划发起下一次供应商查询的 Unix 毫秒时间戳 |
| `poll_attempts` | 已完成的供应商查询次数（包含出现可重试异常的查询） |

它们均为内部诊断信息，`GET /studio/generations/:id` 不返回这些字段。供应商轮询请求的 HTTP 500、网络异常，以及供应商响应中的 `resp_code !== 200`（只要 worker 将其识别为可重试）都不得出现在前端响应、结果卡或 Composer 中。

仅当任务实际终止时返回：

```json
{
  "id": "studio_gen_xxx",
  "status": "failed",
  "error": "Studio generation timed out after 30 minutes"
}
```

## 改动清单

### 1. 数据表：保存临时轮询错误

文件：`packages/opencode/src/studio/studio-generation.sql.ts`

在 `StudioGenerationTable` 的 `error` 附近增加可空字段：

```ts
last_poll_error: text(),
```

保留现有字段的职责：

- `error`：仅保存 `failed` / `create_failed` 的最终错误；
- `last_poll_error`：仅保存 worker 判断为可重试的供应商查询异常；
- `next_poll_at`、`poll_attempts`：继续沿用现有字段，不新增重复存储。

不要重命名或删除现有 `error`，以避免旧记录、现有 API 消费者和历史数据兼容问题。

### 2. SQLite migration：给已存在数据库加列

新增一个时间戳递增的 migration 目录，例如：

`packages/opencode/migration/<timestamp>_studio_generation_poll_retry_error/migration.sql`

内容应仅新增可空列：

```sql
ALTER TABLE `studio_generation` ADD `last_poll_error` text;
```

该列必须允许 `NULL`，这样旧数据无需回填。不要尝试把旧 `error` 批量迁移到新字段：历史 `error` 无法可靠区分是真正失败还是当时的临时重试错误；旧任务的终态仍应以其已有 `status` 为准。

### 3. 服务端类型与 generation 查询响应

文件：`packages/opencode/src/studio/studio-service.ts`

修改 `generationSnapshot(record)`：

- `error` 只在 `record.status` 为 `failed` 或 `create_failed` 时映射；
- 不映射 `last_poll_error`、`next_poll_at` 或 `poll_attempts`；
- 对 `queued/running`，只返回正常的任务状态、进度、队列顺序等生成态信息。

这样 `/studio/generations/:id` 的响应可以作为前端唯一、无歧义的状态源：运行中的任务不会携带会被误解为失败的错误字段。

### 4. 服务端 worker：按异常类别写入不同字段

文件：`packages/opencode/src/studio/studio-service.ts`，函数 `processGeneration(record)`。

现有可重试分支识别网络错误及 408/409/425/429/500/502/503/504，并保持 status 为 `queued/running`、设置退避 `next_poll_at`。将该分支的数据库更新从：

```ts
error: message,
```

改为：

```ts
last_poll_error: message,
```

同时维持现有的 `poll_attempts` 递增与指数退避计算，不改变重试次数、30 分钟总超时或 worker 扫描逻辑。

文件：`packages/opencode/src/tool/internel_image_generate.ts`，函数 `queryInternalGeneration(task)` 与 `isFailureResponse(response)`。

供应商可能返回 HTTP 200、但业务字段为 `resp_code !== 200` 且 `result` 为空。此时没有真实任务状态，不能直接归类为 `failed`。应按以下规则处理：

- 供应商响应中有明确终态失败 status：返回 `failed`，由 worker 写入最终 `error`；
- `resp_code !== 200`、但没有明确失败 status（包括 `result: null`）：抛出带 `resp_code=<value>` 的可重试错误；
- worker 的可重试判断必须识别该错误并写入 `last_poll_error`、安排退避，不更新任务为失败。

非可重试分支仍调用 `failGeneration(record, error)`；在这个函数中继续写入 `error: message`，并明确清空 `last_poll_error`。取消逻辑和创建失败逻辑同理：写最终 `error` 时清空 `last_poll_error`。

### 5. 成功的供应商查询：清除临时错误

文件：`packages/opencode/src/studio/studio-service.ts`，函数 `updateStudioGenerationProgress(record, query)`。

当前该函数会在一次正常的非终态查询返回后清空 `error`。改造后应改为清空：

```ts
last_poll_error: null,
```

不要清空最终 `error`，因为该函数只允许在数据库仍为 `queued/running` 时执行，且最终任务不会再进入该函数。

同时在 `completeGeneration` 成功落库路径中清空 `last_poll_error`，防止任务最后一次查询前留下的临时异常残留在最终记录中。

### 6. 前端 API 类型与状态合并

文件：`packages/app/octoapp/pages/studio/types.ts`

文件：`packages/app/octoapp/pages/studio-page.tsx`

不为 `StudioGenerationResult` 增加 `lastPollError`、`retryAt`、`pollAttempts` 等诊断字段。轮询成功时的 `setPendingResult` 继续以服务端 generation 响应为主体合并数据；只有服务端的终态 `error` 才可进入结果状态。

前端请求 `/studio/generations/:id` 本身返回 HTTP 失败的 catch 分支不在本方案的范围内；它是另一条客户端请求失败路径，需单独设计 retry，不能和服务端供应商轮询异常混为一谈。

### 7. 结果卡：状态优先，不展示临时异常

文件：`packages/app/octoapp/pages/studio/studio-result-card.tsx`

调整 `status()` 的判断顺序：

1. `create_failed`、`failed` 是失败终态；
2. 有图片时为 `succeeded`；
3. `queued`、`running` 必须返回生成态；
4. 仅在缺少明确状态的兼容兜底场景下，再用 `toolError` 或最终 `error` 判失败。

核心约束：只要 `status` 为 `queued/running`，结果卡就必须返回生成态，且不展示任何轮询异常、HTTP 状态码、`resp_code` 或重试信息。保持进度条、取消按钮和“生成中”主文案不变。

失败卡只读取 `error` 或 `toolError`，且只在 `status=failed/create_failed` 时展示。

### 8. Composer：保持现有判定，不以诊断字段驱动状态

文件：`packages/app/octoapp/pages/studio-page.tsx` 与 `packages/app/octoapp/pages/studio/studio-composer.tsx`

现有 `isBusy()` 已依据 `queued/running` 显示 Composer 的停止按钮。改造后无需让它读取任何轮询诊断信息。这保证 Composer 与结果卡同样以 `status` 为唯一生命周期依据。

## 兼容与发布顺序

按以下顺序合并和发布，避免新旧端之间产生错误展示：

1. 先发布数据库 migration 与后端字段写入/响应映射；
2. 再发布前端类型与结果卡的状态优先规则；
3. 不新增任何“自动重试”提示文案或诊断字段展示。

前端的状态优先规则应兼容旧后端：即使旧接口仍返回 `status=running` 与 `error`，卡片也应优先显示生成中。新接口发布后，旧字段歧义自然消失。

## 验收用例

### 服务端单元/集成测试

1. `query_task` 返回 500：记录仍为 `running` 或 `queued`，`last_poll_error` 有值，`error` 为 `NULL`，`next_poll_at` 进入退避时间，worker 后续仍会查询；generation 查询接口不返回该错误。
2. 500 后下一次查询返回进行中：`last_poll_error` 被清空，status 与进度更新。
3. 多次 500 到总超时：最终 status 为 `failed`，`error` 为超时原因，`last_poll_error` 为 `NULL`。
4. 供应商显式返回失败：最终 status 为 `failed`，`error` 为供应商失败原因，`last_poll_error` 为 `NULL`。
5. 任务成功：status 为 `succeeded`，图片正常返回，`error` 与 `last_poll_error` 均不返回。

### 前端组件/状态测试

1. 输入 `{ status: "running" }`：结果卡为 generating，不含 `failed` class，显示取消入口。
2. 输入 `{ status: "queued" }`：显示排队/生成状态，不显示失败框。
3. 输入 `{ status: "failed", error: "..." }`：显示失败框和失败原因，不显示取消入口。
4. 输入旧兼容形态 `{ status: "running", error: "status=500" }`：仍显示生成中，且不展示该错误，避免后端灰度发布期间复现问题。
5. Composer 在上述第 1、2、4 项都显示停止按钮；第 3 项切换为发送按钮。

## 非目标

- 不改变供应商查询频率、指数退避公式、30 分钟任务超时或取消流程；
- 不把服务端 worker 的可重试异常等同于浏览器请求 `/studio/generations/:id` 的 HTTP 失败；后者需要独立的前端 retry 方案；
- 不修改 `studio-service-old.ts` 或 `studio-service_副本.ts`。它们不是当前生效的服务实现，除非后续确认有运行时引用。
