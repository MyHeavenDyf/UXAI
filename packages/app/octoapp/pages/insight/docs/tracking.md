# Insight 打点清单

记录 insight agent 已埋入的所有打点，新增/变更打点时同步维护此表。

接入规范见 [`/docs/tracker.md`](../../../../../../docs/tracker.md)。实施方案与映射规则见 [`tracking-plan.md`](./tracking-plan.md)。

> 注：当前 tracker SDK 的 `interaction` 仅接受 `module / name / subType / extend`，**不支持 `from`**（`from` 只在 `page` 上）。因此「来源区域 / 方式」等维度统一并入 `extend` JSON（如 `source` / `method`），而非顶层 `from`。`tracker.duration` 也已下线。`/docs/tracker.md` 的旧描述待该 SDK 维护方同步修订。

## 打点列表

| # | type | module | name | 触发时机 | extend 字段 | 代码位置 |
|---|------|--------|------|----------|------------|----------|
| 1 | page | insight | insight-page | insight 页面挂载 | — | `index.tsx` `InsightContent` onMount |
| 2 | interaction | insight | new-session | 新建对话成功、跳转到新会话 | — | `index.tsx` `createAndNavigate` |
| 3 | interaction | insight | preset-click | 点击预置提示词胶囊 | `presetId`、`source`(welcome/conversation) | `index.tsx` `handlePresetClick` |
| 4 | interaction | insight | message-send | 发送消息通过校验、受理后（按钮 / Enter） | `trigger`(button/enter)、`source`(welcome/conversation)、`attachmentCount`、`textLength`、`presetId`(文本源自某预置胶囊时带，可与 preset-click 打通漏斗)、`presetEdited`(是否改过预置文案) | `index.tsx` `handleSubmit` |
| 5 | interaction | insight | message-send-blocked | 发送被拦截（未选模型，弹 toast） | `reason`(no_model) | `index.tsx` `handleSubmit` 未选模型分支 |
| 6 | interaction | insight | message-abort | 点击停止生成 | — | `index.tsx` `handleAbort` |
| 7 | interaction | insight | attachment-add | 添加附件（逐个文件，含 picker / 拖拽） | `method`(picker/drop)、`fileType`、`fileSize` | `index.tsx` `addAttachments` |
| 8 | interaction | insight | attachment-upload-result | 附件上传 promise 落定（成功 / 失败） | `success`(bool)、`errorCode`(失败时) | `index.tsx` `doUpload` |
| 9 | interaction | insight | task-refresh | 任务卡片手动刷新（通过 busy/cooldown 校验后） | `taskId` | `index.tsx` `handleTaskRefresh` |
| 10 | interaction | insight | task-stop | 任务停止（通过 busy 校验后） | `taskId` | `index.tsx` `handleTaskStop` |
| 11 | interaction | insight | task-open-result | 任务卡片点「查看结果」。两种分支：本地已有产物→直接打开；completed 但本地无产物（典型：对已完成任务点过终止，拿回的是 stop_task 控制响应而非文件）→触发一次 get_task_result 兜底查询，产物到达后再打开 | `taskId`、`deferred`(true=走了兜底查询分支；缺省/false=直接打开) | `index.tsx` `handleTaskOpenResult` |
| 12 | interaction | insight | result-card-open | 点击输出卡片打开结果 | `cardType`(table/mindmap/markdown/json/file/html) | `index.tsx` `handleOpenResult` |
| 13 | interaction | insight | result-download | 下载结果（下拉选格式后） | `format`(md/csv/xlsx/html/json)、`tabType` | `result-viewer/action-bar.tsx` `DownloadMenu` |
| 14 | interaction | insight | result-copy-content | 复制结果内容 | `tabType`、`viewMode` | `result-viewer/action-bar.tsx` 复制按钮 |
| 15 | interaction | insight | session-switch | 在会话列表点击切到另一个历史会话（点当前会话不计） | `targetSessionId` | `session-list/index.tsx` 会话条目 onClick |
| 16 | interaction | insight | session-rename | 会话重命名提交成功 | `entry`(menu=列表右键 / header=对话头部) | `session-list/index.tsx` `handleRenameConfirm` + `conversation-header.tsx` `saveTitleEditor` |
| 17 | interaction | insight | session-delete | 会话删除成功 | `entry`(menu / header) | `session-list/index.tsx` `handleDelete` + `conversation-header.tsx` `deleteSession` |
| 18 | interaction | insight | attachment-remove | 移除一个附件 | `stage`(uploaded=已传完 / pending=上传中或失败) | `index.tsx` `removeAttachment` |
| 19 | interaction | insight | attachment-retry | 重试上传失败的附件 | — | `index.tsx` `retryUpload` |
| 20 | interaction | insight | result-tab-switch | 结果面板切到不同 tab（点当前 tab 不计） | `tabType` | `index.tsx` `handleActivateTab`（接 `tab-bar.tsx` onActivate） |
| 21 | interaction | insight | result-tab-close | 关闭一个结果 tab | `tabType` | `index.tsx` `handleCloseTab`（接 `tab-bar.tsx` onClose） |
| 22 | interaction | insight | result-retry | 结果加载失败后点重试 | `tabType` | `result-viewer/index.tsx` `UriTabBody` onRetry |
| 23 | interaction | insight | file-open-in-app | 文件兜底卡点「本地打开」 | `fileType`(扩展名兜底 mime) | `result-viewer/index.tsx` `handleOpenInApp` |
| 24 | interaction | insight | file-reveal-folder | 文件兜底卡点「文件夹打开」 | `fileType` | `result-viewer/index.tsx` `handleRevealInFolder` |
| 25 | interaction | insight | file-save-as | 文件兜底卡点「下载 / 另存为」 | `fileType` | `result-viewer/index.tsx` `handleSaveAs` |
| 26 | interaction | insight | session-load-more | 会话列表点「加载更多」（已显示数 < 该目录 insight 会话 total 时出现，SPEC-INS-013 服务端分页） | `limit`(加载后的新上限)、`source`(panel=insight 侧栏 / shell=外壳侧栏) | `session-list/index.tsx` `loadMore` + `_shell/sidebar.tsx` `loadMore` |

## 维护说明

- 新增打点 → 在表格末尾追加一行
- 删除打点 → 删除对应行，重要变更可加删除线保留记录
- 修改 `name` / `module` → 同步更新表格，并通知后端确认字段变更
- 来源 / 方式维度并入 `extend`（不要用 `from`，interaction 不支持）
