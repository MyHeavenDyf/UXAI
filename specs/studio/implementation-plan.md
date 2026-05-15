# Octo Studio UI 刷新实现分析与步骤

## 任务边界

本阶段只做分析和实施步骤整理，不修改 `packages/app/octoapp/pages/studio.tsx` 的具体实现代码。

目标是把现有 Studio 页面刷新为 `/Users/ljc/Downloads/lsc_studio` 目录下参考图的效果，并在 `packages/app/octoapp/pages` 下新建 `studio` 目录承载 Studio 页面内容。

图片生成能力需要接入 opencode tool：

```txt
/Users/ljc/Documents/workspace/agent/tool/jimeng_demo_image_generate.ts
```

## 参考图结论

参考图尺寸均为 `2160 x 1403`，覆盖了 Studio 的完整桌面态流程：

- `1.png`：空态主界面。左侧历史栏，中间 Studio 能力介绍与底部输入框，右侧结果空态。
- `2.png`：能力类型下拉。包含图片生成、视频生成、变清晰、抠图、局部重绘、扩图、场景融合等能力。
- `3.png`：空态默认输入框。
- `4.png`：风格模型选择弹层。以图片网格形式展示千问、BDIcon、质感人像、开发者人物形象、小艺 agent、智慧 3D、抽象几何背景、云宝、HDesign、鸿蒙插画、3D 抽象元素等。
- `5.png`：图片设置弹层。包含比例选择和生成张数选择。
- `6.png`：输入框默认态。
- `7.png`：用户输入后的输入框态。
- `8.png`：会话生成中。中栏显示用户需求、生成方案文本和生成中的图片卡片，右侧结果区显示加载动画。
- `9.png`：生成结果查看。左栏历史选中，中栏显示图片生成卡片，右侧大图预览和详情侧栏。
- `修图-扩图1.png` 到 `修图-扩图4.png`：扩图编辑弹层流程。右侧结果区进入黑色编辑画布，底部有比例、提示词、删除和一键生成操作。

整体视觉关键词：

- macOS 风格窗口外壳，顶部保留 Chat/Cowork/Studio 分段切换、Assets Hub 搜索、用户头像。
- 内容区为四段式：历史侧栏、对话/创作栏、结果画布、结果详情栏。
- 主色从当前蓝色品牌延展到蓝紫/洋红渐变，发送按钮和关键 CTA 使用紫粉渐变。
- 大量使用白色、浅灰、浅蓝半透明侧栏、轻投影、圆角面板。
- Studio 空态突出一个玻璃质感球体或 Octo 标识。

## 当前代码现状

入口文件：

```txt
packages/app/octoapp/pages/studio.tsx
```

当前 `studio.tsx` 把以下职责写在同一个文件里：

- 路由参数、目录 slug、session 创建和跳转。
- `DataProvider` 数据存储、消息加载、事件监听、part delta 拼接。
- 输入框、附件上传、拖拽上传、发送消息。
- 三栏布局：`Sidebar`、可拖拽聊天栏、`ResultViewer`。
- Studio 空态和结果空态。

复用组件来自 Cowork：

- `AttachmentBar`
- `InsightTurn`
- `ResultViewer`
- `createTabStore`
- `octo-tokens.css`

当前路由位置：

```txt
packages/app/octoapp/app.tsx
packages/app/octoapp/octo.tsx
```

二者都使用：

```ts
const StudioPage = lazy(() => import("@/pages/studio"))
```

后续新建 `packages/app/octoapp/pages/studio/index.tsx` 后，需要确认 bundler 对同名 `studio.tsx` 和 `studio/index.tsx` 的解析优先级。为避免歧义，推荐在实现阶段把路由 import 显式改为 `@/pages/studio/index`，或者完成迁移后删除/改名旧 `studio.tsx`。

## 建议目录结构

在 `packages/app/octoapp/pages/studio` 下组织新页面，避免继续扩大单文件：

```txt
packages/app/octoapp/pages/studio/
  index.tsx
  studio.css
  data.ts
  types.ts
  components/
    studio-shell.tsx
    studio-history-sidebar.tsx
    studio-empty-state.tsx
    studio-composer.tsx
    studio-capability-menu.tsx
    studio-style-menu.tsx
    studio-image-settings.tsx
    studio-turn.tsx
    studio-result-viewer.tsx
    studio-result-sidebar.tsx
    studio-expand-editor.tsx
  hooks/
    use-studio-session.ts
    use-studio-composer.ts
    use-studio-generation.ts
```

说明：

- `index.tsx`：只负责页面装配、provider 和路由级状态。
- `use-studio-session.ts`：迁移当前 session message/part/status 订阅逻辑。
- `studio-composer.tsx`：承载底部输入框、附件、能力、风格、设置、发送按钮。
- `studio-result-viewer.tsx`：承载空态、生成中、大图预览、底部下载/收藏/重生成功能。
- `studio-result-sidebar.tsx`：承载缩略图、生成信息、提示词、再次生成和编辑能力入口。
- `studio-expand-editor.tsx`：承载扩图弹层/编辑画布。
- `data.ts`：放能力列表、风格模型列表、比例列表、默认历史文案等静态数据。
- `types.ts`：放 Studio 专用类型，避免复用 Cowork 的结果卡片类型时语义混乱。

