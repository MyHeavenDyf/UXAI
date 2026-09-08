# Studio 左侧历史栏缩略图整体刷新与卡顿优化方案

## 1. 背景与现象

Studio 任务生成完成后，左侧历史会话列表中每一行前面的图片或视频缩略图都会一起刷新。视频缩略图尤其明显，会短暂出现空白、首帧重置或重新加载的观感，同时侧边栏有明显卡顿。

当前供应方生成接口不保证返回视频静态封面，因此本方案不依赖 `poster`，也不要求后端新增视频截图能力。视频缩略图可以继续使用现有视频资源；优化重点是让未发生变化的媒体 DOM 保持挂载，避免重复加载和解码。

## 2. 目标

1. 一次生成任务完成时，只更新对应 session 的缩略图。
2. 其他 session 的 `<img>` / `<video>` DOM 节点保持不变，不重新挂载。
3. 缩略图更新不能触发 `session.list()` 整表请求。
4. Session 元数据后台刷新时保留当前列表，不切换为整栏 loading。
5. 同一个 session、同一个缩略图地址的重复完成事件只产生一次有效写入。
6. 首次进入 Studio、创建会话、会话排序、重命名、删除、跨 session 生成等现有行为保持不变。
7. 不依赖供应方提供视频静态图。

## 3. 不在本次范围内

- 不修改 Studio 生成接口和供应方接口。
- 不要求视频响应提供静态封面。
- 不在浏览器端强制通过 canvas 截取视频帧。
- 不改变生成状态轮询、结果卡片或主工作区的渲染逻辑。
- 不用统一占位图替换现有视频缩略图。
- 不以 `preload="auto"` 增加媒体预加载量来掩盖卡顿。

## 4. 当前数据流与根因

### 4.1 当前刷新链路

```text
任务完成
  -> 多个完成监听点调用 studioThumbnails.setThumbnail(...)
  -> setThumbnail 每次无条件递增全局 version
  -> StudioHistory 监听 thumbnailVersion
  -> 每次 version 变化都执行 refetch()
  -> createResource 进入 loading
  -> Session 列表被整块 loading fallback 替换
  -> 原有 session 行和缩略图 DOM 全部卸载
  -> session.list() 返回
  -> 所有 session 行重新创建
  -> 所有 <img>/<video> 重新挂载、加载、解码和绘制
```

### 4.2 全局版本号错误扩大了更新边界

文件：`packages/app/octoapp/pages/studio/session-thumbnail.ts`

当前 `setThumbnail()` 每次都会执行：

```ts
setPersistedThumbnails(sessionID, { url, updatedAt: Date.now() })
setVersion((value) => value + 1)
```

该版本号表达的是“任意一个 session 的缩略图发生过写入”，粒度是整个侧边栏，而实际需要的更新粒度是 `sessionID` 对应的一行。

`thumbnails` 已经是 Solid `createStore` 返回的响应式 Store。行组件读取：

```ts
props.thumbnails?.[session.id]?.url
```

本身就可以按路径追踪对应 session 的 URL，不需要再增加全局版本号。

### 4.3 缩略图变化被错误地绑定到 Session 整表请求

文件：`packages/app/octoapp/pages/studio/studio-history.tsx`

当前代码通过 `thumbnailVersion` 调用 `refetch()`：

```ts
createEffect(() => {
  const version = props.thumbnailVersion
  if (version && version > 0) refetch()
})
```

缩略图 Store 已经包含新 URL，重新请求 `session.list()` 对显示新缩略图没有必要。该请求只是为了“强制 For 重新渲染”，但同时破坏了已有 DOM 的稳定性。

### 4.4 后台 refetch 会把已有列表替换成 loading

当前列表外层使用：

```tsx
<Show when={!sessions.loading} fallback={<Spinner />}>
  <For each={sessionList}>...</For>
</Show>
```

因此首次加载和后台刷新没有区分。任何 `refetch()` 都会卸载现有列表。虽然请求返回后使用了：

```ts
reconcile(data, { key: "id" })
```

但此时旧列表已经被 loading 分支卸载，keyed reconcile 无法保留之前的媒体 DOM。

### 4.5 任务完成存在重复缩略图写入路径

文件：`packages/app/octoapp/pages/studio-page.tsx`

