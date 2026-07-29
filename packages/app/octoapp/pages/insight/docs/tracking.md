# Insight 打点清单

记录 insight agent 已埋入的所有打点，新增/变更打点时同步维护此表。

接入规范见 [`/docs/tracker.md`](../../../../../../docs/tracker.md)。实施方案与映射规则见 [`tracking-plan.md`](./tracking-plan.md)。

> **先方案后清单（硬性顺序）：** 要加 / 改打点，**先去 [`tracking-plan.md`](./tracking-plan.md) 定 name / extend / 映射规则**，再回本文件记已实现的那一行。本文件只记「定了什么、落在哪」，不承担「怎么定」——顺序反了会出现清单有行却无命名依据的漂移。

> 注：下表 `module` 恒为 `insight`，故省去该列；`type` 除 `insight-page` 为 `page` 外，其余全部为 `interaction`。当前 tracker SDK 的 `interaction` 仅接受 `module / name / subType / extend`，**不支持 `from`**（`from` 只在 `page` 上）。因此「来源区域 / 方式」等维度统一并入 `extend` JSON（如 `source` / `method`），而非顶层 `from`。`tracker.duration` 也已下线。`/docs/tracker.md` 的旧描述待该 SDK 维护方同步修订。

> 排列方式：**按功能模块分组**（不再按上线批次 / 序号）。新增打点追加到所属模块分组的表尾即可。当前在用 44 个 name（另有 1 个已废弃，见文末）。

## 一、页面

| name | type | 触发时机 | extend 字段 | 代码位置 |
|------|------|----------|------------|----------|
| insight-page | page | insight 页面挂载 | — | `index.tsx` `InsightContent` onMount |

## 二、会话管理

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| new-session | 新建对话成功、跳转到新会话 | — | `index.tsx` `createAndNavigate` |
| session-switch | 在会话列表点击切到另一个历史会话（点当前会话不计） | `targetSessionId` | `session-list/index.tsx` 会话条目 onClick |
| session-rename | 会话重命名提交成功 | `entry`(menu=列表右键 / header=对话头部) | `session-list/index.tsx` `handleRenameConfirm` + `conversation-header.tsx` `saveTitleEditor` |
| session-delete | 会话删除成功 | `entry`(menu / header) | `session-list/index.tsx` `handleDelete` + `conversation-header.tsx` `deleteSession` |
| session-load-more | 会话列表点「加载更多」（已显示数 < 该目录 insight 会话 total 时出现，SPEC-INS-013 服务端分页） | `limit`(加载后的新上限)、`source`(panel=insight 侧栏 / shell=外壳侧栏) | `session-list/index.tsx` `loadMore` + `_shell/sidebar.tsx` `loadMore` |

## 三、消息发送 / 对话

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| message-send | 发送消息通过校验、受理后（按钮 / Enter） | `trigger`(button/enter)、`source`(welcome/conversation)、`attachmentCount`、`textLength`、`mcpFunction`(当前挂载的 chip 功能 id，可与 `mcp-chip-select` 打通漏斗) | `index.tsx` `handleSubmit` |
| message-send-blocked | 发送被拦截（未选模型，弹 toast） | `reason`(no_model) | `index.tsx` `handleSubmit` 未选模型分支 |
| message-abort | 点击停止生成 | — | `index.tsx` `handleAbort` |

## 四、MCP 常驻工具 chip

> 用户「挂载一个业务能力意图」的交互层，替代已废弃的预置提示词胶囊（`preset-click`）。与「模型真实调起 MCP」的 `server-mcp-used`（见 §九）分属两层，都保留。

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| mcp-chip-open | 打开 chip 功能菜单 | — | `index.tsx` PromptInput `onOpenMenu` |
| mcp-chip-select | 选中某功能 chip（常驻挂载） | `functionId`、`fileCount`、`pendingBytes`、`tokenEstimate` | `index.tsx` `handleMcpSelect` |
| mcp-chip-clear | × 取消已挂载的 chip | `functionId` | `index.tsx` `handleMcpClear` |
| mcp-chip-result | chip turn 结束后对账该功能工具是否真被调用 / 成败（结果型，turn 完成 effect 派生） | `functionId`、`called`(bool)、`status`(completed/error/not-called) | `index.tsx` turn-complete effect |

## 五、附件 / 文档抽取

