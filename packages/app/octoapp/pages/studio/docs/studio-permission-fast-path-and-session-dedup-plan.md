# Studio 权限快路径与 Session 重复查询优化实施方案

## 1. 方案结论

本方案只解决两个问题：

1. Seedream/视频权限请求不再被 Studio 工作目录的 Instance 冷启动阻塞，供应商响应返回后在同一次 Solid 响应式提交中立即更新页面。
2. Studio 左侧历史列表不再独立调用第二次 `session.list()`，继续复用系统统一的 `GlobalSync + /session + Session.Service` 公共 Session 框架。

本方案明确不做：

- 不新增 `/global/studio/sessions`；
- 不新增 Studio 专用 Session 数据库查询；
- 不新增 Studio Session 详情接口；
- 不复制公共 Session 的过滤、排序、事件和生命周期语义；
- 不做 Session cursor 分页；
- 不修改公共 Session 表结构；
- 不修改 Design/Make、Insight、Chat 的业务逻辑。

## 2. 当前问题

### 2.1 权限接口被 Instance 冷启动阻塞

当前调用：

```text
POST /studio/permissions/check
```

该接口位于 Studio Instance API Group。Group 统一挂载：

```text
InstanceContextMiddleware
WorkspaceRoutingMiddleware
Authorization
```

权限查询只需要当前用户 UID，但请求执行前仍要加载 Studio sessions 目录对应的 Instance。首次加载会初始化配置、插件、LSP、文件监听、VCS、Snapshot 等服务。

因此当前耗时近似为：

```text
Studio chunk 加载
+ 本地路由处理
+ Instance 冷启动
+ 供应商权限接口约 200 ms
+ 前端状态提交
```

供应商直连 200 ms，而客户端需要数秒，主要差值在供应商请求发出之前。

### 2.2 权限状态更新不是原子提交

当前页面分别维护：

```ts
canGenerateVideo
canUseSeedream
studioPermissionReady
```

接口返回后依次调用多个 setter，模型回退又由后续 effect 完成。页面可能短暂经过不一致状态：

```text
视频权限已更新
Seedream 权限已更新
ready 尚未更新
模型回退尚未执行
```

此外当前视频权限初始值为 `true`，Seedream 初始值为 `false`，容易在权限返回前显示错误入口。

### 2.3 Studio Session 被加载两次

第一份数据由 `StudioPage` 创建公共目录 store 时加载：

```ts
globalSync.child(projectDir(), { bootstrap: true })
```

第二份数据由 `StudioHistory` 内部独立加载：

```ts
globalSDK.createClient({ directory: dir }).session.list()
```

`StudioHistory` 又维护自己的 `sessionList`，并在 Session、Message 和 thumbnail 事件后重新请求完整列表。

这导致：

- 首屏出现两次公共 Session list；
- 左侧 loading 与 GlobalSync 已有数据不同步；
- `message.updated` 触发无必要的 Session 整表刷新；
- thumbnail 更新触发无必要的 Session 整表刷新；
- 标题和删除状态存在两份前端状态需要同步。

## 3. 目标架构

```text
StudioPage
  ├─ 权限快路径
  │    └─ POST /global/studio/permissions/check
  │         ├─ Authorization
  │         ├─ 不经过 WorkspaceRouting/InstanceContext
  │         └─ 直接请求供应商权限接口
  │
  └─ 公共 Session 数据
       └─ GlobalSync child store
            ├─ 公共 /session
            ├─ 公共 Session.Service
            ├─ 公共 Session 事件更新
            ├─ StudioPage 使用
            └─ StudioHistory 只展示，不再独立查询
```

权限接口与项目实例没有业务关系，因此使用全局快路径；Session 与系统会话生命周期有强关系，因此继续使用公共架构。

## 4. 实施范围

### 4.1 必改文件