当前缩略图可能从以下路径写入：

1. `pendingResult` 进入 `succeeded` 的响应式 effect。
2. 全局 `message.part.updated` 完成事件。
3. pending result 与 session turn 同步完成的 effect。
4. session idle 后的同步 effect。
5. 生成接口直接返回 succeeded 的 fast path。
6. 生成状态轮询返回 succeeded 的路径。

这些路径是为解决任务完成、消息落库延迟和跨 session 生成等不同场景逐步增加的。它们不一定每次全部执行，但同一次任务通常可能命中多个路径。

`setThumbnail()` 目前没有相同 URL 判断，所以相同结果也会重复持久化并递增 version。除此之外，`StudioHistory` 还会在 `session.updated` / `message.updated` 后延迟 refetch，任务完成后可能再出现一次整栏刷新。

### 4.6 视频缩略图放大了重挂载成本

文件：`packages/app/octoapp/pages/studio/studio-history.tsx`

图片重新挂载后通常能命中浏览器缓存，但仍要重新创建节点、解码和绘制。视频使用：

```tsx
<video src={thumbnailUrl()} muted playsinline preload="metadata" />
```

每次重挂载都会重新建立媒体元素并读取 metadata，因此刷新和卡顿更明显。没有静态 poster 不会阻碍本方案；只要 video 节点不被销毁，就不需要反复恢复首帧状态。

## 5. 推荐改造总览

| 优先级 | 文件 | 改动 |
| --- | --- | --- |
| P0 | `studio/session-thumbnail.ts` | 删除全局 `version`；缩略图写入增加幂等判断；批量加载不再逐条触发全局刷新。 |
| P0 | `studio/studio-history.tsx` | 删除 `thumbnailVersion` prop 和对应 `refetch` effect；按 session ID 直接响应缩略图 Store。 |
| P0 | `studio/studio-history.tsx` | 只在首次且无历史数据时显示整栏 loading；后台刷新保留当前列表。 |
| P0 | `studio-page.tsx` | 不再向两个 `StudioHistory` 传递 `thumbnailVersion`。 |
| P1 | `studio-page.tsx` | 将多个缩略图完成写入统一经过幂等入口；稳定后再收敛重复调用点。 |
| P1 | `studio/studio-history.tsx` | 缩小 Session 事件 refetch 范围，去掉不影响列表元数据的 `message.updated`。 |
| P1 | 新增或现有测试文件 | 覆盖单行更新、后台刷新保留 DOM、重复写入无副作用。 |

## 6. 逐文件具体修改

### 6.1 修改 `packages/app/octoapp/pages/studio/session-thumbnail.ts`

#### 6.1.1 删除全局 version

删除：

```ts
const [version, setVersion] = createSignal(0)
```

删除所有：

```ts
setVersion((value) => value + 1)
```

从返回对象中删除：

```ts
version,
```

删除后，缩略图更新只由 `persistedThumbnails[sessionID].url` 的 Store 路径驱动。

#### 6.1.2 将 `setThumbnail` 改成幂等更新

建议让方法返回是否发生了有效 URL 变化，便于后续调试和测试：

```ts
function setThumbnail(sessionID: string, url: string) {
  if (!sessionID || !url) return false

  recentlySet.add(sessionID)
  scheduleRecentlySetExpiry(sessionID)

  if (persistedThumbnails[sessionID]?.url === url) return false

  setPersistedThumbnails(sessionID, {
    url,
    updatedAt: Date.now(),
  })
  return true
}
```

实现要求：

- 相同 session、相同 URL 不创建新 `ThumbnailEntry`。
- 相同 URL 不触发持久化写入。
- 即使 URL 相同，也应延长 `recentlySet` 的保护时间，避免消息尚未完全落库时被旧数据覆盖。
- 建议使用 `Map<string, ReturnType<typeof setTimeout>>` 管理过期 timer。同一 session 再次完成时先清理旧 timer，避免累积多个 30 秒 timer。
- 组件清理时应清除仍存在的 timer；如果 Store 生命周期始终跟随页面，也可在工厂中提供 `dispose`，由页面 `onCleanup` 调用。

#### 6.1.3 不持久化临时 blob URL

当前页面可能通过 `displayUrl()` 把 data URL 转为 `blob:` URL。Blob URL 只在当前页面生命周期有效，不适合写入 workspace 持久化数据。

