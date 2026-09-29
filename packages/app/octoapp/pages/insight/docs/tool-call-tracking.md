# 统一 Tool / MCP 调用埋点

一次调用上报 `agent-tool-call-start` 和 `agent-tool-call-end`，共用 invocationId；eventId 分别去重。数据从服务端发出，不依赖 Insight 页面。首期沿用 Insight 轮次登记与账号快照，子代理继承根轮次。没有登记的其他模块及历史会话不补报。

## 统计口径

- 调用量：start 按 invocationId 去重，不能将 start/end 相加。
- 成功/失败及耗时：end 的 status、durationMs；仅结束事件进入成功率分母。另按 executionStarted 区分实际进入工具实现的调用和校验/权限拒绝。
- status：success、failure、denied、cancelled、timeout、interrupted。
- MCP 返回 task_id 表示提交调用完成，耗时不包括异步任务运行时间。get_task_result 查询成功但任务 failed 时，status=success、toolDetails.businessStatus=failed。
- SDK 参数校验失败在修复为 invalid 工具之前采集原工具信息，修复过程不新增一次调用。
- 已有 server-*、artifact-* 和用户点击事件保持独立。发送队列内部的 attempts 是网络投递重试，不是工具执行重试。

## extend

| 类别 | 字段 |
| --- | --- |
| 标识 | schemaVersion=1、eventId、invocationId、phase、occurredAt |
| 工具 | toolName、registeredToolName、toolKind（builtin/plugin/mcp）、toolProvider（可获得时）、transport |
| 归属 | agent、rootAgent、sessionId、rootSessionId、messageId、rootMessageId、partId、toolCallId、parentInvocationId、parentSessionId、depth、triggerSource |
| 模型/环境 | modelProvider、modelId、version、environment |
| start 参数 | arguments、argumentsBytes、argumentsTruncated、redactedFields、omittedFields |
| end 参数 | argumentsChanged；变化时 effectiveArguments；argumentsTruncated、redactedFields、omittedFields |
| end 时间 | requestedAt、executionStartedAt、endedAt、durationMs、executionDurationMs、permissionWaitMs |
| end 状态 | status、executionStarted、executionStage |
| end 返回 | resultSummary、outputBytes、outputTruncated、resourceCount、resultRedactedFields、resultOmittedFields、toolDetails |
| end 错误 | errorType、errorCode、errorMessage、retryable（仅明确时） |
| 恢复/降级 | recovered、durationEstimated、payloadTruncated |

未知字段省略。module=insight、account/uid、系统信息位于既有协议顶层。rootMessageId 为根用户轮次消息，messageId 为当前 assistant 消息；partId 仅在工具片段已经生成时可获得。

toolDetails 按现有结构化协议采集：MCP 的 serverName/isError/taskId/businessStatus；Shell 的 exitCode/shell；skill 的 skill；task 的 childSessionId；文档抽取的 format/chars/pages/error。不根据任意自然语言猜测工具失败。

## 参数与内容

请求参数在插件处理前快照；插件重定向路径或替换参数后，end 记录有变化的执行参数。参数和结果先递归过滤、限长，再写数据库及队列：password/token/authorization/cookie/apiKey 等凭证不保存；命令中的常见凭证赋值、Bearer/Basic 和 URL 签名也过滤。二进制及循环对象省略。此过滤不能自动识别所有业务敏感文本，正文与查询内容仍属于受限长度的业务数据。

参数对象上限 16 KiB，单字符串上限 4 KiB，结果摘要上限 4 KiB，错误摘要上限 2 KiB，extend 上限 32 KiB。记录过滤字段和截断状态。原请求参数保存在 start，不在 end 重复上传。为了识别截断/过滤范围之外的参数变化，调用表保存参数指纹，指纹不发送。

## 上报、恢复与隔离

- 新增 agent_tool_call / agent_tool_call_parent 表，独立于产物事实表；复用现有持久化事件队列和 `/record/logger/interaction` 发送器、环境配置、重试与幂等键。
- start/end 分别与调用状态事务落库；事件采集异常仅记诊断，不改变工具返回结果。
- 总耗时使用不可重置的开始时间。执行耗时从工具实现入口计算，并扣除期间 permission.ask 的等待；包含工具内部准备工作，不等于纯远端/进程 CPU 时间。
- sender 定期恢复：只处理原进程已退出的未完成调用。有保存结果则恢复结果，否则 interrupted；不知道真实结束时刻时标记 durationEstimated。原进程仍存活时不将长任务误报为中断。PID 被其他进程复用时保守延后恢复。
- 保留发送失败队列，重发使用相同 eventId。分析端仍需按 eventId 去重，不能假设 HTTP 层 exactly-once。
- 不主动轮询 MCP、不重新执行工具，不影响原有产物采集、文件写入、权限规则和其他模块行为。

实现入口：`session/prompt.ts` 的通用执行包装器、`session/processor.ts` 的生命周期兜底、`session/llm.ts` 的 SDK 校验失败；采集模块 `tracking/calls.ts`、过滤模块 `tracking/call-data.ts`。
