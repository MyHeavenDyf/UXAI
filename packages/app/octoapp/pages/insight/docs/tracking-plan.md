# Insight 打点实操方案

把打点收集单（桌面 `insight打点收集单.md`，28 项行为）落地为 tracker SDK 调用的实施方案。

- 调用方式：[`/docs/tracker.md`](../../../../../../docs/tracker.md)
- 已实现打点清单（实施后同步维护）：[`tracking.md`](./tracking.md)

## 一、收集单 → SDK 的映射约定

收集单的字段与 SDK 参数不是一一对应，统一按以下规则转换：

| 收集单概念 | SDK 落点 | 说明 |
|---|---|---|
| 事件 ID `insight_<域>_<动作>` | `name`（kebab-case，去掉 `insight_` 前缀） | 如 `insight_message_send` → `name: "message-send"`；`module` 固定 `"insight"` |
| 通用参数 `session_id` | 不传 | SDK 自动采集 `datas.path`（`window.location.href`），URL 已含会话 id |
| 通用参数 `ts` | 不传 | 服务端按接收时间记录 |
| 通用参数 `source`（触发来源区域） | `extend.source` | interaction 不支持顶层 `from`，并入 extend，如 `extend: JSON.stringify({ source: "welcome" })` |
| 专属参数（多个） | `extend`（JSON 字符串） | `extend: JSON.stringify({ trigger: "enter", attachmentCount: 2 })` |
| 专属参数（单个简单值） | `extend` 直接传字符串 | 如 `extend: "md"`（下载格式） |

类型选择：收集单全部 28 项都是用户操作，统一用 `tracker.interaction`；页面 PV（已实现的 `insight-page`）不在收集单内，属页面级 `tracker.page`，保持现状。`tracker.duration` 暂无对应项，预留给后续「会话停留时长」类需求。

## 二、事件映射总表

状态：✅ 已实现 ｜ ⬜ 待开发

> SDK 变更（2026-06-17）：`tracker.interaction` 已不支持顶层 `from`（仅 `page` 有），`tracker.duration` 已下线。下表 `from` 列的维度（welcome/conversation、picker/drop 等）实现时统一并入 `extend` JSON（字段名 `source` / `method`）。

### P0 — 核心漏斗（发送 / 任务 / 结果消费）✅ 批次 1 已全部上线

每行说明：**功能** = 这个打点统计的用户行为；**打在哪个功能 / 控件** = 触发打点的 UI 元素 + 代码 handler；打点都在动作成功 / 受理后发出。

| name | 功能（统计什么用户行为） | 打在哪个功能 / 控件（UI + handler） | extend | 状态 |
|---|---|---|---|---|
| `message-send` | 用户向 AI 发送一条消息（含「点胶囊→发送」漏斗：`presetId` 标明文本来自哪个预置） | 输入框「发送」按钮 / 输入框按 Enter → `handleSubmit` 通过校验受理后 | `{trigger, source, attachmentCount, textLength, presetId?, presetEdited?}` | ✅ |
| `message-send-blocked` | 用户想发送但因未选模型被拦截（弹 toast） | 同发送入口，但走 `handleSubmit` 未选模型分支 | `{reason: "no_model"}` | ✅ |
| `preset-click` | 用户点预置提示词胶囊，把提示词填进输入框 | 欢迎页 / 对话页的预置提示词胶囊 → `handlePresetClick` | `{presetId, source}` | ✅ |
| `message-abort` | AI 生成中用户点击停止 | 输入框「发送 / 停止」按钮的停止态 → `handleAbort` | — | ✅ |
| `attachment-add` | 用户添加附件（逐个文件计一次） | 附件按钮选文件（file input）/ 拖拽文件进对话区 → `addAttachments` | `{method, fileType, fileSize}` | ✅ |
| `attachment-upload-result` | 附件上传的成败结果（结果型，非直接点击） | 上传请求 promise 落定 → `doUpload` 的 then / catch | `{success, errorCode?}` | ✅ |
| `task-refresh` | 用户点任务卡片「刷新」查询进度 | 任务卡片刷新按钮 → `handleTaskRefresh`（busy/cooldown 拦截后才打） | `{taskId}` | ✅ |
| `task-stop` | 用户点任务卡片「终止」 | 任务卡片终止按钮 → `handleTaskStop`（busy 拦截后才打） | `{taskId}` | ✅ |
| `task-open-result` | 用户点任务卡片「查看结果」打开右侧面板 | 任务卡片「查看结果」按钮 → `handleTaskOpenResult`：有产物直接打开打 `{taskId}`；completed 但无产物时触发 get_task_result 兜底查询，打 `{taskId, deferred:true}` | `{taskId, deferred?}` | ✅ |
| `result-card-open` | 用户点对话里的输出卡片打开右侧结果 | 对话内输出卡片 `OutputEntryCard` → `handleOpenResult` | `{cardType}` | ✅ |
| `result-download` | 用户从结果面板下载结果文件（选格式） | 结果面板 `ActionBar` 下载下拉项 → `DownloadMenu` 项 onClick | `{format, tabType}` | ✅ |
| `result-copy-content` | 用户复制结果内容到剪贴板 | 结果面板 `ActionBar` 复制按钮 | `{tabType, viewMode}` | ✅ |

