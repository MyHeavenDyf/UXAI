# Studio 页面总结

## 概述

Studio 是 OctoAI 的 AI 图像生成工作室页面，提供完整的图像生成、编辑功能。支持 7 种图像能力（生成、视频生成、放大、抠图、修复、扩展、融合），11 种风格模型，7 种宽高比。底层通过 SDK 与后端 AI 交互，实时展示生成进度和结果。

## 目录结构

```
pages/studio/
├── types.ts        # TypeScript 类型定义
├── data.ts         # 静态配置数据（能力、风格、工具、宽高比）
├── turns.ts        # 对话轮次构建与控制逻辑
├── turns.test.ts   # 单元测试
├── studio.css      # 样式文件
└── index.tsx       # 主页面组件（~1100 行）
```

## 文件详解

### 1. types.ts - 类型定义

| 类型 | 描述 |
|------|------|
| `StudioCapability` | 7 种图像能力联合类型 |
| `StudioAspectRatio` | 7 种宽高比 |
| `StudioImageTool` | 图像工具后端：`"jimeng"` / `"internel"` |
| `StudioGenerationStatus` | 生成生命周期：`idle` → `submitting` → `running` → `succeeded` / `failed` |
| `StudioGenerationRequest` | 前端发送的请求结构 |
| `StudioGenerationResult` | 后端返回的结果结构（含状态、图片、prompt、model、error） |
| `StudioAsset` | 用户上传的参考图片（id、name、mime、dataUrl） |
| `StudioMode` | UI 模式：`"preview"`（默认）/ `"outpaint"`（扩展编辑） |

### 2. data.ts - 静态配置

提供 UI 所需的所有选项数据：
- **7 种能力**：图像生成、视频生成、图像放大、智能抠图、局部重绘、图像扩展、图片融合
- **11 种风格模型**：每个带 CSS 渐变色标识
- **7 种宽高比**：`1:1`, `2:3`, `3:4`, `9:16`, `3:2`, `4:3`, `16:9`
- **2 种图像工具**：即梦(Jimeng)、Internel
- **辅助函数**：`capabilityLabel()`, `styleModelLabel()`, `imageToolLabel()` 用于中文标签查找

### 3. turns.ts - 对话轮次逻辑

核心模块，负责将 SDK 原始消息转换为 UI 可渲染的结构化轮次。

**主要导出：**

| 函数 | 描述 |
|------|------|
| `buildStudioTurns(input)` | 将消息/parts 配对打包为 `StudioTurnData[]`，提取 tool 结果中的图片 URL |
| `latestStudioTurn(input)` | 获取最新一轮对话 |
| `buildStudioTurnSummary(turn)` | 生成中文摘要（含用户需求、模型、比例、图片数） |
| `buildStudioConversationContext(input)` | 获取最后一轮完成的对话摘要作为上下文 |
| `buildStudioDisplayPrompt(text)` | 提取用户需求第一行作为显示文本 |

**内部图片提取逻辑：**
- 优先从 tool 结果的 attachments 取
- 其次解析 tool output JSON（`images` / `primaryImage` / `nested response` 字段）
- 最后递归扫描字符串/数组/对象中的 URL
- 过滤掉 Volcengine API 请求 URL（非图片链接）

### 4. turns.test.ts - 单元测试

覆盖核心场景：
- 多轮对话保持正确顺序和 `isLatest` 标记
- 乱序消息自动按时间排序
- 无消息时回退到 pending result
- 对话上下文摘要生成
- Internel 工具映射到正确的 provider
- 请求 URL 与真实图片 URL 的区分过滤
- 附件中的 base64 data URL 识别

### 5. studio.css - 样式

三栏布局的响应式样式：

| 区域 | 宽度 | 说明 |
|------|------|------|
| `.studio-left` | 300px（响应式 260px） | 左侧历史会话边栏，渐变背景 |
| `.studio-center` | 468px（响应式 420px） | 中间对话与输入区域 |
| `.studio-workspace` | flex-1 | 右侧工作区，含画布 + 详情 |
| `.studio-details` | 320px | 右侧详情面板，<1200px 时隐藏 |

