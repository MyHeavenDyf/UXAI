# `dev_ljc` 分支改动总览

本文档汇总 `dev_ljc` 分支相对 `dev` 的主要改动，覆盖 Studio 页面、生图工具、后端服务、路由接入和相关验证。

## 分支概览

- 分支：`dev_ljc`
- 基础方向：围绕 Studio 独立工作台和图片生成链路重构
- 当前状态：分支上已有一批提交，工作区还保留少量未提交调整

## 1. Studio 页面重构

### 1.1 Studio 独立化

- Studio 从原先依附于 Cowork / opencode 的实现，演进为独立的创作工作台。
- 页面保留三栏结构，但业务数据、会话模型和结果展示都按 Studio 自身语义组织。
- 入口从旧的单文件页面，逐步迁移到 `packages/app/octoapp/pages/studio/index.tsx`。

### 1.2 页面结构拆分

- 新增并拆分了 Studio 相关模块：
  - `data.ts`
  - `types.ts`
  - `turns.ts`
  - `turns.test.ts`
  - `studio.css`
- 页面逻辑从单体组件中拆出，降低了后续扩展成本。

### 1.3 多轮对话

- `studio-center` 支持多轮会话展示。
- 早期轮次不会被后续消息覆盖。
- 对话构建逻辑增加了排序和轮次重建，避免乱序或增量更新导致历史丢失。

### 1.4 历史记录与新建对话

- Studio 左侧历史记录能够展示之前的生成会话。
- “新建对话”按钮已恢复可用。
- 新会话创建后，页面会自动滚动到最新对话区域。

### 1.5 假数据清理

- 之前界面里出现过“骑行图片”“户外骑行图片.png ×”这类假数据，已经逐步替换成真实数据源。
- 同类假数据入口也做了排查，避免历史内容和 UI 占位混淆。

## 2. 图片生成能力改造

### 2.1 两个 builtin tool

分支里新增并注册了两个生图工具：

- `jimeng_image_generate`
- `internel_image_generate`

两者都进入了 builtin tool 体系，不再只是外部挂钩或临时能力。

### 2.2 `studio-composer` 里的工具切换

- Studio 生成区新增了图片工具切换选项。
- 用户可以在 `jimeng` 和 `internel` 之间切换。
- 页面会根据当前选择，把对应 tool 传给生成链路。

### 2.3 即梦生图链路

- `jimeng_image_generate` 负责调用即梦生成接口。
- 工具会打印请求和响应摘要，方便定位任务失败、返回空图、base64 截断等问题。
- 处理逻辑补齐了：
  - base64 图片输出
  - attachments 输出
  - 图片 URL 过滤
  - 多轮摘要拼接

### 2.4 内部生图链路

- `internel_image_generate` 改造成只依赖内部任务创建 / 查询接口：
  - `DEFAULT_CREATE_TASK_URL`
  - `DEFAULT_QUERY_TASK_BASE_URL`
- 不再包含即梦的 V4 签名和 `visual.volcengineapi.com` 调用逻辑。
- 这个 tool 更接近参考实现 `tool/Internal_image_generate.ts` 的内部任务模式。

### 2.5 图片结果显示修正

- 修正了前端误把请求 URL 当成图片的问题。
- 修正了即梦返回 base64 后，文本输出被截断导致图片不显示的问题。
- 现在图片优先从 tool attachments 中读取，再回退到其他解析路径。

### 2.6 连贯生成

- 后续生成会参考前一轮摘要，把上一轮生成细节带进新的 prompt。
- 这样第二轮图片更容易保持主题、构图和风格连续性。

## 3. 后端服务与路由

### 3.1 Studio service

- 新增 `packages/opencode/src/studio/studio-service.ts`
- 负责封装 Studio 的生成流程，调用对应图片 provider / tool，并返回统一结果结构。

### 3.2 图片 provider 抽象

- 新增 `packages/opencode/src/studio/image-provider.ts`
- 抽象出 `ImageGenerateInput`、`ImageGenerateOutput` 和 provider 接口。
- Studio 页面不再直接依赖具体生成实现。

### 3.3 HTTP API

- 新增 Studio HTTP API 和相关路由：
  - `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
  - `packages/opencode/src/server/routes/instance/studio.ts`
- 现在 Studio 生成有了清晰的服务入口，而不是只挂在 agent tool 上。

### 3.4 Agent prompt

- `packages/opencode/src/agent/prompt/studio.txt` 已更新。
- Studio agent 会根据当前选择的工具，优先走对应的 image generation tool。

## 4. 注册与运行时接入

### 4.1 Tool registry

- `packages/opencode/src/tool/registry.ts` 注册了两个新的 builtin image tools。
- Studio 运行时可以直接拿到这两个 tool，而不是临时 plugin 方式。

### 4.2 Agent / config / desktop 相关接入

分支里还包含一批支撑性改动，用于让 Studio 路由、页面入口和桌面壳子正常工作：

- `packages/app/octoapp/app.tsx`
- `packages/app/octoapp/octo.tsx`
- `packages/app/octoapp/components/sidebar.tsx`
- `packages/app/octoapp/pages/cowork/index.tsx`
- `packages/desktop/electron-builder.config.ts`
- `packages/desktop/electron.vite.config.ts`
- `packages/desktop/electron.vite.config.1778817183299.mjs`
- `packages/opencode/script/generate.ts`
- `packages/opencode/src/agent/agent.ts`

这些改动主要是为了保证 Studio 页面和新的 tool / API 在桌面端和运行时中都能正常挂上。

## 5. 文档与设计产物

分支里同步补了两份 Studio 设计文档：

- `specs/studio/technical-design.md`
- `specs/studio/implementation-plan.md`

它们分别描述了：

- Studio 的技术架构和分层思路
- 页面布局、组件拆分和实施步骤

## 6. 测试与验证

这几轮改动中曾执行并通过的验证包括：

- `packages/app` 下的 `bun typecheck`
- `packages/app` 下的 `bun test --preload ./happydom.ts ./octoapp/pages/studio/turns.test.ts`
- `packages/opencode` 下的 `bun typecheck`
- `packages/opencode` 下的 `bun script/build-node.ts`

此外，针对 Studio 会话构建、图片解析、attachments、工具选择等行为补了回归测试。

## 7. 当前需要注意的点

- `packages/opencode/src/tool/jimeng_image_generate.ts` 和 `packages/opencode/src/tool/internel_image_generate.ts` 目前仍保留默认密钥 / 默认参数，以保证本地开发环境能直接跑通。
- 这些默认值对远端推送可能触发 GitHub push protection，后续如果要长期维护，建议单独规划环境变量方案。
- 当前工作区还有少量未提交修改，主要集中在图片生成工具的最近调整上。

## 8. 关键文件清单

以下文件是这次分支改动的核心落点：

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

