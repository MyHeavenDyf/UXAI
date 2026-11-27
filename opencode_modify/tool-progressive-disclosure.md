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

## 十、隐患修复（2026-11-27）

对 v1 的复查发现四项隐患（完整分析记录在会话内，结论如下），全部只动 flag-on 路径，flag off 零行为变化。涉及 2 个包（opencode + ui）+ octoapp 页面层。

### Fix 1 — search_tools 输出预算（上下文洪泛防护）

**问题**：`select:` 数量无上限、`max_results` 无钳制、输出无总预算——大 MCP 工具集下单条 tool result 可达几十 KB 且每轮重放，恰好制造该功能要消除的固定成本。另有两个小 bug：`Number(args?.max_results) || 5` 在 NaN 流入 `slice(0, NaN)` 时会清空结果；`select:`（无名字）返回空字符串。

**改法**（`tool/tool-search.ts`，prompt.ts 侧只把 `args?.max_results` 原样传入、钳制内收）：

| 常量 | 值 | 作用 |
|---|---|---|
| `OUTPUT_BUDGET_CHARS` | 24 000 | 单次 search 结果总预算（约 6K tok） |
| `MAX_SELECT_NAMES` | 16 | select: 最多处理条数，超出 footer 注明 |
| `MAX_KEYWORD_RESULTS` | 20 | max_results 钳制上限（`clampMaxResults`：`Number.isFinite` 兜底回 5，钳 [1,20]） |
| `MAX_OMITTED_NAMES` | 30 | footer 省略名单上限（防御性：select≤16 / keyword≤20 → omitted≤19，当前不可达，为常量放宽后兜底） |

- **按整条目累加预算**（`assembleWithBudget`），不用 `Truncate.Service`——它是行/字节中段截断（MAX_LINES=2000 / MAX_BYTES=50KB），会把 JSON schema 砍坏；整条目粒度下**首条目即使单独超预算也完整保留**（模型必须拿到完整 schema 才能调用）。
- 超预算条目进 footer：`+N more tools not shown (names). Call select:Name to fetch them individually.`
- `availableNames()`（空查询/未命中/missing 名单共用）改走 `formatNameList`：上限 50，超出 `(+N more, see <available-deferred-tools> in system)`，与公告口径互指。
- 空 `select:` 返回引导文案（非空串）。`SEARCH_TOOLS_DESCRIPTION` 补 Limits 段说明上限。

### Fix 3 — DWS workflow toolExecutor 兜底委托

**问题**：`session/llm.ts` 的 GitLabWorkflowLanguageModel `toolExecutor` 按名直查 `tools[toolName]`；MCP defer 后按名调用得到 "Unknown tool"。

**改法**：直查失败时委托元工具——`tools["execute_tool"]`，入参包成外层信封 `{tool_name, params: JSON.parse(argsJson)}`；`JSON.parse` 保持在 try 内。委托路径以 `_requestID` 为 callID 触发内层 ToolCalls.observe，无对应 part，产生孤儿 tracking 行（可接受，DWS 工作流本就无 part 概念）。`sessionPreapprovedTools` 不动——approvalHandler 会累积放行，降级为"多问一次"而非死循环。

### Fix 5 — 元工具保留名冲突整体降级

**问题**：MCP key（provider 前缀拼接）可拼出 `search_tools`/`execute_tool`，与元工具同名产生歧义（execute 委托按名查桶 vs 直传同名工具，模型侧两者不可区分）。

**改法**：`RESERVED_METATOOL_NAMES = {"search_tools", "execute_tool"}`（tool-search.ts 导出）。prompt.ts 把 **MCP 工具获取整体上移到内置工具循环之前**（defer 决策需要先知道 MCP 名单），计算：

```
metaBlocked = toolSearch && MCP keys 与保留名有交集 → elog.warn 一次
```

`metaBlocked` 时整体降级回 flag-off 形态：`deferBuiltin = undefined`、MCP defer 条件加 `!metaBlocked`（撞名工具走既有直传分支）→ 桶为空 → 元工具不创建、announcement 不注入。`deferBuiltin` 过滤同时加了 `!RESERVED.has(id)` 防御（agent defer 列表写进保留名时忽略）。降级测试见 prompt.test.ts（mcpColliding stub，断言 bash 直传、无 execute_tool、无公告）。

### Fix 6 — 元工具 descriptors + 前端 execute_tool 解包

**问题 A（服务端）**：ToolCalls `descriptors` map 无元工具条目，settled 兜底建行时 `toolKind` 为 undefined。prompt.ts 元工具创建块补 `descriptors["search_tools"] = { kind: "builtin" }`、`descriptors["execute_tool"] = { kind: "builtin" }`。

**问题 B（前端）**：execute_tool part 前端不认识——渲染成原始 JSON 信封、产物卡/任务卡/统计/回退收集全部落空。

