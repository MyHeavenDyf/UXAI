# Insight Agent 提示词

## 概述

Insight agent 提示词从初始版本演进，添加异步任务结果格式化规则，更新分析类型。

## 提交记录

### `c2a3b457a` 更新 insight agent prompt

- `src/agent/prompt/octo_insight.txt`：重写工作流，不再使用 `upload_document` + `analyze_interview`，直接将 S3 URL 作为上下文注入；更新分析类型（用 cluster_by_outline/generate_persona/evaluation_summary/mindmap 替换 user_journey/pain_points/opportunity_map）
- `src/agent/skills/octo_insight/interview-analysis/SKILL.md`：更新 skill 描述和工具列表

### `e8ee2dc0a` 预置文案定稿

- `src/agent/prompt/octo_insight.txt`：将"模板下拉"描述更改为"预置按钮"

### `d9b1b66e4` 合入 octo-agent 最新更新

- 删除 `src/agent/prompt/octo_insight.md`（YAML frontmatter 版本，仅保留 .txt）
- `src/agent/prompt/octo_insight.txt`：大幅重写——添加"异步任务结果回复规则"（100 字符以内，无 JSON/表格内联，无解读），添加 pending/failed/stopped 状态处理
