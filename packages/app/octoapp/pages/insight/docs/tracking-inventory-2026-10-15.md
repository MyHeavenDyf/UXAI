# Insight 打点盘点（2026-10-15）

依据 `codex/insight-tracking-inventory` 分支提交 `38d94026e` 的实际调用代码更新。范围为 Insight 页面、接入 Insight 上报的共享组件，以及已登记 Insight 轮次的服务端事件。本次将原 80 项与两轮新增的 23 项合并为完整清单，每个 name 单独列一行；不修改业务代码，未验证安装包或接收端落库。

按唯一 name 计 **103 个**：前端 98 个（页面 1 个、交互/结果 97 个），服务端 5 个。代码中有调用入口不代表每种环境都能触发，更不代表接收端已成功入库。80、98 是此前不同阶段的总数，不是当前总数。

此清单按已实现事件统计，不代表所有按钮均覆盖。逐操作入口的反向核对、分支缺口和补齐优先级见 [按钮覆盖核对](./tracking-button-audit-2026-10-15.md)。

## 上报通道与公共字段

| 通道 | 事件 | 请求 | 页面 DevTools Network | 可靠性 |
| --- | --- | --- | --- | --- |
| 前端页面 | insight-page | POST `/record/logger/page` | 能看到前端发起的请求 | 无持久化重试 |
| 前端交互/结果 | 以下除服务端 5 项外的其他事件，包括 server-* | POST `/record/logger/interaction` | 能看到前端发起的请求 | 无持久化重试；部分来自组件 effect，依赖页面消费结果 |
| 服务端产物 | artifact-file-write/edit、artifact-mcp-return | POST `/record/logger/interaction` | 看不到 sidecar 发出的 HTTP 请求 | 本地队列、租约、去重、重试与恢复 |
| 服务端工具 | agent-tool-call-start/end | POST `/record/logger/interaction` | 看不到 sidecar 发出的 HTTP 请求 | 复用持久化发送队列 |

前端公共字段：`module=insight`、`project=octo-agent`、account、uid、browserName/browserVersion、os、platform、userAgent；`datas[]` 中含 type、name、path、extend。interaction 默认 `subType=click`，即使事件语义是成功/失败结果也如此，不能只凭 subType 判断用户点击。extend 是 JSON 字符串；读取到 appInfo.version 时自动合入 version。页面事件另有 from、screenWidth、screenHeight。

前端账号取发送时的 localStorage.userInfo；服务端事件使用已持久化的原轮次账号。前端 fetch 不检查响应是否为 2xx，也没有本地队列：调用了 tracker 不等于落库成功。

新增的八组 `*-start/result`（files-upload、files-delete、md-save、archive、context-compact、permission-decision、question-response、addon-import）共用 `operationId` 和启动时的 `sessionId`（可得时）；result 带 `status`、`durationMs`，同次执行最多一个结果，重试生成新 operationId。操作次数按 start 去重，不能把两条事件相加。此处去重只约束前端执行回调，不提供可靠补报；没有完成证据时不猜测终态。新增事件不上传文件正文、完整路径、签名 URL、问答答案或完整错误信息；旧事件字段仍按各行所列。

## 1. 页面（1）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| insight-page | InsightContent 挂载；不是每次工具完成，也不等于每次切会话 | 无 |

## 2. 会话与列表（16）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| new-session | 共享侧栏点击新建；Insight 页面创建会话成功也有同名入口，不能直接当唯一新建会话数 | 无 |
| select-session | 共享侧栏点击会话；handler 本身没有排除当前会话 | 无 |
| rename-session | 共享侧栏提交有效的新标题，在请求更新前发送 | 无 |
| delete-session | 共享侧栏确认删除，在删除请求前发送 | 无 |
| session-rename | 会话头部重命名成功 | entry=header |
| session-delete | 会话头部删除成功 | entry=header |
| load-more-sessions | 共享侧栏开始加载更多服务端会话，包含自动补页入口；失败也可能已报 | 无 |
| session-load-more | Insight 侧栏由滚动触发分页且最近列表有新增；旧 shell 另有加载入口 | limit、source=panel/shell |
| pin-session | 执行置顶操作；共享侧栏/头部均有入口 | 无 |
| unpin-session | 执行取消置顶操作；拖拽也可能调用此流程 | 无 |
| reorder-pinned-session | 拖拽会话到置顶区会话位置进行排序 | 无 |
| reorder-recent-session | 拖拽会话到最近区会话位置进行排序 | 无 |
| drag-session-to-pinned | 拖拽会话到置顶分区 | 无 |
| drag-session-to-recent | 拖拽会话到最近分区 | 无 |
| toggle-pinned-section | 展开/折叠置顶区 | 无 |
| toggle-recent-section | 展开/折叠最近区 | 无 |

