# Make Agent 提示词与生成策略

## 概述

Make agent 从通用英文提示演进为中文 `<artifact>` 标签格式，支持多 artifact 分解和子 agent 并行生成，针对弱模型优化策略。

## 提交记录

### `cf3bf21b5` 对齐 Open Design 工作流，增强生成过程交互

- `src/agent/prompt/octo_make.txt`：完全重写为中文 `<artifact>` 标签格式，严格规则（无 skill 工具、立即输出 HTML、设计系统集成、反 AI 模式）
- `src/agent/skills/octo_make/html-prototype/SKILL.md`：完全重写，结构化 artifact 格式，支持多种 artifact 类型（html/deck/svg/markdown-document/code-snippet）

### `793992668` 合入上游 — make prompt 简化回英文

- `src/agent/prompt/octo_make.txt`：从中文改回英文，简化结构（专家设计师角色、artifact 移交规则、设计/内容指南）

### `326dd75fa` 添加模型选择器 + 修复 Chat 模型持久化

- `src/agent/prompt/octo_make.txt`：添加"结果介绍"要求（artifact 之前 2-4 句话）

### `1ec7c712b` 支持多 artifact 分解生成 + 子 agent 并行组件生成

- 新增 `src/agent/prompt/make_component.txt`（39 行）：子 agent 生成独立 HTML 片段
- `src/agent/prompt/octo_make.txt`：添加三种策略——策略 A（单 artifact）、策略 B（子 agent 并行）、策略 C（多 artifact 备用）
- `src/agent/skills/octo_make/html-prototype/SKILL.md`：强调在 `<artifact>` 标签内输出 HTML

### `15f55675e` 弱模型输出优化

- `src/agent/prompt/octo_make.txt`：策略 A 改为默认（避免弱模型复杂分解），添加 HTML 自检规则，策略 B 阈值改为"2+ 部分或 >600 行"
- `src/provider/transform.ts`：`OUTPUT_TOKEN_MAX` 从 32,000 → 128,000

### `a341ac4e2` octo_make 中文提示词

- `src/agent/prompt/octo_make.txt`：完全翻译为中文
- `src/agent/prompt/make_component.txt`：完全翻译为中文
- `src/agent/skills/octo_make/html-prototype/SKILL.md`：完全翻译为中文

### 禁用子 agent 并行生成（2026-06-09）

- `src/agent/prompt/octo_make.txt`：移除策略 B（子 agent 并行）和策略 C（多 artifact 拆分），只保留单 agent 直接生成。每次回复最多只能输出一个 artifact。
- 原因：子 agent 在 session 切换时存在事件路由和数据加载竞争问题，导致最终结果无卡片。原提示词备份在 `dev-plan/octo-make-prompt-backup-with-subagent.md`。

### 强制 HTML 用 artifact 包裹（2026-06-12）

- `src/agent/prompt/octo_make.txt`：新增「强制规则：HTML 必须用 artifact 包裹」章节（第 9-42 行）
- 原因：弱模型有时生成 HTML 不用 artifact 标签（直接裸输出或用 markdown 代码块），导致前端无法渲染预览卡片
- 内容：加粗声明无例外 + 3 个反面示例（❌ markdown 代码块 / 裸 HTML / write 工具）+ 1 个正面示例（✅ artifact 包裹）+ 自检规则（最后一行必须是 `</artifact>`）

### 设计方案支持自然语言确认（2026-06-24）

- `src/agent/prompt/octo_make.txt`：重写「行为规则」第 2-4 条（约第 211 行起）
- 原因：之前规则只识别前端 `[confirm-plan plan-xxx]` 指令作为确认信号。用户不点按钮、直接在输入框说"开始生成 / 按方案做"时，agent 行为不可预测（可能重新输出方案、反问或调用 question 工具）
- 改动：确认信号扩展为两种 — 前端指令 OR 自然语言生成意图；新增第 3 条明确"调整"意图的关键词；新增第 4 条要求模糊消息（询问/讨论）用文字回答，不直接生成 HTML、不重新输出方案、不再走 question 工具

### 设计方案改为两阶段：先 sentinel 引导再生成（2026-06-30）