在 `studio-page.tsx` 的 `pickThumbnail()` 中应优先选择可长期恢复的地址：

```ts
function pickThumbnail(images: StudioImage[]) {
  const image = images.find((item) => !isVideoMedia(item)) ?? images[0]
  if (!image) return

  const thumbnail = image.thumbnailUrl ?? image.url
  if (!thumbnail.startsWith("blob:")) return thumbnail
  return image.remoteUrl ?? thumbnail
}
```

注意：

- 如果供应方返回的是 HTTP(S) 图片缩略图，继续优先使用缩略图。
- 如果只有视频 URL，则继续保存视频 URL，前端仍使用 `<video preload="metadata">`。
- 如果只有 data URL 且没有远端 URL，可以继续保存 data URL；是否改为独立文件缓存属于另一项存储优化，不阻塞本次修复。
- 不应把当前页面生成的 blob URL作为跨页面持久化结果。

#### 6.1.4 批量加载缩略图时合并提交

`loadThumbnails()` 当前在每个 session 请求完成后立即写 Store。建议每批最多 5 个请求完成后，收集本批找到的结果并统一提交。

伪代码：

```ts
const entries = await Promise.all(
  batch.map(async (session) => {
    const result = await client.session.messages({ sessionID: session.id })
    const url = extractFirstImageFromMessages(result.data ?? [])
    if (!url) return
    return [session.id, { url, updatedAt: session.time.updated ?? Date.now() }] as const
  }),
)

const found = entries.filter((entry) => entry !== undefined)
batch(() => {
  found.forEach(([sessionID, entry]) => {
    if (persistedThumbnails[sessionID]?.url === entry.url) return
    setPersistedThumbnails(sessionID, entry)
  })
})
```

这里的 `batch()` 主要合并响应式通知。若 `@solid-primitives/storage` 仍然在每个 setter 后序列化整个 Store，则进一步改为一次 `reconcile` 提交整批结果，确保每批最多一次持久化写入。

延迟重试同样只更新实际找到且 URL 发生变化的 session，不再触发任何 Session 列表 refetch。

### 6.2 修改 `packages/app/octoapp/pages/studio/studio-history.tsx`

#### 6.2.1 删除 `thumbnailVersion` prop

从 `StudioHistory` props 中删除：

```ts
thumbnailVersion?: number
```

删除整个 effect：

```ts
createEffect(() => {
  const version = props.thumbnailVersion
  if (version && version > 0) refetch()
})
```

这是本次最关键的修改。缩略图变化不再请求 Session 列表，也不会让 `sessions.loading` 变化。

#### 6.2.2 每行直接读取对应的 Store 路径

将当前依赖全局版本号的 memo：

```ts
const thumbnailUrl = createMemo(() => {
  void props.thumbnailVersion
  return props.thumbnails?.[session.id]?.url
})
```

改为：

```ts
const thumbnailUrl = () => props.thumbnails?.[session.id]?.url
```

Solid Store 会按属性访问路径建立依赖：

```text
thumbnails[session A].url 改变
  -> session A 行内 thumbnailUrl 更新
  -> session B/C/D 不重新计算、不重挂载
```

不要在行内再读取任何全局 thumbnail counter，也不要为了更新单行给 `<For>` 传入新 session 对象。

#### 6.2.3 区分首次加载和后台刷新

将：

```ts
const isLoading = createMemo(() => sessions.loading)
```

调整为只在没有可显示数据时进入整栏 loading：

```ts
const isInitialLoading = createMemo(
  () => sessions.loading && sessionList.length === 0,
)
```

列表渲染使用：

```tsx
<Show when={!isInitialLoading()} fallback={<InitialLoading />}>
  <For each={sessionList}>...</For>
</Show>
```

后台 `refetch()` 时继续展示 `sessionList`。请求返回后通过现有：

```ts
setSessionList(reconcile(data, { key: "id" }))
```

增量更新标题、排序和新增/删除项。

要求：

- refetch 期间不要把 `sessionList` 清空。
- 不要给列表容器或 `<For>` 添加随请求变化的 `key`。
- 保留现有滚动位置恢复逻辑。
- 可选在标题区域增加不影响布局的小型 refreshing 指示，但本次没有必要。