这些名称不是同义别名：`rename-session` 与 `session-rename`、`delete-session` 与 `session-delete` 分属不同入口且成功口径不同；`load-more-sessions` 与 `session-load-more` 分别偏向发起和成功新增。不要直接相加当去重业务量。

## 3. 分组（13）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| create-group | 提交新建分组 | 无 |
| rename-group | 提交分组重命名 | 无 |
| remove-group | 确认移除分组 | 无 |
| toggle-group | 展开/折叠一个分组 | 无 |
| toggle-group-section | 展开/折叠分组区 | 无 |
| reorder-group | 拖拽调整分组顺序 | 无 |
| new-session-in-group | 在分组里发起新建会话 | 无 |
| create-group-for-session | 为已有会话创建分组；侧栏和头部均有入口 | 无 |
| move-session-to-group | 通过菜单/头部将会话移入分组 | 无 |
| remove-session-from-group | 将会话移出分组 | 无 |
| delete-sessions-in-group | 批量删除分组里的会话，在执行删除前发送 | 无 |
| drag-session-to-group | 拖拽会话到其他分组 | 无 |
| reorder-group-session | 在同一分组内拖拽排序 | 无 |

多数是动作发起口径，不是后端保存成功口径；一次拖拽可能同时触发取消置顶和分组事件。

## 4. 消息（4）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| message-send | 发送通过前置校验并进入发送/排队流程，不代表模型调用成功 | trigger=button/enter、source=welcome/conversation、attachmentCount、textLength、mcpFunction |
| message-send-blocked | 因未选择模型阻止发送；不是所有拦截原因的全集 | reason=no_model |
| message-abort | 有会话且未处于停止请求中，发起停止 | 无 |
| message-queue-remove | 有效队列项移除后；不记录消息正文 | sessionId、remainingCount |

## 5. MCP 功能 chip（4）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| mcp-chip-open | 打开 MCP 功能菜单 | 无 |
| mcp-chip-select | 选择并挂载一个功能 chip | functionId、fileCount、pendingBytes、tokenEstimate |
| mcp-chip-clear | 取消当前挂载功能 | functionId |
| mcp-chip-result | 前端在轮次结束后检查对应工具是否出现及工具 part 状态 | functionId、called、status=completed/error/not-called |

chip 选择不等于实际调用；chip result 的 completed 也不等于异步业务任务完成。

## 6. 附件、解析与风险提示（8）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| attachment-add | 添加附件，逐文件记录；部分文件校验在该事件之后 | method=picker/drop/paste、fileType、fileSize |
| attachment-import-result | 本地导入的结果，包括失败及未本地化降级 | success、kind=image/file；成功时 localized；失败时 reason=no-local-path/write-failed |
| attachment-remove | 从输入框移除附件 | stage=uploaded/pending |
| attachment-retry | 发起有原始文件可供重试的附件导入 | 无 |
| extract-failure | 前端轮次 effect 从 extract_document metadata 识别解析错误或 chars=0 | reason=metadata.error 或 empty-text |
| preview-attachment | 点击缺少可预览信息的附件，进入 unavailable 分支；不是所有附件预览 | type=unavailable、ext |
| preview-local-file | 本地文件预览进入 unavailable 分支；不是所有本地文件打开 | type=unavailable、ext |
| external-model-risk-confirm | 外网模型的上传/引用风险弹框点击确认；取消不报 | 无 |

attachment-import-result 的 success=true、localized=false 不代表文件已落入会话 uploads。用户上传行为也不会直接产生 artifact-file-write。