## 实施步骤

### 1. 建立 Studio 新目录和入口

1. 新建 `packages/app/octoapp/pages/studio/index.tsx`。
2. 暂时从旧 `studio.tsx` 迁移现有行为，确保不改变路由功能。
3. 新建 `studio.css`，只放 Studio 页面专属视觉样式。
4. 在 `app.tsx` 与 `octo.tsx` 中将 Studio lazy import 指向 `@/pages/studio/index`。
5. 保留旧 `studio.tsx` 到迁移完成后再移除，避免中途破坏页面。

### 2. 拆出数据与会话逻辑

1. 把 `DataStore`、`SKIP_PART_TYPES`、消息加载、事件监听迁入 `use-studio-session.ts`。
2. 保留现有 `DataProvider` 契约，继续让下游组件可以读取 session/message/part。
3. 把 `createAndNavigate`、`sendMessage`、`handleSubmit` 拆成 hook 返回值，供 composer 调用。
4. 减少 UI 组件里的 SDK 依赖，让页面装配层负责传入状态和动作。

### 3. 重做页面布局

按照参考图拆成四个区域：

1. 左侧历史侧栏：保留现有 `Sidebar` 数据能力，但需要定制成参考图的浅蓝背景、历史分组、选中态和底部设置。
2. 中间创作栏：固定宽度约 `468px`，顶部显示会话标题，内容为消息/生成方案流，底部悬浮 composer。
3. 主结果画布：空态显示玻璃球体和 `Octo Studio`；生成中显示居中加载动画；结果态显示图片大图。
4. 右侧详情栏：结果态才显示，包含缩略图组、描述、生成信息、提示词、再次生成、变清晰/抠图/局部重绘/扩图按钮、风格标签。

实现时需要保留聊天栏和结果栏之间的拖拽分隔能力，但参考图中视觉上是细边线，不再强调宽分隔条。

### 4. 重做空态

空态需要替换当前简单圆形占位：

- 中间创作栏：顶部 Octo 图标，标题 `Octo Studio`，副标题 `专项能力矩阵`，四项能力：图片生成、视频生成、变清晰、局部重绘。
- 主结果区：玻璃质感球体，标题 `Octo Studio`，文案 `输入你的想法，创意无限可能`。
- 玻璃球建议优先用 CSS 渐变和滤镜实现；如需要更接近参考图，可用 Jimeng 或本地静态图片生成一个透明背景素材。

### 5. 重做 Composer

Composer 是视觉刷新重点：

- 输入卡片为白底，蓝紫描边，外层紫粉光晕。
- 左上角是上传参考图入口，默认展示倾斜的小卡片和 `+`。
- 输入 placeholder：`上传参考图、输入文字，描述你想生成的图片。`
- 底部按钮组包括：
  - 能力类型下拉。
  - 风格模型下拉。
  - 图片设置按钮。
  - 附件/素材按钮。
  - 右侧紫粉渐变圆形发送按钮。
- 输入态需要支持多行文案，参考图中输入后卡片高度保持稳定。

能力类型下拉数据：

- 图片生成
- 视频生成
- 变清晰
- 抠图
- 局部重绘
- 扩图
- 场景融合

风格模型弹层数据：

- 千问
- BDIcon
- 质感人像
- 开发者人物形象
- 小艺 agent
- 智慧 3D
- 抽象几何背景
- 云宝
- HDesign
- 鸿蒙插画
- 3D 抽象元素

图片设置：

- 比例：`1:1`、`2:3`、`3:4`、`9:16`、`3:2`、`4:3`、`16:9`
- 张数：`1张`、`2张`、`3张`、`4张`

### 6. 接入 Jimeng 图片生成 tool

工具文件说明：

```txt
/Users/ljc/Documents/workspace/agent/tool/jimeng_demo_image_generate.ts
```

该 tool 的核心参数：

- `prompt`：完整图片提示词。
- `reqKey`：默认 `jimeng_t2i_v40`。
- `scale`：默认 `0.5`。
- `primaryImage` / `referenceImages`：用于续作或编辑。
- `editReqKey`：带参考图时的编辑模型 key。
- `extraBody`：透传扩展字段。
- `maxRetries` / `timeoutMs`：重试与超时。

实现建议：

1. 先在 Studio UI 内维护结构化请求状态：能力类型、风格模型、比例、张数、附件、用户 prompt。
2. 在发送前把 UI 状态组装成更完整的中文 prompt，例如：用户描述 + 风格模型 + 比例 + 张数 + 参考图说明。
3. 图片比例和张数如 Jimeng 接口需要特定字段，放入 `extraBody`，不要硬编码到 UI 组件中。
4. 生成返回后解析 `images`、`primaryImage`，写入 Studio 专用结果卡片。
5. 结果详情栏使用首图作为主图，全部图片作为缩略图。
6. 对扩图、变清晰、抠图、局部重绘使用 `primaryImage` 或 `referenceImages` 发起编辑请求。

