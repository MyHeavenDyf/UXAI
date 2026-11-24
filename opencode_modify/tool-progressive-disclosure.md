# 工具渐进式披露（Progressive Tool Disclosure）

> 实施基准：`dev_dyf` 分支（2026-11-24）。所有行号以当时代码为准。
> 开关：`OCTO_TOOL_SEARCH` 环境变量，默认关闭（env 名沿用产品前缀 OCTO_）。
> 参考实现：Claude Code 的渐进式披露架构（源码位于 D:/octoAI/claude-code/）。

## 一、背景问题

改造前，每次请求把所有可用工具的完整提示词（长文本 description + JSON schema）一次性放入 API tools 数组：

- 工具描述文本约 3.2K tokens（shell.txt 6362 chars ≈ 1.9K tok 居首）；
- 加上 JSON schema，总工具开销约 4–5K tokens；
- compaction 固定地板：system + tools 在压缩时被视为不可压缩部分（`session/compaction.ts:345`），工具体积直接挤占可用对话长度；
- 部分 agent（如 octo_make 对 bash 的 git 教程段落）被迫做 per-agent 描述裁剪，维护成本高。

## 二、方案总览

```
┌─ flag off（现状，默认）────────────────────────────────┐
│  tools 数组 = [全部内置工具(全量描述+schema), ...MCP 工具] │
└────────────────────────────────────────────────────────┘

┌─ flag on（OCTO_TOOL_SEARCH=1）─────────────────────────┐
│  tools 数组 = [核心工具(全量), search_tools, execute_tool]│
│  deferred 桶 = { name → {description, schema, execute} } │
│              ← 仅内存，不进 API                          │
│  announcement = <available-deferred-tools> 名字列表      │
│              ← system blocks 末尾注入                    │
└────────────────────────────────────────────────────────┘
```

工作流（两步）：

1. 模型调用 `search_tools`（`select:Name` 精确查 / 关键词模糊搜）→ 返回匹配工具的 name + description + 完整 JSON schema 文本，**持久留在 message history**，重放不重传；
2. 模型调用 `execute_tool {"tool_name", "params"}` → 桶查找 → **透传委托桶内已包装的 execute**（权限询问 ctx.ask、ToolCalls.observe 追踪、输出截断、插件触发等链路与直呼完全一致）。

核心收益：长描述从"每轮无条件支付"变为"用则支付"。bash defer 后不再需要 per-agent 描述裁剪（描述全局统一，agent 维度只决定哪些工具进 deferred 桶）。

## 三、关键设计决策

| 决策 | 理由 |
|---|---|
| 权限不绕过 | 被 Permission deny（disabled）或用户按消息关闭（`input.tools[id] === false`）的工具**在进桶之前剔除**，模型通过 search/execute 均无法触达 |
| 委托透明 | execute_tool 只做透传（`entry.execute(args?.params, options)`），不重新包装 —— 避免双重 observe / 双重截断，内层 schema 校验（Tool.wrap decode）照常拦截非法参数 |
| part input 保外层形态 | execute_tool 委托时用 Symbol 在 options 上携带元工具原始入参，`context()` 写 part `input` 时优先用它。原因：重放历史把 `part.state.input` 作为 tool-call 参数回传模型（message-v2.ts），若被内层工具 `ctx.metadata` 覆写成扁平的内层参数，模型会从历史学错调用形态（GLM-5.3 真机实测：第二轮裸传 `{command, description}` 导致 `tool_name` 为空、报 Unknown tool 后才自纠；修复后第二轮一次成功） |
| 缓存稳定 | tools 数组 per-agent 确定（flag + agent.defer + MCP 配置会话内不变），不破坏 Anthropic prompt caching 的前缀稳定性 |
| 单次传输 | search 结果含完整 schema，留在历史里；compaction 后自然清除，重搜代价低（v1 不做 preCompactDiscoveredTools 边界携带） |
| llm.ts 不豁免元工具 | 分析后确认无需改：`*: allow` 的 agent 元工具自然通过；`*: deny` 的 agent 桶为空（进桶前已剔除），语义自洽 |
| announcement 只报名字 | 对齐 Claude Code 的 searchHint A/B 结论：展开描述无收益，名字公告足够引导 |
| 旧 MCP 公告自动消失 | `<available_user_mcp_tools>` 派生自 activeTools（prompt.ts prepareRequest），MCP 工具入桶后派生源为空，旧公告不再注入，无重复公告 |

## 四、文件变更清单

