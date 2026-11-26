# Make Router Agents — octo_make 路由化改造

## 概述

把 make 入口 agent octo_make 从「设计师执行者」改造为**路由 agent**：纯聊天/问答直接回答；设计原型与单文件 HTML 需求用 task 工具派发给新子代理 **octo_design**（承接原 octo_make 提示词并简化）；完整项目开发派发给新子代理 **octo_code**。探索分支 `feat/make-router`（自 dev_dyf 切出，2026-10-22）。

架构决策（用户确认）：
- 分发机制 = **Task 子代理派发**（改动最小；会话内切换/auto-handoff 备选未采用）
- 所有会话一律先过路由（含 [Workspace] 代码工作区，路由按 [Workspace] 前缀倾向 octo_code）
- 硬性要求：子会话的模型输出与产物卡片在前端 make 页内联渲染，显示效果与原 octo_make 完全一致（前端改动见 packages/app，不在本目录）

## 改动记录

### `src/agent/prompt/octo_make.txt` — 重写为路由提示词

- 五段结构：分类规则（A 聊天直接回答 / B 设计原型→octo_design / C 完整项目→octo_code，含模糊判定）→ task 派发规范 → 派发后行为 → 直接回答行为 → 禁止事项
- **五段式 task prompt 模板**（防弱模型漏传路径）：【需求原文】【产物目录】（[Artifact Folder]/[Workspace] 前缀一字不改抄录）【skill 约束】【方案内容】【交付要求】
- 迭代修改必须带 task_id resume 复用同一子会话（保上下文）
- 派发后禁止复述产物内容（前端直接渲染子会话输出，复述会重复）
- 原「尽量不使用 task 工具调用子进程」（2026-06-09 禁用并行生成时加入）反转为主流程
- [confirm-plan] 处理并入分类规则 B（方案确认 → 派发 octo_design）

### `src/agent/prompt/octo_design.txt` — 新建（原 octo_make.txt 简化）

- 保留：资深设计师角色、artifact 输出方式与约束优先级、write/edit/read 规则与 text/link 返回路径、artifact 类型规范（kebab-case、完整 DOCTYPE）、设计规范
- 删除：[Workspace] 代码工作区分支（拆给 octo_code）、设计规划/[confirm-plan] 流程段（路由消化）、「尽量不使用 task」
- 新增：「任务输入」段（五段结构说明）、「你无法与用户对话：不要反问」（question 已 deny）、禁止多文件项目结构
- write 规则改为前缀无关：只能写入任务 prompt【产物目录】给出的目录内（覆盖代码工作区里要单个演示页的边界场景）

### `src/agent/prompt/octo_code.txt` — 新建

- 两种场景：[Workspace] 代码工作区（项目根内直接开发、遵循现有结构）/[Artifact Folder] 普通工作区（产物目录内组织子目录）
- 文件规范：kebab-case、2+ 文件须有目录组织、代码完整可运行
- 交付：2-4 句说明 + `<artifact type="text/link">` 入口文件路径；禁止用 artifact 输出代码全文

### `src/agent/agent.ts` — octo_make 路由化 + 两个新 agent

- **octo_make**：description 改路由语义；permission 增 `edit: "deny"`（EDIT_TOOLS 共键连坐隐藏 write/apply_patch——路由不产文件）、`task: { "*": "deny", octo_design: "allow", octo_code: "allow" }`（findLast 语义，allow 必须在 "*": deny 之后，参照 SPEC-INS-032 §5.2 / octo_insight 先例）；**移除 skills:["html-prototype"] 与 mcp:["pixso"]**（移交 octo_design）。skill 保持 allow（deny 会断 session.command 的 @skill 注入，prompt.ts command() 守卫）
- **octo_design**（新）：mode:"subagent"、hidden:true、write allow / edit ask / task deny / question deny、skills:["html-prototype"]（声明性，实际可见性走 skill_config + alias）、mcp:["pixso"]
- **octo_code**（新）：同上结构，无 skills/mcp
- hidden:true 不影响 task 候选（describeTask 只按 mode!=="primary" 过滤，registry.ts:302-315）

### `src/session/overflow.ts` — DESIGN_AGENTS 加 octo_design/octo_code

- 子代理生成大 HTML 时免 exceedsContext reject，与 octo_make 同待遇

### `src/skill/index.ts` — AGENT_SKILL_ALIASES 加 `"octo_design": "octo_make"` 与 `"octo_code": "octo_make"`

- agent.skills 字段是惰性的；实际 skill 可见性由 skill_config.json 的 agent 映射决定（Skill.available，index.ts:379-405）。两个子代理都不在用户 skill_config 里，经 alias 继承 octo_make 的映射 → 可见清单与 octo_make 完全一致（octo_code 的 alias 于 10-23 补加，此前其清单为空、仅靠 get() 不设防兜底）
- @skill 链路：前端 session.command 注入到主会话（路由）→ 路由五段式 prompt 转发 skill 名 → 子代理自己调 skill 工具加载（task 的 prompt 参数不做 slash command 模板解析）

### 测试

- `test/agent/octo-make-prompt.test.ts`：由「P0 提示词中性化契约」重写为三提示词架构契约（路由分类/五段模板/不复述；design 保留路径约束、去掉工作区分支；code 两场景/text/link 交付）
- `test/agent/agent.test.ts`：SPEC-INS-032 §5.2 用例中 octo_make 的 `task general allow` 断言更新为 deny（路由收敛）；新增两个用例——路由 task 候选收敛（octo_design/octo_code allow、general/explore/make_component deny、task 工具本身可用、edit deny 连坐、skill allow、mcp undefined）与 octo_design/octo_code 权限面（subagent/hidden、write allow、task/question deny、pixso 绑定）
- `test/session/compaction.test.ts`：DESIGN_AGENTS 用例补 octo_design/octo_code 断言