### P1 — 会话管理与结果面板次级操作 ✅ 批次 2 已全部上线

| name | 功能（统计什么用户行为） | 打在哪个功能 / 控件（UI + handler） | extend | 状态 |
|---|---|---|---|---|
| `new-session` | 用户新建对话并跳转到新会话 | 首次发送 / 新建入口 → `index.tsx` `createAndNavigate` | — | ✅ |
| `session-switch` | 用户在会话列表点击切到另一个历史会话（点当前会话不计） | 左侧会话列表条目 → `session-list/index.tsx` 条目 onClick | `{targetSessionId}` | ✅ |
| `session-rename` | 用户重命名会话（提交成功） | 列表右键「重命名」`handleRenameConfirm` + 对话头部双击/菜单重命名 `conversation-header.tsx` `saveTitleEditor` | `{entry: menu/header}` | ✅ |
| `session-delete` | 用户删除会话（确认后成功） | 列表右键删除 `handleDelete` + 头部菜单删除 `conversation-header.tsx` `deleteSession` | `{entry: menu/header}` | ✅ |
| `attachment-remove` | 用户移除一个附件 | 附件 chip 的 × 按钮 → `index.tsx` `removeAttachment` | `{stage: uploaded/pending}` | ✅ |
| `attachment-retry` | 用户重试上传失败的附件 | 附件 chip 的重试按钮 → `index.tsx` `retryUpload` | — | ✅ |
| `result-tab-switch` | 用户在结果面板切到不同 tab（点当前 tab 不计） | 结果面板 `TabBar` 的 tab → `index.tsx` `handleActivateTab` | `{tabType}` | ✅ |
| `result-tab-close` | 用户关闭一个结果 tab | 结果 tab 的关闭按钮 → `index.tsx` `handleCloseTab` | `{tabType}` | ✅ |
| `result-retry` | 结果加载失败时用户点重试 | 结果面板加载失败态的重试按钮 → `result-viewer/index.tsx` `UriTabBody` onRetry | `{tabType}` | ✅ |
| `file-open-in-app` | 文件兜底卡用户点「本地打开」 | FileFallback「本地打开」按钮 → `handleOpenInApp` | `{fileType}` | ✅ |
| `file-reveal-folder` | 文件兜底卡用户点「文件夹打开」 | FileFallback「文件夹打开」按钮 → `handleRevealInFolder` | `{fileType}` | ✅ |
| `file-save-as` | 文件兜底卡用户点「下载 / 另存为」 | FileFallback「下载」按钮 → `handleSaveAs` | `{fileType}` | ✅ |

### P2 — 已确认不打（2026-06-11，已从收集单移除）

