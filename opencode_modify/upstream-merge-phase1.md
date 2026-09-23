# 上游合入 Phase 1 执行记录（纯优化项）

> 日期：2026-09-22
> 基点：我方 `dev_dyf`（fork base `6ff833a22` = v1.14.41 后）← 上游 `D:\octoAI\opencode`（HEAD `ebb7b76ca` = v1.18.31）
> 配套文档：[upstream-merge-plan.md](./upstream-merge-plan.md)（三阶段计划）、[upstream-merge-analysis.md](./upstream-merge-analysis.md)（冲突全景）
> 状态：**Phase 1 已完成并验证**。不含 v2 架构（SessionV1/LayerNode/EventV2Bridge/TaggedError/Effect Schema），不新增 workspace 包。

## 一、变更总览

```
 packages/opencode/package.json                     |   2 +-   （bedrock 4.0.96 → 4.0.166）
 packages/opencode/src/account/account.ts           |  24 ++   （#44029 + #36276）
 packages/opencode/src/bus/index.ts                 |  49 ++   （#27959 竞争修复）
 packages/opencode/src/plugin/index.ts              |   2 +-   （subscribe API 适配）
 packages/opencode/src/project/project.ts           |   2 +-   （同上）
 packages/opencode/src/project/vcs.ts               |   2 +-   （同上）
 packages/opencode/src/provider/provider.ts         | 136 ++   （5 项安全优化）
 packages/opencode/src/server/.../httpapi/event.ts  |  54 ++   （#27959 适配）
 packages/opencode/src/session/compaction.ts        | 103 ++   （模板重构 + tail_turns 语义）
 packages/opencode/src/session/message-v2.ts        |   5 +    （ContentFilterError）
 packages/opencode/src/session/processor.ts         |   1 +    （retry policy 传入 providerID）
 packages/opencode/src/session/prompt.ts            |  35 ++   （孤儿 tool_use 等 3 修复）
 packages/opencode/src/session/retry.ts             | 107 ++   （错误模式扩容）
 packages/opencode/src/share/share-next.ts          |  18 +-   （subscribe API 适配）
 packages/opencode/test/bus/bus-effect.test.ts      |  12 +-   （subscribe API 适配）
 packages/opencode/test/session/compaction.test.ts  |   2 +-   （tail_turns 显式配置）
 packages/opencode/test/session/retry.test.ts      |  66 +-   （新错误模式用例）
 packages/sdk/js/src/v2/gen/types.gen.ts            |   9 +    （finishReason content_filter 类型）
```

## 二、session 层

### 2.1 retry.ts — 错误模式扩容 + retry-after + jitter 上限

- 可重试错误模式扩充：新增对 `overloaded`、`529`、`model_is_error`、`provider_error`、`tool_use_failed`、`500`/`502`/`503`/`504` 状态码等上游新增模式的支持
- 支持 `Retry-After` 响应头：服务端指定的等待时间优先于本地退避计算
- jitter 上限：指数退避的随机抖动设置上限，避免长退避被抖动放大
- 配套 `test/session/retry.test.ts` 更新新模式的用例

### 2.2 prompt.ts — 孤儿 tool_use / unknown finish / content-filter 3 项修复

1. **孤儿 tool_use**：当上一条 assistant 消息携带 tool_use 但 tool_result 缺失（中断/崩溃场景），补一个占位 tool_result（`[Tool result was interrupted]`），避免下游 SDK 抛 "tool_use ids without tool_result blocks" 硬错误
2. **unknown finish_reason**：finish_reason 无法识别时不再静默丢弃，按正常结束处理并记录
3. **content-filter**：`finishReason === "content-filter"` 时终止循环并抛 `ContentFilterError`（message-v2.ts 新增该错误类，SDK `types.gen.ts` 补充对应类型），让上层能感知内容过滤而非无限续跑

### 2.3 processor.ts — retry policy 上下文

- retry policy 回调调用处补传 `ctx.model.providerID`，使按 provider 定制重试策略成为可能（当前策略未区分，为后续扩展预留）

### 2.4 compaction.ts — 模板重构 + tail_turns 语义（详细分析见下文第六节）

