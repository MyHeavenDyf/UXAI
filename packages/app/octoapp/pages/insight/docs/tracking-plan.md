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
| `task-open-result` | 用户点任务卡片「查看结果」打开右侧面板 | 任务卡片「查看结果」按钮 → `handleTaskOpenResult`（有产物时才打） | `{taskId}` | ✅ |
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

## 五、验证

每批合入前按 `/docs/tracker.md` 验证流程：

- 外网 `bun run dev`：逐个触发行为，terminal 看 `[octo:tracker-mock]` payload，确认 `name` / `extend` 正确、`datas.path` 含会话 id
- 内网 `bun run dev:beta`：Network 面板确认命中真实域名、响应 200/204

## 六、维护闭环

```
新增/修改 insight 较重要功能
  → 同步增/删/改对应打点（仅核心行为，CLAUDE.md 有提示）
  → 按本方案映射规则定 name / extend（来源维度并入 extend，不用 from）
  → 实现后在 tracking.md 加 / 改 / 删对应行（不再用桌面收集单）
```