## 7. @ 引用与加号菜单（10）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| mention-open | @ 引用面板从关闭到打开 | 无 |
| mention-select | 选中一个技能或文件引用 | type=skill/file |
| addon-select-skill | 加号菜单选择技能 | name=技能 label |
| addon-select-design-file | 加号菜单选择会话文件，名称沿用共享组件；不代表仅设计模块 | filename |
| addon-select-product-asset | 选择产品资产项 | fileName |
| addon-confirm-product-asset | 确认选中的产品资产；不代表下载/导入全部成功 | count |
| addon-import-start | 产品资产每次实际下载/导入尝试开始 | operationId、sessionId |
| addon-import-result | 本地导入完成、失败或中止；成功不代表消息已发送 | 公共结果字段；status=success/failure/cancelled、count（成功）、reason=import（捕获错误时） |
| addon-import-retry | 对可重试且不忙的产品资产执行重试 | sessionId |
| addon-import-remove | 移除待导入项，包括正在导入或失败项 | sessionId、busy |

共享 AddonMenu 在 Insight 显式接收 trackerModule=insight。选中技能不等于模型执行 skill 工具；合计引用量时也不能默认不同入口事件互斥。

## 8. 任务卡片（3）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| task-refresh | 通过 busy/cooldown 校验，发起查询提示 | taskId |
| task-stop | 通过 busy 校验，发起终止任务提示 | taskId |
| task-open-result | 打开已存在结果，或 completed 无产物时发起一次结果补查 | taskId；补查分支 deferred=true |

刷新和停止是用户意图，不证明远端任务已查询/停止成功。

## 9. 结果面板、保存与归档（16）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| result-card-open | 点击对话输出卡；在结果打开前记录 | cardType |
| result-tab-switch | 切换到不同结果 tab | tabType |
| result-tab-close | 关闭结果 tab | tabType |
| result-retry | 本地 path/URI 加载失败或输出卡落盘失败后点击重试 | tabType、source=path/uri/materialize |
| result-copy-content | 点击复制结果内容 | tabType、viewMode |
| result-download | 下载菜单选择格式，或附件 tab 点击下载；在执行导出前记录 | format（菜单）、tabType；附件分支 source=attachment |
| result-archive | 发起结果归档 | tabType |
| md-edit-open | 点击 Markdown 编辑入口 | source |
| file-open-in-app | 文件兜底卡或 path 结果操作栏发起本地应用打开 | fileType；path 操作栏 source=result-toolbar |
| file-reveal-folder | 文件卡/Markdown 入口或 path 操作栏发起文件夹定位 | fileType；path 操作栏 source=result-toolbar |
| file-save-as | 文件卡走另存为流程 | fileType |
| md-save-start | 自动保存、快捷键或关闭保存进入 doSave；含路径/写入能力缺失的尝试 | operationId、sessionId、source |
| md-save-result | writeFile resolve 为 success；缺路径、缺写入能力或写入失败为 failure | 公共结果字段、source；reason=path-unavailable/write-unavailable/write |
| archive-start | 确认归档后开始执行；不是单纯打开归档弹框 | operationId、sessionId、mode=file/html |
| archive-result | 文件云端上传后创建交付物成功，或 HTML 云端上传成功；失败/明确取消也记录 | 公共结果字段、mode、status=success/failure/cancelled；成功 destination=cloud/local；失败 reason=file-unavailable/file-size/activity/upload/deliverable/archive |
| result-preview-ready | 预览到达可观察就绪点；不把文件兜底卡的本地打开当作预览成功 | sessionId、tabType、source、fromAttachment、viewMode（文本类）、evidence，见下表 |

md-edit-open 只表示进入编辑，不能当作保存成功或 artifact-file-edit。result-download 也不能直接当作文件成功保存次数。

归档的 HTML 未登录本地分支，destination=local、status=success 仅指触发 ZIP 下载，不证明系统保存完成。当前仓库 EDM 上传为外网占位实现，文件归档真实上传回调仍需内网包验收。

