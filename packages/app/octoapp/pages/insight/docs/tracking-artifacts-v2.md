# Insight 产物打点 v2（任务 114）

实现只服务 Insight 及其关联子任务。三个 name 保持为 `artifact-file-write`、`artifact-file-edit`、`artifact-mcp-return`。默认诊断运行，原前端打点继续负责正式发送。

## 统计契约

- 每个原始用户 turn、name、文件身份最多一条；下一轮重新计数。write 覆盖写仍属 write，同轮 write 后 edit 各计一次。
- `files` 保留单元素数组，`count: 1`；MCP 元素保留 `tool`。新增 `schemaVersion: 2`、`eventId`、`sessionId`、`messageId`、`source`、`occurredAt`。`extend` 仍为 JSON 字符串。
- `source` 是首次入队的来源，跨来源命中同一个事件不改写。不能通过过滤 source 完全还原旧版漏报统计。
- 文件类型镜像当前完整 `output-type.ts`，并有前后端分类一致性测试。未知扩展名仍为 code。
- 上报不含绝对文件路径、文件内容或资源 URI。文件路径只参与本地身份计算；Windows 路径不区分大小写，POSIX 保留大小写。MCP 必须提供 `resourceId/resource_id/artifactId/artifact_id/id` 之一作为稳定产物 ID，签名 URI 不参与去重；缺少稳定 ID 的资源进入 `identity-unresolved` 诊断，不生成正式事件。
- 账号、uid、版本在服务端接受提问时固定；缺账号状态为 `missing-account`，不使用后续登录账号补填。

## 事实入口与恢复

1. `SessionPrompt.createUserMessage` 在运行工具前持久化 turn，用户 text part 携带发送权标记。
2. 普通 write/edit 从已持久化 completed tool part 读取实际路径（优先 metadata.filepath）。
3. 普通 MCP 在 `SessionPrompt.resolveTools` 保存最小 `octoArtifactResult`（资源链接、task_id/status、isError）。不保存整份文档，也不改变原工具 output 或下载行为。
4. 异步业务提交后持久化 provider、taskId、查询参数、原 turn、查询租约、下次查询时间和 24 小时截止时间。全局 worker 主动调用 `get_task_result`；完成结果以幂等 completed tool part 写回原会话并归属原 turn。stop_task 进入 cancelled，不计产物；未知提供方进入 unsupported。授权失败暂停为 waiting_auth，不改用后续账号。
5. `TaskTool` 在派发子提问前继承原 turn/账号。原任务与子任务共用根会话、用户 messageId 的事件去重键。
6. completed tool part 是补采事实，`insight_artifact_fact` 区分 pending/processed。归属暂缺时保留 pending 并延迟重试；不会提前写成永久完成。`insight_artifact_observation` 记录 no-artifact、identity-unresolved、origin-unresolved、扫描冲突和任务状态。
7. worker 在服务端数据库就绪后全局启动，不依赖项目或页面初始化。每两秒恢复事实、异步任务和发送队列；重启后无需打开原会话或原项目即可继续处理。

## 发送权与回滚

`OCTO_ARTIFACT_TRACKING=diagnostic` 为默认值。诊断事件保存在本地数据库但不发送；前端旧逻辑继续发送。

显式设置 `OCTO_ARTIFACT_TRACKING=server`、非空上报地址和成功契约后，新 turn 固定为 server。前端仅跳过 server 所属结果；原有在途 turn 不受影响。查询旧任务时，MCP 结果携带原任务 owner，避免错按查询 turn 的 owner 判定。

回滚只需将新 turn 模式改回 diagnostic。旧 server turn 和已入队事件仍由服务端负责；只要上报地址和成功契约保留，发送器继续排空它们。**不要通过清空地址或成功契约来回滚采集，否则旧队列会暂停。**

前端旧 effect 暂时保留，是迁移/回滚协议的一部分，不是双发。文件管理刷新和其他 tracker 调用未改。

## 队列与成功响应

状态：pending → sending → sent；可重试失败回 pending，不可重试失败进入 failed。发送实例通过事务租约领取，租约 30 秒，单次请求 10 秒超时。过期 sending 可重新领取，旧租约不能覆盖新结果。

网络失败、408、429、5xx 使用带抖动的指数退避；遵循 Retry-After。2xx 业务拒绝、其他 4xx 不无限重试。事件 JSON、eventId、账号和 occurredAt 在重试中保持不变。

`OCTO_ARTIFACT_SUCCESS` 必须显式选择：

