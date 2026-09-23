# opencode 上游合入分析（基点 v1.14.41 → 上游 v1.18.31）

> 生成日期：2026-09-20
> 分析对象：`packages/opencode` 层的差异与合入可行性
> 上游仓库：D:\octoAI\opencode（anomalyco/opencode，本地完整 clone）
> 本仓库：D:\octoAI\octoAI（分支 dev_dyf）

## 1. 基本盘

| 维度 | 本项目（自基点起） | 上游（自基点起） |
|---|---|---|
| fork 基点 | `6ff833a22`（2026-05-08，v1.14.41 发布后数日） | 同 |
| 上游目标 | — | HEAD `ebb7b76ca`（v1.18.31，约 4 个月 / 1400+ commits） |
| 新增文件 | 422（几乎纯增量：proto_tool ICT3.x 336、agent/proto 47、server 19、session 8…） | 109（session/llm 五件套、acp 拆分 10、plugin 11、server 13…） |
| 修改文件 | 92 | 218 |
| 删除文件 | 0 | 286（TUI 抽取 + v2 schema 外迁） |

- 我方变更性质：**功能定制为主，几乎纯增量**，核心逻辑改动集中在 agent/session/provider/mcp/config/skill。
- 双方都修改的文件：81 个（其中 cli 仅 5 个，TUI 我方基本没动）。

## 2. 上游架构级变化（决定合入策略的关键事实）

1. **TUI 抽成独立包 `packages/tui`**：`cli/cmd/tui` → `cli/tui`（薄壳）→ `packages/tui`。我方 TUI 自基点后仅 5 个文件有改动，跟随成本可控。
2. **packages/opencode 不再自洽**：上游 v1.18 的 `packages/opencode` 有 **220 个文件 import `@opencode-ai/core` 等新包**（`@opencode-ai/core` 587 处、tui 30、sdk 28、schema 19、llm 19、plugin 18、server 13）。整体合入 = 接受 core/schema/llm/tui/server/protocol/plugin/codemode 等 8+ 新 workspace 包。
3. **server 层删除 Hono 双后端**：`server.ts` 重写为纯 effect `HttpApiApp`，删除 ServerBackend/adapter/旧 Hono 路由（`routes/instance/session.ts` 1124 行、`index.ts` 502 行等均为纯删除，非重写）。真正的功能演进在 `httpapi/handlers/*`（新增 control-plane/event/project-copy/query 分组、compression/fence 等 middleware）。
4. **MCP**：client SDK 曾升 v2 beta（#39247）次日回滚（#39373），最终 1.27.1→1.29.0，API 兼容。实质增强：`mcp__server__tool` 命名、catalog、resourceTemplates、server instructions、roots 能力、OAuth（`McpOAuthPendingProvider`）、分页。
5. **v2 铺路重构贯穿全局**：zod→effect Schema、Bus→`EventV2Bridge`、LayerNode 服务组装、config/schema/models/message-v2 外迁 core 包。约占上游 218 个修改文件行数的一半。
6. 新增实验性原生 LLM 通路 `session/llm/`（`flags.experimentalNativeLlm` 门控，默认关闭）。

## 3. 冲突全景（`git merge-tree` 内存试合并实测，不触碰工作区）

- **全仓库 81 个文件文本冲突**：packages/opencode 62（src 内 42 + test 13 + script 4 + package.json + bin + migration.sql）、desktop 15、app 15、ui 8、core 3、session-ui 2、sdk 3。
- **无同路径 add/add 碰撞**：我方 422 个新文件与上游 109 个新文件零重叠。
- **158 个上游修改文件我方从未动过** → git 可干净自动合入。
- src 冲突分布：server ~22、session ~13、config 3、provider 3、storage 3、tool 4、util 3，其余为 agent/mcp/skill/plugin/file/command/project(2)/share/effect/node.ts 单点。

### 高危冲突文件（上游行数 | 我方行数，均自基点）