## 不改动（有意为之）

- `src/tool/task.txt`：通用 description，insight 线共用，路由行为由 octo_make.txt 覆盖
- `src/session/session-category.ts`：task.ts:109 已硬编码 insertCategory "subagent"
- `src/agent/octo-session-workdir.ts`：insight 专用闸门（判根会话 agent === "octo_insight"）
- `src/tool/registry.ts`：describeTask 自动纳入新 subagent 候选

## 风险与关联

- **2026-06-09 子代理竞争事故**：当时是并行生成 + session 切换事件路由竞争导致结果无卡片。本方案单次顺序派发 + 前端主动发现子会话（task part metadata.sessionId → ensureChildSession），风险面不同；E2E 需覆盖「生成中刷新/切会话」
- **子会话 permission 继承**：task.ts:78-105 只继承 session 级 permission（make 页为空），路由 agent 层收权不影响子代理工具面
- **hasTaskTool 副作用**：路由 task 通配 deny 后 truncate.ts 的 hasTaskTool 为 false，截断提示从「派 explore」变「用 Grep/Read」——路由不读大文件，可接受
- 前端配套改动（VISIBLE_CHILD_AGENTS / 气泡隐藏 / subtask 卡片去重 / autoSave 归属）在 packages/app/octoapp/pages/make/，详见前端提交

## E2E 验证结果（2026-10-22 ~ 10-23，桌面端 dev：bun run dev:desktop + CDP）

14 项场景，14 项验证通过（场景 13 于 10-23 补测）：

| # | 场景 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | 纯聊天 | ✓ | 路由直答零派发，DB children=[] |
| 2 | 设计原型（落地页） | ✓ | task→octo_design，五段式 prompt 完整抄录 [Artifact Folder]，write 卡片内联、路由仅一句转述、subtask 卡片只留头（childInline）、无 task prompt 气泡、文件落主会话 outputs/ |
| 3 | 迭代修改 | ✓ | task_id resume 同一子会话（children 不变），edit×23 + grep 校验 + artifact link |
| 4 | write 存文件 | ✓ | 场景 2 顺带：text/link 卡片可打开 |
| 5 | SVG 单文件 | ✓ | 补验（10-23）：minimalist-coffee-logo.svg 1.1KB 落 `.octo/<主会话>/outputs/`，文件管理面板识别 SVG 类型，路由 turn 仅转述 |
| 6 | [Workspace] 多文件 todo | ✓ | 路由派 octo_code，三文件落工作区根（不进 .octo），3 个 artifact link，Octo_Code 显示名 |
| 7 | 普通工作区三文件小站 | ✓ | 路由判 C（多文件协作）派 octo_code，产物目录内组织交付 |
| 8 | 边界：单页需求（普通/工作区） | ✓ | 均正确判 B 派 octo_design |
| 9 | plan 全链路 | ✓ | 策略模式→填表→[confirm-plan]→路由派 octo_design→tea-brand-homepage.html 36KB 落盘，子会话 turn 内联渲染 |
| 10 | @skill | ✓ | 代码级验证：agent.skills 惰性、skill.get() 不受清单限制、AGENT_SKILL_ALIASES 已配、@chip session.command 链路未动；纯文本 @skill 路由合理降级并明说 |
| 11 | 生成中停止 | ✓ | 主/子会话均中断，subtask 卡片「已中断」 |
| 12 | 刷新恢复 | ✓ | 7 turns 全恢复无重复（生成中+完成后各一次） |
| 13 | 子代理报错态 | ✓（10-23 补测） | icacls 封锁产物目录构造 OS 级写保护：write x5 错误卡片全部正常渲染不白屏；子代理优雅诊断（临时区写入验证工具正常 → python 复制 PermissionError → icacls 定位 DENY 规则）→ 拒绝绕过安全限制 → 诚实汇报「目标未完成」+ 临时保底 + TEXT artifact 卡片；恢复权限后 resume 同一子会话 write 成功（5.7KB SVG 落盘、文件面板恢复显示），完整闭环 |
| 14 | sidebar 列表 | ✓ | 子会话不进列表 |

**两个非架构问题（模型/既有行为，非本次改动引入）：**

1. **glm-5.3 reasoning 爆炸**：[confirm-plan] 长方案输入下模型把 HTML 全写进 reasoning（94k tokens）撞输出上限，task_result 为空。迭代请求「不要在思考里写代码，直接用 write 工具」后 resume 同一子会话成功。可考虑后续在 octo_design.txt 或路由【交付要求】加防思考爆炸约束。
2. **「策略执行」按钮偶发首次点击无效**：handleConfirmPlan 早期 return（前端状态时序），刷新后重试成功。plan 流程代码本次未动，属既有问题。

**验证方法**：CDP Runtime.evaluate（ProseMirror execCommand insertText + Enter 发消息）+ bun:sqlite 直查 opencode-local.db（session 表 parent_id / part 表 task 输入与 task_result）+ 文件系统落盘核对。项目切换经 storeSet 写 opencode.global.dat 的 server.lastProject.local。

## 合并 origin/dev（2026-10-23，merge 476e0ee9f）