- `src/agent/prompt/octo_make.txt`：重写「设计方案工作流」章节（约第 176 行起），从「直接输出 plan artifact」改为「先输出 sentinel 引导用户确认，再生成 plan」
- 原因：之前 agent 判断需求复杂时直接输出完整方案 artifact，用户被"先斩后奏"，没决定是否走方案就已经消耗了 token，违背用户预期
- 新协议（三步走）：
  1. **第一步**：复杂需求时（3+ 模块 / 多页面流程 / 描述模糊 / 大型布局），agent 输出 `[design-plan-intent]` sentinel + 一句中文引导，**立即停止**当前回复，不输出任何 artifact；简单需求仍直接生成 HTML
  2. **第二步**：等用户响应 — 收到 `[enter-plan]` → 输出设计方案 artifact；收到 `[skip-plan]` → 直接生成 HTML
  3. **第三步**：后续行为（确认 / 调整 / identifier 复用）沿用现有规则
- 新增「防循环」规则：用户已选 `[skip-plan]` 后，本会话内 agent 不再发 sentinel，直接生成 HTML（除非用户明确要求"先规划"）
- 配套前端改动（在 packages/app，非本目录）：新建 `plan-entry-banner.tsx` 引导横条，scanner 加 `isPlanIntentResolved` 函数推断 sentinel 是否已被响应

### 强化 sentinel 输出可靠性（2026-07-13）

- `src/agent/prompt/octo_make.txt`：重写「工作流程」章节，从「规则说明」改为「回复模板 + 违规案例」格式
- 原因：agent 有时跳过 `[design-plan-intent]` sentinel，直接输出自然语言或 HTML artifact，导致 banner 不显示
- 改动：
  1. 新增「回复模板」：明确要求回复必须以 `[design-plan-intent]` 开头（判断为生成时）或纯文字（非生成时）
  2. 新增「违规案例」：列出 5 种常见违规模式（以"我来帮你生成"开头、以"好的"开头、sentinel 后有额外文字等）
  3. 工作流从 4 步改为 5 步，sentinel 必须是回复的**第一个词**，前面不能有任何文字/空格/换行
  4. 移除"复杂需求才触发"的语义，改为"任何生成需求都触发"（第 1 步判断为生成 → 立刻发 sentinel）

### 修复子 agent 不输出 design-plan artifact（2026-07-13）

- `src/agent/prompt/octo_make_plan.txt`：重写「工作流程」和「能力边界」章节
- 原因：子 agent `octo_make_plan` 收到 prompt 后先调用 `read` 工具读工作目录（触发权限弹窗），然后输出文字说明但未输出 `<artifact>` 标签，导致 `planCard` 检测不到设计文档，用户看不到确认按钮
- 改动：
  1. 新增「核心规则」章节：要求回复必须以 `<artifact type="text/design-plan">` 开头直接输出文档
  2. 新增「回复模板」：明确 artifact 格式，禁止在 artifact 前输出任何文字
  3. 工作流改为"直接输出 → 等待反馈 → 用户确认"三步
  4. 工具调用（read/websearch）只能在输出初始 artifact 之后的迭代阶段使用
  5. 权限保持 `read: "ask"`、`websearch: "allow"` 不变

### 强化子 agent 强制输出 artifact 规则（2026-07-13）

- `src/agent/prompt/octo_make_plan.txt`：将"强制规则"提升到 prompt 最前面，文档结构模板放到后面
- 原因：之前的 prompt 中"直接输出"指令被 70 行文档结构模板淹没，agent 优先调用 read 工具而非直接输出 artifact
- 改动：
  1. 新增「强制规则（必须遵守）」章节作为 prompt 第一段，明确 4 条硬性约束
  2. 规则 1：第一次回复必须以 `<artifact type="text/design-plan">` 开头
  3. 规则 2：输出 artifact 之后才允许调用 read/websearch 工具
  4. 规则 3：用户确认前保持等待
  5. 规则 4：禁止第一次回复调用工具或输出说明文字

### 允许 write 工具但约束到 artifact 目录（2026-06-30）