**改法**：`packages/ui/src/components/message-part-meta.ts`（纯模块）实现 `unwrapMetaTool(tool, input)`（tool === "execute_tool" 且 input 是 object 且 input.tool_name 为 string → `{tool: input.tool_name, input: input.params ?? {}}`；pending 流式态 input 是字符串，判型失败返回 undefined），message-part.tsx re-export 保持 `@opencode-ai/ui/message-part` 公共 API 不变——独立纯模块的原因：message-part.tsx 的组件依赖链（kobalte 等）在 bun test 环境触发 solid client-only API，无法被单测导入。**不派生新 part 对象**——ContextToolGroup 的 parts() memo 用 `equals: same` 浅比较，新引用恒不等会引发重渲染风暴；改为在每个纯函数消费点解包：

| 层 | 文件 | 点位 |
|---|---|---|
| ui 渲染 | message-part.tsx / message-part-meta.ts | message-part-meta.ts：unwrapMetaTool 纯函数（附 4 例单测）；message-part.tsx：renderable（HIDDEN_TOOLS 过滤）、partDefaultOpen、isContextGroupTool、contextToolDetail/Trigger/Summary、ToolPartDisplay（input()/render/ToolErrorCard/Dynamic 的 input+tool props）；todowrite/question/task 特判查 part().tool 本身，不受影响 |
| make 统计 | pages/make/components/insight-turn.tsx | ToolCallInfo 构造（FileOpsSummary + ToolCallGroupCard） |
| pattern 统计 | pages/pattern/modules/chat/insight-turn.tsx | 同上 |
| insight 任务卡 | pages/insight/utils/task-detect.ts | MCP 业务工具白名单匹配（**flag on 时 MCP 全 defer，不解包任务卡必失效**） |
| insight 产物卡 | pages/insight/utils/write-output.ts | write/edit 产物卡与 artifact-file-write/edit 打点 |
| make 回退 | pages/make/utils/restore-draft.ts | collectWriteEditFiles 回退文件收集 |
| make SSE | pages/make/index.tsx | 两处 `session.next.tool.called` 监听（会话级 + 全局 globalToolCallMap/recordArtifactInit，后者不套会丢版本基线） |

### 残留项（记录不修）

- **invalid.ts 引导残留**：参数校验失败文案只看 flag，降级态仍会提 search_tools——文案自带条件 "listed in <available-deferred-tools>"，降级时公告不存在，条件对模型可见为假，自限；
- **MCP key 撞内置工具名**（如 mcp 前缀拼出带下划线的内置 id）：现状内置 id 均为单词（bash/read/…），MCP key 必含 `_`，实际拼不出来，TODO 留档；
- **announcement 名单不设上限**：defer 全量 MCP 时公告本身就是几十行名字，属设计取舍（名字公告是引导的最低成本形态），未加预算；
- **权限弹窗 / share 页**：permission-dialog 读 ask 请求的内层权限名天然正确；share 页独立实现，均为跟进项。

### 测试

- `test/tool/tool-search.test.ts` 新增 9 例：空 select: 引导、非数字 max_results 不清空结果、max_results 0/500 钳制、select 超 16 截断、预算截断 + 省略 footer、首条目超预算仍完整、可用名单 50 上限、`clampMaxResults` 直测。全绿（28 pass）。
- `test/session/prompt.test.ts` 新增降级用例（mcpColliding stub + withToolSearch + octo_make）：bash 直传、无 execute_tool 元工具、撞名 MCP 工具直传（wire description 区分元工具）、system 无 `<available-deferred-tools>`。`-t "tool search"` 过滤单跑 5 个具名用例全过。
- `packages/ui` 新增 `src/components/message-part-meta.test.ts`（unwrapMetaTool 4 例）；整包 `bun test src` 32 pass。
- 验证命令：`bun test packages/opencode/test/tool/tool-search.test.ts`、`bun test packages/opencode/test/session/prompt.test.ts -t "tool search"`（整文件并行跑有本机固有的 (unnamed) hook 超时，见 §六）、`cd packages/ui && bun test src`、`bun run typecheck`。

### 真机 E2E（2026-11-27，桌面 dev + glm-5.3）

- **flag on · make 页**：`请用 bash 工具执行命令 echo …` → search_tools(select:bash) → execute_tool 两步链路。DB 侧 part 形态确认（`tool="execute_tool"`、input 为 `{tool_name, params}` 信封、内层 bash 的 title/metadata 落在 part state）；UI 渲染为 bash 卡片「执行命令 / echo octo-frontend-verify / 完成」+「文件操作:」分组——均只能来自解包（修复前会显示「工具调用」+空摘要或原始 JSON 信封）。
- **flag on · insight 页（MCP defer）**：自起最小 MCP 测试服务器（zz-mcp-test/echo_tool）→ `execute_tool{tool_name:"zz-mcp-test_echo_tool"}` part 经 packages/ui GenericTool 渲染为「调用了 zz-mcp-test_echo_tool」（修复前显示「调用了 execute_tool」）。**ui 层解包在真实 app 验证通过**。
- **flag off 回归**：同型 bash prompt → part 直接 `bash:completed`（无元工具），渲染与 flag on 完全一致——`unwrapMetaTool` 对非 execute_tool 返回 undefined 的回落路径零行为变化。
- 两轮运行 console 无 error/exception。未覆盖 E2E 的点（静态复核 + unwrapMetaTool 单测覆盖）：write-output 产物卡 / task-detect 任务卡 / restore-draft 回退收集（write/edit 未进 defer 列表，无法在不改配置的前提下触发 execute_tool 形态；解包逻辑与已验证路径同构）；SSE `session.next.tool.called` 载荷（processor.ts 中 `value.input` 同一变量流向 part state 与事件，part state 已实证为信封对象，且事件 schema 强制 Record）。