dev 侧 `ce30caa70a` 放开 octo_make 的 question（skill 明确要求时向用户确认，fastui 等在已有工程/新建之间让用户选择）。合并决策：

- **octo_make（路由）采纳 question: "allow"**：skill 在主会话执行（session.command 注入），question 通道由路由持有；prompt 侧把 dev 的 question 约束行适配进路由版「四、直接回答的行为」（仅 skill 明确要求时调用）
- **octo_design/octo_code 保持 question: "deny"**：子代理不与用户交互，task prompt 五段式已带全部输入。注意 git 自动合并曾把 dev 的 allow 误套到 octo_design 块（行级对齐歧义），已手动修正——同类合并需复查
- agent.test.ts 双方新增用例并存（路由收敛用例 + question 放开用例），octo_make.txt 旧版工具清单块按路由重写版丢弃（write/edit/artifact 约束已拆入子代理提示词）
- 合并后 typecheck 12 packages 全过；test/agent 三文件 121 pass，compaction.test.ts 的 4-5 个超时失败经合并前后对照确认为 Windows 环境性 flaky（失败用例漂移），与合并无关
- 遗留待验证：fastui 类 skill 在子代理执行路径下的 question 交互（子代理 deny question，若 skill 流程在子会话内需要提问会降级——skill 主会话执行时无此问题）

## 二次合并 origin/dev（2026-10-30，merge fe8e46941）

dev 侧自 f180b575ef 起 60+ 提交（Design DMG 评审/恢复面板/产物版本体系/studio 上传优化/登录重构等）。后端 agent.ts/三提示词/skill 零触碰，冲突仅 insight-turn.tsx 三处，全部双侧语义并集：

- props 接口：本分支 `mainSessionID`/`hideUserBubble` 与 dev 的 revert 系列 8 props 并存
- autoSaveArtifact 调用：保留本分支的主会话归属（`mainSessionID ?? sessionID`）+ dev 新增的 filePath 返回值链路（onArtifactSaved 回调 / 伪 tab 补 init 基线）——子会话产物经主会话路径落盘并进版本体系
- 用户气泡：dev 的 `octo-revert-zone` 新结构 + 本分支的 `!hideUserBubble` 条件（子会话 turn 无气泡，revert 图标随之隐藏，语义正确）

index.tsx 两处 InsightTurn 调用自动合并，dev 的 `canRevert` 以 `sessionID === params.id` 门控——子会话 turn 天然 false，与路由设计一致。验证：packages/app typecheck 过；childTurnActive/双 pill 修复、hideUserBubble/mainSessionID、VISIBLE_CHILD_AGENTS、显示名映射全部存活；test/agent 58 pass，2 个超时用例经合并前后对照 + 隔离重跑双向通过，确认为全量并发负载下的 Windows 环境性 flaky（skill 测试同批超时在合并前提交同样复现），非合并回归。

## 前端回归修复：双「生成中」指示（2026-10-23）

演示彩排发现：task 派发生成期间出现**两块「生成中…」状态框**。根因：路由化后子会话 turn 内联渲染（自带 WaitingPill/流式卡片），而主会话（路由）turn 的 WaitingPill 在整个 task 运行期也在显示——单体时代主会话 pill 的 accumulatedText 会聚合子会话内容做预览（子会话不渲染时的补偿设计），内联渲染后成为重复。CDP 实证两块 pill 分属两个 turn（主会话 pill 的预览文本即聚合的子会话 `<artifact>` 内容）。

修复（insight-turn.tsx）：新增 `childTurnActive` memo——存在 running subtask 且 `msgStore[subSessionID]` 已有消息（子会话 turn 已渲染）时，隐藏本 turn 的 WaitingPill。边界：纯聊天无 task 主 pill 照常；子会话 sync 未完成/失败时 msgStore 为空、主 pill 保留兜底，任何时刻都有状态指示；plan/pattern 子代理场景同样受益。E2E 验证：修复前 [Workspace] todo 复现 2 块，修复后记账工具场景（同为 octo_code 多文件）生成全程 4 次采样恒 1 块、完成干净消失、三文件落盘正常。

## 原生 plan agent 接入路由（2026-10-30）

把上游原生 plan agent（只读规划、question 提问、派 explore 只读调研）接入 octo_make 路由，作为第四类派发目标 **D. 方案规划**——用户对话式提出「先做计划/规划，先别动手」时路由派发 plan，与策略模式（octo_make_plan 前端建子会话）两套规划入口并存。

架构决策（用户确认）：
- **explore 调研孙会话不进消息流**（用户选定）：plan 派发的 explore/general 孙会话不 sync 不渲染，调研进度以 plan turn 内子任务卡片展示（描述+状态+可展开 task_result 摘要）；消息流保持「路由转述 → 计划 Markdown」
- 接入方式 = plan agent `mode: "primary"` → `"all"`（task.ts 本就不校验 mode，改 mode 只为 describeTask 候选清单自洽；hidden 不变，不进 switch_agent/autocomplete 用户列表）

### `src/agent/agent.ts`

- plan agent：mode 改 "all"；permission 增 `task: { "*": "deny", explore: "allow" }`——只读规划者只许派只读 explore，防模型选 general 间接获得写能力（findLast 顺序）
- defaults：`task: { insight_reader: "deny", plan: "deny" }`——pattern 形态守卫（照 SPEC-INS-032 §5.2 先例，只挡候选清单不挡 task 工具），防 plan 泄漏进 general 等其他 agent 的候选
- octo_make：task 块加 `plan: "allow"`

### `src/agent/prompt/octo_make.txt`