| 预览 evidence | 适用分支与可证明的范围 |
| --- | --- |
| image-load | 图片触发 load |
| rendered | Markdown 预览完成（含空内容短路）或导图实例创建完成；不保证外部资源全部加载 |
| content-ready | 代码、源码模式或非导图 JSON 内容已交给展示组件；不保证异步高亮完成 |
| media-loaded | 附件音视频触发 loadeddata；不代表完整播放成功 |
| frame-load | HTML/PDF iframe 触发 load；不证明 PDF 可读、内容正确或 HTML 外部资源成功 |

预览按当前实例的 tab、内容/资源版本、模式及 evidence 去重；同一次重复通知不重复报，重开或刷新可重新计。用于去重的正文、路径、URI 只留内存，不作为 extend 上传。不能把这些不同证据全部当作端到端渲染成功。

## 10. 文件管理（11）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| files-download-file | 单文件下载流程中的打点 | 无 |
| files-batch-download | 批量打包下载流程中的打点 | count |
| files-open-in-tab | 文件行/菜单打开结果 tab | 无 |
| files-add-to-session | 将文件加入输入框会话引用 | 无 |
| files-open-in-explorer | 发起在系统文件夹中定位 | 无 |
| files-navigate-folder | 点击进入子目录 | 无 |
| files-archive | 发起文件归档 | kind |
| files-upload-start | 选择/拖入后开始上传，单文件逐个计、目录一次计；仅打开选择器又取消不报 | operationId、sessionId、kind=file/folder、method=picker/drop、count（可得时） |
| files-upload-result | 实际上传结果；部分上传成功或有文件被过滤不能算全部成功；后续列表刷新失败不覆盖上传结果 | 公共结果字段、kind、method、count/successCount/rejectedCount（可得时）；status=success/partial/failure；reason=validation/folder-name/read-entry/upload |
| files-delete-start | 确认删除后调用接口；取消确认不报 | operationId、sessionId、mode=single/batch、count |
| files-delete-result | 单删接口完成或批删返回数量；按数量区分全部/部分/零成功；UI 后续错误不覆盖已记录结果 | 公共结果字段、mode、count、deletedCount（成功返回时）、status=success/partial/failure；reason=delete |

此组统计用户操作，不统计模型文件生成数量。files-upload-* 与输入框 attachment-* 分属不同上传入口，不能互相替代；空目录创建成功可以记 success。

## 11. 能力使用结果：名字是 server，实际前端发送（3）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| server-mcp-used | taskCards 中识别业务 MCP 工具提交的任务，每 taskId 去重 | tool、taskId |
| server-mcp-result | 业务任务进入 completed/failed，每 taskId 的结果去重；stopped 不报 | tool、taskId、status=success/failure |
| server-skill-used | assistant 中 skill 工具 part completed，且能解析技能名，每 part 去重 | skill |

实现位于 insight-turn.tsx 的 effect。首次观测时先建立历史基线，不为历史结果补报；后续变化才发送。页面未消费到的新结果可能缺少此类事件，不能把这三项当成服务端完整调用流水。server-mcp-used/result 只覆盖业务任务卡识别的 MCP，不是所有 MCP 工具。

## 12. 服务端产物（3）

| name | 触发条件 | source |
| --- | --- | --- |
| artifact-file-write | write completed 且有目标路径，包括覆盖写；或 Shell 核验目标从不存在变为普通文件 | write / script |
| artifact-file-edit | edit completed 且有目标路径；或 Shell 成功后已有文件字节发生变化 | edit / script |
| artifact-mcp-return | MCP 成功返回具有可确定身份的资源；异步任务须用户查询到 completed 和产物 | mcp |

公共 extend：`files:[{type,count:1,tool?}]`、eventId、sessionId、messageId、toolCallId、taskId（可用时）、source、occurredAt、version（可用时）。服务端 userAgent 为 octo-artifact-server。