| 收集单 ID | 不打理由 |
|---|---|
| `insight_sidebar_toggle` / `insight_result_panel_toggle` | 布局折叠，纯视觉偏好 |
| `insight_nav_click` / `insight_settings_open` | 壳层导航，非 insight 核心行为；如需要应归属壳层 module |
| `insight_task_detail_toggle` / `insight_result_view_mode` / `insight_result_copy_uri` | 低频查看类微操作，分析价值低 |

## 三、代码写法范式

统一从 `@/utils/tracker` 引入，**打点放在动作成功之后**，失败路径不打（除非事件本身就是结果型，如 `attachment-upload-result`）：

```ts
import { tracker } from "@/utils/tracker"

// 1. 无参数事件
function handleAbort() {
  ...
  tracker.interaction({ module: "insight", name: "message-abort" })
}

// 2. 来源 / 方式维度 → 并入 extend（interaction 不支持 from）
tracker.interaction({ module: "insight", name: "attachment-add",
  extend: JSON.stringify({ method: "drop", fileType: "xlsx", fileSize: 10240 }) })

// 3. 多参数 → extend 传 JSON 字符串
async function handleSubmit() {
  ... // 发送受理后
  tracker.interaction({
    module: "insight",
    name: "message-send",
    extend: JSON.stringify({ trigger, source: isWelcome ? "welcome" : "conversation", attachmentCount, textLength }),
  })
}
```

注意事项：

- SDK 内部已静默捕获异常，调用处**不要再包 try/catch**，也不要 await
- 打点语句不参与业务逻辑，放在 handler 末尾、return 之前
- 双入口组件（welcome / conversation 两套 PromptInput）共用 handler，打点写在 handler 内部而非 JSX onClick 里，避免漏打一处

## 四、实施批次

按 PR 拆两批，每批合入后立即更新 `tracking.md` 清单 + 收集单状态列：

1. ✅ **批次 1（P0，已上线）**：`index.tsx` + `action-bar.tsx`，覆盖发送→任务→结果消费主漏斗（含 `message-send-blocked`，共 12 个 name；上传结果落点改在 `index.tsx doUpload` 而非纯 lib `upload.ts`）。typecheck 通过。
2. ✅ **批次 2（P1，已上线）**：会话管理 + 结果面板次级操作（session-switch/rename/delete、attachment-remove/retry、result-tab-switch/close、result-retry、file-open-in-app/reveal-folder/save-as）。typecheck 通过。
   - 落点修正：`attachment-remove` 实际打在 `removeAttachment`（附件 chip 的 ×），早期文档误写的 `removeQueued` 是「消息发送队列」移除、与附件无关；`stage` 取 `uploaded`(status=done) / `pending`(上传中或失败)。
   - `session-rename` / `session-delete` 两个入口（列表右键 menu、对话头部 header）各自打点，用 `entry` 区分。

P2 的 7 项已确认不打；`tracker.duration` 已下线，会话停留时长类暂无落点。批次 1 + 2 共 24 个 name 已全部上线（清单见 `tracking.md`）。

### 批次 3 — chip 常驻工具 / 文件管理器 / 抽取补充（SPEC-INS-017 / 014 后陆续上线）

收集单之后随功能演进新增的打点，命名沿用「用户操作 = 裸 kebab name / `<域>-<动作>`」约定。四个族：

**① MCP chip 交互族 `mcp-chip-<action>`（替代已删的 `preset-click` 胶囊）**

旧的「预置提示词胶囊」(`preset-click`) 已随 SPEC-INS-017 常驻工具 chip 改造删除，`message-send` 的 `presetId` / `presetEdited` 字段一并移除、改带 `mcpFunction`（当前选中的 chip 功能 id）。chip 是「用户挂载一个业务能力意图」的交互层，与 `server-mcp-used`（模型真实调起 MCP）分属两层，都保留：

