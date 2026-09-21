# Studio 生成状态轮询调用修复方案

## 1. 目标与范围

本方案只解决 Studio 前端生成状态查询请求在短时间内被重复调用的问题。

涉及接口：

```http
GET /studio/generations/:generationID
```

涉及文件：

```text
packages/app/octoapp/pages/studio-page.tsx
packages/app/octoapp/pages/studio/studio-shared.ts
```

本次不调整：

- 后端 worker 扫描间隔。
- 后端调用最终 `query_task` 的间隔。
- `task_id` 创建和保存流程。
- Studio 任务状态映射。
- 生成卡片视觉样式。
- 取消生成能力。

## 2. 当前问题

当前前端轮询代码位于 `packages/app/octoapp/pages/studio-page.tsx`：

```ts
createEffect(() => {
  const active = pendingResult() ?? studioTurn()?.result
  if (!active || active.status !== "queued" && active.status !== "running") return
  if (active.id.startsWith("studio_pending_")) return
  if (!isStudioGenerationID(active.id)) return
  const id = active.id

  const refresh = () => {
    getStudioGeneration(id).then((generation) => {
      setPendingResult(...)
      setStatus(generation.status)
    })
  }

  void refresh()
  const timer = setInterval(refresh, STUDIO_GENERATION_STATUS_INTERVAL_MS)
  onCleanup(() => clearInterval(timer))
})
```

配置的轮询间隔是：

```ts
export const STUDIO_GENERATION_STATUS_INTERVAL_MS = 7_500
```

但实际控制台中，同一个 URL 可能在 1 秒内请求十次以上。

## 3. 根因分析

### 3.1 Effect 同时读取和更新 `pendingResult`

轮询 effect 读取：

```ts
pendingResult()
```

请求返回后又调用：

```ts
setPendingResult(...)
```

`pendingResult` 的以下字段发生变化时，effect 都可能重新执行：

- `status`
- `progress`
- `order`
- `error`
- `images`
- `updatedAt`
- 返回对象引用

### 3.2 Effect 每次重跑都会立即查询

effect 重跑时会先清理旧定时器，然后再次执行：

```ts
void refresh()
```

因此实际调用链可能是：

```text
首次 effect 执行
  -> 立即 GET
  -> GET 返回
  -> setPendingResult
  -> effect 重跑
  -> 立即 GET
  -> GET 返回
  -> setPendingResult
  -> effect 再次重跑
```

此时 `7_500ms` 的定时器几乎没有机会触发。

### 3.3 `studioTurn` 更新也会重启轮询

effect 还读取：

```ts
studioTurn()?.result
```

后端 worker 更新 running tool part 后，sync 事件会更新会话数据，进而改变 `studioTurn()`。即使 `pendingResult` 没有变化，也可能重新执行轮询 effect。

### 3.4 已发出的请求不会被 cleanup 取消

当前 cleanup 只执行：

```ts
clearInterval(timer)
```

已经发出的 fetch 仍会继续。多个旧请求返回后，都可能更新 `pendingResult`，再次触发 effect，放大请求数量。

### 3.5 `setInterval` 允许请求重叠

如果一次状态查询耗时超过轮询间隔，`setInterval` 不会等待前一次请求完成，会继续发起下一次请求。

虽然当前请求风暴主要由 effect 重跑造成，但 `setInterval` 仍然存在并发查询风险。

## 4. 修复原则

修复后的轮询应满足：

1. 轮询生命周期只由 `generationID` 决定。
2. 进度、状态和会话消息更新不能重建轮询器。
3. 同一 generation 同一时间最多存在一个状态查询请求。
4. 下一次查询必须在上一次查询完成之后再计时。
5. generation 改变、任务结束或组件卸载时，立即停止旧轮询。
6. 旧请求的响应不能覆盖新任务状态。
7. 首次进入有效任务时可以立即查询一次。
8. 后续请求间隔稳定保持在配置值附近。

## 5. 推荐方案

采用以下组合：

- 独立的 `pollingGenerationID` memo。
- `createEffect(on(...))` 显式依赖任务 ID。
- 递归 `setTimeout` 替代 `setInterval`。
- `AbortController` 取消旧请求。
- 串行请求，避免 in-flight 重叠。
- cleanup 标识阻止旧异步回调写状态。

## 6. 第一步：提取稳定的轮询任务 ID

新增一个 memo，只返回可轮询的真实任务 ID：

```ts
const pollingGenerationID = createMemo(() => {
  const active = pendingResult() ?? studioTurn()?.result
  if (!active) return
  if (active.status !== "queued" && active.status !== "running") return
  if (!isStudioGenerationID(active.id)) return
  return active.id
})
```

这个 memo 的输出只有两类：

```ts
string | undefined
```

即使 `progress` 从 10 变成 20、`order` 变化或 `updatedAt` 更新，只要 ID 没变，memo 的最终值仍是同一个字符串。