- `http-2xx`：仅在接收端确认 HTTP 2xx 即业务成功时使用。
- `code-0`：HTTP 2xx 且 JSON `code === 0`。
- 留空：不进行真实服务端发送。

pending/sending 最大 50,000 条；超限事务不提交，事实留待后续补采，发送器仍继续排空。自动补报窗口为 30 天；超期待发送事件标记 `expired`，保留原载荷供诊断或显式重放。成功/失败/诊断载荷保留 30 天，expired 载荷和所有去重回执保留至 90 天。

**发布前外部确认项：**接收端支持 eventId 幂等（或报表去重）、实际成功响应契约、延迟补报是否按 occurredAt 归属日期、服务端环境字段和相对 path 是否接受。当前没有线上接口验收证据，不能宣称严格不重不漏或直接将诊断开关改为 server。

## 脚本扫描（独立开关）

`OCTO_ARTIFACT_SCRIPTS=1` 才启用共享目录观察。范围是 `<projectDir>/.octo/<rootSessionId>/outputs/`，不依赖 Git 或 ignore 规则。目录差异不能单独证明写入者或文件完整性，因此 server 轮次只产生候选诊断；diagnostic 轮次暂保留旧事件用于对照，不能作为正式统计。

- write/edit/bash/powershell/python 执行前建立基线，工具退出后比较。write/edit 的比较只确认版本。脚本成功时标为 `attribution-unconfirmed`；异常或取消时标为 `completion-unconfirmed`，均不进入 server 正式事件。
- 观察到的完整差异先保存为 observed，再把事件和新基线同事务提交。入队失败不推进基线；下次扫描前及后台循环会补处理 observed。
- turn 收尾再次检查；工具结束后新增的、无法归因的后台/外部变化只记录诊断，不推断为当前脚本产物。
- MCP 下载入口在写盘前/成功后记录本地 `.artifact-source-<hash>.json`。仅记录文件名、内容指纹和 pending，不含 URI。与文件版本相同的下载不算脚本写入，随后脚本修改仍记 edit；超过 10 分钟的 pending 降级成普通版本证据，避免进程在写盘中途退出后永久阻塞扫描。该 IPC 的持久化调用方已核对为 Insight；Make 的临时目录调用不新增来源记录。
- 不跟随 symlink/junction，含输出目录自身及会话目录。排除 `.materialized.json`、`.artifact-source-*`、`.crdownload`、`.part`、`~$*`；其余隐藏文件、陌生扩展名不随意排除。
- 同会话并发工具窗口标为归属冲突，不进行猜测计数；同目录重复扫描请求合并，全局最多两次扫描并发。
- 默认单次预算：1,000 个目录项、256 MiB 总读取、128 MiB 单文件、3 秒检查预算。64 KiB 分块计算 SHA-256，读前后检查文件版本；文件读中变化最多重试一次，共用剩余预算。底层文件系统调用自身的阻塞延迟不承诺硬实时上界。
- 超限、不可读、下载 pending、冲突、不完整基线均不推进比较基线，不把未扫描文件误作删除。诊断可从 scan 表查看，用户工具继续执行。
- 创建后立即删除、外部程序同窗口写入、强杀前尚未观测以及迟到后台进程输出，不保证准确覆盖；有明确冲突时放弃归因。脚本统计需单独验收后开启。

## 诊断入口

设置 `OCTO_ARTIFACT_DIAGNOSTICS=1` 后，可通过鉴权后的 `GET /global/artifact-tracking?messageId=<根消息ID>&limit=100` 查看 turn、工具观察、异步任务、扫描和队列状态。接口不返回事件 payload、文件路径、资源 URI 或文件内容。

## 本地检查

在对应包目录运行：

```text
packages/opencode: bun test test/tracking/artifact.test.ts --timeout 30000
packages/app: bun test ./octoapp/pages/insight/utils/artifact-tracking.test.ts
packages/opencode、packages/app、packages/desktop: bun typecheck
```

测试使用真实 SQLite、独立进程重新打开磁盘数据库、临时目录和本地 HTTP 接收器。覆盖事实/observed 补采、去重、账号固定、子任务、跨 turn MCP、回滚、租约、重试、下载版本排除、目录链接、扫描预算与异常脚本收尾。

桌面正式验收须使用重新构建的 sidecar，依次验证真实请求、接收确认、服务端重启、账号切换、在途回滚，再启用脚本并检查大目录诊断。仅 mock 日志或源码类型检查不算生产验收。