#### 6.2.4 缩小事件 refetch 范围

当前以下任意事件都会触发 Session 列表请求：

```ts
session.created
session.updated
session.deleted
message.updated
```

建议删除 `message.updated`。消息内容变化不直接决定 Session 列表项；会话标题、更新时间和归档等元数据应由 `session.updated` 表达。

保留：

```ts
session.created
session.updated
session.deleted
```

继续使用现有 debounce，避免连续 Session 事件产生请求风暴。若事件 payload 能可靠提供 agent 或 session ID，再增加以下过滤：

- `session.created/updated` 只处理 `agent === "octo_studio"` 的 session。
- `session.deleted` 只处理当前 `sessionList` 已包含的 ID。
- 忽略其他目录或其他 agent 的事件。

该过滤属于 P1。P0 阶段只要后台 refetch 不卸载列表，即使保留当前事件范围也不会再造成整栏媒体刷新。

#### 6.2.5 保持视频节点稳定，不新增 poster 前置条件

保留现有视频结构：

```tsx
<video
  src={thumbnailUrl()!}
  muted
  playsinline
  preload="metadata"
/>
```

本次不增加 `poster`。验收重点是未变更 session 的 video DOM 引用在任务完成前后保持一致。

如果未来供应端增加图片封面，可以在确认 URL 确实是图片后再增加 `poster`；这只是视觉兜底，不应替代 DOM 稳定性修复。

### 6.3 修改 `packages/app/octoapp/pages/studio-page.tsx`

#### 6.3.1 删除两处 `thumbnailVersion` 传参

Studio 页面有普通展开侧栏和小窗口 overlay 侧栏两处 `StudioHistory`。

两处都删除：

```tsx
thumbnailVersion={studioThumbnails.version()}
```

继续传递同一个响应式 Store：

```tsx
thumbnails={studioThumbnails.thumbnails}
```

#### 6.3.2 所有完成路径统一经过幂等写入入口

保留 `studioThumbnails.setThumbnail(sessionID, url)` 作为唯一底层入口，所有调用点不能直接操作 `setPersistedThumbnails`。

P0 阶段不必立刻删除所有完成监听点。先由 `setThumbnail()` 的幂等判断吸收重复事件，这样风险最低，可以继续覆盖：

- 当前 session 立即完成。
- 轮询完成。
- 消息延迟落库。
- 用户在生成过程中切换到另一个 session。
- 后台 session 完成。

P1 阶段结合日志确认覆盖关系后再收敛调用点：

1. 保留 `pendingResult.status === "succeeded"` effect，负责当前 session 的即时更新。
2. 保留全局 `message.part.updated` completed 监听，负责跨 session 和消息最终落库兜底。
3. 评估删除 fast path、polling path 和两个 sync effect 中重复的显式 `setThumbnail()`。
4. 删除前必须验证 pending result 只有 turn 图片、接口 images 为空、切换 session 后完成等边界情况。

不建议第一步就同时删除全部兜底路径，否则容易重新引入“某些完成场景没有缩略图”的历史问题。

#### 6.3.3 规范化缩略图 URL

调整 `pickThumbnail()`：

- 优先非视频结果。
- 优先真实缩略图 URL。
- 不持久化 `blob:` URL；有 `remoteUrl` 时回退到远端地址。
- 视频没有静态图时继续返回视频 URL。

这样不同完成路径更容易得到同一个稳定 URL，提升幂等命中率，并避免应用重启后读取已经失效的 blob URL。

### 6.4 测试文件

建议新增：

```text
packages/app/octoapp/pages/studio/session-thumbnail.test.ts
packages/app/octoapp/pages/studio/studio-history.test.tsx
```

如果当前 octoapp 测试环境不方便挂载完整 Context，可将幂等合并逻辑抽成无副作用的小函数放在 `session-thumbnail.ts` 中进行单测；DOM 稳定性使用开发环境手工验证或现有浏览器测试能力覆盖。

不要复制生产判断逻辑到测试中，测试应直接调用实际 Store 或渲染实际 `StudioHistory`。

## 7. 推荐实施顺序

### 第一阶段：最小风险修复

