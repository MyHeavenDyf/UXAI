# 权限询问断连恢复：服务端重播 + 客户端补拉自动应答

日期：2026-11-03（方案 2026-11-02）
分支：feat/make-router（承接 SSE 重连补拉修复 375cd5f79）

## 事故背景

2026-11-02 make 页生成期间渲染进程冻结约 165 分钟（日志全局无重连记录 = JS 冻结而非网络断开）。
期间 octo_design 子代理发起 `permission.asked`（03:50:59），事件发布到不流动的全局 SSE 连接后被丢弃；
解冻后 watchdog 中止旧连接，缓冲事件全部作废。用户明确表示权限弹框从未出现（07:33 后的毫秒级
放行全部来自客户端 auto-accept 自动应答）。服务端 `Deferred.await` 无超时 + 该 build 客户端对
丢失的 asked 事件无任何找回路径 → 生成永久卡死（累计 200 分钟）。

已有修复 375cd5f79（SSE 重连补拉）覆盖会话状态/消息，但权限询问的事件丢失缺口仍在：
客户端 auto-accept 只监听 SSE 实时事件，断连期间发布的 asked 事件无人应答。

## 两个修复

### fix 3（服务端根治）：新全局 SSE 连接时重播 pending 权限询问

**机制**：每条新 `/global/event` 连接建立时，把所有未应答的 permission ask 重新经
GlobalBus 发一遍。重播走与实时 ask 完全相同的 GlobalBus 路径，因此所有已发布客户端
零改动即可在重连后恢复弹框。

**改动**：

- 新建 `packages/opencode/src/permission/pending-registry.ts` — 模块级单例
  `Map<PermissionID, PendingAsk>`（先例：GlobalBus 本身就是模块单例）：
  - `trackPendingAsk(id, ask)` / `untrackPendingAsk(id)`：ask 生命周期登记/移除
  - `emitPendingAsks()`：逐条 `GlobalBus.emit("event", { directory, project, workspace,
    payload: { type: "permission.asked", properties: info } })` — envelope 与
    `Bus.publish`（bus/index.ts:104-113）完全同构，payload.id 由 GlobalBusEmitter
    自动分配。pending 定义即未应答，天然幂等。
  - `pendingAskCount()` / `clearPendingAsks()`：测试断言与隔离钩子
- `src/permission/index.ts`：
  - `ask()`：`pending.set` 后读 `InstanceState.directory / .context / .workspaceID`
    登记 registry
  - `Effect.ensuring` 清理（覆盖 reply/中断/实例 dispose 全路径）、`reply()` 的
    `pending.delete` 处、实例 finalizer 遍历处：同步 `untrackPendingAsk`，保证
    registry 与 pending map 永远一致
- 两个全局 SSE 后端都在 handler 注册后同步调用 `emitPendingAsks()`：
  - Hono `src/server/routes/global.ts`（/event subscribe 回调，桌面 dev 走此后端）
  - Effect-httpapi `src/server/routes/instance/httpapi/handlers/global.ts`
    （Stream.callback 的 acquireRelease 内）

handler 注册后同步 emit 必达新连接；也广播给其它连接（重复事件无害，见幂等保障）。

### fix 2（客户端保险）：REST 补拉结果触发 auto-accept 补发

**机制**：SSE 事件监听器（permission.tsx）只覆盖实时路径；断连期间丢失的 asked
只能靠 bootstrap/重连的 `permission.list` REST 补拉恢复。补拉结果就位时对
autoAccept 命中的条目补发应答。

**改动**（packages/app/octoapp）：

- `context/global-sync/bootstrap.ts`：`bootstrapDirectory` input 新增可选
  `onPermissionsLoaded(directory, permissions)`；在 permission.list 拉取块的
  warmSessions + store 写入完成之后回调（此时 pending ask 的子会话连同 parentID
  已进 store，`autoRespondsPermission` 的父链遍历可用）
