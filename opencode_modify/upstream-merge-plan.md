# opencode 上游合入：全量变更点清单与合入计划

> 日期：2026-09-20
> 范围：`packages/opencode` 层（基点 `6ff833a22` = v1.14.41 发布后 → 上游 HEAD `ebb7b76ca` = v1.18.31）
> 配套文档：[upstream-merge-analysis.md](./upstream-merge-analysis.md)（冲突全景、试合并数据、策略对比）
> 状态：**分析完成，未开始合入**。本文档为合入执行依据。

---

## 一、上游依赖与工程层变更

### 1.1 package.json / 依赖

| 类别 | 变更 |
|---|---|
| 新 workspace 依赖 | `@opencode-ai/{codemode, llm, protocol, schema, server, tui, http-recorder, script}`（8 个新包） |
| AI SDK | 新增 cerebras、gateway（Cloudflare）、xai、gitlab、venice、ai-gateway-provider；升级 anthropic 3.0.111 / openai 3.0.88 / google 3.0.73 / vertex 4.0.181 / bedrock 4.0.166 / mistral 3.0.51 |
| MCP SDK | 1.27.1 → **1.29.0**（曾升 v2 beta 后回滚，API 兼容） |
| 其他新增 | ws + @types/ws（OpenAI Responses WebSocket）、@silvia-odwyer/photon-node、htmlparser2、@ff-labs/fff-bun、@aws-sdk/credential-providers |
| 移除 | zod-to-json-schema、drizzle-kit、@parcel/watcher 平台包、`#pty`/`#hono`/`#httpapi-server` import maps（我方 package.json 仍持有，**必然冲突**） |
| 脚本 | test 改 `--only-failures`；新增 test:httpapi（三模式）/ bench:test / profile:test；移除 fix-node-pty、db(drizzle-kit) |

### 1.2 非 src 层

- `test/`：13 个测试文件冲突（我方断言 vs 上游行为变化）；上游新增 bench/profile 套件
- `script/`：build.ts、build-node.ts、generate.ts、httpapi-exercise.ts 冲突
- `bin/opencode`：冲突（上游 TUI 抽取后入口变化）
- `migration/20260427172553_slow_nightmare/migration.sql`：上游新迁移，冲突
- 上游将删除我方仍在用的 `src/pty/`（7 文件）、`src/shell/`（1）、`src/v2/`（10）——整树合并时须显式保留或跟随迁移

---

## 二、模块级变更点全量清单

> 格式：**模块**（上游 A/M/D ｜ 我方 A/M）— 上游变更点 → 我方变更点 → 建议动作

### 2.1 session（11/18/4 ｜ 8/19）⚠ 高危

**上游变更点：**
- `prompt.ts`（+1063）：工具解析 ~340 行拆出至新文件 `session/tools.ts`（590 行）；plan/build 提醒注入拆至 `reminders.ts`；max-steps 提示词迁 core
  - 修复：`isOrphanedInterruptedInterruptedTool`——重试/中断后的孤儿 tool_use 不再触发 assistant-prefill 死循环
  - 修复：finish=unknown 继续循环（#43892）；content-filter 显式报错（#31745）；计时消息按时间排序（#40990）
  - 新功能：MCP resource 附件转 FilePart（10MB 上限、PDF/图片 mime 白名单）
- `system.ts`：新增模型专属提示词 gpt-astra.txt（自 v2 移植）、meta.txt（Muse 家族）、plan-mode.txt
- `retry.ts`（+180）：可重试错误模式扩容（resource_exhausted、at capacity 等）；retry-after 头响应；带 jitter 的重试上限（#41939）；xAI/OpenAI 网络错误重试
- `compaction.ts`（+328）：SUMMARY_TEMPLATE 迁 core；指令重构适配小模型（#42045）；插件可注入/替换压缩 prompt
- `session.ts`（+814）：**session snapshot/revert 系统（#33226）**；SetMetadataInput；目录过滤修复（#30804）；成本容错（#43248）；错误类 Schema.TaggedError 化；LayerNode 化
- `message-v2.ts`：schema 全量迁 `@opencode-ai/core/v1/session`，缩为薄壳
- `processor.ts`：MessageV2→SessionV1 改名；v2 事件双写改 EventV2Bridge；Usage 类型取自 llm 包
- 新增 `session/llm/` 五件套（ai-sdk.ts / native-request.ts / native-runtime.ts / request.ts / AGENTS.md）——`flags.experimentalNativeLlm` 门控的实验性原生 LLM 通路，默认关闭
- 其余：overflow.ts、projectors(.ts/-next.ts)、session.sql.ts、message-error.ts

