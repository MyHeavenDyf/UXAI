# Studio 近期修改说明

本文档整理了最近几轮围绕 Studio 和生图链路的修改，方便后续回顾、提 PR 或交接。

## 1. Studio 页面能力调整

### 1.1 Studio 变成独立工作台

- Studio 从原先依附于 Cowork / opencode 的表现层，逐步改造成独立工作台。
- 页面不再只依赖单次会话结果，而是以 Studio 自己的会话与创作数据为主。
- 左侧历史、中央对话、右侧结果区的结构保留下来，同时强化了 Studio 自身的业务语义。

### 1.2 多轮对话支持

- `studio-center` 现在支持多轮对话记录展示。
- 之前只显示最新一轮或被后续轮次覆盖的问题已修正。
- 对话顺序会按会话消息重建，尽量保证前一轮不会被下一轮吞掉。

### 1.3 新建对话

- 修复了 Studio 页面中“新建对话”按钮无响应的问题。
- 新建后会进入新的会话上下文，并能继续保持历史记录可见。

### 1.4 自动滚动

- Studio 新对话或新消息出现后，界面会自动滚动到最新对话位置。
- 这样可以避免生成结果已经出来，但用户还停留在旧位置看不到的问题。

### 1.5 历史记录

- Studio 的历史记录现在会显示之前的生成对话。
- 不再只保留当前页临时内容，也不会把多轮创作历史遗漏掉。

### 1.6 假数据清理

- 之前界面里出现过“骑行图片”“户外骑行图片.png ×”这类假数据，占位内容已经逐步替换成真实会话与真实结果数据。
- 同时排查了其他类似假数据入口，尽量让页面展示来自实际对话和生成结果。

## 2. 生图工具与链路改造

### 2.1 新增 builtin 生图工具

- 新注册了 `internel_image_generate` 这个工具。
- 原来的 `jimeng_image_generate` 也继续作为 builtin tool 保留。
- 两个工具都从 opencode 侧收进了统一的 tool registry，不再只是外部挂钩式入口。

### 2.2 Studio 中可切换图片来源

- `studio-composer` 新增了图片生成来源切换选项。
- 现在可以在 `jimeng` 和 `internel` 之间切换。
- Studio 发起生成时，会根据选择的来源调用对应的 builtin tool。

### 2.3 生图工具输出方式修正

- 之前即梦返回的图片信息如果走文本输出，容易被截断，导致前端拿到不完整内容。
- 现在图片数据改为走 tool attachments，避免大 base64 被文本截断。
- Studio 端会优先从 attachments 读取图片，再回退到其他解析方式。

### 2.4 图片解析修正

- 修正了图片 URL 识别逻辑，避免把 `https://visual.volcengineapi.com?...` 这类请求地址误当成最终图片地址。
- 生图结果现在会优先识别真实的图片数据字段，必要时再解析 base64 / data URL。
- 同时补了回归测试，防止后续再次把调试 URL 当成图片。

### 2.5 连贯性支持

- 生图对话后续轮次会参考前一轮的生成细节，再拼进新的 prompt。
- 这样第二轮生成时能保持构图、风格和主体的一致性，减少“每轮都像新图”的割裂感。

## 3. 稳定性与调试信息

### 3.1 日志补全

- 给即梦相关调用补了请求和响应摘要日志。
- 关键参数、返回结果、错误信息都更容易排查。
- 这里重点是“能定位到是哪一步失败”，而不是只看到一个笼统的 `Not Found` / `BadRequest`。

### 3.2 错误排查

- 曾经出现过以下几类问题：
  - 图片结果显示空白。
  - 结果区误渲染了请求 URL。
  - 多轮对话第一轮丢失。
  - Studio 页面 `capability` 读取空值时报错。
- 这些问题都已经按链路逐个修正。

## 4. 配置与默认值

### 4.1 默认密钥恢复

- 之前为了尝试去掉硬编码默认值，曾移除 `DEFAULT_ACCESS_KEY` 和 `DEFAULT_SECRET_KEY`。
- 用户反馈本地代码因此无法运行，随后又恢复了这两个默认值。
- 这一点保证了本地开发环境仍然能直接跑通生图链路。

### 4.2 提醒

- 由于仓库里存在可识别的默认密钥字符串，后续如果继续推送到远端，可能再次触发 GitHub 的 push protection。
- 如果后面要长期保留这条链路，建议再单独规划环境变量方案。

## 5. 主要文件范围

这几轮修改主要集中在以下位置：

- `packages/app/octoapp/pages/studio/index.tsx`
- `packages/app/octoapp/pages/studio/turns.ts`
- `packages/app/octoapp/pages/studio/turns.test.ts`
- `packages/app/octoapp/pages/studio/types.ts`
- `packages/app/octoapp/pages/studio/data.ts`
- `packages/app/octoapp/pages/studio/studio.css`
- `packages/opencode/src/tool/jimeng_image_generate.ts`
- `packages/opencode/src/tool/internel_image_generate.ts`
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/studio/image-provider.ts`
- `packages/opencode/src/studio/studio-service.ts`
- `packages/opencode/src/agent/prompt/studio.txt`
- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
- `packages/opencode/src/server/routes/instance/studio.ts`

## 6. 已完成验证

曾经跑过并通过的验证包括：

- `packages/app` 下的 `bun typecheck`
- `packages/app` 下的 `bun test --preload ./happydom.ts ./octoapp/pages/studio/turns.test.ts`
- `packages/opencode` 下的 `bun typecheck`
- `packages/opencode` 下的 `bun script/build-node.ts`

## 7. 当前分支

- 当前工作分支：`dev_ljc`
- 相关修改已经在本地整理过，后续可以继续补充到该分支上。