- 新增 D 分类：明确「先规划再动手」/ [Workspace] 重构方案 / 要计划文档而非产物 → 派 plan；模糊判定补 A/D/B-C 划界（纯讨论→A；明确先规划→D；按已有计划执行→B/C 并附计划全文）
- 派发规范 subagent_type 增 plan；五段模板对 plan 适用（【交付要求】= 结构化 Markdown 计划文本、不写文件；【方案内容】含上一轮 plan 的 task_result 全文——task.ts:175 回传完整未截断）
- 派发后行为：plan 子代理 question 提问由用户在界面作答，路由**不代答**；计划文本同禁止复述
- 迭代 task_id 复用覆盖 plan（「把计划里的 X 改成 Y」→ resume 同一 plan 子会话）

### 前端 packages/app（make 页三处 + 显示名）

- index.tsx：VISIBLE_CHILD_AGENTS 加 `"plan"`；hideUserBubble 两处条件加 plan；**ensureChildSession 加 agent 门**——sync 前用 `sync.session.get(id)?.agent`（session.created 事件已填充 store.session，无需先 sync），agent 已知且不在可见清单（explore/general 等）→ 不 sync 不进 childSessionIDs（子任务卡片走完整内容形态，即原 sync 失败降级路径的复用）；agent 未知（事件竞态）→ 照旧 sync 降级内联
- insight-turn.tsx：显示名映射加 `plan` → 'Octo_Plan'；其余零改动（childInline/onChildSession/childTurnActive/autoSave 全沿用）
- plan 子会话不进 planChildSessionIDs/discoveredPlans（策略模式 banner 状态机专用）

### 不改动（有意）

- 策略模式全链路（octo_make_plan / plan banner / [confirm-plan]）不动
- plan.txt / build-switch.txt（CLI 共用）；桌面端 `OPENCODE_EXPERIMENTAL_PLAN_MODE` 默认 false → prompt.ts:335-345 简单注入路径对 plan 子会话生效、无 plan 文件工作流、plan_exit 不注册（registry.ts:266 双旗标门控）→ plan 纯文本产出
- session-request-tree 树感知 BFS + question dock 零改动（plan 子会话 question: allow 天然可见可答，requestID 应答与 sessionID 无关）

### 测试与验证

- agent.test.ts：路由候选用例加 plan allow + 更名 octo_design/octo_code/plan；新增 plan agent 权限面用例（mode "all"、hidden、task explore allow/general deny、question allow、edit deny、general 候选不含 plan、task 工具不隐藏）；octo-make-prompt.test.ts：新增 D 分类契约用例（四类分类/三目标派发/计划只读交付/不代答/按计划执行回附）
- bun test test/agent 两文件 61 pass；全仓 typecheck 12 packages 过

### 桌面端 E2E 验证（2026-10-30 ~ 10-31，dev + CDP + bun:sqlite 直查 opencode-local.db）

测试主会话 ses_e73e95c69ffe5yeYKE7pDolzqc（工作区 D:\octoAI\test\test_project2），4 个子会话：plan×2（品牌网站规划+双语修订、多人协作编辑规划）、octo_code×2。9 项验证 8 过 1 项按用户指示跳过：

| # | 场景 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | D 派发 + 内联渲染 | ✓×2 | 路由判 D → task(plan) → 子会话 turn 内联渲染完整计划 Markdown（Octo_Plan 标签、无 task prompt 气泡）；路由仅 206 字转述不复述计划；含 [Workspace] 语境判 D |
| 2 | plan question dock 应答 | ✓×2 | plan 各提 3 问，dock 渲染（树感知 BFS 收集子会话 pending question）、作答回传（question part completed，输出含三题答案）、plan 拿答案后继续产出 8207 字完整计划 |
| 3 | 「按计划执行」回附 | ✓ | 「就按这个计划开始执行」→ 判 C 派 octo_code，task prompt 五段式【方案内容】含 6389 字符完整方案（「以下为已确认的完整规划方案全文」） |
| 4 | task_id resume 迭代 | ✓ | 「改成中英双语」→ resume 同一 plan 子会话（children 不变），修订计划内联渲染 |
| 5 | [Workspace] 规划 | ✓ | plan 直读工作区文件（read/glob，全程只读零写入）后产出方案 |
| 6 | 刷新恢复 | ✓×4 | 2→4→5→8 turns 递增恢复：Octo_Plan 标签、无 task prompt 气泡、无重复、pill 清空；生成中+完成后各覆盖 |
| 7 | 生成中停止 | ✓ | 停止按钮 → pill 清空 →「已中断」×4 → DB 双会话带 error 完成（主会话 aborted + 子会话 aborted） |
| 8 | 纯聊天 A 类回归 | ✓ | 路由直答零派发（后端验证 children 不变） |
| 9 | explore 孙会话过滤 | 代码就位未实跑 | 两轮规划模型均选择直读（8 文件小项目直读是合理模型行为）；ensureChildSession agent 门与「sync 失败降级」共用路径（未 sync 子会话卡片走完整内容形态），无新增风险面 |
| 10 | 策略模式回归 | 未测 | 用户指示跳过（ensureChildSession 白名单含 octo_make_plan，代码级确认不拦截） |

**两个非回归观察（dev 应用层/模型既有问题，非本次改动引入）：**