**我方变更点：** 标题意图式描述+二次压缩（fe41de879）、context compaction 加固流（fa2f14bcc 等）、skill 注入与 specSelector、/compact via session.command、session 分类

**建议动作：**
- Phase 1：手工移植 retry.ts 全量；prompt.ts 三处修复（孤儿 tool_use / unknown finish / content-filter）；compaction 模板改进
- Phase 2：MCP resource 附件转 FilePart；system.ts 新提示词（如相关模型）
- Phase 3：tools.ts/reminders.ts 拆分跟随、snapshot/revert 系统、EventV2Bridge 链

### 2.2 provider（1/4/28 ｜ 0/4）⚠ 双方大改

**上游变更点：**
- `transform.ts`（+1048）+ `provider.ts`（+884）适配块：header/chunk 超时默认 5 分钟（含 OPENAI_HEADER_TIMEOUT_DEFAULT）；SSE reader cancel 拒绝处理；Azure CLI 认证（#45079）；Cloudflare AI Gateway 原生透传（#42634，npm 映射）；Vertex 多区域路由 + googleVertexAnthropicBaseURL；Bedrock mantle 加载器（#30464）；DeepSeek 模型 ID 保留
- GLM-5.2 High/Max thinking 变体（#32446）；Kimi adaptive thinking effort（#37696）；Anthropic thinking block 容忍（#46653）；Cohere North 配置（#31536）；vLLM interleaved reasoning（#30477）
- 重构噪音（~40% 行数）：toPublicInfo、TaggedError、ProviderCostTier、LayerNode
- `models.ts` **整文件删除**（schema 迁 `@opencode-ai/core`，#27347）——我方 models.ts 有改动（远端 catalog/W3），若跟随需把 schema 依赖一起带
- copilot：X-Interaction-Id 头（#47215）、token 计费（#30181）、SDK 目录整理（D=28）

**我方变更点：** 远端 provider 统一+模型元数据、W3 models API、本地 provider idle timeout（防 /make 5 分钟断流）、undici 依赖、移除 BPIT/Octo AI

**建议动作：** Phase 1 摘全部适配块（在我方 transform/provider.ts 内逐 hunk 移植，我方 provider 体系结构不动）；models.ts 保留我方版本；Phase 3 再评估 schema 迁 core

### 2.3 mcp（2/4/0 ｜ 1/1）⚠ 高危

**上游变更点：**
- `index.ts`（+725）：事件改 McpEvent；ConfigMCP→ConfigMCPV1；list/call/分页/tolerant schema 抽至新文件 `catalog.ts`；新增 roots 能力声明 + ListRootsRequestSchema handler；resourceTemplates 列表（#33546）；server instructions 注入上下文（#32490）；`mcp__server__tool` 命名（#33533）；OAuth 改 McpOAuthPendingProvider；分页 listMaxPages
- 新增 `browser.ts`；SDK 1.29.0
- resource read tools（#33483）、client roots（#32230）、server log notifications（#31752）、cwd on local servers（#30676）、非交互 mcp add（#31054）

**我方变更点：** 按需阻塞重连+Toast（8f9a328d0）、closeClient intentionalDisconnects 修复、preflight 限定当前 agent remote、D2+B 双保险、[octo:mcp] 日志、tools list diff 日志

**建议动作：** Phase 2 以"上游新结构为骨架、我方重连/preflight/日志逻辑重新套入"（SDK 层 API 兼容，无断裂）；catalog.ts 可直接采纳

### 2.4 server（13/54/40 ｜ 19/30）⚠ 最大冲突区