| 文件 | 上游 | 我方 | 冲突实质 |
|---|---|---|---|
| session/prompt.ts | 1063 | 496 | 上游拆出 tools.ts/reminders.ts + 3 个逻辑修复；我方有 skill 注入/标题压缩/compaction 流程 |
| provider/provider.ts | 884 | 797 | 双方都大改：上游 provider 适配+重构，我方远端 provider 统一/W3 API/超时兜底 |
| session/session.ts | 814 | 168 | 上游 snapshot/revert 系统、metadata、错误类 effect 化 |
| mcp/index.ts | 725 | 329 | 上游事件/catalog/roots/OAuth；我方重连重构+preflight+D2B 兜底 |
| config/config.ts | 473 | 269 | 上游 v2-compat；我方 agent MCP 绑定/skills.json/品牌 |
| session/compaction.ts | 328 | 241 | 上游模板重构；我方加固流程 |
| skill/index.ts | 193 | 201 | 上游 registry 化；我方 skill_config 同步/过滤/事件 |
| agent/agent.ts | 114 | 443 | 我方为主（octo_make/insight/ict_pattern），上游改动小 |
| tool/task.ts | 326 | 6 | 上游 BackgroundJob 后台任务，我方仅轻改 → 接近干净 |
| tool/registry.ts | 281 | 50 | 上游重构，我方轻改 |

## 4. 上游值得合入的改进

### 4.1 纯优化、低风险（不依赖新包架构，可直接移植）

1. **session/retry.ts（180 行）**：可重试错误模式扩容（resource_exhausted、at capacity 等）、retry-after 头响应、带 jitter 的重试上限、xAI/OpenAI 网络错误重试。全部建议合入。
2. **session/prompt.ts 三个逻辑修复**：
   - `isOrphanedInterruptedTool`：重试/中断后的孤儿 tool_use 不再触发 assistant-prefill 死循环；
   - "unknown" finish 继续循环（#43892）；
   - content-filter finish 显式报错（#31745）。
3. **provider 适配块**（transform.ts / provider.ts）：header/chunk 超时默认 5 分钟、SSE reader cancel 拒绝处理、Azure CLI 认证（#45079）、Cloudflare AI Gateway 原生透传（#42634）、Vertex 多区域路由、Bedrock mantle、DeepSeek 模型 ID 保留。
4. **session/compaction.ts**：压缩指令重构适配小模型（#42045）、插件可注入/替换压缩 prompt。
5. **MCP 系列**：OAuth/兼容性修复、catalog、resourceTemplates 列表（#33546）、server instructions 注入（#32490）、roots 能力（#32230）、`mcp__server__tool` 命名（#33533）。
6. **tool/task.ts**：后台任务 BackgroundJob、subagent 权限派生（plugin/agent/subagent-permissions.ts）。
7. **plugin 新 provider 5 家**：digitalocean、modal、snowflake-cortex、xai、cerebras；OpenAI Responses WebSocket 传输与池化（#29477）。
8. **其他**：acp 修复（session options、usage 缓存写入）、GLM-5.2 High/Max thinking 变体（#32446）、Anthropic thinking block 容忍（#46653）、模型专属 system prompt（gpt-astra.txt、meta.txt）、worktree managed cloning（#30117）、session snapshot/revert（#33226）。

### 4.2 v2 架构耦合链（合入需成批评估，单独摘会断）

- Bus→EventV2Bridge、zod→effect Schema、LayerNode 服务组装；
- models.ts 删除（schema 迁 core）、message-v2.ts 缩壳、config 迁 core；
- server Hono 删除与 server.ts 重写；
- TUI 抽取（涉及 bin/opencode、package.json、构建脚本）；
- session/llm/ 原生 LLM 通路（实验性，默认关闭）。

## 5. 我方功能保护清单（冲突解决时不得丢失）