需要进一步确认：

- opencode app 当前前端是否能直接调用这个 tool，还是必须通过 session prompt 让 agent/tool 层执行。
- Jimeng 返回结果是否会作为 assistant text part、tool result part，或需要新增专门事件解析。
- 图片 URL 是否需要本地缓存，避免远端 URL 过期或跨域。

### 7. 重做生成流和结果卡片

参考图中的生成流程不是普通 Markdown 结果，而是 Studio 专用图片生成卡片：

1. 用户输入后，中栏顶部显示用户粉色气泡。
2. Assistant 文本先给出 4 个候选方案。
3. 出现 `图片生成` 类型卡片，生成中为紫色骨架。
4. 生成完成后卡片显示标题、创建时间和 4 张缩略图。
5. 点击缩略图或卡片后，右侧结果区进入大图预览。

实现建议新建 Studio 专用 `StudioTurn`，不要直接扩展 Cowork 的 `InsightTurn`：

- Cowork 的 `InsightTurn` 面向表格、Markdown、JSON、Mermaid。
- Studio 需要识别图片生成结果、编辑结果、缩略图、多图状态、选中图、重新生成。

### 8. 重做结果查看区

结果态应包含：

- 顶部 tab chip：如 `户外骑行图片.png` 和关闭按钮。
- 中央主图，保持图片比例居中，不拉伸。
- 底部浮动操作：收藏、重试/刷新、下载。
- 右侧详情栏：
  - 4 张缩略图。
  - 图片标题和描述。
  - 生成信息：模型、比例、分辨率。
  - 提示词。
  - 紫粉渐变 `再次生成`。
  - 编辑能力按钮：变清晰、抠图、局部重绘、扩图。
  - 风格标签。

### 9. 扩图编辑弹层

扩图参考图显示为结果区内的黑色编辑工作台：

- 左侧历史和中间对话栏仍可见。
- 右侧结果区域变为黑色画布。
- 顶部显示 `扩图`、说明文案和关闭按钮。
- 中央显示待扩图图片。
- 底部浮动控制条包含比例、提示词输入、删除、一键生成。

实现建议：

1. 在 `studio-result-viewer.tsx` 中以 `mode` 控制 `preview | expandEditor`。
2. 扩图生成调用 Jimeng 编辑能力，传入当前图片 URL 作为 `primaryImage`。
3. 生成完成后退出编辑模式或追加一个新的编辑结果 tab。

### 10. 样式与资产策略

- 图标优先使用已有 icon 系统或 lucide 图标；若项目内已有图标组件，跟随项目模式。
- 风格模型缩略图可以先使用静态占位图或参考图中已有素材；最终如需生成新素材，再使用 Jimeng tool。
- 避免把大段内联 style 继续堆在组件里，Studio 专属视觉统一放到 `studio.css`。
- 保留 `octo-tokens.css` 中已有 token，但补充 Studio 自身变量，例如：
  - `--studio-accent`
  - `--studio-accent-2`
  - `--studio-panel`
  - `--studio-sidebar`
  - `--studio-glow`

### 11. 验证计划

实现阶段建议验证：

1. 从 `packages/opencode` 或对应包目录运行 `bun typecheck`，不要在 repo root 运行。
2. 启动 octoapp dev server，打开 Studio 路由。
3. 对比以下状态截图：
   - 空态。
   - 能力下拉。
   - 风格模型弹层。
   - 图片设置弹层。
   - 输入后 composer。
   - 生成中。
   - 生成完成结果预览。
   - 扩图编辑模式。
4. 检查布局在较窄桌面宽度下不重叠，尤其是 composer、右侧详情栏和大图预览。
5. 生成 tool 网络失败时，UI 应显示可重试状态，而不是卡死在生成中。

## 风险点

- `@/pages/studio` 既有文件和新目录同名，模块解析可能不按预期，需要显式 import 或迁移后删除旧文件。
- 当前 `Sidebar` 会按 session 展示历史，但参考图历史文案更像 Studio 专属任务列表，可能需要定制历史项渲染。
- 当前 `InsightTurn` 不适合图片生成结果，需要新增 Studio 专用结果模型。
- Jimeng tool 默认返回远端 URL，下载、预览、再次编辑都依赖 URL 可访问性。
- 扩图、抠图、局部重绘的具体 `req_key` 和 `extraBody` 字段需要后续根据 Jimeng API 真实参数确认。

## 推荐实施顺序

1. 迁移目录结构，保证旧行为不变。
2. 拆出 session/composer/result hooks 和组件。
3. 完成空态和 composer 视觉。
4. 完成菜单和图片设置弹层。
5. 实现 Studio 专用生成卡片和结果预览。
6. 接入 Jimeng tool 的生成结果解析。
7. 实现右侧详情栏和再次生成。
8. 实现扩图编辑模式。
9. 做视觉截图比对和 typecheck。