特色样式：输入框紫色魔法光晕边框、渐变按钮、毛玻璃下拉菜单、加载动画圆点。

### 6. index.tsx - 主页面组件

**路由：**
- `/:base64Dir/studio` — 新建会话
- `/:base64Dir/studio/:sessionId` — 已有会话

**状态管理：**
- `createStore` 管理批量数据（session、message、part）
- `createSignal` 管理独立 UI 状态（prompt、capability、styleModel、images、pending 等）

**核心流程：**

```
用户输入 → buildPrompt() 构建中文 prompt 模板
         → sendStudioMessage() 发送给 SDK
         → pendingResult 立即显示骨架屏
         → SDK event 实时更新消息/parts
         → buildStudioTurns() 构建展示数据
         → UI 渲染结果图片
```

**子组件（均在同一文件内定义）：**

| 组件 | 位置 | 功能 |
|------|------|------|
| `StudioHistory` | 左侧栏 | 按日期分组的会话列表 + 新建按钮 |
| `StudioIntro` | 中间栏（空状态） | 无会话时的欢迎页，展示能力列表 |
| `StudioComposer` | 中间栏底部 | 输入区：文件上传、能力选择、工具选择、风格选择、宽高比/数量设置、提交按钮 |
| `StudioConversation` | 中间栏内容区 | 对话历史渲染：用户气泡 → AI 回复 → 结果卡片（含图片网格/错误/加载态） |
| `StudioResultCanvas` | 右侧画布区 | 状态驱动的图片展示：闲置（玻璃球装饰）→ 加载 → 成功（大图 + 工具栏）→ 失败 |
| `StudioDetails` | 右侧详情栏 | 图片缩略图网格、prompt 展示、生成信息、操作按钮（重新生成/放大/抠图/修复/扩展） |
| `StudioOutpaintEditor` | 全屏浮层 | 扩展模式编辑器：原图预览 + 比例设置 + prompt 输入 |
| `StudioMark` | 装饰 | 渐变圆形品牌标记 |
| `StudioGlassSphere` | 装饰 | 闲置状态的大玻璃球 |
| `InfoRow` | 通用 | 标签-值信息行 |
| `ToolButton` / `IconTool` | 通用 | 下拉触发按钮 / 图标按钮 |
| `CapabilityMenu` / `StyleMenu` / `ImageToolMenu` / `ImageSettings` | 弹出菜单 | 各类选择器 |

**布局示意：**

```
┌──────────────┬────────────────┬──────────────────────────┐
│  History     │  Intro /       │  Canvas      │ Details  │
│  会话列表    │  Conversation  │  图片展示    │ 元数据   │
│              │  Composer      │              │ 操作     │
│  300px       │  468px         │  flex-1      │ 320px    │
└──────────────┴────────────────┴──────────────────────────┘
```

## 数据流

```
SDK Client (globalSDK)
    │
    ├── client.session.list()     → StudioHistory 会话列表
    ├── client.session.messages() → 消息加载（切换 session 时）
    ├── client.sendMessage()      → sendStudioMessage() 发送
    └── event.listen()            → 实时更新（message.updated, part.updated, delta）
             │
             ▼
        createStore<DataStore>
             │
             ▼
        buildStudioTurns()  ← 将消息转换为 UI 轮次
             │
             ▼
        StudioConversation / StudioResultCanvas / StudioDetails 渲染
```

## Prompt 工程

用户输入经过 `buildPromptInput()` 包装为结构化的中文 prompt 模板，包含：
- 能力类型约束
- 所选工具
- 风格模型
- 宽高比
- 生成数量
- 参考图片（如有）
- 历史对话上下文
- 用户原始需求
- 输出格式指令

## 关键依赖

- `@opencode-ai/sdk/v2/client` — SDK 客户端类型与 API
- `@opencode-ai/core` — 二分查找、编码工具
- `@/context/global-sdk` — 全局 SDK 实例
- `@/context/global-sync` — 全局文件系统同步
- `@/pages/layout/helpers` — 会话分组与排序
- `@solidjs/router` — 路由导航
- `solid-js` — 响应式框架