> 图片走 S3 上传（`attachment-upload-result`）；非图片附件走本地导入 worktree（`attachment-import-result`），两者分别打点。

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| attachment-add | 添加附件（逐个文件，含 picker / 拖拽 / 粘贴） | `method`(picker/drop/paste)、`fileType`、`fileSize` | `index.tsx` `addAttachments` |
| attachment-upload-result | **图片** S3 上传 promise 落定（成功 / 失败） | `success`(bool)、`kind`("image")、`errorCode`(失败时) | `index.tsx` `doImageUpload` |
| attachment-import-result | **非图片**附件导入 worktree 的成败（结果型） | `success`(bool)、`localized`(成功时，是否拿到本地绝对路径) | `index.tsx` `doImport` then/catch |
| attachment-remove | 移除一个附件 | `stage`(uploaded=已传完 / pending=上传中或失败) | `index.tsx` `removeAttachment` |
| attachment-retry | 重试上传失败的附件 | — | `index.tsx` `retryUpload` |
| extract-failure | `extract_document` 本地解析失败（按原因分布，结果型，turn effect 扫 tool parts 派生） | `reason`(error/empty-text) | `index.tsx` turn effect |

## 六、任务卡片

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| task-refresh | 任务卡片手动刷新（通过 busy/cooldown 校验后） | `taskId` | `index.tsx` `handleTaskRefresh` |
| task-stop | 任务停止（通过 busy 校验后） | `taskId` | `index.tsx` `handleTaskStop` |
| task-open-result | 任务卡片点「查看结果」。两种分支：本地已有产物→直接打开；completed 但本地无产物（典型：对已完成任务点过终止，拿回的是 stop_task 控制响应而非文件）→触发一次 get_task_result 兜底查询，产物到达后再打开 | `taskId`、`deferred`(true=走了兜底查询分支；缺省/false=直接打开) | `index.tsx` `handleTaskOpenResult` |

## 七、结果面板（含文件兜底卡）

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| result-card-open | 点击对话里的输出卡片打开结果 | `cardType`(table/mindmap/markdown/json/file/html) | `index.tsx` `handleOpenResult` |
| result-tab-switch | 结果面板切到不同 tab（点当前 tab 不计） | `tabType` | `index.tsx` `handleActivateTab`（接 `tab-bar.tsx` onActivate） |
| result-tab-close | 关闭一个结果 tab | `tabType` | `index.tsx` `handleCloseTab`（接 `tab-bar.tsx` onClose） |
| result-retry | 结果加载失败后点重试 | `tabType` | `result-viewer/index.tsx` `UriTabBody` onRetry |
| result-copy-content | 复制结果内容 | `tabType`、`viewMode` | `result-viewer/action-bar.tsx` 复制按钮 |
| result-download | 下载结果（下拉选格式后） | `format`(md/csv/xlsx/html/json)、`tabType` | `result-viewer/action-bar.tsx` `DownloadMenu` |
| md-edit-open | md 结果卡点「编辑」进编辑模式 | `source`(tab.source) | `result-viewer/action-bar.tsx` 编辑按钮 |
| file-open-in-app | 文件兜底卡点「本地打开」 | `fileType`(扩展名兜底 mime) | `result-viewer/index.tsx` `handleOpenInApp` |
| file-reveal-folder | 文件兜底卡点「文件夹打开」 | `fileType` | `result-viewer/index.tsx` `handleRevealInFolder` |
| file-save-as | 文件兜底卡点「下载 / 另存为」 | `fileType` | `result-viewer/index.tsx` `handleSaveAs` |

## 八、文件管理器

> 删除（单个 / 批量）低价值不打（对齐文末排除原则）。

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| files-download-file | 下载单个文件 | — | `file-manager/index.tsx` `handleDownload` |
| files-batch-download | 批量打包（zip）下载 | `count` | `file-manager/index.tsx` `handleBatchDownload` |
| files-preview-file | 单击文件到右侧预览 | — | `file-manager/index.tsx` `handlePreview` |
| files-open-in-tab | 打开文件到结果 tab | — | `file-manager/index.tsx` `handleOpenFile` |
| files-add-to-session | 「加入会话」把文件挂到输入 | — | `file-manager/index.tsx` `handleAddToSession` |
| files-open-in-explorer | 「在文件夹中显示」 | — | `file-manager/index.tsx` `handleOpenInExplorer` |
| files-navigate-folder | 进入子目录 | — | `file-manager/index.tsx` 目录行 onClick |