- `context/global-sync.tsx`：`permissionSyncListeners` Set + bootstrapInstance
  构造 input 时逐个 try/catch 分发；context 返回值新增
  `onPermissionsLoaded(cb): () => void`。覆盖冷启动 bootstrap、目录切换、
  SSE 重连补拉（server.connected → queue.push → bootstrapInstance）
- `context/permission.tsx`：现有 SSE 事件监听器旁新增 sweep 监听，复用
  `shouldAutoRespond` + `respondOnce`

## 幂等保障（2+3 并存无冲突）

- 客户端 `respondOnce` 的 `responded` map 去重（TTL 1h）：SSE 重播事件与 REST
  补拉 sweep 双通道只发一次应答
- 服务端 `reply()` 对未知 requestID 静默 return（permission/index.ts）
- event-reducer 按 id upsert + `permission.replied` 精确移除：重复 asked 帧
  不产生重复 UI

已知限制（接受）：PermissionProvider 同步挂载 vs bootstrap 网络 IO，sweep 注册
几乎必先到达；理论竞态窗口由 fix 3 的服务端重播兜底。

## 验证

### 自动化测试

- `packages/opencode/test/permission/pending-replay.test.ts`（新增，6/6 通过）：
  - 纯单元：trackPendingAsk → emitPendingAsks 的 envelope 与 Bus.publish 同构
    （directory/project/workspace/payload.type/payload.id/properties）；空 registry
    为 no-op
  - 集成（it.live + provideTmpdirInstance）：ask 登记 registry 直到 reply("once")/
    reject；实例 dispose 清空 registry；emitPendingAsks 投递真实 pending ask
    （含实例 directory）
- `packages/opencode/test/server/global-event-replay.test.ts`（新增，2/2 通过）：
  两个后端（Server.Default / Server.Legacy）参数化验证 — 连接 /global/event 后
  `server.connected` 帧之后收到重播的 `permission.asked` 帧且含 request id；
  无 pending 时流中不出现 permission 帧
- `packages/app/octoapp/context/global-sync/bootstrap.test.ts`（扩展，8/8 通过）：
  fake sdk 的 permission.list 返回一条 pending ask，断言 onPermissionsLoaded
  收到 (directory, [entry])、warmSessions 已把会话拉进 store、store.permission
  已填充
- 回归：opencode `bun test test/permission/`（91/91）、`bun test ./octoapp/context/`
  （172/172）、全仓 `bun run typecheck` 通过。test/server 套件存在 22 个失败，
  经 stash 对照验证为分支既有问题（portable-share schema const/enum 差异、CORS、
  Windows 超时等），与本次改动无关
- 桌面端 E2E（dev:desktop + CDP）：见下节

### E2E 结论

环境：`bun run dev:desktop`（sidecar = opencode dist 构建，含本修复），测试目录
`D:\octoAI\test\test_project2`（config 默认 allow，故会话带 session 级
`permission: [{permission: "edit", pattern: "*", action: "ask"}]` 规则集制造 ask），
模型 `hs/glm-5.3`，REST `prompt_async` 发起生成，CDP `Page.setWebLifecycleState`
冻结/解冻渲染进程。E2E 全部通过（2026-11-03）：

- **A 传输层重播**：ask 挂起时另起 `curl -N` 连 `/global/event`，收到
  `server.connected` 帧后紧随重播的 `permission.asked` 帧（id/完整 envelope）。
  证明每条新连接必达重播。
- **B 冻结恢复弹框（人工路径）**：冻结 → 生成中 write ask 发布到不流动连接
  （事件丢弃）→ 挂起 20s+ → 解冻 → **不刷新页面** dock 自动出现（需要权限
  + 文件路径 + 三按钮）→ 用户点击 → probe 文件写入、生成完成。重播事件让
  用户可见的弹框在重连后复活。