**上游变更点：**
- **删除 Hono 双后端**（#28b03595bf）：server.ts 重写为纯 effect HttpApiApp；删除 ServerBackend/adapter(bun/node)/cors/旧 Hono 路由——`routes/instance/session.ts`(1124 行)、`index.ts`(502)、`global.ts`(286) 等为**纯删除**（与 httpapi/handlers 重复）
- `httpapi/handlers/session.ts`（+201）：forkRaw、SessionError.mapStorageNotFound 错误规范化、EventV2Bridge
- 新增 groups/handlers：control-plane（move-session #30640）、event、project-copy（#30139）、query
- 新增 middleware：compression、cors-vary、fence、schema-error；workspace-routing 改进
- TuiEvent 从 cli 迁至 server/tui-event.ts；init-projectors.ts
- 跨 location 事件流（stream events across locations）

**我方变更点：** insight httpapi handlers 13 个新增文件、httpapi 请求诊断日志、experimental 路由定制、代理相关（proxy-util）

**建议动作：** Phase 2 摘错误规范化 + compression/fence 等中间件；Phase 3 决策 Hono→effect 纯化（牵连 packages/sdk 重新生成、desktop/web 对接）

### 2.5 tool（2/26/0 ｜ 336/6）

**上游变更点：**
- `task.ts`（+326）：后台任务 BackgroundJob 体系（#27033）；subagent 权限派生（plugin/agent/subagent-permissions.ts）
- `registry.ts`（+281）重构；code-mode.ts + execute 沙箱工具（experimentalCodeMode 门控，#34677/#35085/#35185）
- mcp-exa.ts → mcp-websearch.ts；json-schema.ts 新增；fff search tools（#27802）
- 其余 26 个 M：read/edit/grep/glob 等的 AppFileSystem/LayerNode 迁移与 Effect 日志替换

**我方变更点：** proto_tool ICT3.x 原型体系（336 文件，**上游零碰撞**）；task/registry/webfetch 轻改

**建议动作：** Phase 2 采 BackgroundJob + subagent-permissions（task.ts 我方仅 +6 行，接近干净）；code-mode 观望；proto_tool 完全保留

### 2.6 config（2/10/12 ｜ 1/5）

**上游变更点：** v2-compat（v1 读 v2 配置 #45421）、zod→effect Schema、keybinds、tui 配置文件迁 config/（tui.ts/tui-cwd.ts/tui-migrate.ts）、schema 迁 core

**我方变更点：** skills.json 配置/部署、agent MCP 绑定、Octo 品牌与配置优先级、custom provider modalities

**建议动作：** Phase 2 可摘 v2-compat 思路；结构层 Phase 3

### 2.7 skill（0/2/0 ｜ 1/1）⚠

**上游变更点：** registry 化 + file agent loading（#30617）、skill resource paths 修复（#34052）

**我方变更点：** skill_config.json 同步、agent 按类型过滤、proto_*→octo_make alias、skill.used 事件、优先级确定性

**建议动作：** Phase 1 摘 #34052 修复；registry 化 Phase 3（我方 skill 体系定制深）

### 2.8 agent（1/2/0 ｜ 47/2）

**上游变更点：** LayerNode 化（轻，114 行）
**我方变更点：** octo_make、insight 子代理族、ict_pattern、agent 级 MCP 绑定（pixoso）、权限定制
**建议动作：** 完全以我方为准；冲突时 ours 为主 + 吸收上游非结构性修复

### 2.9 plugin（11/6/0 ｜ 2/1）

**上游变更点：** 新 provider 5 家（digitalocean #39066、modal、snowflake-cortex #29901、xai、cerebras）；openai/ws.ts + ws-pool.ts（Responses WebSocket #29477）；pty-environment.ts（shell.env 钩子）；tui/runtime.ts；dispose hook（#29493）；namespaced hook API（#33416）；v2 effect host（#33111）
**建议动作：** Phase 2 采新 provider 与 ws 传输（独立文件，低风险）；hook API 变化需评估我方 plugin 兼容

### 2.10 acp（10/2/2 ｜ 0/0）✅ 干净

**上游变更点：** agent.ts（1938 行）拆分为 service/event/tool/content/permission/directory/usage/config-option/profile/error 10 文件；session options 修复、usage 缓存写入修复、acp-next prompt（#29664）、tool updates 流（#29333）、提升 next 实现（#29929）
**我方变更点：** 无
**建议动作：** Phase 2 直接整目录采纳上游版本（无冲突）

### 2.11 cli（44/32/145 ｜ 0/5）— TUI 抽取