- 去重键：根会话 + 根用户轮次 + name + 资源身份。同轮同文件的同名事件只入队一次；重复 edit 次数不能用该事件数统计。同一个文件的 write 和 edit 名称不同，可以各有一条。
- 同一事件命中多个来源时保留首次入队 source。跨子任务沿用根轮次归属。
- DOCX/PDF/XLSX 的 files.type 通常为 file，TXT 为 code；不能仅凭 files.type=file 区分三种 Office/PDF 文件。
- Shell 通过 artifactFiles 声明最终文件，限原会话 outputs/uploads，成功退出、未取消且通过前后核验才计数。当前代码还会尽力识别直接 PowerShell Add-Content/Set-Content 的静态 TXT 路径；动态路径无法识别时不保证覆盖，不能泛化为所有 Bash/Python 写盘。
- 普通用户手动改文件、文件存在但工具失败、异步后台仍在写、未捕获目标等，不保证生成事件。工具调用成功也不证明文件内容语义正确。
- 异步 MCP 不主动轮询；仅提交 taskId 不产生此类产物事件。

## 13. 服务端统一工具调用（2）

| name | 触发条件 | 核心字段 |
| --- | --- | --- |
| agent-tool-call-start | 服务端收到完整工具调用，记录执行前参数，每 invocationId 一次 | invocationId、eventId、toolName、toolKind、arguments、会话/轮次/Agent/模型/父调用 |
| agent-tool-call-end | 调用成功、失败、拒绝、取消、超时或中断，每 invocationId 一次 | status、executionStarted、durationMs、结果摘要、错误信息、必要时 effectiveArguments |

status：success/failure/denied/cancelled/timeout/interrupted。工具包括 builtin/plugin/mcp，Shell 的协议工具名为 bash。只覆盖已登记 Insight 轮次及继承归属的子代理；其他模块和未登记历史调用不补报。userAgent 为 octo-tool-call-server。

调用次数按 start 的 invocationId 去重；start/end 不能相加。end 的 success 表示本次工具调用成功：get_task_result 成功返回 failed 业务状态时，调用仍可为 success，业务结果在 toolDetails.businessStatus。耗时不等于异步任务总耗时。队列 attempts 是发送重试次数，不是工具重试次数。

参数及结果会过滤常见凭证并限长，不代表所有业务敏感正文都能自动识别。完整字段见 [统一工具调用埋点](./tool-call-tracking.md)。

## 14. 上下文、权限与问答（6）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| context-compact-start | 确认压缩、通过会话/模型/禁用校验后执行命令 | operationId、sessionId、command |
| context-compact-result | 按业务返回识别完成、失败或中止；确认弹框取消不报 | 公共结果字段、command、status=success/failure/cancelled；reason=command-result/command-request |
| permission-decision-start | 对权限请求选择允许一次、始终允许或拒绝，通过响应中校验后发起请求 | operationId、sessionId、decision=once/always/reject、permission |
| permission-decision-result | 权限响应请求完成或失败；不是工具执行结果 | 公共结果字段、decision、permission、status=success/failure；reason=request |
| question-response-start | 提交答案或拒绝问题，通过发送中校验后发起请求 | operationId、sessionId、action=reply/reject、questionCount |
| question-response-result | 问答请求完成或失败；不上传答案 | 公共结果字段、action、questionCount、status=success/failure；reason=request |

用户选择 reject 后请求成功，result 仍是 success；拒绝选择由 decision/action 表达，不能误解为模型业务成功。

## 15. 模型、知识引用与导航（3）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| model-select | Insight 欢迎页/会话页选择模型生效后；外网风险确认取消不报 | sessionId（可得时）、modelId、providerId、isExternal |
| knowledge-reference-open | 回答下方引用列表中有 URL 的条目点击；不含模型正文任意链接 | sessionId、source=reference-list、index；不上传标题/URL |
| navigation-open | 点击 Insight 的项目、技能库、资产库、设置、更新入口 | target=project/skills/assets/settings/update、source=sidebar、sessionId（可得时） |

主侧栏走 InsightSidebar → GroupedSidebar → AgentSidebar → SidebarShell 可选回调；旧槽位入口兼容保留。共享组件仅由 Insight 接入上报，其他页面不新增同名事件。navigation-open 只表示入口操作，不代表目标页面加载或项目选择成功。

## 验证与查询

