# Studio 多轮生成上下文改造方案

## 背景

当前 Studio 中，一轮对话生成后，下一轮继续输入时，生成结果表现得像一次全新的独立请求。用户输入类似“把它改成赛博朋克风”“保持上一张构图，换成夜景”等指代性需求时，系统没有稳定继承上一轮 prompt、生成结果、画幅、风格和图片特征。

## 当前现状

前端 Studio 主生成路径在 `packages/app/octoapp/pages/studio-page.tsx`：

- `runGeneration()` 读取当前输入框内容、能力、风格、画幅、数量、参考图。
- `createStudioGeneration()` 直接 POST `/studio/generations`。
- 请求体只传本轮 `prompt`、`capability`、`styleModel`、`aspectRatio`、`count`、`referenceImages`、`sourceImage` 和 `extra`。

后端 Studio 生成路径在 `packages/opencode/src/studio/studio-service.ts`：

- `createGeneration()` 校验 session 后创建 generation。
- `createProviderTask()` 直接调用内部图片生成服务。
- 传给 provider 的 prompt 是本轮 `input.prompt`。
- 生成结束后再把本轮 user message、assistant message、tool part 写入 session。

也就是说，Studio 当前有会话记录和 turn 展示，但生成时没有把历史 turn 作为语义上下文参与 provider prompt。

## 已存在但未接入的能力

`packages/app/octoapp/pages/studio/turns.ts` 已经有：

- `buildStudioTurns()`：从 session messages/parts 还原 Studio turn。
- `buildStudioTurnSummary()`：提取上一轮用户需求、助手说明、结果模型、比例、数量、工具。
- `buildStudioConversationContext()`：基于最后一轮成功结果生成摘要。

问题是 `buildStudioConversationContext()` 当前没有在 `studio-page.tsx` 的提交链路中被使用。

## 根因

Studio 生成链路绕过了普通 chat agent 的上下文推理：

1. 前端直接调用 `/studio/generations`，不是调用 `session.prompt`。
2. 后端直接调用图片 provider，不经过 `octo_studio` agent/LLM。
3. 历史消息只用于 UI 展示，不用于下一轮 prompt 构造。
4. 已有的历史摘要函数只取最后一轮，并且没有接入请求。

## 改造目标

- 下一轮 Studio 生成可以理解上一轮的用户需求和生成结果。
- 支持“它”“上一张”“保持风格”“换成某风格”等连续对话指代。
- 不破坏当前 Studio 异步生成、轮询、会话落库和 UI 展示逻辑。
- 用户界面仍显示原始用户输入，不被上下文 prompt 污染。
- 修改范围尽量小，优先复用现有 turn 数据结构。

## 推荐方案

### 1. 前端只收集最后一轮成功生成摘要

在 `packages/app/octoapp/pages/studio/turns.ts` 扩展上下文构造函数。

第一版暂时只取最后一轮成功生成结果，不考虑多轮累计上下文。判断标准：

- turn 有 `result`。
- `result.images.length > 0`。
- `result.status` 为 `succeeded` 或结果已经包含可展示媒体。

摘要内容：

- 用户需求：`turn.userText`
- 助手说明：`turn.assistantText`
- 能力：`turn.result.capability`
- 模型：`turn.result.model`
- 画幅：`turn.result.aspectRatio`
- 数量：`turn.result.images.length`
- 结果图片或视频 URL：取第一张 `remoteUrl ?? url`
- 工具名：`turn.toolName`

建议第一版直接输出字符串，降低前后端 schema 变更成本。现有 `buildStudioConversationContext()` 已经接近这个目标，只需要增强它对“最后一轮成功生成”的选择逻辑和主图 URL 提取。

示例输出：

```text
上一轮用户需求：生成一个未来城市海报
上一轮助手说明：我将为您创作生成一个未来城市海报。采用“通用”风格，画幅比例设为 3:4。
上一轮生成结果：能力 image.generate，模型 通用，比例 3:4，1 张图
上一轮主图：https://...
上一轮工具：internel_image_generate
```

### 2. 前端提交时携带上下文

在 `packages/app/octoapp/pages/studio-page.tsx`：

- import 新的上下文构造函数。
- 在 `runGeneration()` 里调用它。
- 将结果放入 `createStudioGeneration()` 的 `extra.studioContext`。

建议只在已有有效 Studio session 时收集上下文：

- 新建会话首轮不带上下文。
- 当前会话已有成功结果时带上下文。
- 当前请求是用户上传新参考图时，历史作为弱上下文。

示例请求结构：

```ts
extra: {
  ...(overrides?.extra ?? {}),
  studioContext,
  userIdx: uiplusUserAccount(),
}
```

### 3. 后端合成 effective prompt

在 `packages/opencode/src/studio/studio-service.ts`：