1. **SSE 事件流长跑/机器挂起后断连**：后端 REST/POST 与 DB 完整（路由转述与计划全文均已落盘），UI 事件滞后 pill 卡「生成中」；页面刷新走 REST 恢复路径正常（终态全量恢复）。与 10-22 E2E 记录的断连同类。**已于同日修复**（根因=重连后仅恢复全局列表态、会话级事件无重放，上游 #13973 继承缺口）：`server.connected` 时 global-sync 补拉带 `trustStatusSnapshot`（清陈旧 busy）+ sync 层强制重拉已跟踪会话（补全文），断连窗口内丢事件不再需要手动刷新，E2E 已验证（冻结页面模拟断连 → 解冻重连 → 13s 内自动恢复，不刷新页面）。
2. **glm-5.3 reasoning 膨胀**：octo_code 首次派发 5 分钟纯 reasoning 无 tool call 空产出，路由按 prompt 规则自动重试（新子会话）。与 make-router 主 E2E 的 reasoning 爆炸同源。

**验证方法**：CDP Runtime.evaluate（ProseMirror insertText + Enter 发消息、DOM 断言）+ bun:sqlite 直查 opencode-local.db（注意 part 表 session_id 直查、数据 JSON 字段在顶层无 part 包装层）+ 文件系统核对。

## 修复:压缩续跑注入文本显示为用户气泡（2026-11-16）

打包版使用中发现:消息界面偶尔多出用户气泡显示 "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."(有时两段)。

**根因**:auto-compaction 完成后后端注入续跑 user 消息(`packages/opencode/src/session/compaction.ts`):overflow 路径注入回放消息(`metadata.compaction_replay`,用户原话副本)+"Continue..." 消息(`metadata.compaction_continue`),均为 synthetic text、**无 compaction part**。make 页 InsightTurn 自实现的 `userText()` 取首个 text part 不看 synthetic(上游 message-part.tsx 有 `!synthetic` 过滤,故 insight 页走 SessionTurn 不受影响)→ 注入文本被当用户输入渲染。`isVisibleUserMessage` 的 compaction 过滤分支对"无 compaction part"的消息不设防。主会话(octo_make 路由,agent 不在 hideUserBubble 子代理名单)压缩时注入消息直接显示;overflow 时 replay+continue 各一条="两段"。make-router 子会话上下文大(五段式 task prompt+方案+迭代 resume),频繁撞 context 上限,故此分支打包后才明显。

**修复(packages/app,turn 保留渲染防止续跑 assistant 输出丢失,只隐藏气泡/锚点)**:

- `octoapp/pages/make/utils/visible-message.ts`:新增导出 `isCompactionInjectedMessage(parts)`——parts 含 compaction_continue/compaction_replay 标记的 text 且无非 synthetic text;`isVisibleUserMessage` 原样不动(手动 /compact 回显、[附件] 清单等不受影响)
- `octoapp/pages/make/components/insight-turn.tsx`:`userText()` 开头对注入消息返回空 → 气泡 Show 条件不成立,turn 与续跑 assistant 输出照常渲染;isCompactionTurn 注释修正
- `octoapp/pages/make/utils/turn-anchor-text.ts`:`turnAnchorText()` 对注入消息返回空(无锚点)
- 测试:visible-message.test.ts 加 `isCompactionInjectedMessage` 6 例、turn-anchor-text.test.ts 加注入消息无锚点 2 例;两文件 24 pass;packages/app typecheck 过

**注意**:该过滤为显示层,消息仍在 userMessages 列表(续跑输出依赖 turn 存在);Fix 8/9 校验口径未动。后端 compaction_continue 标记注释声明"不稳定契约",若上游改标记名需同步此处。

## 影响面分析后第二批修复（2026-11-16）

路由+子任务对现有功能的影响面系统排查（后端/前端两路调查 + 人工验证），确认无影响面与真实影响后，修复用户指定的 3 项：

**1. 分享预览泄漏压缩注入文本（opencode 后端）**
`src/session/share-preview.ts` user 行 where 只滤 type 不滤注入标记（synthetic 过滤仅对 assistant 行生效）——compaction 注入的 "Continue..."/overflow 回放消息在分享页渲染成用户气泡（insight 会话分享同样中招，非 make 专属）。修法：user 行 SQL 加 `not (text 且 metadata.compaction_continue/compaction_replay=1)`；过滤后空 parts 的注入消息经既有 225 行空产出逻辑自动消失。手动 /compact 回显（synthetic 无标记）继续显示，由既有测试锁定。测试：share-preview.test.ts 新增注入隐藏用例（真实消息保留 + continue/replay 消失），9/9 pass。

**2. 模型选择器被子会话消息拨动（app 前端）**
`octoapp/pages/make/index.tsx` 模型同步 effect 的 `local.model.set` 无 sessionID 守卫——合并流 lastUserMessage 是子会话消息（task prompt/压缩注入）时把输入框模型拨回旧值（用户切新模型后重进会话触发）。修法：`(msg.sessionID ?? sid) !== sid` 跳过；`syncSessionModel`（local.tsx:383）本有守卫无需动。

**3. 子会话生成计时/忙碌判定/输出徽标（app 前端）**
- `childBusy` 原来只查 plan 子会话 → 扩为遍历 childSessionIDs（design/code/pattern 全覆盖）兜底孤儿子会话运行（SSE 断连/竞态），effectiveBusy 连带修正 blockTime 触发面与并发发送防护。正常流程主会话 task await 已 busy，纯防御缺口
- `elapsedText` pending assistant 查找加活跃子会话兜底（主会话无 pending 时取 busy 子会话的 pending）
- subtask 卡片头 "N 输出" 徽标 childInline 时隐藏（产物已由子会话 turn 完整展示，对齐 showExpandable 的 `!childInline()` 模式）

