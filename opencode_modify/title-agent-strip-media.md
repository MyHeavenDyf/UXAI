# Title Agent 不再传入图片

## 问题描述

title agent 生成会话标题时，用户第一条消息里附带的图片（`file` part，`image/*` 或 `application/pdf`）会原样传给标题模型。标题模型多为小模型/纯文本模型（且可能经 `title_model` 降级），图片输入轻则浪费 token，重则触发不支持图片输入的报错导致标题生成失败。

## 修改内容

### packages/opencode/src/session/prompt.ts（ensureTitle）

`MessageV2.toModelMessagesEffect(titleContext, mdl)` 增加 `{ stripMedia: true }` 选项：

- 用户消息中的图片/PDF `file` part → 替换为文本占位 `[Attached image/png: 文件名]`（保留「用户附了图」的信号，标题仍可体现「查看截图」类意图）
- 工具结果里的媒体附件 → 直接丢弃（标题生成发生在首轮 step 1，正常无工具结果，防御性生效）

复用 `toModelMessagesEffect` 既有的 `stripMedia` 机制，不新增任何过滤逻辑。

## 涉及文件

- `packages/opencode/src/session/prompt.ts`（仅 1 行：title 上下文转换传入 `stripMedia: true`）

## 关联机制（不改动，仅背景）

- `stripMedia` 定义：`packages/opencode/src/session/message-v2.ts` `toModelMessagesEffect` options
- 媒体判定：`packages/opencode/src/util/media.ts` `isMedia`（`image/*` + `application/pdf`）
- octo_insight 的 synthetic parts 剥离逻辑保持不变（在 stripMedia 之前独立生效）
- `compressTitle` 二次压缩只传超长标题文本，无需处理

## 验证结果

- `bun run typecheck`（packages/opencode）通过
