# Insight 按钮与操作入口打点覆盖核对

核对日期：2026-10-15。代码依据：`codex/insight-tracking-inventory`，业务代码基线 `c7b0d68f9`，上一轮清单提交 `3412ca94c`。下方逐项表是改动前的审计快照；最新实施状态见本节，不宣称已验证线上落库。

## 补齐实施状态

第一批、第二批已在当前工作区实现，待发版：文件管理上传/目录上传、Markdown 保存、归档结果、上下文压缩、权限决策、问答提交/拒绝、产品资产导入/取消/重试/移除、模型选择、队列移除，以及结果重试/附件下载/path 本地打开的漏失分支。新增 18 个 name，具体口径、字段和限制见 [当前打点清单](./tracking.md)。

文件上传覆盖选择/拖拽后实际执行，不统计仅打开选择器又取消；权限/问答结果代表请求响应，不代表后续工具成功。原审计列出的压缩弹框取消、问题选项切换等纯 UI 动作仍不统计。

“按需”项现已补齐：文件删除发起/结果、预览就绪证据、知识库引用列表点击、项目/技能库/资产库/设置/更新入口，共新增 5 个 name；具体可证明的预览阶段见当前清单，不能把 PDF iframe load 当作内容验证成功。“可保留不报”的折叠、勾选、编辑器格式键、缩放等仍未补，因此仍不能称为所有按钮均有打点。归档真实内网回调和接收端落库需用内网环境验收；定向测试不替代发布验收。

## 结论与口径

**不是所有按钮都打了点。** 已覆盖会话管理、消息发送、任务卡片和部分文件操作；核心业务仍有缺口，而且同名按钮在不同分支的覆盖不一致。

本次从按钮、菜单项、键盘及拖拽入口追到 handler、父组件回调和共享实现，不以组件文件是否 import tracker 作唯一判断。

- **已覆盖**：该操作路径能找到明确的上报调用；不代表后端执行成功或接收端落库。
- **部分覆盖**：只有某些入口/分支、发起阶段或相关工具结果有事件，无法完整代表该项用户行为。
- **未覆盖**：已检查入口和业务回调，未找到对应的用户操作事件。console、SSE、业务 API 不算埋点。
- **其他模块**：有上报，但 module 不是 insight，不能在 module=insight 的查询中看见。

范围包括 Insight 自有组件、实际接入的共享侧栏/加号菜单/模型选择/项目入口/归档弹窗、对话共用 UI。跳转后的技能库、资产库、设置全部内部按钮，以及生成的 HTML 网页内任意按钮，不属于本次 Insight 主界面按钮全集；第三方编辑器工具栏按功能族检查。未逐个运行 UI 点击验证，因此不输出误导性的按钮覆盖率。欢迎页和会话页重复入口合并列出。

