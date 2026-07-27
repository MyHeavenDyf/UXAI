# Bug 分析：Make 页面生成中切换 Session 导致卡片丢失

> 发现日期：2026-06-08
> 影响范围：`/make` 页面 Session 切换后的卡片渲染
> 严重程度：高（用户可感知的产物丢失）

---

## 1. 问题复现路径

1. 进入 `/make` 页面，输入 prompt 开始生成
2. 在生成过程中（流式 delta 还在到达时），点击侧边栏切换到另一个 session
3. 再次切回原 session
4. **结果**：原 session 中已生成/正在生成的内容没有卡片展示

多次快速切换会显著提高触发概率。

---

## 2. 根因分析

共有 **3 个 bug 相互叠加**，任意一个单独存在都不会导致如此严重的卡片丢失。

### 2.1 主因：Session 切换时立即清理 parts + 异步 sync 竞争

**引入提交**：`557bf8c7c` — fix(make): 修复停止按钮卡住不恢复的问题

```ts
// packages/app/octoapp/pages/make/index.tsx:220-228
createEffect(
  on(
    () => params.id,
    (newId, oldId) => {
      if (oldId && oldId !== newId) {
        const [store, setStore] = globalSync.child(sdk.directory)
        dropSessionCaches(store, [oldId])   // ← 同步、立即清理
        setStore(produce((draft) => {
          delete draft.message[oldId]
          delete draft.session_status[oldId]
        }))
      }
      if (newId) {
        layout.lastSessionPerTab.setMake(newId)
        void sync.session.sync(newId)       // ← 异步 HTTP 加载
      }
    },
  ),
)
```

**问题链路**：

```
时序：

t0  用户在 Session A 中，流式 delta 正在写入 store.part[msgA]
t1  用户切换到 Session B
    → params.id 变化 → createEffect 触发
    → dropSessionCaches(A) 立即执行
    → store.message[A] = undefined, store.part[msgA] = undefined
    → sync.session.sync(B) 发起 HTTP 请求（异步）

t2  用户在 B 还没加载完时又切换到 C
    → dropSessionCaches(B) 立即执行
    → sync.session.sync(B) 的 HTTP 响应到达
      但 tracked(directory, B) 可能已失效 → 写入被跳过
    → sync.session.sync(C) 发起

t3  用户切回 Session A
    → sync.session.sync(A) 发起新的 HTTP 请求
    → 在 HTTP 响应到达之前，UI 已渲染
    → store.part[msgA] 仍为 undefined
    → insight-turn 的 assistantParts() 返回 []
    → outputCards() 返回 []  ← 卡片消失
```

**关键点**：`dropSessionCaches` 是同步的（立即删除数据），而 `sync.session.sync` 是异步的（需要 HTTP round-trip）。两者之间存在**数据真空期**。

#### `dropSessionCaches` 的清理范围

```ts
// packages/app/octoapp/context/global-sync/session-cache.ts:23-41
export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  // 1. 清理 parts（按 part.sessionID 匹配）
  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has(part?.sessionID ?? ""))) continue
    delete store.part[key]              // ← parts 全部删除
  }
  // 2. 清理 messages、session_status 等
  for (const sessionID of stale) {
    delete store.message[sessionID]
    delete store.session_status[sessionID]
    // ...
  }
}
```

注意：`index.tsx:222` 调用的 `dropSessionCaches` 传的是 `store`（child store 的第一个返回值），**不会清理 `sync.tsx` 内部的 meta 数据**（`limit`/`cursor`/`complete`/`loading`）。这意味着：
- data 被清空了（`message[A]`、`part[msgA]` 都没了）
- 但 sync 内部的"已加载过"标记可能残留

#### `sync.session.sync` 的缓存判断

```ts
// packages/app/octoapp/context/sync.tsx:463-465
const hasSession = Binary.search(store.session, sessionID, (s) => s.id).found
const cached = store.message[sessionID] !== undefined && meta.limit[key] !== undefined
if (cached && hasSession && !opts?.force) return   // ← 可能跳过重新加载
```

由于 `index.tsx:225` 已经 `delete draft.message[oldId]`，`cached` 为 `false`，sync 会重新加载。
但 **HTTP 请求是异步的**，加载完成前 UI 渲染的数据是空的。

#### `loadMessages` 的 replace 模式

```ts
// packages/app/octoapp/context/sync.tsx:339
const message = input.mode === "prepend" ? merge(cached, next.session) : next.session
```

