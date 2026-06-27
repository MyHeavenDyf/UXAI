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