## 1. 页面框架、项目及会话

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 左侧会话栏展开/收起、窄屏抽屉关闭 | 未覆盖 | 仅改变侧栏状态 |
| 右侧文件管理面板展开/收起、窄屏关闭 | 未覆盖 | 仅改变面板状态 |
| 拖动左右分隔线、调整侧栏宽度 | 未覆盖 | 状态/本地存储变化，无操作事件 |
| 点击左上项目入口、打开项目选择 | 未覆盖 | ProjectInfo 打开共享弹框，无 Insight 入口事件 |
| 项目弹框确认选择 | 其他模块 | module=project-onboarding、name=confirm；没有 Insight 来源维度 |
| 技能库、资产库入口 | 未覆盖 | SidebarFooter 设置来源并导航，无 Insight 点击事件；目的页面事件不能等价替代 |
| 设置入口、更新提示按钮 | 未覆盖 | 打开共享设置/更新流程，无 Insight 入口事件；不含弹窗内部所有操作 |
| 新建会话 | 已覆盖 | new-session；侧栏点击和页面创建成功都存在同名入口，口径需区分 |
| 点击历史会话 | 已覆盖 | select-session；并非旧清单的 session-switch |
| 会话重命名 | 已覆盖 | 侧栏 rename-session 在请求前；头部 session-rename 在成功后 |
| 会话删除确认 | 已覆盖 | 侧栏 delete-session 在请求前；头部 session-delete 在成功后 |
| 会话置顶/取消置顶 | 已覆盖 | pin-session / unpin-session |
| 最近列表加载更多 | 已覆盖 | load-more-sessions 为发起；session-load-more 为滚动触发且有新增，含自动补页差异 |
| 置顶/最近区域折叠 | 已覆盖 | toggle-pinned-section / toggle-recent-section |
| 拖拽会话排序、跨置顶/最近分区移动 | 已覆盖 | reorder-pinned-session / reorder-recent-session / drag-session-to-pinned / drag-session-to-recent；可伴随 pin/unpin |
| 新建/重命名/移除分组 | 已覆盖 | create-group / rename-group / remove-group，多为发起口径 |
| 分组内新建、为会话新建分组 | 已覆盖 | new-session-in-group / create-group-for-session |
| 菜单移入/移出分组、删除分组内会话 | 已覆盖 | move-session-to-group / remove-session-from-group / delete-sessions-in-group |
| 分组折叠、分组区折叠 | 已覆盖 | toggle-group / toggle-group-section |
| 分组排序、会话拖入分组、组内排序 | 已覆盖 | reorder-group / drag-session-to-group / reorder-group-session |
| 会话/分组右键菜单展开、删除等弹框取消 | 未覆盖 | 后续确认动作部分已有事件，菜单打开和取消本身没有 |

依据：`index.tsx`、`sidebar.tsx`、`conversation-header.tsx`、`sidebar-footer.tsx`、共享 `agent-sidebar.tsx` / `grouped-sidebar.tsx` / `project-info.tsx` / `dialog-project-onboarding.tsx`。

## 2. 输入框、模型、附件与引用

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 点击发送、Enter 发送 | 已覆盖 | message-send；通过前置校验进入发送/排队，不是模型成功 |
| 未选择模型时尝试发送 | 已覆盖 | message-send-blocked，reason=no_model |
| 其他发送拦截条件 | 部分覆盖 | busy、会话切换、附件/资产待完成等不能用 no_model 事件概括 |
| 停止生成按钮 | 已覆盖 | message-abort，在 abort 请求前 |
| 队列消息右上移除按钮 | 未覆盖 | removeQueued 只移除队列内容 |
| 打开模型菜单、搜索/选择模型 | 未覆盖 | 仅 console 和 model.set；统一工具事件带模型信息不等价于模型选择事件 |
| 选择外网模型的风险确认/取消 | 未覆盖 | ModelSelectorPopover 的独立 NetworkRiskDialog；不要与上传风险事件混淆 |
| 加号菜单打开/关闭、一级菜单切换 | 未覆盖 | 不存在通用 addon-open/close；MCP 子菜单除外 |
| 加号“添加附件”打开文件选择器 | 部分覆盖 | 选择器打开/取消不报，实际选入文件后走 attachment-add |
| 输入框选文件、拖拽、粘贴附件 | 已覆盖 | attachment-add；导入另有 attachment-import-result，部分校验在 add 之后 |
| 输入框附件删除、失败重试 | 已覆盖 | attachment-remove / attachment-retry |
| 上传/文件引用的外网风险确认 | 已覆盖 | external-model-risk-confirm；仅该共享 UploadRiskGate 确认动作 |
| 上传风险弹框取消、政策链接 | 未覆盖 | 确认事件不能覆盖取消或外链点击 |
| @ 面板打开、鼠标/键盘选择技能或文件 | 已覆盖 | mention-open / mention-select；选项 handler 共用 |
| @ 面板分类切换、搜索、取消勾选/移除引用、关闭 | 未覆盖 | 选择事件不统计这些动作 |
| 加号菜单选择技能、会话文件 | 已覆盖 | addon-select-skill / addon-select-design-file；只代表选择 |
| 加号会话文件面板确认/取消、取消选中 | 未覆盖 | 已有选择事件不能证明最终确认或发送 |
| 加号选择产品资产、点击确认 | 已覆盖 | addon-select-product-asset / addon-confirm-product-asset |
| 产品资产导入成功/失败、失败项重试/移除 | 未覆盖 | InsightAddonMenu 的 download/retry/deselect 无对应事件；“选择/确认”不代表导入成功 |
| MCP 功能菜单展开、选功能、退出模式/× | 已覆盖 | mcp-chip-open / mcp-chip-select / mcp-chip-clear；多个退出入口共用 handler |

