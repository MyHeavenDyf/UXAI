# Title Agent 提示词改为中文短标题

## 问题描述

session title 自动生成的 agent 提示词为全英文（`packages/opencode/src/agent/prompt/title.txt`），中文用户输入时弱模型容易生成英文标题；且原规则允许 ≤50 字符，标题偏长。

## 修改内容

### 1. packages/opencode/src/agent/prompt/title.txt

将整个提示词改为中文编写，核心变化：

- 标题输出改为中文，只保留必要的技术术语/文件名/数字
- 长度上限从 ≤50 字符改为 ≤10 个字符
- 任务描述改为「总结用户的需求，生成简短中文标题」
- 规则补充中文场景细节（过长文件名取 basename、去掉「的/这个/我的」等冗余词、寒暄输入给语气标题）
- 示例全部替换为中文场景（原英文示例不再适用）

## 涉及文件

- `packages/opencode/src/agent/prompt/title.txt`（提示词主体改为中文）
- `packages/opencode/src/session/prompt.ts:231`（调用 title agent 时拼在用户消息前的引导语由英文 "Generate a title for this conversation:" 改为中文 "请总结用户需求，生成一个不超过10个字的中文标题："）

## 验证结果

- 未改动 `packages/opencode/src/session/prompt.ts` 中的清洗逻辑（`cleaned` 长度截断仍为 100 字符，实际标题由提示词约束在 10 字内）
- title agent 定义（`packages/opencode/src/agent/agent.ts:472-487`）不变，仍通过 `PROMPT_TITLE` 引用该文件
- 预览 title.txt 修改后格式正确