注意：仅创建 memo 还不够。轮询 effect 必须通过 `on(pollingGenerationID, ...)` 显式限制依赖，不能在 effect 顶层继续读取完整 `pendingResult()` 或 `studioTurn()`。

## 7. 第二步：使用 `on()` 控制轮询生命周期

建议结构：

```ts
createEffect(
  on(
    pollingGenerationID,
    (id) => {
      if (!id) return
      // 创建该 ID 独占的轮询生命周期
    },
  ),
)
```

该 effect 只在以下情况重跑：

- 没有任务变为存在任务。
- generation ID 改变。
- 当前任务完成或失败，ID 变为 `undefined`。

以下变化不再重跑：

- `progress`
- `order`
- `rawStatus`
- `updatedAt`
- running tool part sync 更新
- `pendingResult` 对象引用改变

## 8. 第三步：递归 `setTimeout` 替代 `setInterval`

不建议：

```ts
setInterval(refresh, 7_500)
```

建议：

```ts
let timer: ReturnType<typeof setTimeout> | undefined

const schedule = () => {
  timer = setTimeout(run, STUDIO_GENERATION_STATUS_INTERVAL_MS)
}

const run = async () => {
  await refresh()
  schedule()
}

void run()
```

实际节奏变成：

```text
立即查询
  -> 等待查询完成
  -> 等待 7.5 秒
  -> 查询
  -> 等待查询完成
  -> 等待 7.5 秒
```

如果一次请求耗时 1 秒，实际请求起点间隔约为 8.5 秒，而不会出现请求重叠。

## 9. 第四步：增加生命周期取消

每个 generation ID 对应一个独立的 `AbortController`：

```ts
const controller = new AbortController()
```

`getStudioGeneration` 增加可选 signal：

```ts
async function getStudioGeneration(id: string, signal?: AbortSignal) {
  return fetch(url, {
    headers,
    signal,
  })
}
```

effect cleanup：

```ts
onCleanup(() => {
  stopped = true
  controller.abort()
  if (timer) clearTimeout(timer)
})
```

以下情况会触发 cleanup：

- generation ID 改变。
- 当前任务成功。
- 当前任务失败。
- 用户切换会话。
- Studio 页面卸载。

## 10. 第五步：防止旧响应覆盖新任务

除了 AbortController，还应保留逻辑保护：

```ts
if (stopped) return

setPendingResult((current) => {
  if (current && current.id !== id) return current
  return ...
})
```

AbortController 负责尽量取消请求，ID 检查负责防止取消存在竞态时写错状态。

两者不能互相替代。

## 11. 推荐的轮询伪代码

```ts
const pollingGenerationID = createMemo(() => {
  const active = pendingResult() ?? studioTurn()?.result
  if (!active) return
  if (active.status !== "queued" && active.status !== "running") return
  if (!isStudioGenerationID(active.id)) return
  return active.id
})

createEffect(
  on(
    pollingGenerationID,
    (id) => {
      if (!id) return

      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()

      const schedule = () => {
        if (stopped) return
        timer = setTimeout(run, STUDIO_GENERATION_STATUS_INTERVAL_MS)
      }

      const run = async () => {
        if (stopped) return

        try {
          const generation = await getStudioGeneration(id, controller.signal)
          if (stopped) return

          setPendingResult((current) => {
            if (current && current.id !== id) return current
            if (sameGenerationSnapshot(current, generation)) return current
            return {
              ...generation,
              sourceImage: current?.sourceImage,
            }
          })

          setStatus(generation.status)

          if (generation.status === "succeeded" || generation.status === "failed") {
            return
          }

          schedule()
        } catch (error) {
          if (stopped) return
          if (error instanceof DOMException && error.name === "AbortError") return

          handleGenerationStatusError(id, error)
        }
      }

      void run()

      onCleanup(() => {
        stopped = true
        controller.abort()
        if (timer) clearTimeout(timer)
      })
    },
  ),
)
```

## 12. 状态更新去重

保留当前的快照比较逻辑，但建议提取为函数：

```ts
function sameGenerationSnapshot(
  current: StudioPendingResult | undefined,
  next: StudioGenerationResult,
) {
  return Boolean(
    current &&
    current.id === next.id &&
    current.status === next.status &&
    current.progress === next.progress &&
    current.order === next.order &&
    current.error === next.error &&
    current.images.length === next.images.length
  )
}
```

这可以减少无意义的 Solid 状态更新，但它不应再承担“避免轮询重启”的责任。轮询不重启应由 `on(pollingGenerationID, ...)` 保证。

如果结果媒体可能保持数量不变但 URL 变化，需要进一步比较图片 ID 或更新时间。

## 13. 成功后的消息加载

当前成功后执行：