| 文件 | 变更 |
|---|---|
| `packages/core/src/flag/flag.ts:123` | 新增 `OPENCODE_TOOL_SEARCH` getter（运行时求值，测试可在进程启动后设 env） |
| `packages/opencode/src/agent/agent.ts:78` | `Info` schema 新增 `defer: Schema.optional(Schema.Array(Schema.String))` |
| `packages/opencode/src/agent/agent.ts:394` | octo_make 配置 `defer: ["bash", "webfetch"]`（注意匹配的是工具注册 ID：shell=bash、webfetch=webfetch，不是 "fetch"） |
| `packages/opencode/src/tool/tool-search.ts`（新文件） | 纯函数层：query 解析、打分排序、结果格式化、announcement 格式化、两个元工具描述常量 |
| `packages/opencode/src/session/prompt.ts:486` | resolveTools 内构造 `deferred` 桶 |
| `packages/opencode/src/session/prompt.ts:537-545` | 内置工具：`deferBuiltin`（agent.defer 列表）+ `builtinDisabled`（进桶前剔除 deny） |
| `packages/opencode/src/session/prompt.ts:597-599` | 内置工具 defer 分支：execute 抽为独立闭包，命中 defer 写入桶并 `continue` |
| `packages/opencode/src/session/prompt.ts:612-617, 734-736` | MCP 工具同理：`mcpDisabled` + defer 分支 |
| `packages/opencode/src/session/prompt.ts:743-798` | 构造 `search_tools` / `execute_tool` 动态元工具（闭包引用桶）+ elog 日志 |
| `packages/opencode/src/session/prompt.ts:868-870` | prepareRequest：`<available-deferred-tools>` announcement 注入 system |
| `packages/opencode/src/session/prompt.ts:801` | resolveTools 返回 `{tools, deferred}`（原为仅 tools） |
| `packages/opencode/src/tool/invalid.ts:20-24` | 参数校验失败文案加 flag-on 引导：select:Name → search_tools → execute_tool |
| `packages/opencode/src/tool/task.txt` | Phase 0 清理：删除虚构子代理示例（约 35 行），改为"像同事一样简报"的写提示指引 |
| `packages/opencode/src/tool/registry.ts` | Phase 0 清理：删除 describeSkill 注入 task 描述的段落（与 system.ts 的 skill 列表重复）；保留 Skill.Service 依赖（SkillTool 传递需要） |

## 五、search_tools / execute_tool 语义

### query 语法（tool-search.ts parseQuery）

- `select:Name1,Name2` — 精确选择，返回完整条目；
- `discover:keywords` — 关键词发现；
- 纯关键词 — 同 discover。

### 打分（scoreTool）

- 名字精确匹配 6 分；词匹配 4 分（`nameWords` 按 `/[^a-z0-9]+/` 切，下划线算分隔符，MCP 名如 `pixso_get_file` 可被 "get file" 命中）；
- 子串匹配 3 分；description 命中每词 1 分；
- 排序：分数降序、同分名字升序；关键词搜索默认返回前 5（`max_results` 可调）。

### 失败引导

- 查无此工具 → `No deferred tool named "x"` + 当前桶内工具名列表；
- execute_tool 未知工具名 → 同样列出可用名单并引导先 search。

## 六、测试

- 单元：`test/tool/tool-search.test.ts`（19 个用例：解析/打分/排序/格式化）；
- 集成：`test/session/prompt.test.ts` 末尾四个 `it.live`（30s 超时，TestLLMServer 范式；前三个 agent=octo_make，MCP 用例 agent=build + `makeHttp(mcpWithTools)` stub 层）：
  1. defer 列表生效 + announcement 注入（tools 数组无 bash/webfetch，有 search_tools/execute_tool/read；system 含 `<available-deferred-tools>`、`- bash`、`- webfetch`）；
  2. 两步链路端到端（search 返回 `### bash` + schema 文本 → execute_tool 透传执行 `echo octo-tool-search` → 输出断言；并断言 execute_tool part 的 `input` 保持 `{tool_name, params}` 外层形态）；
  3. 会话权限 deny bash → 桶内无此工具，search 返回 `No deferred tool named "bash"`；
  4. MCP defer（stub toolsForAgent 返回 `testfixture_probe`）：MCP 工具不进 tools 数组、可经两步链路执行，且旧 `<available_user_mcp_tools>` 公告不再注入（其派生源 activeTools 已无 MCP 工具，无重复公告）。

运行：`bun test packages/opencode/test/tool/tool-search.test.ts` 与
`bun test packages/opencode/test/session/prompt.test.ts -t "tool search"`。

