# Insight 产物打点：服务端完成回调方案

## 1. 目标与交付边界

保留 `artifact-file-write`、`artifact-file-edit`、`artifact-mcp-return` 三个 name。产物事实由服务端完成回调采集，持久化后立即唤醒独立发送队列；不依赖当前页面、会话组件或 SSE 消费。

本次接入 write、edit、同步 MCP，以及用户主动查询异步 MCP 后返回的产物。**不主动轮询 MCP**：提交只记录任务归属；用户没有查询就不统计尚未返回的异步产物。用户发起查询后切走页面，只要服务端调用继续完成，就照常采集。

服务端指桌面应用中的 sidecar 进程，不是远程 MCP 服务器。退出整个应用会停止该进程；已经持久化的事件在下次应用启动时补发。正在执行但尚未取得结果的 MCP 调用，不承诺退出后自动继续执行。

## 2. 事件规则

| 场景 | 触发条件 | name | source |
| --- | --- | --- | --- |
| write 新建或覆盖 | 工具 part 成功进入 completed，有目标文件路径 | artifact-file-write | write |
| edit 修改 | 工具 part 成功进入 completed，有目标文件路径 | artifact-file-edit | edit |
| 同步 MCP 产物 | 无 isError，返回有效 resource_link，资源身份可确定 | artifact-mcp-return | mcp |
| 异步 MCP 提交 | 保存 task_id、服务标识和原始轮次 | 不生成产物事件 | — |
| 用户查询异步结果 | get_task_result 返回 completed 和有效产物清单 | artifact-mcp-return | mcp |
| 查询 processing/pending/failed；stop_task | 未取得成功交付物或仅控制结果 | 不生成产物事件 | — |
| bash/PowerShell/Python、apply_patch、自定义插件写盘 | 本批未接入可靠完成证据 | 不生成产物事件，留下未接入回执 | — |
| 手动改文件、目录刷新、下载/落地已有 MCP 产物 | 不属于本批工具产物事实 | 不生成这三个事件 | — |

write/edit 每个原始用户轮次、事件名、规范化文件路径计一次；同轮 write 后 edit 各计一次，下轮再次修改重新计数。子任务继承原始轮次；Windows 路径忽略大小写并统一分隔符，POSIX 路径保留大小写。

每个独立产物入队一个事件，保留 `extend.files: [{type, count: 1}]`；MCP 文件项保留 `tool`。统计应汇总 files.count，不能继续把一条 HTTP 请求当成一个聚合批次。额外记录 eventId、sessionId、messageId、toolCallId、taskId、source、occurredAt、version。相同去重键取首次入队来源，重试不改来源和发生时间。

## 3. 服务端流程

1. Insight 的直接发送、排队发送都在 prompt extra 中携带模块标记、当前 account、uid、version。
2. 服务端在工具执行前登记本轮归属；原 account 和原轮次写入后不被后续登录、查询、重放或回滚重新分配。其他产品使用相同工具时不登记为 Insight。
3. 子任务创建时复制原轮次归属。异步任务提交成功时保存“根会话＋MCP 服务＋task_id → 原轮次”。后续用户查询使用该映射，不使用查询轮次的当前账号。
4. MCP 包装层在输出截断之前提取结构化结果，保留精简事实；不保存文件内容或签名 URL 到打点载荷。
5. `SessionProcessor.completeToolCall` 先保存 completed part，再同步入队。网络发送独立执行，失败不改变工具业务结果。
6. 在 `Server.listen` 启动全局发送器，不需要打开原项目。启动及每分钟只重读已登记轮次的遗漏完成记录；这不是远程任务查询。
7. 新事件立即唤醒发送；后台每 5 秒处理到期重试。队列单进程串行，数据库租约避免多进程同时发送同一条。HTTP 超时 10 秒，租约 30 秒。

## 4. MCP 资源身份

优先使用提供方 `resourceId` / `resource_id`（也识别 `_meta` 中对应字段），结合服务标识与 task_id。禁止直接使用返回 URI、删除 URL 参数后使用、或仅用 task_id 合并多个文件。

现有 `uxr-tool` 的 key_findings、run_guide_analysis、run_usability_analysis、mindmap 按现有前端的“completed 产物清单完整且不变”契约处理：首次 completed 清单与事件在同一事务中冻结，为缺少稳定 ID 的每个条目分配持久化清单槽位 ID；后续查询整批识别为同一份已捕获清单。这样一个多文件任务仍有多条事件，更换签名 URI 不会重新计数。