| 文件 | 修改内容 |
| --- | --- |
| `packages/app/octoapp/pages/studio-page.tsx` | 改用权限快路径；权限三态和原子更新；公共 Session store 作为唯一数据源；向 StudioHistory 传递列表和 loading |
| `packages/app/octoapp/pages/studio/studio-history.tsx` | 删除内部 session.list、第二份 sessionList 和事件 refetch；改为展示公共 store 数据 |
| `packages/opencode/src/tool/internel_image_generate.ts` | 给权限供应商请求增加超时和分段耗时日志 |
| `packages/opencode/src/server/routes/studio-global.ts` | 新增 Hono 权限快路径 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/studio-global.ts` | 新增 Effect Root 权限 API schema |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/studio-global.ts` | 新增 Effect Root 权限 handler |
| `packages/opencode/src/server/routes/instance/httpapi/api.ts` | 将 StudioGlobalApi 注册到 RootHttpApi |
| `packages/opencode/src/server/routes/instance/httpapi/server.ts` | 为 Root API 注册 studioGlobalHandlers |
| `packages/opencode/src/server/server.ts` | 在 Workspace/Instance 路由前注册 Hono 权限快路径 |
| `packages/opencode/src/server/routes/instance/studio.ts` | 删除旧 Hono `/studio/permissions/check` 路由和无用 import |
| `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts` | 删除旧 Studio Instance 权限 endpoint schema |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts` | 删除旧 Studio Instance 权限 handler 和无用 import |
| `packages/sdk/js/src/v2/gen/**`（自动生成） | 重新生成 SDK：移除旧路径，加入新的 Root 权限接口；禁止手工编辑 |

### 4.2 不修改文件

本方案不修改：

```text
packages/opencode/src/session/session.ts
packages/opencode/src/session/session-category-query.ts
packages/opencode/src/session/session.sql.ts
packages/app/octoapp/context/global-sync.tsx
packages/app/octoapp/context/global-sync/**
```

不修改公共 Session 查询和 GlobalSync 行为，是本方案保持系统统一性的边界。

## 5. 权限接口快路径

### 5.1 新接口

新增：

```text
POST /global/studio/permissions/check
```

请求：

```json
{
  "uid": "current-user-account"
}
```

响应结构保持当前 Studio 页面使用的解析契约：

```json
{
  "code": 200,
  "data": [true, true]
}
```

当前约定：

```text
data[0] = 视频生成权限
data[1] = Seedream 权限
```

本期不改变供应商协议，避免同时扩大前后端改动。后续如需要提升可读性，可以单独把响应转换为具名字段。

### 5.2 Effect HttpApi

新增：

```text
packages/opencode/src/server/routes/instance/httpapi/groups/studio-global.ts
```

建议定义：

```ts
export const StudioGlobalPermissionPayload = Schema.Struct({
  uid: Schema.optional(Schema.String),
})

export const StudioGlobalApi = HttpApi.make("studio-global").add(
  HttpApiGroup.make("studio.global")
    .add(
      HttpApiEndpoint.post(
        "checkPermission",
        "/global/studio/permissions/check",
        {
          payload: StudioGlobalPermissionPayload,
          success: described(Schema.Unknown, "Studio permission result"),
          error: ApiStudioGenerationError,
        },
      ),
    )
    .middleware(Authorization),
)
```

禁止挂载：

```text
InstanceContextMiddleware
WorkspaceRoutingMiddleware
```

新增：

```text
packages/opencode/src/server/routes/instance/httpapi/handlers/studio-global.ts
```

handler 只调用：

```ts
checkStudioPermission(ctx.payload.uid)
```

禁止：

- 读取 `InstanceState.context`；
- 调用 `Instance.restore()`；
- 根据 `x-opencode-directory` 创建 Instance；
- 初始化 Studio generation worker。

### 5.3 Effect Root 注册

修改：

```text
packages/opencode/src/server/routes/instance/httpapi/api.ts
```

将 API 注册到 `RootHttpApi`：

```ts
export const RootHttpApi = HttpApi.make("opencode-root")
  .addHttpApi(ControlApi)
  .addHttpApi(GlobalApi)
  .addHttpApi(StudioGlobalApi)
```

不能注册到 `InstanceHttpApi`。

修改：

```text
packages/opencode/src/server/routes/instance/httpapi/server.ts
```

```ts
const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(
  Layer.provide([
    controlHandlers,
    globalHandlers,
    studioGlobalHandlers,
  ]),
)
```

### 5.4 Hono 路由

当前项目同时支持 Hono 和 Effect HttpApi。只修改一套会导致不同启动方式下表现不一致。

新增：

```text
packages/opencode/src/server/routes/studio-global.ts
```

内部定义：

```text
POST /permissions/check
```

修改：

```text
packages/opencode/src/server/server.ts
```

必须在 `workspaceApp` 和 `InstanceRoutes` 之前注册：

```ts
const app = new Hono()
  .onError(ErrorMiddleware)
  .use(CorsMiddleware(opts))
  .use(LoggerMiddleware(backendAttributes))
  .use(AuthMiddleware)
  .use(CompressionMiddleware)
  .route("/global", GlobalRoutes())
  .route("/global/studio", StudioGlobalRoutes())
```

这样请求只经过全局鉴权和通用 HTTP 中间件，不经过 `InstanceMiddleware`。

### 5.5 旧接口迁移与删除

已确认 `/studio/permissions/check` 没有仓库外调用方，仓库内唯一业务调用方是 `StudioPage`。SDK 中的旧方法只是根据服务端 schema 自动生成，目前没有其他业务调用。

因此本次不设置兼容期。`StudioPage` 切换到新路径后，同一变更中删除：

```text
packages/opencode/src/server/routes/instance/studio.ts
  └─ POST /studio/permissions/check

packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts
  └─ 旧权限 endpoint schema

packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts
  └─ 旧权限 handler
```

随后重新生成 JavaScript SDK，确保：

- SDK 不再暴露 `/studio/permissions/check`；
- SDK 生成新的 `/global/studio/permissions/check` 调用；
- 仓库内不存在旧路径的运行时代码引用。

旧地址最终应返回 `404`。这样权限检查只有一条不会触发 Instance 冷启动的入口，避免后续代码误用旧链路。

这里只删除旧权限接口，不移动或删除其他 Studio Instance 接口：

```text
/studio/prompt-tags
/studio/generations/**
/studio/template-*/**
/studio/editor-entries
```

## 6. 权限供应商请求

### 6.1 增加超时

修改：

```text
packages/opencode/src/tool/internel_image_generate.ts
```

`checkStudioPermission()` 当前没有 AbortSignal。增加独立超时：

```ts
const STUDIO_PERMISSION_TIMEOUT_MS = 5_000

