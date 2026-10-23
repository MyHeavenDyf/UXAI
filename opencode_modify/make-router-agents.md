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

### `src/skill/index.ts` — AGENT_SKILL_ALIASES 加 `"octo_design": "octo_make"`

- agent.skills 字段是惰性的；实际 skill 可见性由 skill_config.json 的 agent 映射决定（Skill.available，index.ts:379-395）。octo_design 不在用户 skill_config 里，经 alias 继承 octo_make 的映射 → html-prototype 对子代理可见
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
