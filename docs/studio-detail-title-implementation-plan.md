# Studio `detailTitle` 改造与会话标题同步方案

## 目标

为每个 Studio 图片/视频生成结果建立一个简短、可读的 `detailTitle`，替代当前从完整 `result.prompt` 截取第一行的标题展示方式。

该标题由已有的提示词润色 LLM 调用一并生成，不增加额外模型请求。它将逐步用于：

1. 右侧详情的 `studio-detail-title`；
2. 画布顶部图片/视频 Tab 的 `studio-canvas-label-text`；
3. 中间顶部的会话标题；
4. 左侧 Studio 会话选择栏的显示标题。

## 标题语义

### 生成结果标题：`detailTitle`

`detailTitle` 是**单个生成结果**的短标题，不是完整提示词，也不是会话标题。

规则：

- 使用中文，建议 4–12 个字，最多 16 个字；
- 只概括主体、核心画面或核心动作；
- 不包含模型、比例、数量、时长、质量、工具等参数；
- 不使用“生成一张”“帮你制作”“画面描述”等动作或解释性文字；
- 不使用句号、引号或 Markdown；
- 图片示例：`雨中木屋`、`晨雾山谷`；
- 视频示例：`海边奔跑`、`咖啡馆镜头推进`。

### 会话标题

会话标题只取**第一轮生成结果**的 `detailTitle`：

```text
Session.title = 第一轮生成的 detailTitle
```

后续继续生成、再次生成、图生视频、编辑操作均不覆盖会话标题。这样左侧栏与中间顶部标题稳定地代表一段会话，而不是不断随最新结果改变。

用户手动重命名优先级最高。唯一需要防范的竞态是：第一轮 LLM 尚未返回 `detailTitle` 时，用户已经主动修改了临时会话标题。此时不得用 LLM 标题覆盖用户输入。

## 当前实现与问题

| 展示位置 | 当前来源 | 问题 |
|---|---|---|
| `studio-detail-title` | `buildStudioDisplayPrompt(result.prompt)` | `result.prompt` 是完整有效提示词，通常较长 |
| 画布 Tab | `canvasTabLabels`，由 `extractKeywords(result.prompt)` 初始化 | Tab 名称依旧来自完整提示词，且写入本地状态后不会随 LLM 结果自动更新 |
| 中间顶部 | `Session.title`，无值时回退 `result.prompt` | 未使用生成结果短标题 |
| 左侧会话栏 | `Session.title` | 只读取 session 列表，无法直接读取 generation result |

关键文件：

- `packages/opencode/src/studio/studio-service.ts`
- `packages/app/octoapp/pages/studio/types.ts`
- `packages/app/octoapp/pages/studio/turns.ts`
- `packages/app/octoapp/pages/studio/studio-conversation.tsx`
- `packages/app/octoapp/pages/studio-page.tsx`
- `packages/app/octoapp/pages/studio/studio-history.tsx`

## 数据模型

### 1. 新增生成结果字段

在前端与服务端的 `StudioGenerationResult` 中新增：

```ts
detailTitle?: string
```

字段职责与现有字段保持区分：

| 字段 | 语义 |
|---|---|
| `prompt` | 实际提交给生成模型的有效提示词，可能经过 LLM 润色 |
| `detailPrompt` | 右侧“提示词”区块展示的文本：用户原始输入或无输入视频时的默认气泡文案 |
| `detailTitle` | 当前生成结果的简短标题 |
| `displayPrompt` | 对话气泡的操作标签，例如“再次生成” |
| `Session.title` | 会话稳定标题，仅由第一轮 `detailTitle` 自动设置或由用户手动修改 |

### 2. 第一轮会话标题更新控制字段

在首次创建会话的生成请求中增加仅用于标题同步的请求字段：

```ts
initialSessionTitle?: string
shouldSetSessionTitle?: boolean
```

含义：

- `initialSessionTitle`：前端创建 session 时写入的临时标题；
- `shouldSetSessionTitle`：仅第一轮创建会话的生成任务为 `true`；
- 服务端在 LLM 返回 `detailTitle` 后，仅当 session 当前标题为空或仍等于 `initialSessionTitle` 时，才用 `detailTitle` 更新 `Session.title`。