```ts
loadSessionMessages(sessionID)
```

建议只在状态第一次从 queued/running 进入 succeeded 时执行一次。

递归轮询结构中，一旦查询返回 succeeded：

1. 更新 pending result。
2. 设置 succeeded。
3. 加载一次 session messages。
4. 不再 schedule 下一次查询。

不要依赖下一轮 effect cleanup 才停止请求。

## 14. 错误处理边界

本方案重点是调用频率，不修改现有业务错误策略，但轮询函数至少需要：

- `AbortError`：静默忽略。
- generation 已切换：静默忽略。
- 其他错误：调用现有错误处理逻辑。
- 错误后不再 schedule，避免失败状态下继续请求。

如果后续要增加网络错误重试，应单独设计错误计数和退避，不应重新引入 effect 重跑驱动查询。

## 15. 需要删除的旧逻辑

完成改造后删除：

```ts
const timer = setInterval(refresh, STUDIO_GENERATION_STATUS_INTERVAL_MS)
onCleanup(() => clearInterval(timer))
```

也不要继续保留无生命周期控制的：

```ts
void refresh()
```

首次立即查询应放在新轮询生命周期中的：

```ts
void run()
```

## 16. 建议的实现顺序

1. 给 `getStudioGeneration` 增加可选 `AbortSignal`。
2. 新增 `pollingGenerationID` memo。
3. 将轮询 effect 改为 `createEffect(on(pollingGenerationID, ...))`。
4. 使用递归 `setTimeout`。
5. 增加 `stopped`、AbortController 和 cleanup。
6. 保留 ID 校验和状态快照去重。
7. 成功或失败后不再调度下一次查询。
8. 删除旧 `setInterval` 逻辑。

## 17. 测试方案

### 17.1 单任务正常生成

条件：

- 初始状态 running。
- 进度依次返回 10、30、60、100。

验证：

- 首次立即请求一次。
- 后续每次请求都在前一次完成至少 7.5 秒后发生。
- 进度更新不会产生额外立即请求。
- 成功后停止轮询。

### 17.2 排队状态频繁变化

条件：

- `order` 持续变化。
- sync 同时更新 running tool part。

验证：

- `order` 和 sync 更新不重建轮询器。
- 请求数量仍符合 7.5 秒节奏。

### 17.3 慢请求

条件：

- 每次 GET 耗时 10 秒。

验证：

- 任意时刻只有一个 GET 在进行。
- 下一次请求在前一次结束 7.5 秒后才开始。

### 17.4 切换会话

条件：

- A 任务请求未完成时切换到 B 会话。

验证：

- A 请求被 abort。
- A 响应不能更新 B 的 pending result。
- B 仅在存在有效 generation ID 时启动新轮询。

### 17.5 连续创建任务

条件：

- A 任务后立即创建 B 任务。

验证：

- A 的 timer 和请求全部清理。
- 只有 B 继续轮询。

### 17.6 任务成功或失败

验证：

- succeeded 后不再请求。
- failed 后不再请求。
- 状态终结后没有残留 timer。

### 17.7 页面卸载

验证：

- 页面卸载后请求被 abort。
- 不出现组件卸载后的状态写入。

## 18. 调试与观测建议

开发阶段可以临时增加日志：

```ts
console.debug("[StudioPage] generation poll", {
  id,
  phase: "start",
  time: Date.now(),
})
```

建议记录：

- generation ID。
- 请求开始时间。
- 请求完成时间。
- 是否由 cleanup abort。
- 返回状态和进度。

验收完成后应删除高频调试日志，或者放在明确的 debug flag 后。

浏览器 Network 面板中，同一 generation 的请求应表现为：

```text
第 1 次：进入轮询后立即请求
第 2 次：第 1 次完成约 7.5 秒后
第 3 次：第 2 次完成约 7.5 秒后
```

不应出现：

```text
同一秒连续多个 GET
前一次 GET 未完成时发出下一次 GET
进度更新后立即发出额外 GET
```

## 19. 验收标准

- 同一个 generation 同时最多一个状态查询请求。
- 进度和排队人数更新不会重启轮询。
- 正常请求完成后，下一次查询等待至少配置间隔。
- 7.5 秒配置真实生效。
- 切换任务或页面卸载会取消旧请求。
- 成功和失败后停止轮询。
- 不再出现 1 秒内对同一个 generation 发起十次以上 GET。
- 不修改后端 worker 和最终接口轮询策略。

## 20. 预期影响

改造只影响前端对 Studio generation 查询接口的调用调度。

不会改变：

- generation 创建请求。
- generation 返回数据结构。
- 后端任务状态。
- 进度条数据来源。
- Studio 对话持久化。
- 后端最终接口轮询频率。

完成后，前端请求频率从“由响应式更新意外驱动”变为“由 generation ID 生命周期和固定间隔明确驱动”。