| name | 功能（统计什么用户行为） | 打在哪个功能 / 控件（UI + handler） | extend |
|---|---|---|---|
| `mcp-chip-open` | 用户打开 chip 功能菜单 | PromptInput chip 按钮 `onOpenMenu` | — |
| `mcp-chip-select` | 用户选中某功能 chip（常驻挂载） | `index.tsx` `handleMcpSelect` | `{functionId, fileCount, pendingBytes, tokenEstimate}` |
| `mcp-chip-clear` | 用户 × 取消已挂载的 chip | `index.tsx` `handleMcpClear` | `{functionId}` |
| `mcp-chip-result` | chip turn 结束后对账该功能工具是否真被调用 / 成败（结果型，turn 完成 effect 派生） | `index.tsx` turn-complete effect | `{functionId, called, status: completed/error/not-called}` |

**② 文件管理器族 `files-<action>`（module 仍 `insight`）**

SPEC-INS-014 文件管理器面板的用户操作。删除（单个 / 批量）低价值不打。

| name | 功能 | 打在哪个功能 / 控件 | extend |
|---|---|---|---|
| `files-download-file` | 下载单个文件 | `file-manager/index.tsx` `handleDownload` | — |
| `files-batch-download` | 批量打包（zip）下载 | `handleBatchDownload` | `{count}` |
| `files-preview-file` | 单击文件到右侧预览 | `handlePreview` | — |
| `files-open-in-tab` | 打开文件到结果 tab | `handleOpenFile` | — |
| `files-add-to-session` | 「加入会话」把文件挂到输入 | `handleAddToSession` | — |
| `files-open-in-explorer` | 「在文件夹中显示」 | `handleOpenInExplorer` | — |
| `files-navigate-folder` | 进入子目录 | 目录行 onClick | — |

**③ 结果面板补充**

| name | 功能 | 打在哪个功能 / 控件 | extend |
|---|---|---|---|
| `md-edit-open` | md 结果卡点「编辑」进编辑模式 | `result-viewer/action-bar.tsx` 编辑按钮 | `{source: tab.source}` |

**④ 抽取 / 附件结果型补充**

| name | 功能 | 打在哪个功能 / 控件 | extend |
|---|---|---|---|
| `extract-failure` | `extract_document` 本地解析失败（按原因分布，结果型，turn effect 派生） | `index.tsx` turn effect 扫 tool parts | `{reason: error/empty-text}` |
| `attachment-import-result` | 非图片附件导入 worktree 的成败（结果型；与图片走的 `attachment-upload-result` 区分） | `index.tsx` `doImport` then/catch | `{success, localized?}` |

> 注：`attachment-upload-result` 现仅用于**图片** S3 上传结果，extend 带 `kind:"image"`；非图片附件走本地导入、结果打 `attachment-import-result`。

### 批次 4 — MCP 任务结果成败（`server-` 前缀，服务端真实使用）

`server-mcp-used` 统计的是 MCP 业务工具**被调用并提交长任务**（提交时刻，每 `task_id` 一次）。批次 4 补它的**完成侧**对偶：任务真正跑出终态（成功 / 失败）时再打一次，用于算 MCP 调用成功率、失败分布。属「模型 / 服务端真实使用」，沿用 `server-` 前缀。

| name | 功能（统计什么） | 打在哪 | extend |
|---|---|---|---|
| `server-mcp-result` | 某业务 MCP 任务跑出终态（`completed`→success / `failed`→failure），每 `task_id` 一次 | `insight-turn.tsx` server-usage effect（与 `server-mcp-used` 同一 effect） | `{tool, taskId, status: "success"/"failure"}` |

命名 / 落点约定：