依据：`index.tsx` 的 handleSubmit/handleAbort/removeQueued/addAttachments/doImport；`insight-addon-menu.tsx`；`mention-popover`、`prosemirror-editor`；共享 `dialog-select-model.tsx`、`upload-risk-gate.tsx`、`addon-menu`。

## 3. 对话、权限、问题及上下文

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 上下文压缩入口、确认/取消、压缩完成/失败 | 未覆盖 | confirmCompactContext → compactContext → session.command；只有 toast/console，没有对应操作与结果事件 |
| 上下文用量预警“忽略” | 未覆盖 | 设置当前会话忽略状态 |
| 权限“拒绝/始终允许/允许一次” | 部分覆盖 | 无按钮事件；agent-tool-call-end 可间接反映 denied 等最终状态，但无法统计三种选择及点击次数 |
| 权限提示中的本地路径点击 | 未覆盖 | openFileOrReveal 与 console；没有 file-open-in-app 等事件 |
| 问题面板选项、自定义答案、前后题、题号切换 | 未覆盖 | 只更新问题状态，无用户操作事件 |
| 问题面板提交/拒绝（含键盘路径） | 部分覆盖 | 无提交/拒绝操作事件；question 工具最终结果属于工具调用口径 |
| 用户消息复制、消息内代码等复制 | 未覆盖 | 共用 UI 的剪贴板逻辑；不是结果栏 result-copy-content |
| 工具过程/差异展开收起 | 未覆盖 | 共用 SessionTurn/MessagePart 状态切换 |
| 知识库引用来源展开收起、点击来源外链 | 未覆盖 | knowledge-references.tsx 调整 open / openExternal |
| 对话里的附件/图片点击预览 | 部分覆盖 | 正常预览无统一事件；preview-attachment / preview-local-file 只在 unavailable 分支 |
| 对话输出卡正常打开 | 已覆盖 | result-card-open |
| 输出卡落盘失败后的“重试”（整卡点击） | 未覆盖 | OutputEntryCard 失败分支直接 onRetry → retryMaterialize，绕过 result-card-open；也没发 result-retry |
| 页面异常兜底“复制诊断/刷新” | 未覆盖 | 剪贴板和 location.reload，无操作事件 |

工具事件虽可辅助定位权限/问答结果，但不会提供每次 UI 决策、上一步/下一步、取消或拒绝的完整用户漏斗。

## 4. 任务卡片

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 刷新进度 | 已覆盖 | task-refresh，通过 busy/cooldown 后，远端查询成功前 |
| 停止任务确认 | 已覆盖 | task-stop，通过 busy 后；不代表远端已停止 |
| 停止弹框取消 | 未覆盖 | 关闭弹框 |
| 查看结果 | 已覆盖 | task-open-result；缺产物补查带 deferred=true |
| 任务详情展开/收起 | 未覆盖 | setExpanded |

依据：`task-card/index.tsx` → `index.tsx` 的 handleTaskRefresh/handleTaskStop/handleTaskOpenResult。