- 移除硬编码 `DEFAULT_TAIL_TURNS = 2`，`tail_turns` 改为纯配置驱动：`undefined` = 保留全部近期轮次（默认 15k token 预算内），`<= 0` = 不保留尾部
- `MAX_PRESERVE_RECENT_TOKENS` 8k → 15k
- 新增 `serialize()`：对话序列化为 `[User]:` / `[Assistant]:` / `[Assistant tool call]: tool(input)` / `[Tool result]:` 文本格式，工具输出截断 2000 字符，mime 附件用占位符
- 新增 `truncate()` 工具函数
- prompt 组装重构：`<conversation>` 标签包裹对话 + `<previous-summary>` 锚定摘要 + 我方保留的 `SUMMARY_TEMPLATE`；有 `previousSummary` 时走"更新锚定摘要"指令，否则"新建摘要"
- 插件注入点：`experimental.chat.messages.transform` 插件钩子在摘要前可变换消息
- **我方交互修复**：纠错重试（corrective retry）流程在 prompt 后追加完整对话历史，避免移植后重试时丢失上下文（我方自定义的重试流上游没有，需手动对齐）
- `test/session/compaction.test.ts` 仅一处必要修改："summarizes only the head" 用例显式 `tail_turns: 2`（与上游自身测试适配一致）

## 三、bus 层 — #27959 /event SSE 竞争修复

**问题**：`subscribe()` 原返回懒 `Stream`，`/event` SSE 路由在 Stream 被消费前存在前缀消费窗口，窗口内 publish 的事件会丢失。

**修复**（`src/bus/index.ts`）：

```ts
// 旧：subscribe: (def) => Stream（懒，订阅时机 = 消费时机）
// 新：
readonly subscribe: <D>(def: D) => Effect.Effect<Stream.Stream<Payload<D>>, never, Scope.Scope>
```

实现改为 `Effect.gen`：yield 时即 `PubSub.subscribe(ps)` 获取 subscription + `Effect.addFinalizer` 注册清理 + 返回 `Stream.fromSubscription(subscription)`，订阅动作提前到获取 Effect 时。

**调用方适配**（`yield* (yield* bus.subscribe(...)).pipe(...)` 模式）：

- `src/server/routes/instance/httpapi/event.ts`：eventResponse 重构为 Effect.gen，eager 订阅后 `Stream.takeUntil`
- `src/share/share-next.ts`：watch() 增加 flatMap + forkScoped
- `src/project/project.ts`、`src/project/vcs.ts`、`src/plugin/index.ts`：单行适配
- `test/bus/bus-effect.test.ts`：6 处调用点适配，18/18 通过

**未合入 #28051**（bus.publish 实例上下文丢失）：我方 `InstanceState.bind`（ALS）+ `run-service.ts` 的 `makeRuntime.attach()` 已保证 publish 的实例上下文，上游该修复针对的是上游自己的 runtime 结构，不适用。

## 四、account 层

- **#44029**：`login()` 对 `verification_uri_complete` 做绝对化 + 协议白名单校验（仅 http/https），恶意服务器返回 `file://` 等协议 URL 时不再直接交给前端打开
- **#36276**：新增 `remove()` 中删除当前活跃账号后的回退逻辑——自动切换到剩余账号的第一个 org，避免删号后 active 指向不存在的账号

## 五、provider 层 — 5 项安全优化（保守合入）

> 原则：只采纳与我方自定义功能（fetch-debug 诊断、bypass dispatcher、bpit-beta、models-snapshot、metadata 注入）无交集的部分。完整审查记录见上游对照。

