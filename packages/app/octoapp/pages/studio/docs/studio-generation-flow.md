# Studio 图片生成链路

本文梳理 Studio 中从用户输入文本到生成图片展示的完整路径，以及多轮对话如何衔接。

## 关键文件

- `packages/app/octoapp/pages/studio/index.tsx`：Studio 页面主逻辑、输入、状态、结果展示。
- `packages/app/octoapp/pages/studio/turns.ts`：将 session message / part 转换为 Studio 对话轮次。
- `packages/opencode/src/agent/prompt/octo_studio.txt`：Studio agent 的系统提示。
- `packages/opencode/src/session/prompt.ts`：服务端创建用户消息、解析工具、驱动 LLM loop。
- `packages/opencode/src/session/llm.ts`：调用模型并传入工具。
- `packages/opencode/src/tool/jimeng_image_generate.ts`：即梦图片工具。
- `packages/opencode/src/tool/internel_image_generate.ts`：内部图片工具。

## 单轮生成流程

1. 用户在 `StudioComposer` 输入 prompt，选择能力、工具、风格、比例、数量后点击生成。

2. `handleSubmit()` 调用 `runGeneration()`。

3. `runGeneration()` 做前端状态准备：
   - 读取输入文本。
   - 如果文本为空或当前 busy，直接返回。
   - 设置 `status` 为 `submitting`。
   - 创建 `pendingResult`，用于前端立即显示生成中状态。
   - 设置 `sending` 为 `true`。
   - 清空输入框。
   - 如果当前没有 session，则创建 `octo_studio` session 并跳转。
   - 调用 `sendStudioPrompt()`。

4. `sendStudioPrompt()` 调用 SDK：

   ```ts
   globalSDK.client.session.promptAsync({
     sessionID,
     tools: {
       jimeng_image_generate: imageTool() !== "internel",
       internel_image_generate: imageTool() === "internel",
     },
     parts: buildStudioPromptParts(...)
   })
   ```

   Studio 前端不直接请求图片 API，而是发送一条 session 用户消息，并只开放当前选择的图片工具。

5. `buildStudioPromptText()` 将用户输入包装为 Studio 专用任务单，包含：
   - 用户需求
   - 能力
   - 风格模型
   - 画幅比例
   - 生成数量
   - 当前选中的生图工具
   - 工具参数 JSON
   - 必须调用当前选中的生图工具
   - 上一轮摘要

6. 服务端 `SessionPrompt.prompt()` 创建 user message。

7. 服务端将本轮 `tools` 转成 session permission，并进入 session loop。

8. 服务端 `resolveTools()` 根据 agent、model、permission 和本轮 user message 的 `tools` 字段解析可用工具。

9. 当 agent 是 `octo_studio` 且本轮开放了 `jimeng_image_generate` 或 `internel_image_generate` 时，服务端会：
   - 只保留图片生成工具和 `invalid`。
   - 设置 `toolChoice: "required"`。

   这样 Studio 生图请求不能只返回文字，必须调用图片工具。

10. `LLM.stream()` 调用 `streamText()`，传入：
    - system prompt
    - 历史 messages
    - active tools
    - tool choice

11. 模型根据 `octo_studio.txt` 的规则，生成简短说明并调用当前可用图片工具。

12. 图片工具执行：
    - `jimeng_image_generate` 调即梦/火山视觉接口。
    - `internel_image_generate` 调内部 create task / query task 接口。

13. 工具执行完成后，将图片 URL 或 base64 图片写入 tool part 的 `output`、`attachments` 或 `content`。

14. 前端通过 `globalSDK.event.listen()` 接收服务端事件：
    - `message.updated`
    - `message.part.updated`
    - `session.status`
    - `message.part.delta`

15. 前端将 message 和 part 写入 `dataStore`。

16. `buildStudioTurns()` 将原始 message / part 转换成可展示的 Studio 轮次：
    - 按时间排序消息。
    - 以 user message 为一轮。
    - 找到 user message 后面的 assistant message。
    - 收集 assistant text。
    - 收集 tool parts。
    - 从 tool output / attachments / content 中提取图片。
    - 组装为 `StudioTurnData`。

17. UI 根据 `turns()` 和 `result()` 渲染：
    - 中间对话区展示用户气泡、助手说明、结果卡片。
    - 右侧画布展示当前结果大图。
    - `StudioDetails` 展示缩略图、提示词、模型、比例、标签和操作按钮。

## 多轮对话流程

多轮对话复用同一个 session，不单独维护 Studio 私有历史。

1. 用户在已有 Studio session 中继续输入，仍然调用 `runGeneration()`。

2. 如果已有 `params.id`，前端不会创建新 session，而是将新 user message 发到当前 session。

3. 本轮 prompt 会通过 `buildStudioConversationContext()` 带上上一轮摘要。

4. 上一轮摘要来自最近一个有图片结果的 Studio turn，通常包含：
   - 上一轮用户需求
   - 上一轮助手说明
   - 上一轮生成结果的模型、比例、图片数
   - 上一轮工具

5. 服务端也会把完整 session history 转成 model messages，因此模型同时看到：
   - 前端显式塞入的上一轮摘要。
   - 服务端提供的原始历史消息。

6. 新一轮仍然强制调用当前选中的图片工具，避免只回复文字。

7. 新工具结果回流后，`buildStudioTurns()` 会把新 user / assistant / tool part 解析成新的 Studio turn。

8. 右侧结果选择逻辑：

   ```ts
   studioTurn()?.result ?? latestCompletedTurn()?.result ?? pendingResult()
   ```

   含义：
   - 优先展示当前最新轮次结果。
   - 如果最新轮次还没有图片，展示最近一次已完成结果。
   - 如果没有真实结果，展示 pending 状态。

## 关键状态

- `prompt`：输入框文本。
- `capability`：当前能力，如 `image.generate`、`image.outpaint`。
- `styleModel`：当前风格模型。
- `aspectRatio`：当前画幅比例。
- `count`：生成图片数量。
- `imageTool`：当前生图工具，`jimeng` 或 `internel`。
- `assets`：用户上传的参考图片。
- `status`：前端生成状态。
- `sending`：前端是否正在提交。
- `pendingResult`：前端乐观生成的临时结果。
- `dataStore.message`：当前 session 的消息列表。
- `dataStore.part`：按 messageID 存储的 parts。
- `turns`：从真实消息解析出的 Studio 轮次。
- `result`：右侧当前展示结果。
- `selectedImageId`：当前选中的缩略图。

## 再次生成

`StudioDetails` 和画布工具栏的“再次生成”共用 `regenerateCurrentResult()`。

当前逻辑是：

1. 读取当前展示的 `result()`。
2. 使用当前结果的 `prompt`。
3. 复用当前结果的 `capability`。
4. 调用 `runGeneration({ capability: current.capability, prompt: current.prompt })`。

因此“再次生成”不依赖输入框文本。

## 当前注意点

1. Studio 生图主链路是“前端发 session 消息 -> agent 调 tool”，不是前端直接调用生图 API。

2. 多轮连续性主要依赖“上一轮摘要 + session 原始历史”。普通第二轮文本更偏语义续作；如果要严格基于上一张图编辑，需要显式传 `sourceImage`。

3. `turns.ts` 从 tool part 重建历史结果时仍有元数据简化，例如 `capability` 和 `aspectRatio` 可能不是工具真实参数。

4. 前端存在 `pendingResult` 乐观状态，真实结果会在 tool part 回流后替换 pending 状态。

5. Studio 当前强制图片工具调用的逻辑在服务端 `prompt.ts` 中，只对 `octo_studio` 且本轮开放图片工具时生效。