## 5. 结果 tab 与文件操作

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 切换不同结果 tab、关闭 tab | 已覆盖 | result-tab-switch / result-tab-close；点击当前 tab 不报 switch |
| 点击“文件管理”tab、收起面板 | 未覆盖 | onViewModeChange/onCollapse 改状态 |
| 预览/代码切换 | 未覆盖 | ViewModeToggle → setViewMode |
| 非附件结果栏复制内容 | 已覆盖 | result-copy-content；不保证剪贴板最终成功 |
| 非附件结果栏选择下载格式 | 已覆盖 | result-download，在 opt.onClick 执行导出前 |
| 附件 tab 的下载按钮 | 未覆盖 | fromAttachment → handleAttachmentDownload；没有复用 DownloadMenu 的事件 |
| 附件 tab 刷新预览、全屏/退出全屏 | 未覆盖 | refetch/状态切换 |
| 文件兜底卡“本地打开/文件夹/另存为” | 已覆盖 | file-open-in-app / file-reveal-folder / file-save-as；仅对应 FileFallback 分支 |
| path 文本等结果栏“本地打开/文件夹” | 未覆盖 | action-bar.tsx 直接调用 openFileLocally/revealFileInFolder，没有上述事件 |
| URI Markdown 结果栏文件夹定位 | 已覆盖 | file-reveal-folder，fileType=md；与 path 分支不同 |
| URI 资源加载失败“重试” | 已覆盖 | result-retry |
| 本地 path 加载失败“重试” | 未覆盖 | PathErrorFallback → refetch，未走 URI 的 tracker 回调 |
| 资源加载失败“复制链接” | 未覆盖 | 直接 navigator.clipboard.writeText |
| Markdown“编辑”入口 | 已覆盖 | md-edit-open |
| Markdown 自动保存、Ctrl/Cmd+S、关闭时保存 | 未覆盖 | doSave → window.api.writeFile；没有保存结果事件，也不是模型 edit 工具 |
| Markdown 工具栏编辑按钮、关闭/Esc | 未覆盖 | Vditor 编辑与关闭状态；md-edit-open 不覆盖实际编辑/保存 |
| 导图等预览内部缩放/平移、渲染内容内外链 | 未覆盖 | 没有 Insight 操作事件；生成 HTML 内任意交互不纳入应用按钮全集 |

关键证据：`result-viewer/action-bar.tsx` 的 path 快捷按钮、fromAttachment 分支；`result-viewer/index.tsx` 的 PathTabBody/UriTabBody 与 FileFallback；`markdown-editor/index.tsx` 的 doSave/flushSave/handleClose。

## 6. 文件管理器

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 文件上传按钮、文件夹上传按钮（含空态入口） | 未覆盖 | 文件选择后走 FileManagerInner.handleUpload/handleFolderUpload，不走输入框 addAttachments/doImport |
| 拖入文件/目录、上传完成/失败 | 未覆盖 | processEntries/uploadSingleFile；toast/console 不是 attachment-import-result |
| 刷新列表、加载失败“重新加载” | 未覆盖 | refresh 无事件 |
| 打开类型筛选、勾选类型、清空筛选 | 未覆盖 | store/filter 状态变化 |
| 按类型/修改时间分组、表头排序 | 未覆盖 | setGroupMode / handleHeaderSort |
| 全选、单选、清空选择 | 未覆盖 | selected 状态变化 |
| 生成/上传分区及内部组展开收起 | 未覆盖 | fileStore 的折叠状态；不是侧栏 toggle-group |
| 单击文件、菜单“在标签页中打开” | 已覆盖 | 共用 handleOpenFile → files-open-in-tab |
| 文件菜单“加入会话” | 已覆盖 | files-add-to-session；外网风险确认可能另有 external-model-risk-confirm |
| 文件菜单“打开所在文件夹” | 已覆盖 | files-open-in-explorer |
| 单文件下载、批量 ZIP 下载 | 已覆盖 | files-download-file / files-batch-download；下载流程中的事件，不是原生保存对话框接受率 |
| 点击进入子目录 | 已覆盖 | files-navigate-folder |
| 面包屑返回父目录/根目录 | 未覆盖 | Breadcrumb → setCurrentPath，不走 files-navigate-folder |
| 单文件删除确认、批量删除确认 | 未覆盖 | doDelete/doBatchDelete 无事件；不属于 artifact-file-edit |
| 删除取消、行尾菜单打开/关闭 | 未覆盖 | 对话框或菜单状态 |
| 文件归档入口 | 已覆盖 | files-archive，kind；后续确认/结果另见下节 |

依据：`file-manager/index.tsx`、`toolbar.tsx`、`breadcrumb.tsx`。这组上传和输入框上传是不同实现路径，不能将前者默认视为已有附件事件覆盖。