- `src/agent/prompt/octo_make.txt`：放宽三处对 write 工具的硬性禁止（第 6、29、173 行），改为条件允许——默认仍用 `<artifact>` 标签；仅当用户明确要求用 write 工具时才允许，且写入路径必须限定在 `.octo/<sessionId>/outputs/` 目录内。
- 新增「文件写入规则（write 工具路径约束）」章节（插入在「产物交接」之后、「生成策略」之前），说明路径前缀固定、文件名规范、禁止路径、默认仍优先 artifact。
- 配套前端改动（在 packages/app，非本目录）：`pages/make/index.tsx` 的 `sendMessage()` 在 prompt 最前面无条件注入 `[Artifact Folder]: <绝对路径>` 前缀，让 agent 知道当前会话的 artifact 目录绝对路径（含 sessionId）。
- 原因：write 工具的 agent 权限已是 `allow`，但旧提示词明确禁止使用 write。用户希望保留 `<artifact>` 为默认输出方式的同时，允许 agent 在用户明确要求时用 write 工具——但严格约束到 artifact 目录，避免散落项目各处。前端注入绝对路径是因为 write 工具 schema 要求绝对路径，且 sessionId 只有前端知道。

### 同会话修改产物用 edit 工具（2026-06-30）

- `src/agent/prompt/octo_make.txt`：在「文件写入规则」之后新增「文件编辑规则（edit 工具路径约束）」章节——仅当用户在同会话中明确引用之前的产物要修改时，才用 edit 工具直接改文件；路径必须来自前端注入的 `[Existing artifacts in this session]` 列表；跨会话或全新生成都不能用 edit。edit 权限保持 `ask`，触发弹窗由用户授权。
- 配套前端改动（在 packages/app，非本目录）：`pages/make/index.tsx` 的 `sendMessage()` 在原有 `[Artifact Folder]` 注入基础上，调 `sdk.client.file.list` 扫描 `.octo/<sessionId>/outputs/` 目录下已存在的文件，注入 `[Existing artifacts in this session]` 列表（每轮 sendMessage 重新扫盘，保证列表新鲜）。
- 原因：用户希望同会话里改之前的产物时，agent 直接 edit 文件而非重新输出完整 `<artifact>`，省 token 也更符合"修改"语义。文件列表由前端注入而非 agent 自行 ls，是为了减少 tool call 轮次，并确保 agent 拿到准确的绝对路径。

### 设计规划改为两步走工作流（2026-07-16）

- `src/agent/prompt/octo_make_plan.txt`：完全重写为两阶段工作流
- 原因：用户希望在"点击进入"和"输出设计文档"之间增加一个"策略准备"阶段，让子 agent 先通过对话收集信息并填写策略表单，用户确认后再生成完整文档
- 改动：
  1. **第一阶段（策略准备）**：与用户对话，提取关键信息后立即用 `<artifact type="text/strategy-field" field="字段名">值</artifact>` 输出到对应字段（需求背景/设计目标/设计方法/其他/用户画像/用户旅程/研究报告）
  2. **第二阶段（设计规划生成）**：收到 `[strategy-complete]` 后，根据表单信息输出完整 `<artifact type="text/design-plan">` 文档
  3. 新增强制规则：第一阶段禁止输出 design-plan，第二阶段必须先分析再输出文档
  4. 工具调用（read/websearch）只能在第二阶段使用
- 配套前端改动（在 packages/app）：
  - `pages/make/index.tsx`：新增 `planPhase` signal（"strategy" | "generate"）、`strategyFormData` memo、`handleGenerateStrategy()` 函数、`manualStrategyFormData` signal 用于用户手动编辑
  - `pages/make/utils/strategy-form-scanner.ts`：新建，解析子 agent 输出的 strategy-field artifact
  - `pages/make/components/result-viewer/strategy-form-renderer.tsx`：新建，策略表单 UI 组件（7 个字段分两块：设计需求 + 洞察研究）
  - `pages/make/components/result-viewer/index.tsx`：新增 props（planPhase/strategyFormData/onStrategyFieldChange/onGenerateStrategy/isGenerating），按 phase 分发渲染 StrategyFormRenderer 或 DesignPlanRenderer