**该兼容策略的边界**：首次 completed 必须返回完整清单。若提供方可能分页、增量追加或在 completed 后继续改产物，应提供稳定资源 ID 和完整清单回执后再适配，不能依赖首次清单策略。其他 MCP 提供方缺少稳定资源 ID 时保留 pending 诊断，不猜测文件身份。

没有找到任务原始归属时进入 pending 回执；后续提交映射恢复后可重采。无原账号的事件进入 blocked，不能借用当前登录账号。对旧版本提交、未登记原始归属的任务不虚构归属。

## 5. 持久化、重试与保留期限

使用独立表名，避免消费已撤回实现遗留的数据：

- `insight_artifact_delivery_turn`：原始及继承轮次身份。
- `insight_artifact_delivery_task`：异步任务归属、首次完成清单回执。
- `insight_artifact_delivery_event`：正式事件与发送状态。
- `insight_artifact_delivery_receipt`：工具采集诊断，包括没有生成事件的原因。

事件状态为 pending、sending、sent、failed、blocked。连接失败、超时、408、429、5xx 指数退避重试，上限间隔一小时；其他拒绝响应进入 failed 保留载荷，需排查接收契约。配置缺失或无效保留 pending 并记录原因，不回退前端。缺少原始账号记录 blocked。

本版**不自动按 30 天清除待发送事件或载荷**，45 天以上待发送事件也参与恢复；不承诺本地数据库被删除、损坏之后恢复。暂不增加定时清理，后续清理策略应单独评审。

客户端提供确定性 eventId（extend 中）和 `Idempotency-Key` 请求头。若接收成功但响应丢失，仍用原 eventId 重试。**远程数据库恰好一次需接收端按 eventId 幂等**；仅靠客户端不能证明接收库无重复。HTTP 2xx 表示接收接口确认，不等于已核查远程数据库落库。

## 6. Beta / Prod 配置与构建

两个文件都复用原有前端地址，不要求用户再填写一份 OCTO_REPORT_BASE_URL：

```dotenv
# packages/desktop/.env.beta：替换为实际 Beta 服务根地址
VITE_OCTO_REPORT_BASE_URL=http://www
OCTO_ARTIFACT_SUCCESS=http-2xx
```

```dotenv
# packages/desktop/.env.prod：替换为实际生产服务根地址
VITE_OCTO_REPORT_BASE_URL=https://实际生产域名
OCTO_ARTIFACT_SUCCESS=http-2xx
```

`http://www` 仅对应已在环境中可解析、可访问的真实主机名，不能把示例或尖括号占位符原样用于生产。VITE 变量保持**服务根地址**，因为其他前端打点还会追加 `/record/logger/interaction` 或 `/record/logger/page`。服务端兼容完整 interaction 地址，但不代表已有前端 tracker 也支持完整地址。

构建时 Vite 将上述地址写入 Electron 主进程，主进程 fork sidecar 时以 OCTO_REPORT_BASE_URL 注入。已显式设置的运行环境 OCTO_REPORT_BASE_URL 优先；排查时也要检查是否有旧的系统环境变量覆盖。服务端默认 http-2xx；如果真实接口以 `{code:0}` 确认成功，设置 `OCTO_ARTIFACT_SUCCESS=code-0`。

Beta/Prod 构建时会检查地址：缺失、不是 HTTP(S) 绝对地址、或误填 interaction/page 完整接口路径，都会直接报错，避免继续打出错误配置的包。独立服务端运行时缺少地址则保留 pending 事件及诊断。

本版不读取 `OCTO_ARTIFACT_TRACKING`、`OCTO_ARTIFACT_DIAGNOSTICS`、`OCTO_ARTIFACT_SCRIPTS`，可以删除这些旧配置。不需要 server 开关，也不会因漏开而继续由前端发送。

必须先构建再打包：在 packages/desktop 执行 `bun run build:beta` 后执行 `bun run package:beta`；Prod 对应 build:prod / package:prod。现有 release 脚本已经按这个顺序执行。直接运行 package 命令只会打包现有 out，不能用于证明新代码或新配置已生效。

## 7. 怎么观察

新版本不会在渲染页面 DevTools Network 中发出这三个 name 的 interaction 请求。页面其他打点（如 message-send、server-mcp-used、server-mcp-result）仍可能使用同一个接口，必须查看请求 payload 的 name，不能只看 URL。

服务端日志检索 `[octo:artifact]`：启动日志含数据库位置、是否配置地址及成功契约；delivery 日志含 eventId、name、HTTP 状态、attempts。用户没有生成事件时还需查询本地 receipt，不能只看发送表。