1. 删除 thumbnail `version` signal、所有 `setVersion` 和返回字段。
2. 删除 `StudioHistory.thumbnailVersion` 及其 `refetch` effect。
3. 两处 `StudioHistory` 调用删除 `thumbnailVersion` 传参。
4. 行内直接读取 `thumbnails[session.id].url`。
5. 后台 Session refetch 时保留已有列表。

完成这一阶段后，整体刷新和主要卡顿应当已经消失。

### 第二阶段：减少重复工作

1. `setThumbnail` 增加相同 URL 幂等判断。
2. 管理 `recentlySet` timer，避免同一 session 累积 timer。
3. 批量加载缩略图时合并 Store 和持久化写入。
4. `pickThumbnail` 避免持久化 blob URL。
5. 去掉 `message.updated` 对 Session 列表 refetch 的触发。

### 第三阶段：收敛完成监听点

1. 给每个缩略图写入来源增加临时开发日志，例如 `pending-effect`、`part-event`、`polling`、`sync-effect`。
2. 覆盖生成、编辑、跨 session、失败后重试等场景。
3. 确认哪些路径稳定重复。
4. 删除冗余显式写入，只保留当前 session 主路径和跨 session 兜底路径。
5. 清理临时日志。

第三阶段不是解决视觉问题的前置条件，可以独立提交，降低一次性改动风险。

## 8. 自动化测试用例

### 8.1 缩略图 Store 幂等性

1. 第一次写入 session A / URL A，返回 `true`。
2. 再次写入 session A / URL A，返回 `false`。
3. 第二次写入不能改变 entry 对象或触发持久化写入计数。
4. 写入 session A / URL B，返回 `true`，只更新 session A。
5. session B 的 entry 引用和 URL 保持不变。

### 8.2 单行响应式更新

1. 渲染三个 session，分别记录三行 `<img>/<video>` DOM 引用。
2. 更新 session B 的缩略图。
3. session B 的媒体内容更新。
4. session A、C 的媒体 DOM 引用严格相等。
5. 不发生 `session.list()` 调用。

### 8.3 后台 refetch 保持 DOM

1. 使用已有 sessionList 渲染列表。
2. 触发 `session.updated` 并让 `session.list()` 延迟返回。
3. 请求期间列表仍然可见，不出现整栏 Spinner。
4. 请求返回且 session 标题变化后，标题正确更新。
5. URL 未变化的媒体 DOM 引用保持一致。

### 8.4 初次加载

1. `sessionList` 为空且初次请求 pending 时显示 loading。
2. 请求成功后显示历史列表。
3. 空列表请求成功后显示 empty 状态，而不是持续 loading。
4. 请求失败时沿用现有错误/空状态策略，不保留永久 Spinner。

### 8.5 跨 session 完成

1. session A 正在生成时切换到 session B。
2. session A 在后台完成。
3. session A 的缩略图正确更新。
4. session B 和其他 session 的媒体节点不重挂载。
5. 当前路由和 session 选择不改变。

### 8.6 视频无 poster 场景

1. 使用只有视频 URL、没有静态图的生成结果。
2. 首次显示时 video 能读取 metadata 并展示现有浏览器可用帧。
3. 另一个 session 完成后，该 video DOM 引用保持一致。
4. Network 面板不出现该视频因列表刷新产生的新请求。

## 9. 手工验证步骤

1. 准备至少 5 个 Studio 历史会话，其中至少 2 个使用视频缩略图。
2. 在当前会话发起图片生成，生成完成前记录其他视频元素：

```js
const videos = [...document.querySelectorAll('[data-slot="list-scroll"] video')]
```

3. 任务完成后重新查询并逐项比较：

```js
videos.every((video, index) => (
  video === document.querySelectorAll('[data-slot="list-scroll"] video')[index]
))
```

4. 预期结果为 `true`；如果列表因排序发生位置变化，应按所属 session 行查找后比较，而不是按 index 比较。
5. 在 Network 面板确认任务完成时没有因为缩略图变化额外调用 `session.list()`。
6. 确认其他视频资源没有重新请求或重新读取 metadata。
7. 检查侧边栏滚动位置、hover tooltip、右键菜单、重命名和删除。
8. 再验证小窗口 overlay 侧栏，因为页面中存在第二个 `StudioHistory` 实例。

## 10. 性能观测建议

实施前后分别记录一次任务完成阶段的 Performance trace，关注：