这样无需引入长期 `titleSource` 字段，也能避免用户在第一轮生成中手动改名后被自动覆盖。

## 分步实施代办

以下任务应按顺序执行。每一步完成后都可独立验证；未完成下一步前不影响已有展示。

### 阶段 1：在 LLM 润色结果中生成并持久化 `detailTitle`

#### 1.1 扩展服务端 LLM 输出模型

文件：`packages/opencode/src/studio/studio-service.ts`

修改：

1. 在 `StudioPromptRefineResult` 增加 `detailTitle?: string`。
2. 在 `promptRefineSchema` 增加 `detailTitle` 校验。
3. 在 `IMAGE_PROMPT_REFINE_SYSTEM` 与 `VIDEO_PROMPT_REFINE_SYSTEM` 中：
   - 将输出目标从 `assistantText`、`refinedPrompt` 扩展为三项；
   - 加入标题长度、内容和禁止项规则；
   - 明确 JSON 输出字段为 `assistantText`、`refinedPrompt`、`detailTitle`；
   - 增加一组简短示例，降低模型把完整 prompt 填入标题的概率。
4. 在 `completePromptRefineResult` 中保留校验后的 `detailTitle`。

建议 `detailTitle` 在 schema 中保持可选：若模型偶尔漏掉标题，仍可保留已成功的提示词润色结果，并走前端/服务端兜底，而不是令整个润色流程失败。

#### 1.2 为非 LLM 流程提供确定性兜底标题

文件：`packages/opencode/src/studio/studio-service.ts`

现有下列路径不会调用 LLM：

- 图生视频或带参考图的生成（prompt passthrough）；
- 编辑能力；
- LLM 不可用或润色失败的 fallback；
- 再次生成（通常使用已恢复的有效提示词并跳过润色）。

修改：新增一个纯函数，例如 `fallbackDetailTitle(input)`：

1. 优先使用 `input.detailPrompt`；
2. 再使用 `input.prompt`；
3. 取第一行，清理空白与常见标点；
4. 截断至 16 个中文字符等效长度；
5. 为空时按 capability 返回稳定默认值，例如“图片创作”或“视频创作”。

让 `submittingPromptRefine`、`promptPassthroughRefine` 与 `promptRefineFallback` 都返回 `detailTitle`。这样结果从创建、进行中到完成都具有标题。

#### 1.3 持久化到生成任务与会话 tool input

文件：`packages/opencode/src/studio/studio-service.ts`

修改：

1. 在 `StudioGenerationRequest`、`StudioGenerationPromptInput` 和服务端 `StudioGenerationResult` 增加 `detailTitle?: string`。
2. 在 `studioToolInput()` 中写入 `detailTitle`。这是会话恢复的必要步骤，遗漏后刷新页面会丢失标题。
3. 在 `generationSnapshot()` 返回 `detailTitle`，使创建、轮询接口可立即返回该字段。
4. `runGenerationCreatePipeline()` 合并 LLM refine 结果时保留 `detailTitle`。
5. `displayInput()` 合并 provider task input 时不得覆盖或丢弃 `detailTitle`。

#### 1.4 扩展 API 与 SDK

文件：