**上游变更点：** TUI 全量抽至 `packages/tui`，包内仅留 `cli/tui` 薄壳 + worker/validate-session；`cli/cmd/tui/thread.ts` → `cli/tui.ts`
**我方变更点：** 仅 5 个文件轻改（stats.ts、upgrade.ts 等）
**建议动作：** Phase 3 架构决策项。跟随 = 引入 packages/tui + 改 bin + 构建；不跟随 = 保留包内 TUI（放弃上游 TUI 演进）。**我方 TUI 改动小，推荐跟随以降低长期维护**，但需与产品形态（桌面/Web 为主）权衡 TUI 是否还必要

### 2.12 storage / file / project / util / bus / effect / 其他

| 模块 | 上游（A/M/D） | 我方 | 上游要点 | 动作 |
|---|---|---|---|---|
| storage | 0/2/5 | 0/3 | db schema 所有权迁 core（#29068）；db.bun/db.node 拆分 | P3 |
| file | 0/0/5 | 0/1 | file 服务删除，并入 core filesystem（#30447）；新增 filesystem read/list routes（#5937e606df） | P3 |
| project | 0/5/5 | 0/3 | project copies/tracking（#30139/#31943）、reference guidance（#31601） | P2 摘功能/P3 结构 |
| util | 3/7/12 | 1/3 | 12 文件迁 core；keybind 等 | P1 摘 keybind.ts 可用部分/P3 结构 |
| bus | 0/0/2 | 0/0 | **修复：PubSub eager subscribe 关 /event 竞争（#27959）；preserve bus instance context（#28051）** | **P1 摘两修复** |
| effect | 3/8/1 | 0/2 | app-runtime、LayerNode 服务组装、serviceUse | P3 |
| account | 0/3/1 | 0/0 | **修复：console device URLs（#44029）；logout 后切换 org（#36276）** | **P1 摘两修复** |
| auth | 0/1/0 | 0/1 | OAuth callback 页统一（#34025）、Effect beta | P2 |
| permission | 0/2/1 | 0/0 | code-mode adapter、location-scoped permission service（#30287） | P2/P3 |
| question | 0/2/0 | — | LayerNode 化 | P3 |
| share | 0/2/1 | 0/1 | share-next、LayerNode | P3 |
| snapshot | 0/1/0 | — | 配合 session snapshot | P2（随 session.ts） |
| sync | 0/2/2 | — | schema 迁移 | P3 |
| control-plane | 1/5/2 | — | v1 db 兼容修复（#42444） | P2 摘修复 |
| command | 0/2/0 | 1/2 | skill resource paths 相关（#34052 波及） | P1 随 skill 修复 |
| format/git/id/ide/installation/lsp/patch/env/worktree | 各 0-3 M | — | 全部为 Effect 日志/LayerNode/zod 清理重构；worktree managed cloning（#30117）为唯一功能 | P2 摘 worktree；其余 P3 |
| image / background | 各 A=1 | — | image 模块新增；background/job.ts 新增（配合 task BackgroundJob） | P2 随 task |
| v2 / pty / shell | 0/0/10+7+1 删 | 我方保留 | 上游迁出至新包 | **P3：整树合并时须显式保留我方版本** |
| studio / comment | — | 3+1 新增 | 我方独有 | 保留 |

### 2.13 根文件

- `index.ts`（上游 +117）：导出变化；`node.ts`：双改；`event-manifest.ts`、`event-v2-bridge.ts`、`markdown.d.ts` 新增——P3
- 我方 `sql.d.ts`、`audio.d.ts` 不受影响

---

## 三、分阶段合入计划

### Phase 1：纯优化移植（不引入新包、不动架构）— 预计 1~2 天