验证：packages/app 与 packages/opencode typecheck 过；share-preview 9/9。

**影响面分析其余结论（未修，待产品决策）**：分享导出只同步根会话（make 会话分享缺子代理产物正文）；回退不回退子会话 autoSave 落盘文件（消息流与磁盘不一致）；question 断连无重播（permission 有，sidecar 重启时子会话 pending question 挂死）；`AUTOMATIC_COMPACTION_ENABLED` false→true 为全局开关（所有会话首次启用自动压缩，insight 主界面走上游 SessionTurn 滤 synthetic 安全，分享页已由本次修复覆盖）。排查确认无影响：question/permission 树感知 BFS 收集、发消息路由、停止级联 abort、刷新恢复、skill/MCP 别名链、ACP/studio/tui、Fix 8/9。

## 第三批修复:锚点与子任务对应 + 回退清理子任务(2026-11-17,同事测试反馈)

同事打包版测试反馈两问题,均定位为真实缺陷并修复:

### 1. 锚点与子任务的对应问题(app 前端)

**根因**:make 页对话锚点轨道(TurnAnchorNav)的 messages 直接用 `userMessages()`(主+子会话合并流)。路由派发后子会话(octo_design/octo_code/plan)的 task prompt、question 表单回填等内部 user 消息虽然气泡已隐藏(hideUserBubble),但照样各生成一个锚点条:锚点数量与可见用户输入不一一对应,hover 显示内部五段式模板文本(【需求原文】...),滚动到子任务卡片时高亮的也是这个"幽灵锚点"。压缩续跑注入消息同理(此前只处理了 hover 无文本,锚点条本身还在)。

**修复**:
- `octoapp/pages/make/utils/visible-message.ts`:新增导出 `isHiddenTaskPromptMessage(message, mainSessionID)`——消息属子会话且 agent ∈ {octo_design, octo_code, plan}(与 InsightTurn hideUserBubble 同口径,抽成共享 helper);index.tsx 两处 hideUserBubble 内联表达式替换为该 helper
- `octoapp/pages/make/index.tsx`:新增 `anchorMessages` memo——userMessages 过滤掉隐藏 task prompt 与压缩注入消息,TurnAnchorNav 改用此列表
- `octoapp/pages/make/components/turn-anchor-nav.tsx`:滚动侦测只认有锚点的 turn(anchoredIds 集合),滚到无锚点 turn(子任务卡片/注入消息)时保持最近一个有锚点 turn 高亮——子任务内容归属发起它的那条用户输入;视口顶部 fallback 同步改为首个有锚点 turn
- 测试:visible-message.test.ts 加 `isHiddenTaskPromptMessage` 5 例(三子代理判定/主会话 false/其他子代理 false/缺 sessionID false/空主会话 id false),18 pass

### 2. 回退不删除子任务生成的文件(前端收集 + 服务端清理,双端)

**根因**:回退 executeRevert 只扫主会话回退点之后的消息收集落盘文件(collectRevertedFiles:write/edit 工具路径 + artifact 标签推导路径)。子代理产物两路全漏:write/edit 工具调用在子会话 parts;<artifact> 标签产物由前端 autoSave 按 mainSessionID 归档到主会话产物目录,但标签文本在子会话 assistant 消息里。主会话产物(路由改造前 octo_make 直出)走同一条收集路径所以一直正常。

**修复(packages/app)**:`make/index.tsx` executeRevert 收集循环后追加子会话扫描——遍历 childSessionIDs,各子会话按现有 revert 指针过滤活消息(id < currentRevertID,与主会话 liveMsgs 同口径),只收 `id > 回退目标消息 id` 的消息(跨会话 MessageID.ascending 单调,与 userMessages revert 过滤同一比较口径),artifact 路径一律传主会话 sid 推导(与 autoSave 归属一致)。回退、重新生成(handleRegenerateMessage 复用 executeRevert)两入口同时生效。
- 测试:新增 `make/utils/restore-draft.test.ts`(collectWriteEditFiles/collectRevertedFiles 口径:子会话 write 路径直收、artifact 按主会话 id 推导、code 工作区 output/<sid前12位>、合并去重、无 projectDir 只收工具路径),8 pass

**伴生修复(packages/opencode,幽灵 turn 复活)**:服务端 `SessionRevert.cleanup`(发新消息时物理删除被回退消息)只清主会话——回退后子会话消息原样保留,发新消息清掉 revert 指针后,被回退轮次派发的子会话 turn 会重新出现在前端合并消息流(旧子任务卡片与新派发并存)。修复:cleanup 里对 `sessions.children(sessionID)` 各子会话删除 `id >= messageID` 的消息(MessageV2.Event.Removed,与主会话同机制);整会话落在回退点之后(无更早消息)的直接 `sessions.remove`(级联删孙会话,Event.Deleted 推送前端移除);remove 失败(并发已删)Effect.ignore 不阻断。
- 测试:revert-compact.test.ts 新增「回退点前派发的子会话保留、之后派发的整会话删除」用例(消息级+会话级断言),8/8 pass(--timeout 30000;5s 默认超时下 git 重测试本机既有抖动,基线对照确认非本次引入)

验证:packages/app + packages/opencode typecheck 过;visible-message 18、turn-anchor-text 11、restore-draft 8、revert-compact 8 全绿。

## 第四批修复:回退文件清理实际不删根因(2026-11-18,桌面 dev E2E 实测)