## 7. 归档流程

| 可操作入口 | 覆盖 | name / 实际边界 |
| --- | --- | --- |
| 结果栏归档入口 | 已覆盖 | result-archive，tabType |
| 文件管理归档入口 | 已覆盖 | files-archive，kind |
| 归档弹框选目录/产品/版本、确认、取消 | 未覆盖 | 共享 ArchiveDialog 调用 onConfirm，Insight handleConfirm 未发确认事件 |
| 后台归档成功/失败/取消 | 未覆盖 | archive-flow 的任务状态、回调和 toast 不等于上报事件；不能用入口量算成功率 |
| 归档成功弹框复制链接、查看、关闭 | 未覆盖 | DialogArchiveSuccess 的剪贴板/导航/关闭无事件 |

未将其他页面的 confirm-archive 当作 Insight 覆盖证据。当前 Insight 复用了弹框和流程，但没有复用其他页面入口上的 tracker 调用。

## 优先补齐建议（本次未实施、未定新 name）

优先处理会影响产品结论的流程，不必为了“所有按钮”把每次纯视觉操作都上报。

| 优先级 | 建议范围 | 原因 |
| --- | --- | --- |
| 第一批 | 文件管理上传/文件夹上传的发起与结果 | 当前这条核心入口在附件统计里缺失 |
| 第一批 | Markdown 保存结果 | 只有打开量，无法知道编辑是否成功落盘；与模型 edit 事件应分开 |
| 第一批 | 归档确认与最终结果 | 目前只有入口，无法算成功率或定位失败阶段 |
| 第一批 | 结果重试、下载、本地打开的不同分支补齐 | 同名按钮漏掉部分路径，直接导致按类型/来源比较失真 |
| 第一批 | 上下文压缩发起与结果 | 影响对话可用性，现只有日志/toast |
| 第二批 | 权限决策、问答提交/拒绝 | 工具 end 不能完整解释用户决策过程；不应直接上传完整敏感回答 |
| 第二批 | 产品资产导入结果/重试、模型选择、队列移除 | 补足选择到可用、发送到执行之间的流程 |
| 按需 | 文件删除、预览成功、知识库引用点击、项目/导航入口 | 取决于产品分析问题，统一来源维度后再实施 |
| 可保留不报 | hover、菜单关闭、普通折叠、每次勾选、编辑器格式键、预览缩放 | 高频纯交互，不必默认全部增加 |

新增打点前应按现有约定先修改 tracking-plan.md，明确 name、发起/成功口径、去重和 extend，再实现及更新清单。本报告不把建议名称当成已经上线的事件。

## 证据索引

- [页面入口与回调](../index.tsx)
- [文件管理与独立上传实现](../components/file-manager/index.tsx)、[工具栏](../components/file-manager/toolbar.tsx)、[面包屑](../components/file-manager/breadcrumb.tsx)
- [结果操作栏](../components/result-viewer/action-bar.tsx)、[不同结果加载与兜底分支](../components/result-viewer/index.tsx)、[输出卡失败重试](../components/output-entry-card.tsx)
- [Markdown 编辑/保存](../components/markdown-editor/index.tsx)、[归档流程](../components/archive-flow.tsx)
- [权限](../components/permission-dock.tsx)、[问答](../components/question-dock.tsx)、[知识库引用](../components/knowledge-references.tsx)、[任务卡片](../components/task-card/index.tsx)
- [侧栏公共入口](../components/sidebar-footer.tsx)、[共享会话侧栏](../../../components/agent-sidebar.tsx)、[共享分组](../../../components/grouped-sidebar.tsx)
- [模型选择](../../../components/dialog-select-model.tsx)、[上传风险确认](../../../components/upload-risk-gate.tsx)、[项目入口](../../../components/project-info.tsx)
- [Insight 加号菜单](../components/insight-addon-menu.tsx)、[共享加号菜单](../../make/components/addon-menu/index.tsx)、[@ 面板](../components/mention-popover/index.tsx)
- [80 个事件的名称与字段清单](./tracking-inventory-2026-10-15.md)