- `session.list()` 请求次数。
- `<img>/<video>` 节点的移除与新增数量。
- 视频 metadata 请求数量。
- 图片 decode / paint 次数。
- ResizeObserver 创建和回调数量。
- 任务完成瞬间的 Long Task。
- 缩略图持久化写入次数。

预期变化：

| 指标 | 修改前 | 修改后 |
| --- | --- | --- |
| 缩略图更新引发的 `session.list()` | 1 次或多次 | 0 次 |
| 未变化媒体 DOM 重建 | 整栏 | 0 |
| 当前 session 缩略图更新 | 伴随整栏重建 | 仅对应行 |
| 重复相同 URL 写入 | 可能多次 | 0 次有效写入 |
| 后台 Session refetch 的整栏 loading | 有 | 无 |
| 视频 poster 依赖 | 无，但重挂载明显 | 仍无，且节点稳定 |

## 11. 回归风险与控制

### 11.1 缩略图不更新

风险：删除 version 后，如果行内没有正确读取 Store 路径，UI 可能不响应。

控制：使用 accessor 直接读取 `props.thumbnails?.[session.id]?.url`，增加单行响应式测试。不要在组件外提前解构 Store 值。

### 11.2 Session 排序未更新

风险：去掉缩略图 refetch 后，用户可能担心 session 更新时间排序不再刷新。

说明：排序更新应由 `session.updated` 的后台 refetch 负责，而不是由 thumbnail version 负责。保留 `session.updated` 监听即可。

### 11.3 相同 URL 但确实是新任务

风险：供应方可能对不同任务返回相同资源 URL。

控制：如果 URL 相同，视觉缩略图无需更新。`recentlySet` 仍应续期，防止旧消息覆盖。若未来业务需要记录缩略图所属 generation，可在 entry 中增加 `sourceID`，但不应为相同 URL 重建媒体节点。

### 11.4 视频 URL 过期

风险：没有 poster 时，过期视频 URL 无法恢复缩略图。

说明：这是资源生命周期问题，不是本次整体刷新问题。可在未来单独设计本地媒体缓存、签名 URL 刷新或统一视频占位图。

### 11.5 overlay 和常规侧栏行为不一致

风险：页面包含两处 `StudioHistory`，只修改一处传参或验证一处会遗漏小窗口模式。

控制：两处统一修改，并分别手工验证。

## 12. 验收标准

必须同时满足：

1. 图片或视频任务完成时，左侧栏不会整体切换为 loading。
2. 未变化 session 的 `<img>/<video>` DOM 引用在任务完成前后保持一致。
3. 缩略图变化不会调用 `session.list()`。
4. 当前任务对应的缩略图能够及时更新。
5. 同一个 session、同一个 URL 的重复完成事件不产生有效 Store 写入。
6. Session 创建、排序、重命名、删除和归档仍能刷新列表。
7. 跨 session 任务完成后，后台 session 的缩略图仍能更新。
8. 小窗口 overlay 侧栏与正常展开侧栏行为一致。
9. 没有静态 poster 的视频仍能使用现有视频 URL 显示缩略图。
10. `packages/app` 类型检查通过，相关单元测试通过。

## 13. 建议验证命令

按照仓库约束，从 `packages/app` 目录运行，不从仓库根目录运行测试：

```bash
cd packages/app
bun typecheck
bun test octoapp/pages/studio/session-thumbnail.test.ts
bun test octoapp/pages/studio/studio-history.test.tsx
```

如果最终没有新增第二个测试文件，只运行实际存在的测试路径。完成后再按第 9 节进行浏览器 DOM 和 Network 验证。

## 14. 建议提交拆分

为了便于回归和 review，建议拆成两个提交：

1. `fix(studio): keep sidebar thumbnails mounted during refresh`
   - 删除 thumbnail version / refetch 耦合。
   - 后台刷新保留现有列表。
   - 两处 StudioHistory 调用同步调整。

2. `perf(studio): dedupe and batch sidebar thumbnail updates`
   - 幂等 setThumbnail。
   - recentlySet timer 管理。
   - 批量 Store/持久化写入。
   - URL 规范化和相关测试。

完成这两个提交后，再根据运行日志决定是否单独提交“收敛重复完成监听点”。