| # | 内容 | 文件 | 方式 |
|---|---|---|---|
| 1 | retry 错误模式扩容 + retry-after + jitter 上限 | session/retry.ts | 我方文件手工合入上游实现（我方 +116 行 vs 上游 +180，需对照融合） |
| 2 | 孤儿 tool_use 死循环修复 | session/prompt.ts | 摘 hunk（isOrphanedInterruptedTool） |
| 3 | unknown finish 继续循环 / content-filter 显式报错 | session/prompt.ts | 摘 hunk |
| 4 | compaction 小模型指令 + 插件注入 | session/compaction.ts | 对照融合（我方有加固流，需保序） |
| 5 | provider 适配块：超时默认/SSE cancel/Azure CLI/Cloudflare 透传/Vertex 多区域/Bedrock/DeepSeek | provider/transform.ts、provider.ts | 逐 hunk 移植，避开 TaggedError/LayerNode 重构块 |
| 6 | bus /event 竞争修复 ×2 | bus/ | 摘 hunk |
| 7 | account 两修复 | account/ | 摘 hunk |
| 8 | GLM-5.2 thinking 变体、Anthropic thinking 容忍 | provider 相关 | 视我方模型列表需要 |

**验证：** `bun run typecheck`；`bun test packages/opencode/test/session packages/opencode/test/provider`；冒烟（内网 provider 请求、/make 长输出、MCP 连接、标题压缩）
**记录：** 每项完成后按规范写入 opencode_modify/ 对应文档

### Phase 2：功能采纳（引入少量新文件，不引入新 workspace 包）— 预计 2~4 天

| # | 内容 | 方式 |
|---|---|---|
| 1 | acp/ 整目录更新（10 新文件 + 拆分） | 直接采纳（我方零改动） |
| 2 | MCP：catalog.ts/browser.ts 新文件 + roots/resourceTemplates/instructions/OAuth 修复 + SDK 1.29 | 以新结构为骨架重套我方重连/preflight/日志 |
| 3 | tool/task.ts BackgroundJob + background/job.ts + image 模块 + subagent-permissions | task.ts 我方近干净，可整体对照采纳 |
| 4 | plugin 新 provider 5 家 + openai ws 传输 | 新增文件为主 |
| 5 | MCP resource 附件转 FilePart | prompt.ts 摘 hunk |
| 6 | server：错误规范化、compression/fence middleware、handlers 修复 | 对照移植 |
| 7 | worktree managed cloning、control-plane db 兼容修复、skill resource paths 修复 | 摘 hunk |
| 8 | system.ts 模型专属提示词（gpt-astra/meta） | 视需要 |

**验证：** typecheck + 全量 `bun test packages/opencode` + MCP 管理 UI 冒烟 + make 规划流冒烟 + ACP（如有客户端）验证

### Phase 3：架构对齐（专项评估后执行）— 周级

前置决策（需产品/团队确认）：
1. **是否引入 @opencode-ai 新包体系**（core/schema/llm/tui/server/protocol/codemode）？引入 = 跟随 v2；不引入 = 永久 fork 该层
2. **TUI 去留**：跟随 packages/tui 抽取，还是产品已桌面化后弃用 TUI
3. **server Hono→effect 纯化**：牵连 packages/sdk 重新生成、desktop/web/server 对接层回归
4. v2/、pty/、shell/ 的保留与迁移路径
5. 依赖大版本升级（@ai-sdk/* 3.x、Effect beta）回归范围

执行方式建议：若决策跟随，采用 `git merge` 整树合入 + 按 opencode_modify/upstream-merge-analysis.md 附录 62 项冲突清单逐文件解决（我方功能按第五节保护清单回归验证）。

### 横切关注点（所有阶段）

- 我方功能回归清单：octo_make 规划流、insight 全链路、MCP 重连/管理页、标题压缩、远端 provider 统一、skill 同步/过滤/事件
- `bun.lock` 冲突在 Phase 2（SDK 升级）与 Phase 3 必然出现，以 `bun install` 重新生成为准
- packages/sdk 若 server 路由有变需重新生成；desktop/app/ui 冲突一律 ours
- 测试：上游 test/ 有 13 个文件断言随行为变化，移植时同步更新断言

---

## 四、变更点数据附录

- 双方都改文件（真基点）：81（cli 仅 5）；试合并文本冲突：packages/opencode 62 项（清单见 analysis 文档附录）+ 其他包 19 项
- 上游 158 个修改文件我方未动（可自动合入）；双方新增文件零同路径碰撞
- 上游删除 286 文件构成：cli/TUI ~145、server 旧路由 40、provider/copilot 28、config 12、util 12、v2 10、pty 7、storage/file/project 各 5、其余散点
- 每模块详细数字见本文第二节表头