`sync.session.sync` 调用 `loadMessages` 时没有传 `mode`，默认走 `"replace"`。
如果 HTTP 请求到达服务端时 session 还在生成中，拿到的 parts 就是**中间状态**，内容不完整。

---

### 2.2 放大器：`message.part.delta` 的 `endsWith` 去重逻辑错误

**引入提交**：`793992668` — feat(insight): 合入上游 commit 4283b01

```ts
// packages/app/octoapp/context/global-sync/event-reducer.ts:266-269
case "message.part.delta": {
  // ...
  const part = parts[result.index]
  const field = props.field as keyof typeof part
  const existing = part[field] as string | undefined
  if (existing?.endsWith(props.delta)) break   // ← BUG：错误跳过
  // ...
}
```

**上游代码没有这段逻辑**（`packages/app/src/context/global-sync/event-reducer.ts` 直接追加，无 `endsWith` 判断）。

#### 错误场景

`endsWith` 去重的设计意图是防止 SSE 重连时 delta 重复追加。但它与 `message.part.updated` 事件（`reconcile` 模式）冲突：

```
时序：

1. message.part.updated 到达 → reconcile 将 part.text 设为完整内容
   part.text = "<html><body><div>Hello World</div></body></html>"

2. 后续 delta 到达，delta = "o"
   检查："<html>...World</html>".endsWith("o") → false ✓ 追加

3. 后续 delta 到达，delta = "</html>"
   检查："<html>...World</html>".endsWith("</html>") → true ✗ 跳过！
   实际上这个 delta 是新增内容，不应该被跳过
```

更危险的是 HTML 生成中常见的小片段重复：

```
part.text 当前值 = "...<div class='container'><div>content</div>"
delta = "</div>"
endsWith("</div>") → true → 跳过！
但实际上这是新的一层闭合标签，跳过后会导致 HTML 结构不完整
```

#### 对卡片的影响

卡片渲染依赖 `insight-turn.tsx` 中的 `parseAllArtifactsFromText` 解析 `<artifact>` 标签。
如果 HTML 内容因为 `endsWith` 误判而被截断，`<artifact>` 标签可能不完整（缺少 `</artifact>` 闭合），
导致 `parseAllArtifactsFromText` 无法解析出任何卡片。

---

### 2.3 放大器：迁移到 SyncProvider 后缺少 force sync

**引入提交**：`e7652e507` — refactor(make): 迁移至 SyncProvider 统一事件监听

迁移前，切换 session 时直接调用 HTTP 获取 messages：

```ts
// 旧代码（已删除）
createEffect(on(() => params.id, async (id) => {
  if (!id) return
  const result = await globalSDK.client.session.messages({ sessionID: id })
  // 直接写入 dataStore，无缓存判断
}))
```

迁移后改为：

```ts
// 新代码
void sync.session.sync(id)   // ← 有缓存判断，可能跳过
```

`sync.session.sync` 内部有缓存检查（`sync.tsx:464-465`），在特定时序下会误判为"已有缓存"而跳过重新加载。
旧代码没有缓存层，每次切换都会强制 HTTP 请求，反而更可靠。

---

## 3. 问题叠加效果

三个 bug 同时存在时，多次切换 session 的完整问题链：

```
Session A 开始生成（流式 delta 到达中）
  │
  ├─ [Bug2: endsWith 去重]
  │   部分中间 delta 被错误跳过 → 内容已经不完整
  │
  ├─ 用户切换到 Session B
  │   └─ [Bug1: dropSessionCaches] A 的 parts 和 messages 立即被清理
  │
  ├─ 用户切回 Session A
  │   └─ sync.session.sync(A) 发起异步 HTTP
  │       └─ [Bug3: 无 force sync] 可能误判缓存跳过加载
  │       └─ 即使加载了，HTTP 响应时 A 可能仍在生成 → parts 不完整
  │       └─ 加载完成前，UI 渲染空数据 → 卡片消失
  │
  ├─ Session A 生成完成，SSE 发送最终的 message.part.updated
  │   └─ part.text 被 reconcile 为完整内容
  │
  ├─ 但之后可能还有残留的 delta 事件到达
  │   └─ [Bug2: endsWith] 完整内容.endsWith(尾部delta) → true → 跳过
  │       这种情况跳过是正确的，不会造成问题
  │
  └─ 最终：如果 HTTP 加载的中间态 parts + endsWith 跳过的 delta
      叠加后内容不完整 → <artifact> 标签无法解析 → 无卡片
```