- **C 完整事故复现（autoAccept 开启）**：两条恢复路径分别验证——
  - **C1（fix 2 补拉 sweep）**：冻结期 ask 丢失后挂起 33 分钟（解冻后因
    autoAccept 存储问题未即时恢复，见下）→ `location.reload()` 模拟"用户
    重启" → bootstrap 补拉 permission.list → sweep 补发应答 → 文件写入、
    轮次完成，恢复全程 ~8s（含 LLM 续跑）。
  - **C2（fix 3 重播，零人工零刷新）**：冻结 → prompt → ask 挂起（死锁
    窗口确认）→ 解冻 → 客户端 15s 心跳定时器（冻结期挂起、解冻即触发）
    abort 旧连接，SDK SSE 客户端 `reader.cancel()` 正常收尾（缓冲事件
    全部作废，与事故一致）→ 250ms 重连 → `server.connected` → 服务端同步
    重播 pending ask → autoAccept 命中毫秒级应答 → 生成续跑完成。
    CDP 控制台时间线：解冻 14:35:58 → 重连 14:36:00.551 → 最终 assistant
    消息 14:36:00.577（重连到恢复 26ms）。
- **D 常规流回归**：autoAccept 开启 + 页面存活，prompt → ask 毫秒级自动
  放行（无 dock 阻塞）→ 文件写入 → 轮次 ~2.5s 完成；autoAccept 关闭时
  dock 点击放行路径在 B 中覆盖。既有行为无回归。

E2E 过程中的关键发现（排障记录）：

- **桌面端 persist 不走 localStorage**：`Persist.global` 在 desktop 平台经
  `window.api.storeGet/storeSet` IPC 落主进程 `opencode.global.dat`，直接写
  renderer localStorage 的 autoAccept 键应用根本不读。开启目录级 autoAccept
  的正确方式是 `window.api.storeSet("opencode.global.dat", "permission",
  JSON.stringify({autoAccept: {"<base64(dir)>/*": true}}))` 后 reload。
  （base64 为 URL-safe 无 padding，路径含反斜杠时 bash/JSON 转义会吞字节，
  需在页面内 `String.fromCharCode` 构造。）
- **解冻后恢复时序**：`global-sdk.tsx` 的 15s 心跳在冻结期定时器挂起，解冻
  瞬间过期触发 `attempt.abort()`；SDK SSE 客户端（serverSentEvents.gen.ts
  `abortHandler → reader.cancel()`）使流**正常 return 而非 throw**——所以
  重连不会有 catch 日志，且缓冲的旧事件随 cancel 作废（与事故「缓冲事件
  全部作废」现象吻合）。随后 250ms 重连 + `server.connected` → fix 3 同步
  重播 + fix 2 重连补拉双通道，`respondOnce` responded map 去重保证只应答
  一次。
- 事件监听器（fix 3 消费方）与补拉 sweep（fix 2 消费方）在同一恢复窗口内
  并存无冲突，验证了幂等设计。

## 关键文件

| 文件 | 变更 |
|---|---|
| packages/opencode/src/permission/pending-registry.ts | 新建：pending 登记与重播 |
| packages/opencode/src/permission/index.ts | ask 登记 / ensuring+reply+finalizer 移除 |
| packages/opencode/src/server/routes/global.ts | Hono /event 连接时重播 |
| packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts | httpapi /event 连接时重播 |
| packages/app/octoapp/context/global-sync/bootstrap.ts | onPermissionsLoaded 通道 |
| packages/app/octoapp/context/global-sync.tsx | 监听注册 API + 分发 |
| packages/app/octoapp/context/permission.tsx | 补拉 sweep 监听 |

## 不做（有意）

- per-instance `/event` 路由重播（instance/event.ts）——桌面端走全局流；TUI 收益留作后续
- `question.asked` 同类重播——同类缺口但独立模块，留作后续
- 服务端 pending 超时——2+3 后客户端回来即恢复，优先级低
- fix 4（octo_design/octo_code outputs allow 规则）——另行确认
