# Insight 打点盘点（2026-10-15）

依据本地 `dev` 分支 `c7b0d68f9` 的实际调用代码整理，未拉取远端、未验证线上落库。范围为 Insight 页面、以 `trackerModule="insight"` 接入的共享组件，以及已登记 Insight 轮次的服务端事件。此文是实现快照，不新增或修改打点。

按唯一 name 计 **80 个**：前端 75 个（页面 1 个、交互/结果 74 个），服务端 5 个。代码中有调用入口不代表每种环境都能触发，更不代表接收端已成功入库。旧清单中的“44 个”已不适用。

## 上报通道与公共字段

| 通道 | 事件 | 请求 | 页面 DevTools Network | 可靠性 |
| --- | --- | --- | --- | --- |
| 前端页面 | insight-page | POST `/record/logger/page` | 能看到前端发起的请求 | 无持久化重试 |
| 前端交互/结果 | 以下除服务端 5 项外的其他事件，包括 server-* | POST `/record/logger/interaction` | 能看到前端发起的请求 | 无持久化重试；部分来自组件 effect，依赖页面消费结果 |
| 服务端产物 | artifact-file-write/edit、artifact-mcp-return | POST `/record/logger/interaction` | 看不到 sidecar 发出的 HTTP 请求 | 本地队列、租约、去重、重试与恢复 |
| 服务端工具 | agent-tool-call-start/end | POST `/record/logger/interaction` | 看不到 sidecar 发出的 HTTP 请求 | 复用持久化发送队列 |

前端公共字段：`module=insight`、`project=octo-agent`、account、uid、browserName/browserVersion、os、platform、userAgent；`datas[]` 中含 type、name、path、extend。interaction 默认 `subType=click`，即使事件语义是成功/失败结果也如此，不能只凭 subType 判断用户点击。extend 是 JSON 字符串；读取到 appInfo.version 时自动合入 version。页面事件另有 from、screenWidth、screenHeight。

前端账号取发送时的 localStorage.userInfo；服务端事件使用已持久化的原轮次账号。前端 fetch 不检查响应是否为 2xx，也没有本地队列：调用了 tracker 不等于落库成功。

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

## 4. 消息（3）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| message-send | 发送通过前置校验并进入发送/排队流程，不代表模型调用成功 | trigger=button/enter、source=welcome/conversation、attachmentCount、textLength、mcpFunction |
| message-send-blocked | 因未选择模型阻止发送；不是所有拦截原因的全集 | reason=no_model |
| message-abort | 有会话且未处于停止请求中，发起停止 | 无 |

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

## 7. @ 引用与加号菜单（6）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| mention-open | @ 引用面板从关闭到打开 | 无 |
| mention-select | 选中一个技能或文件引用 | type=skill/file |
| addon-select-skill | 加号菜单选择技能 | name=技能 label |
| addon-select-design-file | 加号菜单选择会话文件，名称沿用共享组件；不代表仅设计模块 | filename |
| addon-select-product-asset | 选择产品资产项 | fileName |
| addon-confirm-product-asset | 确认选中的产品资产；不代表下载/导入全部成功 | count |

共享 AddonMenu 在 Insight 显式接收 trackerModule=insight。选中技能不等于模型执行 skill 工具；合计引用量时也不能默认不同入口事件互斥。

## 8. 任务卡片（3）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| task-refresh | 通过 busy/cooldown 校验，发起查询提示 | taskId |
| task-stop | 通过 busy 校验，发起终止任务提示 | taskId |
| task-open-result | 打开已存在结果，或 completed 无产物时发起一次结果补查 | taskId；补查分支 deferred=true |

刷新和停止是用户意图，不证明远端任务已查询/停止成功。