- `packages/opencode/src/server/routes/instance/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

修改：在 generation request/result schema 与 HTTP API handler 中传递 `detailTitle`。

完成服务端 schema 修改后，执行：

```bash
./packages/sdk/js/script/build.ts
```

预期更新：

- `packages/sdk/js/src/v2/gen/sdk.gen.ts`
- `packages/sdk/js/src/v2/gen/types.gen.ts`

### 阶段 2：前端恢复、再次生成与右侧详情接入

#### 2.1 扩展前端结果类型和会话恢复

文件：

- `packages/app/octoapp/pages/studio/types.ts`
- `packages/app/octoapp/pages/studio/turns.ts`

修改：

1. 在前端 `StudioGenerationResult` 新增 `detailTitle?: string`。
2. `buildResult()` 从 tool input 读取 `detailTitle` 并写入成功、进行中、失败三种 result 分支。
3. 历史会话没有 `detailTitle` 时，不尝试用 `displayPrompt`（尤其不能显示“再次生成”）作为标题；回退到当前的 `buildStudioDisplayPrompt(result.prompt)`。

#### 2.2 首次生成、pending、轮询和再次生成

文件：`packages/app/octoapp/pages/studio-page.tsx`

修改：

1. 扩展 `StudioGenerationOverrides` 与 `createStudioGeneration()` 入参，传递 `detailTitle`。
2. `setPendingResult()`、创建响应合并、轮询响应合并中保留客户端已有的 `detailTitle`。
3. `restoreGenerationInput(result)` 中传递 `detailTitle: result.detailTitle`。
4. 再次生成时优先继承来源 `detailTitle`；不让“再次生成”成为标题，也不重新请求 LLM 生成新标题。
5. 若 LLM 完成后刷新了会话消息，使用服务端 tool input 中的最终 `detailTitle` 替换 pending 兜底标题。

#### 2.3 右侧详情标题

文件：`packages/app/octoapp/pages/studio/studio-conversation.tsx`

当前：

```tsx
<div class="studio-detail-title">{buildStudioDisplayPrompt(props.result.prompt)}</div>
```

改为：

```tsx
<div class="studio-detail-title">
  {props.result.detailTitle ?? buildStudioDisplayPrompt(props.result.prompt)}
