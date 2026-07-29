# 设计规划流程修复：消息排序 & 弱模型表单追问

## 改动文件

### 1. packages/app/octoapp/pages/make/index.tsx

**问题**：`userMessages` memo 将主 session 消息和子 session 消息分开拼接（主 session 在前、子 session 在后），导致子 session 结束后用户在主 session 的交互消息会出现在子 agent 消息上方，打破了时间顺序。

**修复**：合并所有消息后按 `time.created` 排序：
- 无子 session 时直接返回 `mainMsgs`（保持引用不变，无性能开销）
- 有子 session 时合并后按时间戳升序排列
- 使用 `?.` 安全访问，缺失时间戳的消息排在前面但不崩溃

### 2. packages/opencode/src/agent/prompt/octo_make_plan.txt

**问题**：第一阶段指令"持续对话直到用户点击「策略生成」按钮进入第二阶段"导致弱模型反复追问用户补充表单字段，即使已有足够信息。

**修复**：将第 3 条改为"每次填充字段后简短确认即可，不要在对话中反复追问用户补充更多字段。用户有足够信息后自会点击「策略生成」按钮进入第二阶段。若用户主动询问...可提示...但不要主动重复追问。"