> 本机注意：整文件并行跑 prompt.test.ts 有资源竞争性失败（auth.json 轮询 + preload.ts 的 afterAll 在高负载下超过 bun 5s hook 默认超时，报 `(unnamed)` 失败）；`-t` 过滤单跑稳定。该现象与本次改动无关（stash 验证过干净树同样失败）。

### 真实模型 E2E（2026-11-24，glm-5.3 经 volce 网关）

`OCTO_TOOL_SEARCH=1 bun run dev serve` + octo_make 会话实测：

- 第一轮「请用 bash 运行 echo …」：模型 reasoning 明确引用 deferred 公告 → `search_tools({"query":"select:bash"})` 拿到完整 schema → `execute_tool` 执行成功并回报输出；elog `deferredTools=bash,webfetch`、directTools 含 search/execute 无 bash/webfetch；
- 第二轮同型请求：**直接 `execute_tool` 一次成功**（不再 search，schema 已留在历史；prompt cache 命中）——验证「多次调用只传一次」；
- 修复前第二轮曾出现一次失败重试：模型从重放历史学到扁平的 `{command, description}` 形态（part input 被内层 ctx.metadata 覆写所致），报 Unknown tool 后自纠——即上表「part input 保外层形态」的来源，修复后复测无此现象。

## 七、灰度与回滚

- 默认关闭，`OCTO_TOOL_SEARCH=1` 开启；
- 验证路径：octo_make（defer bash/webfetch）先行，观察 search/execute 调用成功率、invalid 工具引导命中、bash 实际执行正确性；
- 回滚 = 不设 env，代码路径回到现状（flag off 分支零改动）；
- 全量放开后：可删除 per-agent 的 bash 描述裁剪逻辑，描述统一回 tool.txt 原文。

## 八、已知限制 / 后续方向

- v1 打分是简单关键词匹配，未做 TF-IDF（Claude Code 是 TF-IDF 0.6 + 关键词 0.4）；桶规模小（MCP + 少量 defer）时够用，MCP 大规模接入后再评估；
- compaction 边界不携带已发现工具（preCompactDiscoveredTools）：search 结果天然留在历史，压缩清除后模型重搜一次即可，代价可接受；
- 桶为 per-request 构造（resolveTools 每轮重跑），闭包持有 execute 引用，无跨请求状态；
- octo_make 的 defer 目前不含 skill 工具；skill 走 SKILL.md 注入体系，与工具披露正交。

## 九、打包与开启方式（desktop 发行）

**打包（无需额外操作，自动进包）**：desktop sidecar 引用的是 opencode 的构建产物而非源码——
`packages/desktop/electron.vite.config.ts:10` 把 `virtual:opencode-server` alias 到 `../opencode/dist/node/node.js`；
`packages/desktop/scripts/predev.ts:20` 与 `prebuild.ts:9` 都会执行 `cd ../opencode && bun script/build-node.ts` 重建该产物。
因此 dev / electron-builder 打包流程自动携带本功能。2026-11-24 已重建并验证：`dist/node/node.js` 含 `OCTO_TOOL_SEARCH`、`available-deferred-tools`、`tool search enabled` 字符串。

> 坑：`packages/opencode` 的 `bun run build`（script/build.ts）是 CLI 多平台二进制构建，**开头 `rm -rf dist`** 且本机在 linux-arm64 目标上下载 bun 运行时失败——会误删 `dist/node`。重建 node bundle 一律用 `bun run script/build-node.ts`。

**开启（三层，按放量阶段选择）**：

| 层级 | 做法 | 适用 |
|---|---|---|
| 用户系统环境变量 | `setx OCTO_TOOL_SEARCH 1` 后重启 app；链路：系统 env → 主进程 env → `createSidecarEnv()`（server.ts:256，全量拷贝 process.env）→ sidecar | 个人试用 / 灰度观察 |
| app 级默认注入 | `preferAppEnv()`（`packages/desktop/src/main/server.ts:66`）加 `OCTO_TOOL_SEARCH: "1"`，与 OCTO_EXPERIMENTAL_FILEWATCHER 并列 | 产品放量 / 回滚=删一行 |
| 编译期渠道差异化 | `createSidecarEnv` 已有 `import.meta.env.OCTO_*` 模式（OCTO_KB_BASE_URL 等，来自 .env + electron-vite mode），可加 beta 渠道先行 | 按渠道灰度 |

**打包态验证**：sidecar 日志看 elog `tool search enabled`（含 agent/deferredTools/directTools 字段）；flag 未设置时所有路径与现状一致（零风险默认关）。