- 与 `server-mcp-used` 一对：`used` = 提交侧、`result` = 完成侧，`taskId` 可打通两者算漏斗 / 时延。
- 只在 `completed` / `failed` 两个终态打；`stopped`（用户终止，已由 `task-stop` 覆盖）、`pending` / `processing`（未出结果）**不打**——对齐「出结果了（成功或失败）才打」。
- `status` 归一化为 `success` / `failure`（不直接透传 TaskStatus 枚举，分析侧只关心成败二分）。
- **必须配 baseline 快照 + 去重 set**（与 `server-mcp-used` 同规则）：复用模块级 `trackedServerUsageKeys`，key 用 `mcp-result:${taskId}` 前缀（与提交侧 `mcp:${taskId}` 区分）；首次观测本 turn 时把已终态的历史任务记入 baseline 不上报，避免刷新 / 切回历史会话把旧结果当新事件虚增。
- **已知偏差（分析侧必读）：`result` 相对 `used` 会系统性偏低（低估完成率）。** 有一种情况会漏 `result`：用户在长任务**运行中切走**该会话，任务在 turn 卸载期间跑完，再切回时首次观测已是终态 → 被 baseline 当历史吞掉不上报；而 `used` 此前已在提交侧实时报过。结果这类任务**有 `used` 无 `result`**。这是 baseline「宁可少报、不虚增」取舍的固有代价（不补一个没真观测到的终态事件），偏差方向恒为「偏低」。**用 `taskId` 对齐 `used`/`result` 算成功率 / 完成漏斗时：`result` 缺口 = 未观测到终态，不等于失败，别把缺口计入失败分母。** 要精确成功率需服务端在 turn 之外补事件，不在前端 effect 内解决。

### 批次 5 — @ 引用面板（SPEC-INS-023）

输入框 `@` 唤起、引用**技能 / 会话文件**的用户操作层。只打两条核心用户行为，纯 tab 切换 / hover / 取消勾选不打（低价值、纯视觉）。

| name | 功能（统计什么） | 打在哪 | extend |
|---|---|---|---|
| `mention-open` | 用户键入 `@` 唤起引用面板（衡量入口触达） | `index.tsx` `handleMentionInput`（面板由关到开那一次） | — |
| `mention-select` | 用户选中一项引用（衡量技能 / 文件引用使用率与占比） | `index.tsx` `handleMentionSelect` | `{type: "skill" \| "file"}` |

命名 / 落点约定：

- `mention-` 前缀,与 `mcp-chip-` 平级(都是「输入框内的引用 / 挂载」交互族),但 mention 是 @ 唤起的即选即插,无常驻态,故只有 open/select 两态,不设 clear(取消勾选是低频微操,不打)。
- `mention-open` 一次 `@` 输入过程只打一次,连续输入 `@abc` 的每次 keystroke 不重复打。判据是编辑器内的 `openReported` 标记,**以 `@` 触发文本消失(选中成胶囊 / 删掉 / 敲空格)为重置点**,不是以面板的显示状态为准——点面板外关闭时文本里的 `@query` 还在,若按显示状态重置,继续输入会被判成「重新打开」虚增 open 数。
- `mention-select` 的 `type` 二分(skill/file)供分析侧切「技能引用 vs 文件引用」占比。**注意**:@技能走 synthetic 注入(3b,不调 skill 工具),故 §九 `server-skill-used` **不覆盖** @技能;`mention-select{type:skill}` 是 @技能 唯一的用户侧口径。

## 五、验证

每批合入前按 `/docs/tracker.md` 验证流程：

- 外网 `bun run dev`：逐个触发行为，terminal 看 `[octo:tracker-mock]` payload，确认 `name` / `extend` 正确、`datas.path` 含会话 id
- 内网 `bun run dev:beta`：Network 面板确认命中真实域名、响应 200/204

## 六、维护闭环

**先方案后清单（硬性顺序，不可颠倒）：** 要新增 / 修改打点，**先在本文件（`tracking-plan.md`）里定 name / extend / 映射规则 / 命名约定**，方案敲定后**再去 `tracking.md` 记已实现的那一行**。本文件是「怎么定」，`tracking.md` 是「定了什么、落在哪」；顺序反了会出现「清单里有行、但没有对应的命名 / 映射依据」的漂移。

```
新增/修改 insight 较重要功能
  → 同步增/删/改对应打点（仅核心行为，CLAUDE.md 有提示）
  ① 先在本文件 tracking-plan.md 定 name / extend / 映射规则（来源维度并入 extend，不用 from）
     · 用户主动操作 = 裸 kebab name；服务端真实使用（模型调起 MCP/skill 并回显）= server- 前缀
  ② 再在 tracking.md 加 / 改 / 删对应行（记已实现的落点，不再用桌面收集单）
```