## 9. 结果面板（11）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| result-card-open | 点击对话输出卡；在结果打开前记录 | cardType |
| result-tab-switch | 切换到不同结果 tab | tabType |
| result-tab-close | 关闭结果 tab | tabType |
| result-retry | 结果加载失败后点击重试 | tabType |
| result-copy-content | 点击复制结果内容 | tabType、viewMode |
| result-download | 在下载菜单选择格式，在执行导出前记录 | format、tabType |
| result-archive | 发起结果归档 | tabType |
| md-edit-open | 点击 Markdown 编辑入口 | source |
| file-open-in-app | 文件卡走本地应用打开流程 | fileType |
| file-reveal-folder | 文件卡/Markdown 入口走文件夹定位流程 | fileType |
| file-save-as | 文件卡走另存为流程 | fileType |

md-edit-open 只表示进入编辑，不能当作保存成功或 artifact-file-edit。result-download 也不能直接当作文件成功保存次数。

## 10. 文件管理（7）

| name | 触发条件 | 业务 extend |
| --- | --- | --- |
| files-download-file | 单文件下载流程中的打点 | 无 |
| files-batch-download | 批量打包下载流程中的打点 | count |
| files-open-in-tab | 文件行/菜单打开结果 tab | 无 |
| files-add-to-session | 将文件加入输入框会话引用 | 无 |
| files-open-in-explorer | 发起在系统文件夹中定位 | 无 |
| files-navigate-folder | 点击进入子目录 | 无 |
| files-archive | 发起文件归档 | kind |

此组统计用户操作，不统计文件生成数量。未找到文件管理单个/批量删除的独立打点。

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

## 验证与查询

1. 前端：开发者工具 Network 搜索 `/record/logger/`，检查请求 payload 的 module=insight、datas[].name 和 extend；page 使用独立接口。不要只看请求 URL 判定产物是否回退前端。
2. 服务端：查本地 SQLite 表 `insight_artifact_delivery_event`，包含上述 5 个服务端 name；state、reason、attempts 用于区分未发送、失败和已确认发送。
3. 没有事件：结合 `insight_artifact_delivery_receipt`、`insight_artifact_delivery_turn`、`insight_artifact_delivery_task`，工具调用另查 `agent_tool_call` / `agent_tool_call_parent`。不能仅凭队列表为空断言工具没运行。
4. sent 表示发送器按当前契约确认 HTTP 响应成功；接收平台是否最终落库仍以接收端为准。本仓不提供接收平台的数据库表结构。

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

- tracking.md 的“44 个 name”不是当前总数；漏记了共享侧栏/分组、产品资产、风险提示、归档及不可预览分支等。
- 旧 session-switch 在当前搜索范围没有发送调用；现侧栏使用 select-session。头部仍用 session-rename/session-delete，侧栏则用 rename-session/delete-session。
- 旧“折叠不打点”的描述已不成立：置顶、最近、分组均存在 toggle-* 事件。
- 旧产物维护说明中的“前端 baseline + set、按类型聚合”不适用于现在的服务端产物持久化去重。
- preset-click、attachment-upload-result 属历史事件，不计入上述 80 个。
- 此快照不把调试日志 `[octo:event]` / `[octo:resource-link]`、SDK SSE 或控制台输出当作上报事件。
- 此次没有验证 PR #953 是否已进入本地分支；本地构建配置仍有缺地址时报错的旧检查，不据 PR 讨论推断安装包行为。

## 主要代码依据

- [页面入口](../index.tsx)、[Insight 侧栏](../sidebar.tsx)、[会话头部](../components/conversation-header.tsx)
- [共享侧栏](../../../components/agent-sidebar.tsx)、[共享分组](../../../components/grouped-sidebar.tsx)、[上传确认](../../../components/upload-risk-gate.tsx)
- [Insight 加号菜单](../components/insight-addon-menu.tsx)、[共享加号菜单](../../make/components/addon-menu/index.tsx)、[资产选择](../../make/components/addon-menu/asset-dialog.tsx)
- [结果操作](../components/result-viewer/action-bar.tsx)、[结果视图](../components/result-viewer/index.tsx)、[文件管理](../components/file-manager/index.tsx)
- [能力使用](../components/insight-turn.tsx)、[前端发送器](../../../utils/tracker.ts)
- 服务端：packages/opencode/src/tracking/{store,calls,sender,facts,scripts,output-type}.ts；Shell：packages/opencode/src/tool/shell.ts。