---

## 4. 修复方案

### 4.1 移除 `endsWith` 去重（必须修复）

文件：`packages/app/octoapp/context/global-sync/event-reducer.ts`

```diff
 case "message.part.delta": {
   const props = event.properties as { messageID: string; partID: string; field: string; delta: string }
   const parts = input.store.part[props.messageID]
   if (!parts) break
   const result = Binary.search(parts, props.partID, (p) => p.id)
   if (!result.found) break
-  const part = parts[result.index]
-  const field = props.field as keyof typeof part
-  const existing = part[field] as string | undefined
-  if (existing?.endsWith(props.delta)) break
   input.setStore(
     "part",
     props.messageID,
```

**理由**：上游 `packages/app/src/context/global-sync/event-reducer.ts` 没有这个逻辑。`reconcile` 机制已经通过 `message.part.updated` 事件保证了数据的最终一致性。`endsWith` 去重在 reconcile 后会产生误判。

### 4.2 延迟清理 + force sync（推荐修复）

文件：`packages/app/octoapp/pages/make/index.tsx`

```diff
 createEffect(
   on(
     () => params.id,
     (newId, oldId) => {
-      if (oldId && oldId !== newId) {
-        const [store, setStore] = globalSync.child(sdk.directory)
-        dropSessionCaches(store, [oldId])
-        setStore(produce((draft) => {
-          delete draft.message[oldId]
-          delete draft.session_status[oldId]
-        }))
-      }
-
       if (newId) {
         layout.lastSessionPerTab.setMake(newId)
-        void sync.session.sync(newId)
+        void sync.session.sync(newId, { force: true })
+      }
+
+      // 延迟清理旧 session：等新 session 数据加载后再清理
+      // 避免快速切换时数据真空期
+      if (oldId && oldId !== newId) {
+        queueMicrotask(() => {
+          const [store, setStore] = globalSync.child(sdk.directory)
+          dropSessionCaches(store, [oldId])
+          setStore(produce((draft) => {
+            delete draft.message[oldId]
+            delete draft.session_status[oldId]
+          }))
+        })
       }

       setSending(false)
```

**理由**：
- `force: true` 确保 `sync.session.sync` 不跳过缓存，每次切换都强制从服务端拉取最新数据
- `queueMicrotask` 将旧 session 的清理延迟到微任务队列，确保新 session 的 sync 先发出
- 旧数据在新数据到达前仍然可见，避免 UI 闪烁

### 4.3 可选：去掉 index.tsx 中的主动清理（简化方案）

`sync.tsx` 内部的 `touch` 函数（`sync.tsx:285-292`）已经有 LRU 缓存淘汰机制：
```ts
const touch = (directory: string, setStore: Setter, sessionID: string) => {
  const stale = pickSessionCacheEvictions({
    seen: seenFor(directory),
    keep: sessionID,
    limit: SESSION_CACHE_LIMIT,  // 40
  })
  evict(directory, setStore, stale)
}
```

当 `sync.session.sync(newId)` 被调用时，`touch` 会自动淘汰最久未访问的 session 缓存。`index.tsx` 中手动 `dropSessionCaches` 是多余的，反而造成了上述竞争问题。

**简化方案**：完全移除 `index.tsx:220-228` 的清理逻辑，依赖 `sync.tsx` 内部的 LRU 淘汰即可。

---

## 5. 影响评估

| 修复项 | 风险 | 影响范围 |
|--------|------|----------|
| 移除 endsWith 去重 | 低 — 上游无此逻辑，已验证多年 | 所有使用 SyncProvider 的页面 |
| force sync | 低 — 仅增加 HTTP 请求频率 | make 页面切换体验 |
| 延迟清理 / 去掉清理 | 低 — sync.tsx 内部有 LRU 兜底 | make 页面内存占用（40 session 缓存上限） |

---

## 6. 关联提交

| Commit | 日期 | 说明 |
|--------|------|------|
| `793992668` | 2026-05-27 | 引入 `endsWith` 去重（Bug 2） |
| `e7652e507` | 2026-06-01 | SyncProvider 迁移，失去 force sync 能力（Bug 3） |
| `557bf8c7c` | 2026-06-04 | 引入 `dropSessionCaches` 立即清理（Bug 1） |
| `1fddbd9e2` | 2026-06-08 | 产物自动保存（未引入新 bug） |