1. 前端：开发者工具 Network 搜索 `/record/logger/`，检查请求 payload 的 module=insight、datas[].name 和 extend；page 使用独立接口。不要只看请求 URL 判定产物是否回退前端。
2. 服务端：查本地 SQLite 表 `insight_artifact_delivery_event`，包含上述 5 个服务端 name；state、reason、attempts 用于区分未发送、失败和已确认发送。
3. 没有事件：结合 `insight_artifact_delivery_receipt`、`insight_artifact_delivery_turn`、`insight_artifact_delivery_task`，工具调用另查 `agent_tool_call` / `agent_tool_call_parent`。不能仅凭队列表为空断言工具没运行。
4. sent 表示发送器按当前契约确认 HTTP 响应成功；接收平台是否最终落库仍以接收端为准。本仓不提供接收平台的数据库表结构。
5. 新增操作事件在前端 Network 查找对应 start/result，以 operationId 配对；检查 sessionId、status、durationMs。重试应有新 operationId，重复终态回调不应新增同次结果。新增前端事件不会写入上述服务端队列表。

```sql
SELECT name, state, COUNT(*) AS count
FROM insight_artifact_delivery_event
GROUP BY name, state;

SELECT id, name, state, attempts, reason, created_at
FROM insight_artifact_delivery_event
ORDER BY created_at DESC
LIMIT 100;
```

前端没有可靠重试；服务端缺失/无效地址保留 pending，原账号缺失可能 blocked，网络失败/超时/408/429/5xx 重试，其他拒绝响应通常 failed。重启补发需要保留原数据库和有效配置。配置和更详细边界见 [服务端产物方案](./server-artifact-delivery.md)，以代码为准。

## 旧清单与当前实现差异

- 历史“44 个 name”与初版 80 项均不是当前总数；本版完整列出 103 项，含后续补齐的用户操作与结果事件。
- 旧 session-switch 在当前搜索范围没有发送调用；现侧栏使用 select-session。头部仍用 session-rename/session-delete，侧栏则用 rename-session/delete-session。
- 旧“折叠不打点”的描述已不成立：置顶、最近、分组均存在 toggle-* 事件。
- 旧产物维护说明中的“前端 baseline + set、按类型聚合”不适用于现在的服务端产物持久化去重。
- preset-click、attachment-upload-result 属历史事件，不计入上述 103 个。
- 此快照不把调试日志 `[octo:event]` / `[octo:resource-link]`、SDK SSE 或控制台输出当作上报事件。
- 本次只更新打点盘点，不核验 PR #953 的合入状态、构建配置或安装包行为。

尚未全部覆盖的按钮包括普通折叠、勾选、编辑器格式键、预览缩放等；详见按钮审计。实现完成不等于全按钮覆盖，也不等于已发版。

## 主要代码依据

- [页面入口](../index.tsx)、[Insight 侧栏](../sidebar.tsx)、[会话头部](../components/conversation-header.tsx)
- [共享侧栏](../../../components/agent-sidebar.tsx)、[共享分组](../../../components/grouped-sidebar.tsx)、[上传确认](../../../components/upload-risk-gate.tsx)
- [Insight 加号菜单](../components/insight-addon-menu.tsx)、[共享加号菜单](../../make/components/addon-menu/index.tsx)、[资产选择](../../make/components/addon-menu/asset-dialog.tsx)
- [结果操作](../components/result-viewer/action-bar.tsx)、[结果视图](../components/result-viewer/index.tsx)、[文件管理](../components/file-manager/index.tsx)
- [能力使用](../components/insight-turn.tsx)、[前端发送器](../../../utils/tracker.ts)
- [操作关联与预览去重](../utils/interaction-tracking.ts)、[保存](../components/markdown-editor/index.tsx)、[归档](../components/archive-flow.tsx)
- [权限](../components/permission-dock.tsx)、[问答](../components/question-dock.tsx)、[知识引用](../components/knowledge-references.tsx)
- [侧栏导航回调](../../../components/sidebar-shell.tsx)、[模型选择](../../../components/dialog-select-model.tsx)
- 服务端：packages/opencode/src/tracking/{store,calls,sender,facts,scripts,output-type}.ts；Shell：packages/opencode/src/tool/shell.ts。