第三批的「回退收集子会话文件」修复后实测(桌面 dev + CDP 查 sidecar API),回退到消息 2 后 about.html 仍在、portfolio.html 内容也没恢复——**involved 收集是对的,删除机制整段失效**。真实根因两层:

**根因 A(非 git 项目,服务端 patch 机制整体失效)**:opencode 的文件回退走 Snapshot 服务——独立 git 快照仓(`Global.Path.data/snapshot/<project>/<hash>`),`enabled()` 要求项目 vcs 是 git。test_project2 等测试项目**没有 .git**,主/子会话 patch part 数为 0,`snap.revert(patches)` 空转。改造前主任务文件能删,靠的是 .octo/outputs 产物的前端 .history 机制(artifact 卡开 tab 记版本),不是服务端。

**根因 B(前端 .history 机制对子代理直写文件失效)**:路由化后 octo_design 用 write 工具把文件直接落到项目根(跟随项目已有文件布局),不经 artifact autoSave、从未开成 tab → 零 .history 版本。`historyController.restoreFilesBefore` 对零版本文件返回 `"none"` 直接 no-op(有版本但全在 cutoff 后才删),于是收集到的路径既不恢复也不删。

**修复 1(packages/opencode,git 项目,`revert.ts`)**:revert 的 patch 收集从只扫主会话扩展到合并子会话——`sessions.children()` 各子会话取 `id >= rev.messageID`(与 cleanup 同口径)的 patch part,按消息 id 与主会话 patch 时序排序合并(`snap.revert` 同文件取数组首次出现的快照,时序保证取回退点状态)。子会话写的文件 git 项目回退后恢复内容/删除新建,与主会话语义完全一致。
- 测试:revert-compact.test.ts 新增「子会话写文件回退恢复+删除」端到端用例(provideTmpdirInstance {git:true},子会话两轮 patch:保留轮 a0→a1,回退轮 a1→a2+新建 b.txt;revert 后断言 a.txt=a1、b.txt 不存在),9/9 pass

**修复 2(packages/app,非 git 项目/无版本文件,`executeRevert` 兜底删除)**:利用 write 工具 part 的 `state.metadata.exists`(写入时文件是否已存在,write.ts 既有字段)做证据——合并消息(主 liveMsgs + 子 liveChildMsgs)按「路径 → 最早一次 write/edit」聚合(recordWriteEvidence,restore-draft.ts 新增导出;edit 视为已存在,路径反斜杠归一与 involved 同口径);`restoreFilesBefore` 返回 `"none"`(零版本)且证据满足 `existed === false && 最早写消息 id > 回退目标消息 id` → 文件是回退轮次 write 新建的 → `api.deleteFile` 直接删。之前已存在的文件(existed true / 最早写在回退点前 / edit 先行)保持不动——无恢复来源,与既有行为一致,宁可保守。
- 测试:restore-draft.test.ts 加 recordWriteEvidence 6 例(exists 记录/undefined 不删/edit 已存在/路径归一/多消息保最早且与调用顺序无关/未完成不记),32 pass

E2E 实测定位手法(复用):CDP 9222 拿 sidecar 密码 → `GET /session`(主会话 directory/children)→ `GET /session/{child}/message` 看 parts(write 工具 input.filePath + metadata.exists)→ 对照项目磁盘文件与 revert 指针状态;TurnAnchorNav 阈值(≥3 条消息才渲染)也解释了两输入对话锚点栏整体消失——过滤幽灵锚点后 2<3,属既有阈值设计而非过滤缺陷。

## 第五批修复:回退子任务文件的用户提示(UI,2026-11-25)

第四批把子任务文件的实际删除修通后(桌面 dev 手动验证删除成功),用户提示链路还是只覆盖主会话——两个洞:

**洞 1(回退确认面板预告)**:`insight-turn.tsx` 的 `revertArtifacts` memo(「将被删除/将被修改」清单)只扫本 turn 会话消息,子代理 write 路径与 artifact 标签全在子会话 → 面板不预告子任务文件。**修复**:InsightTurn 新增 `childSessionIDs?: string[]` prop(index.tsx 两处调用点传 `[...childSessionIDs()]`);memo 在 `sessionID === mainSessionID` 且有子会话时追加扫描——各子会话按主会话 revert 指针过滤活消息(与 executeRevert liveChildMsgs 同口径),`id > 回退目标消息 id` 的 parts 计入待回退清单、更早的计入 existedBefore 证据(跨会话 ULID 时序可比),artifact 路径仍按主会话 sid 推导(autoSave 归属一致)。

**洞 2(回退后 toast 无子任务文件反馈)**:`api.deleteFile` 兜底删除是静默的,`.history` 删除(outcome==="deleted")也无提示。**修复**:executeRevert 里 `deletedFiles` 收集两路删除(outcome "deleted" + 兜底删除,后者改门在 `api.deleteFile` 存在才记账),全部文件操作完成后 `showOctoToast({ title: "已删除 N 个文件", description: 文件名列表(>5 截断为「前 5 + 等 N 个」) })`;第二循环逐 tab 的「该页面已随回退删除」提示在文件已被汇总 toast 覆盖时跳过防重复。handleRegenerateMessage 复用 executeRevert,重新生成流程同样受益。

验证:packages/app typecheck 过;visible-message + turn-anchor-text 30 pass;桌面 dev HMR 热载无报错。子会话无 write 的会话不进新分支(当前测试会话 ses_e73e95c69ffe 四个子会话仅 read/glob/question),面板预告+删除 toast 的可视验证需子任务实际 write 文件的场景。