## 十一、全局化改造（2026-11-27 晚，随 dev 合并）

合入 origin/dev（fe0ede7846）带来 octo_make 路由化重构：octo_make 变为需求路由代理（mode: primary），原「设计原型专家」角色拆给新 octo_design，新增完整项目开发的 octo_code。这与 v1 的 per-agent defer 产生**语义冲突**——git 自动合并把 `defer: ["bash", "webfetch"]` 从旧 octo_make 块挂到了新 octo_design 块（共同祖先文本对齐的结果），octo_make 路由本身丢失 defer，三个集成测试失败（bash 直传进 tools 数组）。

**决策（用户明确）**：渐进式披露不再按 agent 灰度——flag on 时对**所有 agent 全局生效**，删除 per-agent defer 列表。

### 实现

- `tool/tool-search.ts` 新增导出 `CORE_DIRECT_TOOLS = {invalid, question, task, plan_exit, skill}`——保持直传的交互协议层：错误自纠、用户应答、子代理派发（task 是路由架构的脊柱，其描述还携带 describeTask 动态候选清单）、规划确认、skill 加载入口（404B 极小）。
- `session/prompt.ts` 的 `deferBuiltin` 从 `(input.agent.defer ?? [])` 改为 `items.map(id).filter(非核心 && 非保留名)`——**defer 集合从 registry 实际可见清单派生**，天然继承模型级工具过滤（gpt 的 apply_patch/edit/write 互斥、insight 专属工具的 agent 过滤）与既有权限前置剔除（builtinDisabled）。其余链路（MCP defer、metaBlocked 降级、元工具创建、announcement、ENVELOPE）零改动。
- `agent/agent.ts` 删除 `Info.defer` schema 字段与 octo_design 的 defer 配置——agent 维度不再有 defer 概念。
- **invalid 的特殊性**：它不进 wire（llm.ts:387 `activeTools` 过滤——invalid 是服务端失败调用的重映射目标，模型侧从不可见），但必须留在 tools map 供执行派发，因此保留在核心直通集**且不进桶**；若进桶，失败调用的 invalid 重映射会找不到执行器。
- 直传体积对比：flag on 后模型每轮只见 question(667B)/task(2.7KB)/skill(404B)/plan_exit(~590B) + 两个元工具；bash(6.4KB)/todowrite(9KB,全库最大)/read/edit/write/glob/grep/lsp/webfetch/websearch 等约 30KB 描述全部转为按需支付。todowrite 9KB 是单工具最大收益，代价是规划类 agent 首次用 todo 需先 search 一次——属「用则支付」的既定取舍，若实测规划质量退化可把它加进 CORE_DIRECT_TOOLS（一行改动）。

### 测试更新

`test/session/prompt.test.ts` 五个用例适配全局语义：
- 断言直传集：bash/webfetch/read/write **全部 defer**（旧断言 read 直传已失效），直传只剩 question/task/search/execute；invalid 断言为 not.toContain（不下发 wire，见上）；
- MCP 用例（agent=build）补 bash 也 defer 的断言（证明全局性，build 无任何 defer 配置）；
- 两步链路 / 权限 deny / 撞名降级三用例逻辑不变自然通过（降级= deferBuiltin 置 undefined，全部直传）。
- 验证：`-t "tool search"` 5 用例全过；`test/tool/tool-search.test.ts` 28 过；`test/agent/` 62 过（含 dev 新增 octo-make-prompt.test.ts）；`bun run typecheck` 12/12。

### 已知影响

- 公告变长：defer 全量后 `<available-deferred-tools>` 名单为该 agent 可见的全部工作类工具（约 6-15 行名字），仍是名字级小成本（§十残留项已记录不设上限的取舍）；
- 全部 MCP + 内置工作工具进桶后，**每个会话首次使用每个新工具多一次 search 往返**（schema 留历史，后续轮次直呼 execute_tool，prompt cache 命中——2026-11-24 真机已验证该模式）；
- 自定义 agent（用户 agent md）自动获得同等 defer 行为，无需任何配置——即「应用到所有场景」的本意；
- flag off 回归不变：回滚仍是关 env，代码路径零变化。