| 文件 | 我方功能 |
|---|---|
| agent/agent.ts | octo_make、insight 系列子代理、ict_pattern agent、agent 级 MCP 绑定、权限定制 |
| session/prompt.ts | 标题意图式描述+二次压缩、context compaction 加固流、skill 注入、MCP 设置流程 |
| provider/provider.ts | 远端 provider 统一+模型元数据、W3 models API、本地 provider idle timeout、移除 BPIT/Octo AI |
| mcp/index.ts | 按需阻塞重连+Toast、preflight ping（限定当前 agent 的 remote）、工具调用失败兜底（D2+B）、[octo:mcp] 日志 |
| config/config.ts | skills.json 配置/部署、agent MCP 绑定、Octo 品牌与配置优先级 |
| skill/index.ts | skill_config.json 同步、agent 按类型过滤、proto_*→octo_make alias、skill.used 事件打点 |
| session/compaction.ts | 我方 compaction 加固（中断处理、摘要修复、usage 上报） |
| tool/proto_tool/**、agent/proto/** | ICT3.x 原型体系（上游无对应，不受合并影响） |
| 新增文件 422 个 | 上游零碰撞，合并时全部保留 |

## 6. 合入路线建议

### 方案对比

| 方案 | 做法 | 工作量 | 效果 |
|---|---|---|---|
| A. 整树合并 | `git merge` 上游 HEAD，手工解 81 冲突，接受 8+ 新包与 v2 链 | 大（周级），需全量回归 | 与上游完全对齐，后续可持续 sync |
| B. 选择性移植 | 只摘 4.1 清单，以 patch/hunk 方式进我方文件 | 小（天级） | 拿到绝大部分 bug fix 与 provider 优化，架构不动 |
| C. 分阶段（推荐） | B 起步 → 需要时再评估 A | 递增 | 风险可控，先见效 |

### 推荐分批（方案 C）

- **Phase 1（立即可做）**：retry.ts 全量、prompt.ts 三修复、compaction 模板、provider 适配块。均为我方已改文件中的局部 hunk 或轻改文件，直接手工移植并跑 typecheck + 单测。
- **Phase 2**：MCP 增强（catalog/resourceTemplates/roots/instructions/OAuth）、task BackgroundJob、subagent 权限、plugin 新 provider、acp 修复、GLM thinking 变体。涉及 mcp/index.ts 等高危文件，需以"上游结构为骨架、我方业务重新套入"。
- **Phase 3（架构决策，专项评估后再做）**：TUI 抽取、server effect 化、EventV2/effect Schema/core 包体系。做之前需评估 packages/app、desktop、sdk 的连锁改造。

## 7. 风险与注意事项

- merge-tree 含 rename 检测，实际 `git merge` 冲突数可能有 ±10% 浮动；
- `bun.lock` / `package.json` 必然冲突；上游依赖大版本变化需全量回归；
- `packages/sdk`（openapi 生成物）依赖 server 路由，若合入 server 变更需重新生成；
- desktop/app/ui 的冲突基本可 "ours" 解决（自研产品层）；
- 上游 286 个删除若整树合并会移除包内 TUI，需验证 `bin/opencode` 与产品入口；
- 上游 `tool/mcp-exa.ts` 改名为 `mcp-websearch.ts`、`plugin/codex.ts` → `plugin/openai/codex.ts`。

## 附录：试合并冲突文件清单（packages/opencode/src，62 项）

```
agent/agent.ts                                  cli/cmd/stats.ts
cli/tui/worker.ts                               cli/upgrade.ts
command/index.ts                                config/agent.ts
config/command.ts                               config/config.ts
effect/app-runtime.ts                           file/index.ts
mcp/index.ts                                    node.ts
plugin/index.ts                                 project/instance-store.ts
project/project.ts                              provider/error.ts
provider/provider.ts                            provider/transform.ts
server/global-lifecycle.ts                      server/projectors.ts
server/routes/global.ts                         server/routes/instance/experimental.ts
server/routes/instance/file.ts                  server/routes/instance/httpapi/api.ts
server/routes/instance/httpapi/groups/global.ts server/routes/instance/httpapi/handlers/experimental.ts
server/routes/instance/httpapi/handlers/file.ts server/routes/instance/httpapi/handlers/provider.ts
server/routes/instance/httpapi/handlers/session.ts          server/routes/instance/httpapi/handlers/v2/session.ts
server/routes/instance/httpapi/middleware/error.ts          server/routes/instance/httpapi/middleware/instance-context.ts
server/routes/instance/httpapi/middleware/workspace-routing.ts              server/routes/instance/httpapi/public.ts
server/routes/instance/httpapi/server.ts        server/routes/instance/index.ts
server/routes/instance/provider.ts              server/routes/instance/session.ts
server/routes/ui.ts                             server/server.ts
session/compaction.ts                           session/llm.ts
session/message-v2.ts                           session/overflow.ts
session/processor.ts                            session/projectors-next.ts
session/projectors.ts                           session/prompt.ts
session/session.sql.ts                          session/session.ts
share/share-next.ts                             skill/index.ts
storage/db.bun.ts                               storage/db.node.ts
storage/db.ts                                   tool/registry.ts
tool/skill.ts                                   tool/task.ts
tool/webfetch.ts                                util/filesystem.ts
util/network.ts                                 util/token.ts
```