在启动日志给出的本地 SQLite 数据库中执行只读查询：

```sql
SELECT id, name, message_id, part_id, state, attempts, reason, created_at
FROM insight_artifact_delivery_event ORDER BY created_at DESC LIMIT 100;

SELECT part_id, message_id, tool, task_id, state, reason, updated_at
FROM insight_artifact_delivery_receipt ORDER BY updated_at DESC LIMIT 100;

SELECT id, message_id, tool, completed_part_id
FROM insight_artifact_delivery_task;
```

receipt 常见原因：file-enqueued / mcp-enqueued、task-not-completed、no-artifact-resource、tool-not-integrated、missing-task-origin、missing-stable-resource-id、mcp-error。事件中的 missing-original-account、missing-or-invalid-report-url、response-rejected 用于区分账号、配置和接收错误。turn 表用于核查本轮是否登记。

## 8. 验收与下一阶段

验收同时满足“停留与切走得到相同事件集合”和“两个集合都等于事先定义的预期集合”。至少包括：

| 操作 | 预期 |
| --- | --- |
| 同轮 write r2.md 两次，再 edit 一次 | write 1 条、edit 1 条 |
| 新轮次再 write r2.md | 新增 write 1 条 |
| 两个子任务同轮写同一路径 | write 1 条；两个不同路径则 2 条 |
| 提交异步任务后不查询 | MCP 产物事件 0 条 |
| 用户查询 completed，返回两个产物 | MCP 2 条，归属于提交时的账号和轮次 |
| 重复查询，两个签名 URI 均变化 | 总数仍 2 条 |
| 查询发起后切到其他会话 | 与停留的预期集合相同 |
| 只保存 completed part 后进程中断 | 重启重放，事件仅入队一次 |
| 接收后断开连接，不返回响应 | 重试沿用相同 eventId；接收端验证幂等 |
| 45 天待发送事件，重启不打开原项目 | 发送成功；不因年龄丢弃 |
| 缺地址、缺账号、失败、无资源、未接入工具 | 有对应诊断，不生成错误归属或前端补发 |
| 安装实际 Beta 包，用 write/edit/MCP 操作 | 确认 sidecar 日志、三个 name 的 Network 缺席、真实接收数据库记录 |

自动化用真实 SQLite、独立进程重启和本地 HTTP 接收器验证；类型检查及构建检查不能替代最后一项真实安装包联调。实际公司接收地址与接口幂等能力需要在用户打包环境验证。

脚本产物作为后续独立交付：要求调用专属输出目录、受控写入接口或明确完成回执，才能归因并区分新增/修改。不能以共享目录差异、文件存在、哈希稳定证明脚本成功完成，也不能误统计手动修改和后台程序输出。接入后可沿用 write/edit 事件名与 source=script；本版没有启用该覆盖。

## 9. 本次验证记录（2026-09-18）

- `packages/opencode` 中运行 `bun test test/tracking/delivery.test.ts --timeout 30000`：15 项通过，包含断开连接后同 eventId 重试、独立进程重启、超过 30 天事件补发。
- `packages/opencode` 中运行 `bun test test/session/processor-effect.test.ts --test-name-pattern 'artifact completion' --timeout 30000`：1 项集成测试通过，实际执行文件写入和修改，验证完成回调直接产生 write/edit 事件。
- `packages/opencode`、`packages/app`、`packages/desktop` 的 `bun typecheck` 全部通过。
- `build:beta` 构建通过；测试地址为 `http://127.0.0.1:43198`，不是公司真实上报地址。后续代码的主进程和 sidecar 也已重新构建验证。交付真实安装包前必须使用真实 .env.beta 重新构建，不能直接分发本次测试 out。
- 使用 Electron 自带 Node 24.15.0 运行构建后服务端包：新建临时 SQLite，三个事件全部通过本机 HTTP 接收器发送并标记 sent；没有打开项目。检查生成的 renderer JS，三个产物事件名均不存在。
- 未安装实际 Beta 安装包，未向公司上报服务发送测试数据，未核验其幂等实现或远程数据库。

构建后可在 `packages/desktop` 用 PowerShell 复验最后一项：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & .\node_modules\electron\dist\electron.exe .\scripts\verify-artifact-delivery.mjs
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}
```

该检查只启动测试服务进程和本机接收器，使用独立临时数据库；不启动桌面 GUI，也不操作现有用户数据。