export async function checkStudioPermission(userIdx?: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    STUDIO_PERMISSION_TIMEOUT_MS,
  )

  return fetch(url, {
    method: METHOD,
    headers: internalImageHeaders(),
    body: JSON.stringify({
      checkPermList: ["view:keling_entry", "view:jimeng_entry"],
      uid: userIdx ?? env("IMAGE_USER_IDX") ?? DEFAULT_USER_IDX,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))
}
```

实际实现需要保留现有 HTTP 状态码和 JSON 错误处理，不能直接用示例覆盖原函数。

### 6.2 第一阶段不引入权限缓存

本方案的核心是让首次请求直接到达供应商，而不是依赖缓存掩盖冷启动。

第一阶段不增加持久缓存，原因：

- 权限可能被管理员即时回收；
- 缓存会引入失效策略和安全讨论；
- 缓存无法证明首次请求的链路已经优化。

可以增加同一 UID 的进行中 Promise 去重，但 Promise 完成后立即删除：

```ts
const permissionLoading = new Map<string, Promise<unknown>>()
```

这只合并并发请求，不缓存结果。

### 6.3 分段耗时日志

增加以下日志点：

```text
[studio.permission] route_enter
[studio.permission] vendor_start
[studio.permission] vendor_end
[studio.permission] route_end
```

字段：

```ts
{
  requestID,
  uidHash,
  vendorDurationMs,
  totalDurationMs,
  status,
}
```

禁止记录完整 UID、token、cookie、authorization header 和完整供应商响应。

验收重点：

```text
vendor_start - route_enter
```

应接近 0，P95 建议小于 50 ms。该阶段不应出现 Instance bootstrap 日志。

## 7. 前端权限立即更新

### 7.1 状态改为三态

修改：

```text
packages/app/octoapp/pages/studio-page.tsx
```

建议保留现有布尔 accessor，以减少子组件修改，但增加明确状态：

```ts
const [studioPermissionStatus, setStudioPermissionStatus] =
  createSignal<"loading" | "ready" | "error">("loading")
const [canGenerateVideo, setCanGenerateVideo] = createSignal(false)
const [canUseSeedream, setCanUseSeedream] = createSignal(false)
```

删除 `canGenerateVideo` 初始值 `true`，避免无权限用户进入 Studio 时短暂看到视频入口。

`loading` 阶段规则：

- 不认为用户有权限；
- 不显示明确的“无权限”结论；
- 权限相关入口显示 disabled/loading；
- 不把 Seedream 自动切换成 Qwen。

### 7.2 请求不依赖目录和 Session

权限请求只依赖：

```text
server.current.http
uiplusUserAccount()
```

请求头不再包含：

```ts
directoryHeader(projectDir())
```

新请求：

```ts
const response = await fetch(
  new URL("/global/studio/permissions/check", current.http.url),
  {
    method: "POST",
    headers,
    body: JSON.stringify({ uid: uiplusUserAccount() }),
    signal: controller.signal,
  },
)
```

权限请求应在 StudioPage 初始化时立即发出，不等待：

- `projectDir()`；
- `globalSync.child()` bootstrap 完成；
- Session list；
- prompt-tags；
- thumbnail；
- 当前 Session 消息。

### 7.3 原子解析和提交

新增单一应用函数：

```ts
function applyStudioPermission(result: {
  code?: number
  resp_code?: number
  data?: unknown
}) {
  const data = Array.isArray(result.data) ? result.data : []
  const ok = result.code === 200 || result.resp_code === 200
  const video = ok && data[0] === true
  const seedream = ok && data[1] === true

  batch(() => {
    setCanGenerateVideo(video)
    setCanUseSeedream(seedream)
    setStudioPermissionStatus("ready")

    if (!seedream && styleModelRequiresSeedreamPermission(styleModel())) {
      setStyleModel("qwen")
    }
  })
}
```

接口成功解析后直接调用该函数，不添加 timer、debounce 或额外异步任务。

这样供应商响应到达后，视频入口、Seedream 模型、提交按钮和模型回退在同一次 batch 中更新。

### 7.4 失败和取消

失败时原子设置：

```ts
batch(() => {
  setCanGenerateVideo(false)
  setCanUseSeedream(false)
  setStudioPermissionStatus("error")
})
```

页面卸载时 abort：

```ts
const permissionController = new AbortController()
onCleanup(() => permissionController.abort())
```

AbortError 不打印成业务错误，也不在已卸载页面提交状态。

如果以后支持刷新权限，增加递增 request sequence，只有最后一次请求允许提交结果，防止旧响应覆盖新响应。

### 7.5 保证子组件响应式传值

继续以响应式表达式传入：

```tsx
<StudioComposer
  canGenerateVideo={canGenerateVideo()}
  canUseSeedream={canUseSeedream()}
/>
```

不要在组件创建时把权限值复制到非响应式普通变量，也不要在子组件内部复制成一次性初值。

需要检查的消费点包括：

- capability 菜单的视频入口；
- Seedream 模型菜单；
- `canSubmit`；
- result action disabled；
- 视频生成快捷入口；
- 编辑/再次生成权限判断。

## 8. Session 重复查询优化

### 8.1 保留公共 Session 架构

继续使用：

```text
globalSync.child(projectDir())
/session
Session.Service.list()
SessionTable/SessionCategoryTable
globalSDK.event
GlobalSync event reducer
```

不新增 Studio Session store，不直接查询数据库。

### 8.2 设置 Studio 需要的公共 Store 容量

当前 GlobalSync child store 默认 `limit = 5`，而 `StudioHistory` 旧请求由服务端默认返回最多 100 条。直接切换为 GlobalSync 数据可能把历史列表从 100 条降到 5 条。

为保持当前行为，在触发 bootstrap 前把该公共 child store 的展示 limit 调整为 100：

```ts
const [syncStore, setSyncStore] = globalSync.child(projectDir(), {
  bootstrap: false,
})

if (syncStore.limit < 100) {
  setSyncStore("limit", 100)
}

globalSync.child(projectDir(), { bootstrap: true })
```

注意：GlobalSync 内部会在展示 limit 基础上增加 recent buffer，因此网络请求上限可能大于 100；这是现有公共框架行为，本方案不修改。

如果产品确认左侧只需要最近 50 条，可以把展示 limit 定为 50，但这属于产品容量调整，不能与性能修复一起静默改变。

### 8.3 StudioPage 派生展示列表

在 `StudioPage` 中从公共 store 创建只读 memo：

```ts
const studioSessions = createMemo(() =>
  syncStore.session
    .filter((session) =>
      session.agent === "octo_studio" &&
      !session.parentID &&
      !session.time.archived
    )
    .slice()
    .sort((a, b) =>
      (b.time.updated ?? 0) - (a.time.updated ?? 0)
    ),
)
```

这只是公共数据的视图，不保存第二份 Session 状态。

`activeStudioSession`、`isValidStudioSession()`、上一次 Session 恢复、标题栏重命名和删除继续使用 `syncStore/setSyncStore`。

### 8.4 StudioHistory 改为纯展示组件

修改：

```text
packages/app/octoapp/pages/studio/studio-history.tsx
```

props 增加：

```ts
{
  sessions: Session[]
  loading: boolean
  onSessionUpdated: (session: Session) => void
  onSessionRemoved: (sessionID: string) => void
  // 保留原有 directory、routeSlug、activeSessionID 等参数
}
```

删除：

- `createResource()`；
- 内部 `client.session.list()`；
- 内部 `sessionList` store；
- `refetch()`；
- `refetchTimer`；
- StudioHistory 内部的 Session event listener；
- `thumbnailVersion` 导致的 refetch effect。

渲染改为：

```tsx
<For each={props.sessions}>
```

重命名成功后：

```ts
props.onSessionUpdated(updatedSession)
```

删除成功后：

```ts
props.onSessionRemoved(session.id)
```

上层回调使用现有 `setSyncStore()` 立即修改公共 store；随后到达的公共 Session SSE 事件会正常 reconcile，不需要重新请求列表。

### 8.5 loading 展示

`StudioHistory` 不再拥有独立 resource，loading 由父级传入。

建议：

```ts
const studioSessionsLoading = createMemo(
  () => syncStore.status !== "complete" && studioSessions().length === 0,
)
```

只要公共 store 已经出现 Studio Session，就立即展示，不等待 Agent、MCP、VCS 等其他 bootstrap 项全部结束。

如果最终列表为空，则在公共 bootstrap 完成后展示 empty state。

### 8.6 thumbnail 不得刷新 Session

`thumbnailVersion` 只用于重新计算对应 Session 的 thumbnail URL，不能再调用 `session.list()`。

保留：

```ts
const thumbnailUrl = createMemo(() => {
  void props.thumbnailVersion
  return props.thumbnails?.[session.id]?.url
})
```

删除：

```ts
createEffect(() => {
  const version = props.thumbnailVersion
  if (version && version > 0) refetch()
})
```

Session 列表和 thumbnail map 独立响应更新。

## 9. 请求时序

优化后的首次进入时序：

```text
StudioPage 创建
  ├─ 立即 POST /global/studio/permissions/check
  │    └─ 直接请求供应商，不创建 Instance
  │
  ├─ GlobalSync 公共 Session bootstrap
  │    └─ 允许正常触发 Studio 目录 Instance 冷启动
  │
  └─ prompt-tags/thumbnail 等现有请求

权限供应商响应
  └─ applyStudioPermission()
       └─ batch 更新 video、seedream、status、styleModel
```

权限和 Session 可以并行。Session 冷启动再慢，也不会成为权限请求的前置条件。

## 10. 测试方案

### 10.1 服务端测试

建议新增：

```text
packages/opencode/test/server/studio-global-permission.test.ts
packages/opencode/test/tool/studio-permission-timeout.test.ts
```

覆盖：

1. `/global/studio/permissions/check` 返回 Studio 页面当前可解析的结构。
2. 新接口经过 Authorization。
3. 新接口不创建 Instance。
4. Hono 和 Effect HttpApi 行为一致。
5. UID 正确传递给供应商。
6. 超时后返回可识别错误。
7. Abort timer 总能清除。
8. 并发 Promise 去重不会缓存已完成结果。
9. 旧 `/studio/permissions/check` 返回 `404`。
10. 重新生成的 SDK 不再包含旧路径，并包含新的 Root 权限方法。

### 10.2 前端测试

建议新增：

```text
packages/app/octoapp/pages/studio/studio-permission.test.ts
packages/app/octoapp/pages/studio/studio-history.test.tsx
```

覆盖：

1. 权限请求使用 `/global/studio/permissions/check`。
2. 权限请求不携带 directory header。
3. loading 阶段视频和 Seedream 不被误判为允许。
4. 响应成功后同一次 batch 更新权限与模型。
5. Seedream 有权限时不回退 Qwen。
6. Seedream 无权限时回退 Qwen。
7. 失败进入 error 状态并关闭权限入口。
8. 页面卸载后忽略请求结果。
9. Studio 首次进入只调用一次公共 `session.list()`。
10. StudioHistory 不直接调用 `session.list()`。
11. `message.updated` 不触发 Session list。
12. thumbnail version 更新不触发 Session list。
13. GlobalSync Session 更新后左侧立即更新。
14. 重命名和删除立即更新公共 store。

### 10.3 手工验证

场景：

```text
完全退出客户端
→ 重新启动并登录
→ 先进入 Design/Make
→ 首次切换 Studio
```

DevTools Network 应观察到：

- 一个 `/global/studio/permissions/check`；
- 不再出现 `/studio/permissions/check`；
- 一个公共 `/session` list；
- 不再有 StudioHistory 发起的第二个 `/session` list；
- thumbnail 更新后没有新增 `/session` list。

服务端日志应观察到：

- 权限 `route_enter` 后立即出现 `vendor_start`；
- 两者之间没有 Studio Instance bootstrap；
- 供应商返回后立即出现 `vendor_end` 和 `route_end`。

页面应观察到：

- 权限 loading 阶段没有错误入口闪烁；
- 权限返回后一个渲染周期内更新 Seedream 和视频入口；
- 无 Seedream 权限时模型同步回退到 Qwen；
- Session 标题、重命名、删除和 thumbnail 更新正常。

### 10.4 执行命令

必须从 package 目录执行测试和 typecheck。

```bash
cd packages/opencode
bun typecheck
bun test test/server/studio-global-permission.test.ts test/tool/studio-permission-timeout.test.ts
```

```bash
cd packages/app
bun typecheck
bun test --preload ./happydom.ts ./octoapp/pages/studio/studio-permission.test.ts ./octoapp/pages/studio/studio-history.test.tsx
```

新增 Root API schema并删除旧 endpoint 后，按仓库要求重新生成 SDK：

```bash
./packages/sdk/js/script/build.ts
```

不要手工编辑 SDK 生成文件。

## 11. 验收指标

| 指标 | 目标 |
| --- | --- |
| 权限接口进入本地服务到供应商请求开始 | P95 小于 50 ms |
| 供应商响应到前端权限状态提交 | 小于一个渲染帧，目标 16 ms 内 |
| 冷启动权限端到端耗时 | 接近供应商耗时，P50 目标小于 500 ms |
| Studio 首屏公共 Session list | 1 次 |
| StudioHistory 直接 Session list | 0 次 |
| message.updated 导致 Session list | 0 次 |
| thumbnail 更新导致 Session list | 0 次 |
| 权限请求触发 Instance 初始化 | 0 次 |
| 旧 `/studio/permissions/check` 可用路由 | 0 个，访问返回 404 |

## 12. 风险与注意事项

### 12.1 公共 Session Store 容量

如果未在 bootstrap 前提高 child store limit，历史列表可能从旧行为的最多 100 条变成默认 5 条。实施时必须明确保持 100，或者由产品确认改成其他固定数量。

本方案不做滚动分页。超过固定容量的历史 Session 暂时保持与产品确认后的展示策略一致。

### 12.2 空列表 loading

公共 bootstrap 的 `status=complete` 需要等待多个请求。已有 Session 时可以提前展示；真正没有 Session 时 empty state 可能仍需等待 bootstrap 完成。

如果实测这里仍明显慢，应优先给 GlobalSync 增加通用的 Session 子加载状态，而不是重新引入 Studio 独立 Session 查询。该改动应作为公共框架能力单独评审。

### 12.3 权限不是只靠 UI 保证安全

前端隐藏 Seedream/视频入口只是交互控制。如果权限属于安全边界，生成接口服务端也应校验权限。该安全增强不阻塞本次性能改动，但需要单独确认供应商调用成本和缓存策略。

### 12.4 双后端必须同步

Hono 和 Effect HttpApi 都要实现新路径。不能只在当前开发环境使用的后端上验证。

## 13. 推荐提交拆分

1. `perf(studio): add global permission fast path`
2. `perf(studio): apply permission response atomically`
3. `refactor(studio): reuse global session store in history`
4. `test(studio): cover permission fast path and session dedup`

每个提交保持可独立回滚，不混入分页、数据库索引或公共 GlobalSync 重构。

## 14. 最终验收清单

- [ ] 新权限接口位于 Root API，不经过 InstanceContextMiddleware。
- [ ] Hono 新路由注册在 Workspace/Instance 路由之前。
- [ ] 新权限接口仍经过 Authorization。
- [ ] Hono 和 Effect HttpApi 中的旧权限 endpoint 均已删除。
- [ ] 旧 `/studio/permissions/check` 返回 404。
- [ ] SDK 已重新生成，不再包含旧路径，并包含新的 Root 权限方法。
- [ ] Studio 前端不再给权限请求发送 directory header。
- [ ] 权限请求不等待 Session、prompt-tags 或 thumbnail。
- [ ] 权限初始状态为 loading，视频和 Seedream 不提前放行。
- [ ] 权限成功结果使用 `batch()` 原子提交。
- [ ] 无 Seedream 权限时在同一批次回退 Qwen。
- [ ] 页面卸载时权限请求被取消。
- [ ] 权限供应商请求有超时和脱敏分段日志。
- [ ] StudioHistory 不再调用 `session.list()`。
- [ ] StudioHistory 不再维护第二份 Session store。
- [ ] Session 仍来自公共 GlobalSync 和 Session.Service。
- [ ] Session 列表容量没有从旧行为意外缩减到 5。
- [ ] message.updated 和 thumbnail 更新不再触发 Session 整表请求。
- [ ] Studio 权限和 Session 相关测试通过。
- [ ] `packages/opencode` 与 `packages/app` typecheck 通过。