- 保留 `input.prompt` 作为用户原始输入。
- 新增 helper，如 `buildEffectiveStudioPrompt(input)`。
- `createProviderTask()` 调 provider 时使用 `effectivePrompt`。
- `persistStudioSession()` 仍将 user text part 写原始 `input.request.prompt`，避免 UI 显示长上下文。
- tool input 可增加 `effectivePrompt`，方便调试。

合成策略：

```text
当前用户需求：
{input.prompt}

上一轮成功生成上下文：
- 上一轮用户需求：...
- 上一轮生成结果：能力 image.generate，模型 ...，比例 3:4，生成 1 张图
- 上一轮主图：...

生成要求：
如果当前需求包含“它、上一张、保持、换成、继续、改成”等指代或延续表达，请延续历史上下文中的主体、构图、风格和已生成结果特征。
如果当前需求明确要求全新内容，以当前需求为主，仅参考历史上下文中的可复用偏好。
```

### 4. 区分不同生成场景

普通文生图：

- 默认带最后一轮成功 turn 的摘要。
- 如果用户上传新参考图，当前参考图优先，历史只补充风格和偏好。

再次生成：

- `regenerateCurrentResult()` 应优先复用当前 result prompt 和参数。
- 可以不额外带完整历史，避免 prompt 重复叠加。

视频生成：

- 如果从当前图片生成视频，`referenceImages` 已包含当前图。
- 历史上下文主要补充画面风格、主体和上一轮 prompt。

编辑能力：

- `image.upscale`、`image.cutout`、`image.inpaint`、`image.outpaint` 已有 `sourceImage`。
- 历史上下文只补充风格/主体，不覆盖编辑指令。

## 文件级修改点

### `packages/app/octoapp/pages/studio/turns.ts`

- 增强 `buildStudioConversationContext()`。
- 只选择最后一轮成功生成 turn。
- 返回字符串上下文。
- 在摘要里补充 `capability` 和第一张结果媒体 URL。

### `packages/app/octoapp/pages/studio-page.tsx`

- import 上下文构造函数。
- 在 `runGeneration()` 中生成 `studioContext`。
- 传入 `createStudioGeneration()` 的 `extra`。
- 根据 `regenerateCurrentResult()` 等场景决定是否跳过上下文。

### `packages/opencode/src/studio/studio-service.ts`

- 扩展 `StudioGenerationRequest.extra` 的读取逻辑。
- 新增 `buildEffectiveStudioPrompt()`。
- `createProviderTask()` 使用 effective prompt 调 provider。
- `persistStudioSession()` 的 tool input 增加 `effectivePrompt` 或 `studioContext` 便于排查。

### `packages/opencode/src/server/routes/instance/studio.ts`

如果上下文放在 `extra.studioContext`，无需新增顶层 schema 字段。

如果选择顶层 `conversationContext`，需要扩展 `StudioGenerationInput`。

### `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

如果上下文放在 `extra.studioContext`，无需修改。

如果选择顶层 `conversationContext`，需要同步扩展 HttpApi schema，并按需重新生成 SDK。

## 兼容策略

推荐第一版把上下文放入 `extra.studioContext`：

- 避免变更公共 API 顶层结构。
- 不需要立即改 SDK schema。
- 后端可以渐进读取，不影响旧客户端。
- 后续稳定后再提升为正式字段。

## 测试建议

### 单元测试

为 `turns.ts` 增加测试：

- 空会话返回空上下文。
- 单轮成功结果能提取用户需求、模型、比例、主图 URL。
- 多轮结果只取最后一轮成功生成结果。
- running/failed/editor entry 不应污染成功上下文。

### 前端行为验证

手动验证：

1. 第一轮输入“生成一个未来城市海报”。
2. 第二轮输入“把它改成赛博朋克风，保持构图”。
3. 检查请求 `extra.studioContext` 包含上一轮信息。
4. 检查 UI 对话气泡仍只显示用户原始第二轮输入。

### 后端验证

检查 generation 记录：

- `request.input.prompt` 保留用户原始输入。
- provider 收到的是合成后的 effective prompt。
- tool part 的 input 中能看到上下文或 effective prompt，便于排查。

## 风险与注意点

- 不要把完整图片 data URL 大量塞入上下文，最多取最近一轮或只取 remote URL。
- 上下文 prompt 不应无限增长，第一版固定只取最后一轮成功结果。
- 对于明确新建内容的 prompt，历史应降权，避免旧结果污染新需求。
- UI 展示和 session 标题应继续使用原始用户 prompt。
- 如果后续改为走 `octo_studio` agent，需要重新评估异步 generation、轮询、tool part 落库之间的职责划分。

## 最小可实施版本

1. 前端复用并增强 `buildStudioConversationContext()`，只取最后一轮成功结果。
2. 将摘要字符串塞入 `extra.studioContext`。
3. 后端 `createProviderTask()` 将 `input.prompt` 与 `extra.studioContext` 合成为 effective prompt。
4. UI 和落库仍保留原始 `input.prompt`。

这是最低风险路径，可以先解决“每轮独立”的主要体验问题。后续如确有需要，再扩展为多轮结构化上下文。