**E2E 验证（2026-11-25，桌面 dev + CDP）**：11-23 会话 ses_e9812e706ffe（octo_code 子会话 write index.html/style.css/script.js，均 exists=false）实测全过——①面板预告：回退面板列出子任务写的 index.html「将被删除」（改前只扫主会话时此处为空）；②删除 toast：确定后弹出「已删除 3 个文件：index.html、style.css、script.js」（Toast DOM 为 .octo-toast-text，MutationObserver 捕获，title+description 合并显示）；③磁盘实删：三文件消失，其他会话产物（about/pricing/todo）不动；④首消息回退重启流程正常（会话删除 + 跳回 /make + 第二条 toast）。CDP 手法：_cdp_eval.cjs 装全局 toast 观察器再点确定（toast 4s 自动消失，先装观察器防漏采），面板定位用「含『确定要回退到此步骤』且含 ≥2 按钮的最小 div」。

## 第四次合入 origin/dev（2026-11-26，16f20ebf5）

dev 侧 4 个 PR：#1195/#1196 insight 输入框弹窗互斥修复 + 文件管理/对话交互埋点、#1198 Design 产物自动归档（auto-archive.ts 新增 + make/index.tsx +315 行）+ 评估状态重构（assessment-state.ts）、#1199 onboarding 看板上报 domainId/productLineId/productId/versionId。**dev 完全没动 packages/opencode**。

唯一冲突：make/index.tsx import 区——本分支 `recordWriteEvidence + WriteEvidence`（第四批回退证据）vs dev `collectWriteEditFiles + extractFileContent`（自动归档用），两边合并保留。

合并要点：
- dev 已自带 childSessionIDs 基础设施（signal + 4 处使用，无 writeEvidence 回退机制）——自动归档 createEffect 也按 `[sid, ...childSessionIDs()]` 扫主+子会话 write 路径（isCodeHtmlArtifactWrite 过滤后 handleCodeHtmlArtifactArchive），与本分支回退扫描同一口径复用
- insight-turn.tsx 自动合并无冲突：本分支 childSessionIDs prop 与 dev 新增 onHtmlArtifactSaved prop（html 产物 autoSave 成功后触发自动归档）在两处 InsightTurn 调用点并存
- dev 新增 recordToolVersionsAfter：write/edit 落盘且无真实 tab 时补伪 tab 记 .history 基线+agent 版本——**与本分支第五批回删除有正向协同**（子任务 write 文件此后会有 .history 版本,回退走 restoreFilesBefore 而非证据兜底）

验证：make utils 190 测试全过（含 dev 改动的 assessment-state）、packages/app typecheck 过（opencode 未动免检）。

## 第六批修复：外部评审驱动三修复（2026-11-26）

同事用另一个 agent（ChatGPT）对 PR #1201 做了静态评审（结论 Request Changes，4 P1 + 7 P2）。逐条对照代码核实后采纳其中三点（其余判定不成立或已有设计缓解，分析结论在会话记录）。三处修复：

**P1-1b 回退失败仍清 .history 版本（真数据丢失路径）**：`make/index.tsx` executeRevert 第一循环单文件恢复失败仅 catch + toast「产物回退失败」，第二循环对 involved 全部文件无条件 `removeVersionsAfter` → 文件没恢复 + 版本历史被清 = 恢复来源永久丢失。修复：第一循环 catch 里 `restoreFailed.add(filePath)`，第二循环 `if (restoreFailed.has(filePath)) continue`——恢复失败的文件保留 .history 版本作为恢复来源。

**P1-4 重连强制同步被去重吞掉**：`sync.tsx` runInflight pending 存在时直接返回旧 promise——重连补偿 `syncSession(id, {force:true})` 撞上在途普通同步时 force 语义被吞（普通同步命中缓存提前返回，断连窗口丢的事件补不回来）。修复：runInflight 加 opts 参数，force 调用不直接复用 pending，改为 `pending.catch(()=>{}).then(task)` 排队串行执行（保住强制重取又不并发写同一会话 store；pending 失败不阻断 force——恢复动作不应因上次报错跳过）；finally 清 key 加 `map.get(key) === promise` 守卫防先到的普通同步误删后续 force 的登记。reconnect 处注释同步改「由 runInflight 去重」→「排队在其后串行执行」。

**P2-1 syncSessionModel 在子会话守卫前执行（顺序脆弱）**：`make/index.tsx` createEffect 里 `syncSessionModel(local, msg)` 在 `(msg.sessionID ?? sid) !== sid` 守卫之前——现实无实害（local.session.restore 自带 `msg.sessionID !== session` 早退守卫，local.tsx:382），但依赖下游守卫属隐患。修复：挪到守卫之后，与 `local.model.set` 同一防线内。

**PR #1201 规范修正（同日）**：pr-standards bot 于 02:20Z 报 4 项不合规（2 小时自动关闭窗口）。核实 workflow 源码（pr-standards.yml）发现 feat/docs/refactor 标题跳过 issue 检查 → 无需建 issue（仓库 Issues 本就禁用）。标题改 `feat(make): octo_make 路由化改造,设计/开发需求派发 octo_design/octo_code 子代理`，正文按模板补齐（Type 勾 New feature、What/Verify 实内容、Checklist 双勾），03:25Z bot 回复「now meets our contributing guidelines」+ needs:compliance 标签清除。

验证：packages/app 328 单测全过、typecheck 过。P1-1b 的失败注入场景（restoreFilesBefore throw）无现成单测，走代码路径审查（catch→restoreFailed→第二循环 continue）。