| # | 优化项 | 内容 |
|---|---|---|
| 1 | SSE cancel 兜底 | `wrapSSE` 中 `reader.cancel(err)` 加 `.catch(() => {})`，cancel 竞争时不再抛未处理 rejection |
| 2 | Azure oauth | auth type 为 oauth 时 `azure-cognitive-services` 传 `accountId`；baseURL 按部署 URL 模式决定是否带 `/v1` |
| 3 | Vertex 多区域 | 新增 `googleVertexAnthropicBaseURL()`（eu/us 大区走 `aiplatform.{region}.rep.googleapis.com`）与 `googleVertexEndpoint()`；google-vertex 的 fetch 改用 `GoogleAuth` 客户端获取 access token；支持 `GOOGLE_VERTEX_PROJECT` 环境变量 |
| 4 | Bedrock 增强 | 新增 `@ai-sdk/amazon-bedrock/mantle` bundled 入口 + `selectBedrockMantleLanguageModel()`（20b/120b 走 chat，其余走 responses）；`getModel` 支持 `arn:` 直通模型；`crossRegionPrefixes` us 区 `deepseek` → `deepseek.r1`；**依赖升级 4.0.96 → 4.0.166**（旧版无 `./mantle` 子路径导出） |
| 5 | Cloudflare 直通 | ai-gateway 路由细分：`openai/*` → `aigateway(createOpenAI()(...))`，`anthropic/*` → `aigateway(createAnthropic()(...))`（模型名 `.` → `-`），`workers-ai/@cf` → unified，其余 → `createOpenAICompatible` 直连 `api.cloudflare.com/client/v4/accounts/{id}/ai/v1` + `cf-aig-gateway-id` 头；新增 `cloudflareGatewayNpm()` 映射 |

配套类型改动：`BundledSDK` 增加 `chat?`/`responses?` 字段；`CustomModelLoader` 增加第 4 参数 `model?: Model`（getLanguage 调用点同步传入），供 mantle 等按模型选择 SDK 入口。

**未合入项**（有意跳过）：

- provider 超时默认值（headerTimeout/chunkTimeout 300s）：与我方 fetch-debug 诊断包装器信号流冲突，需单独设计
- transform.ts 模型变体扩展（GLM-5.2/Kimi/GPT-5.x efforts）：视我方模型列表需要再定
- 其余 v2 架构相关：Phase 2/3 范畴

## 六、compaction 移植对我方自定义功能的影响分析

我方 compaction 自定义点及移植后状态：

| 我方自定义点 | 状态 |
|---|---|
| 纠错重试流（corrective retry，摘要失败后带纠错 prompt 重试） | **保留并修复**：上游单消息流不含对话历史，我方在 retry prompt 后追加 conversation，行为对齐移植前 |
| `SUMMARY_TEMPLATE` + `<summary>` 输出标签 | **保留**：buildPrompt 采用上游 `<conversation>` 包裹结构，模板本体与标签名不变，anchors 测试断言无需改动 |
| `previousSummary` 锚定续摘（增量摘要） | **保留并增强**：沿用上游"更新锚定摘要"指令措辞 |
| `compaction.prompt` 自定义摘要指令 | **保留**：优先级最高，提供时 conversation 作为附加上下文而非主 prompt |
| Event.Estimated 发布 | **不变**：移植前该事件从未发布（死代码），上游同样无 |
| tail 保留语义（我方旧默认保留最后 2 轮） | **变更（上游行为）**：默认改为预算制全轮次（15k），需旧行为时配置 `compaction.tail_turns: 2` |

结论：除 tail 保留默认值随上游变化外，我方功能全部保留，且重试流丢上下文问题已修复。

## 七、验证结果

- **typecheck**：`packages/opencode`（tsgo）、`packages/sdk/js` 均通过
- **测试矩阵**（Windows 本机抖动大，采用 stash 基线对比失败集合而非数量）：
  - `test/bus/bus-effect.test.ts`：18/18 通过
  - `test/account/`：26/26 通过
  - `test/provider/`：40 失败 = 基线 40 失败（集合完全一致，均为 models.dev 网络/AWS 配置类环境失败）
  - `test/session/{retry,prompt,compaction,message-v2}.test.ts` + bus + account 合跑：多轮失败集合与基线核心集一致（5 个时序敏感测试基线即失败：loop/shell BusyError 系列、unknown agent error 等）；"glob tool keeps instance context" 单测隔离运行通过，确认为负载抖动
  - retry.test.ts 新增错误模式用例全部通过
- **依赖**：`@ai-sdk/amazon-bedrock` 4.0.166 安装成功，`./mantle` 子路径导出已验证

## 八、遗留与后续

- Phase 2/3（v2 架构、新包引入）按 [upstream-merge-plan.md](./upstream-merge-plan.md) 另行执行
- provider 超时默认值、transform.ts 模型变体扩展为待定项，需要时单独评估
- `src/agent/prompt/octo_make.txt` 的工作区改动为本分支既有工作（write 工具路径规则措辞），不属于本次合入