</div>
```

`studio-detail-copy` 继续显示完整有效 prompt；`studio-detail-prompt` 继续使用已经落地的 `detailPrompt`，两者不受本任务影响。

### 阶段 3：画布 Tab 接入 `detailTitle`

文件：`packages/app/octoapp/pages/studio-page.tsx`

当前画布 Tab 的文本由 `canvasTabLabels` 维护，多个写入点直接调用：

```ts
extractKeywords(result.prompt)
```

涉及位置包括：

- canvas 首图自动加入 Tab；
- 从对话/文件管理选择结果；
- 多图切换时更新序号；
- 右侧详情点击缩略图时创建或更新 Tab。

修改：

1. 新增单一 helper，例如 `canvasTabBaseLabel(result)`：

   ```ts
   return result.detailTitle ?? extractKeywords(result.prompt)
   ```

2. 将所有 `extractKeywords(result.prompt)` / `extractKeywords(r.prompt)` 的 Tab 标签写入点替换为该 helper。
3. 多图结果保持现有规则：`{detailTitle}-1`、`{detailTitle}-2`。
4. 新增 effect：当一个已加入 Tab 的 result 从兜底标题更新为 LLM `detailTitle` 时，刷新该 result 对应的 `canvasTabLabels`。否则 Tab 在生成开始阶段写入旧 prompt 后，不会自动变成新标题。
5. 不修改用户下载文件名的语义，除非后续另行决定。`currentImageLabel()` 当前复用 `canvasTabLabels` 生成文件名，若 Tab 改为 `detailTitle`，下载文件名会自然同步改变；此影响应在实施时确认。

### 阶段 4：第一轮 `detailTitle` 同步会话标题

#### 4.1 创建会话时记录临时标题

文件：`packages/app/octoapp/pages/studio-page.tsx`

当前首次生成会通过 `createStudioSession(text)` 创建 session，并使用用户输入的首行作为标题。

修改：

1. 继续保持这个临时标题，避免 LLM 处理中显示空会话名。
2. 当本次 `runGeneration()` 创建了新 session 时，向生成请求附带：

   ```ts
   initialSessionTitle: buildStudioDisplayPrompt(text)
   shouldSetSessionTitle: true
   ```

3. 对已有 session 的后续生成、再次生成、编辑操作不传 `shouldSetSessionTitle`。

需要特别处理 session 创建后才得到 `sessionID` 的现有异步流程：在构造 `createStudioGeneration()` 请求时根据 `existingSession` 决定是否传递上述字段。

#### 4.2 服务端在第一轮 LLM 完成后安全更新 `Session.title`

文件：`packages/opencode/src/studio/studio-service.ts`

修改：

1. 扩展 `StudioGenerationRequest` 与 API payload，支持：

   ```ts
   initialSessionTitle?: string
   shouldSetSessionTitle?: boolean
   ```

2. 在 `runGenerationCreatePipeline()` 获得最终 `promptRefine.detailTitle` 后执行标题同步。
3. 仅当以下条件都成立时更新 `Session.title`：

   ```text
   request.shouldSetSessionTitle === true
   AND detailTitle 非空
   AND (session.title 为空 OR session.title === request.initialSessionTitle)
   ```

4. 若 session.title 与 `initialSessionTitle` 不相等，视为用户已在生成期间手动改名，跳过自动更新。
5. 更新后发送既有的 session update 事件，使客户端同步 store 和左侧历史栏自动刷新。

注意：不要在 `generationSnapshot()`、轮询或每次成功生成时都更新 `Session.title`；这会让多轮会话标题跳变。

#### 4.3 中间顶部会话标题

文件：`packages/app/octoapp/pages/studio-page.tsx`

`currentTitle()` 已优先读取 `activeStudioSession().title`，因此阶段 4.2 完成后，中间顶部会话标题会自动显示第一轮 `detailTitle`。

只需将无 session title 的回退顺序调整为：

```text
Session.title
→ 当前 result.detailTitle
→ buildStudioDisplayPrompt(result.prompt)
→ 当前 userText
→ "Octo Studio"
```

该调整覆盖 session 更新事件尚未抵达客户端的短暂窗口。

#### 4.4 左侧 Studio 会话选择栏

文件：`packages/app/octoapp/pages/studio/studio-history.tsx`

左侧栏的标题由 `session.list()` 返回的 `Session.title` 渲染。因此阶段 4.2 后无需为列表加载 generation result。

修改范围：

- 保持现有 `sessionTitle(session.title)` 渲染；
- 保持现有 session update 事件触发的 `refetch()`；
- 验证第一轮 LLM 完成后列表会在事件去抖后显示 `detailTitle`；
- 保持右键重命名行为，且确保重命名后的标题不会再被后续生成覆盖。

## 非目标

- 不改变 `studio-detail-copy`：它继续显示完整有效 prompt。
- 不改变 `studio-detail-prompt`：它继续显示 `detailPrompt` 所代表的用户原始输入或无输入视频默认文案。
- 不让每轮生成都重命名整个会话。
- 不为图生视频或带参考图任务额外新增一次 LLM 调用，只为其提供确定性兜底标题。
- 不修改普通聊天、非 Studio session 的标题逻辑。

## 测试与验收

### 单元测试

1. LLM JSON 同时含 `assistantText`、`refinedPrompt`、`detailTitle` 时，三项均被解析与持久化。
2. LLM 返回缺失 `detailTitle` 时，润色仍成功并使用确定性兜底标题。
3. 图生视频 passthrough 不调用 LLM，但生成稳定的 fallback `detailTitle`。
4. 再次生成继承来源 `detailTitle`，不产生“再次生成”标题。
5. `buildStudioTurns()` 从 tool input 恢复 `detailTitle`。
6. 旧历史任务没有 `detailTitle` 时回退到 prompt 摘要。
7. 仅第一轮请求带 `shouldSetSessionTitle` 时，服务端更新 Session.title。
8. 第一轮生成期间用户重命名后，服务端检测到 `session.title !== initialSessionTitle`，不覆盖。
9. 后续生成即使得到新的 `detailTitle`，也不更新 `Session.title`。

### UI 验收

1. 右侧 `studio-detail-title` 显示短标题，而非完整润色提示词。
2. 画布 Tab 在 LLM 返回后显示短标题；多图保持正确序号。
3. 新建会话生成中显示临时标题，完成后切换为第一轮短标题。
4. 左侧会话栏与中间顶部显示同一个第一轮短标题。
5. 手动重命名后，刷新、再次生成、后续生成均保留用户标题。
6. 图生视频无用户文本、图生视频有用户文本、文生视频、图片生成和编辑操作均有符合本方案的标题/回退行为。

### 验证命令

在对应包目录执行：

```bash
cd packages/app
bun test --preload ./happydom.ts ./octoapp/pages/studio/turns.test.ts
bun typecheck

cd ../opencode
bun typecheck
```

服务端 HTTP API schema 变更后还应执行：

```bash
./packages/sdk/js/script/build.ts
```