## 九、服务端真实使用（`server-` 前缀）

上面各组统计的是**用户主动操作**（点击 / 发送）。下面两条统计的是**模型 / 服务端真实使用 MCP / skill 并把内容回显到会话中**——不是用户点了什么，而是 agent 真的调起了这些能力。为便于分析侧按维度切分，统一用 `server-` 前缀与常规打点区分（`module` 仍为 `insight`）。

触发点都在 `insight-turn.tsx` 一个 effect 内，从本轮的 `taskCards` / assistant parts 识别，天然 insight 作用域；用 baseline 快照避免「刷新会话把历史调用当新事件重报」，用 `trackedServerUsageKeys` 保证同一 usage 只报一次。

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| server-mcp-used | 某业务 MCP 工具真实被模型调用并提交长任务（**提交侧**，每 `task_id` 一次；从 `taskCards` 中 `isBusinessTool` 的条目识别） | `tool`(业务工具裸名 key_findings/run_guide_analysis/run_usability_analysis/mindmap)、`taskId` | `insight-turn.tsx` server-usage effect |
| server-mcp-result | 某业务 MCP 任务跑出终态（**完成侧**，`completed`→success / `failed`→failure，每 `task_id` 一次；`stopped` 及未出结果态不打）。与 `server-mcp-used` 靠 `taskId` 成对，可算成功率 / 时延 | `tool`、`taskId`、`status`("success"/"failure") | `insight-turn.tsx` server-usage effect |
| server-skill-used | 某 skill 真实被模型调用（每个 skill 工具 part 一次；从 assistant parts 中 `tool==="skill"` 且 completed 的条目识别，取 `metadata.name`） | `skill`(解析出的技能名，如 interview-analysis) | `insight-turn.tsx` server-usage effect |

## 十、@ 引用面板（SPEC-INS-023）

> 输入框 `@` 唤起、引用**技能 / 会话文件**的用户操作层。技能落地走 synthetic 注入（3b，不调 skill 工具），故 §九 的 `server-skill-used` **不会**为 @技能覆盖——`mention-select` 是这条路径的唯一用户侧口径。纯 tab 切换 / hover / 取消勾选不打点。

| name | 触发时机 | extend 字段 | 代码位置 |
|------|----------|------------|----------|
| mention-open | 输入框首次键入 `@` 唤起引用面板（面板由关到开的那一次） | — | `index.tsx` `trackMentionOpen`（由 `prosemirror-editor` 的 `onMentionOpen` 回调触发） |
| mention-select | 在面板中选中一项（技能或文件） | `type`(skill / file) | `index.tsx` `trackMentionSelect`（由 `prosemirror-editor` 的 `onMentionSelect` 回调触发） |

## 已废弃

| name | 废弃说明 |
|------|----------|
| ~~preset-click~~ | SPEC-INS-017 常驻工具 chip 改造移除了预置提示词胶囊，改用 `mcp-chip-*` 族（见 §四）。原 `presetId` / `source` 字段、以及 `message-send` 上的 `presetId` / `presetEdited` 字段一并作废（后者改带 `mcpFunction`）。 |

## 维护说明

- 新增打点 → 追加到**所属功能模块分组**的表尾（不再按上线批次 / 全局序号排列）
- 删除打点 → 从所在分组移除，重要变更移到「已废弃」小节加删除线保留记录
- 修改 `name` / `module` → 同步更新表格，并通知后端确认字段变更
- 来源 / 方式维度并入 `extend`（不要用 `from`，interaction 不支持）
- **区分「用户操作」与「服务端真实使用」**：前者是用户点击 / 发送（常规 name，归入 §一–§八 对应模块）；后者是模型真的调起 MCP / skill（`server-` 前缀，归入 §九）。新增服务端使用类打点一律沿用 `server-` 前缀，落点放在渲染派生的 effect 里时，必须配 baseline 快照 + 去重 set，避免刷新历史会话虚增计数。
- 已确认不打（低价值 / 纯视觉）：侧栏 / 结果面板折叠、壳层导航 / 设置、任务详情展开、结果视图模式切换、复制 uri、文件管理器删除等。
