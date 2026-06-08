# 计划：将 Open-Design 前端项目页面移植到 octoAI /make

## Context

当前 octoAI 的 `/make` 功能基于 session 模型：用户创建一个 `octo_make` agent 的 session，通过对话生成 HTML 原型。UI 是简单的双栏布局（聊天 + ResultViewer）。

Open-Design 有更成熟的项目页面 UI：项目创建有丰富的表单（6 类型标签），项目页面有文件工作区、多对话切换、文件树等。

**目标**：只移植 open-design 的**前端模块**，使用 octoAI 现有后端系统（session/message/part API），在前端做适配层。在 `TitlebarSimple` 上新增 Make 专属标签页。

## 核心适配策略：Session 即 Project

**不修改后端**，用现有 session API 模拟 open-design 的项目模型：

| Open-Design 概念 | octoAI 映射 | 实现方式 |
|------------------|------------|---------|
| Project | 父 Session | `session.create({ agent: "octo_make", title: <项目名> })` |
| Conversation | 子 Session | `session.create({ agent: "octo_make", parentID: <项目sessionID> })` |
| Project 元数据 (kind/fidelity/platform) | localStorage | `octo:make:meta:<sessionID>` → JSON |
| 项目文件 | file.list() / file.read() | 现有文件 API，agent 通过 write tool 写入 |
| Messages | session.messages() | 现有消息 API |
| 实时更新 | SSE events | 现有 event 系统 |

**现有后端能力完全够用**：
- `session.create({ parentID })` — 子 session 归属父 session
- `session.children({ sessionID })` — 列出子 session
- `session.list({ category: "prototype" })` — 按类别过滤
- `session.update({ title })` — 修改标题
- `file.list()` / `file.read()` — 文件列表/读取
- SSE events — 实时更新

---

## Phase 1: 适配层 — API 客户端 + 状态管理

### 新建文件

**`packages/app/octoapp/pages/make/utils/make-project-adapter.ts`** — API 适配层
- 将 open-design 的 Project/Conversation 概念映射到 octoAI 的 session API
- 关键函数：
  - `createProject(input)` → 调用 `client.session.create({ agent: "octo_make", title: input.name })`，返回包装的 MakeProject 对象
  - `listProjects()` → 调用 `client.session.list({ agent: "octo_make", roots: true })`
  - `getProject(projectID)` → 调用 `client.session.get({ sessionID: projectID })`
  - `deleteProject(projectID)` → 调用 `client.session.delete({ sessionID: projectID })`
  - `createConversation(projectID)` → 调用 `client.session.create({ agent: "octo_make", parentID: projectID })`
  - `listConversations(projectID)` → 调用 `client.session.children({ sessionID: projectID })`
  - `deleteConversation(convID)` → 调用 `client.session.delete({ sessionID: convID })`
- 内部使用 `globalSDK.createClient()` 获取 client

**`packages/app/octoapp/pages/make/utils/make-project-meta.ts`** — 元数据持久化
- localStorage 管理：key `octo:make:meta:<sessionID>`
- `MakeProjectMeta` 类型：`{ kind, fidelity, platform, platformTargets, designSystemId, templateId, metadata }`
- `saveMeta(sessionID, meta)` / `loadMeta(sessionID)` / `deleteMeta(sessionID)`
- 复用现有 `persisted()` 工具（`packages/app/octoapp/utils/persist.ts`）

**`packages/app/octoapp/pages/make/utils/make-project-types.ts`** — 共享类型定义
- 移植 open-design 的 DTO 类型：
  - `MakeProject`：包装 Session + meta 数据
  - `MakeConversation`：包装子 Session
  - `ProjectMetadata`：kind/fidelity/platform/所有 media 字段
  - `ProjectKind`：`'prototype' | 'deck' | 'template' | 'media' | 'image' | 'video' | 'audio' | 'other'`
- 参考：`D:/octoAI/open-design/packages/contracts/src/api/projects.ts`

---

## Phase 2: 新建项目对话框

### 新建文件

**`packages/app/octoapp/pages/make/components/new-project-modal.tsx`**
- 使用 `@opencode-ai/ui/dialog` 的 Dialog 组件
- Props：`open`、`onClose`、`onCreate`
- 参考：`D:/octoAI/open-design/apps/web/src/components/NewProjectModal.tsx`

**`packages/app/octoapp/pages/make/components/new-project-panel.tsx`** — 完整移植
- SolidJS 重写 open-design 的 NewProjectPanel（参考 `apps/web/src/components/NewProjectPanel.tsx`）
- **全部 6 个类型标签**：prototype / live-artifact / deck / template / media / other
- **Media 子标签**：image / video / audio
- **表单字段**（按类型动态显示）：
  - 项目名称（文本输入）+ autoName() 自动生成
  - 设计系统选择（复用现有 `DesignSystemPicker`）
  - 模板选择（复用现有 `TemplatePicker`）
  - 保真度：wireframe / high-fidelity
  - 平台目标：responsive / web-desktop / mobile-ios / mobile-android / tablet / desktop-app（多选）
  - 演讲者备注、动画（deck 专属）
  - 图片模型/宽高比（image 专属）
  - 视频模型/宽高比/时长（video 专属）
  - 音频类型/模型/时长/声音（audio 专属）
  - 提示词模板
- `buildMetadata()` 根据当前活动标签构建 metadata
- 提交流程：`createProject(input)` → `saveMeta(sessionID, metadata)` → 导航到 `/make/<sessionID>`
- 使用 `createSignal` / `createStore` 管理表单状态

### 修改文件

**`packages/app/octoapp/pages/_shell/sidebar.tsx`**
- "Octo Make" 的 "+" 按钮改为打开 NewProjectModal

---

## Phase 3: 项目页面（核心 — MakePage 重构）

### 路由

**`packages/app/octoapp/app.tsx`** 和 **`packages/app/octoapp/octo.tsx`**（双入口）
- 当前：`<Route path="/make/:id?" component={MakePage} />`
- 新增：`<Route path="/make/:projectID/:conversationID?" component={MakeProjectPage} />`
- 保留旧路由做兼容（见 Phase 5）

### 新建文件

**`packages/app/octoapp/pages/make/project-page.tsx`** — 主项目页面
- SolidJS 重写 open-design 的 ProjectView（参考 `apps/web/src/components/ProjectView.tsx`）
- **整体布局**：三栏（sidebar 对话列表 | chat 聊天面板 | file workspace 文件工作区）
- **项目头部**：项目名称（可编辑 via `session.update()`）、类型标签（从 meta 读取）、菜单（重命名/删除/设置）

**左侧 — 对话列表面板**：
- **`packages/app/octoapp/pages/make/components/conversation-sidebar.tsx`** (~150 行)
  - 列出项目内所有对话（`listConversations(projectID)`）
  - 点击切换对话
  - "+" 按钮新建对话
  - 右键菜单：重命名/删除
  - 参考：`D:/octoAI/open-design/apps/web/src/components/ConversationsMenu.tsx`

**中间 — 聊天面板**：
- 复用现有 `InsightTurn` 组件渲染消息
- 复用现有输入栏结构（textarea + DesignSystemPicker + TemplatePicker + ModelSelector + 发送按钮）
- 活跃 session ID 从选中的对话推导
- 复用现有 dataStore 模式管理消息/部件
- 复用现有 SSE 事件监听（`message.updated`、`message.part.updated`、`session.status`）

**右侧 — 文件工作区**：
- **`packages/app/octoapp/pages/make/components/file-workspace.tsx`** (~300 行)
  - 双栏：文件树 | 文件查看器
  - 参考：`D:/octoAI/open-design/apps/web/src/components/FileWorkspace.tsx`
- **`packages/app/octoapp/pages/make/components/file-tree.tsx`** (~250 行)
  - 调用 `file.list()` 列出项目目录文件
  - 支持点击打开、展开目录
  - 上传按钮（通过 agent write tool 写入文件，或直接 fetch 写入）
  - 右键菜单：重命名/删除
  - 参考：`D:/octoAI/open-design/apps/web/src/components/DesignFilesPanel.tsx`
- **`packages/app/octoapp/pages/make/components/file-viewer.tsx`** (~200 行)
  - 根据 MIME 类型渲染：HTML（HtmlRenderer）、图片、代码（语法高亮）、纯文本
  - 参考：`D:/octoAI/open-design/apps/web/src/components/FileViewer.tsx`
- 文件标签页：复用现有 `tab-store.ts` 的 createTabStore()
- 文件查看器区域可与 ResultViewer 共存（生成的 artifact 也显示在右侧）

**分割面板**：
- 复用 MakePage 现有的拖拽分割逻辑（chatWidth signal + divider mouse events）
- 改为三段可拖拽

### 数据流
```
URL: /make/:projectID/:conversationID?
  → projectResource = createResource(projectID, client.session.get)
  → projectMeta = loadMeta(projectID) from localStorage
  → conversations = createResource(projectID, listConversations)
  → activeConversationID signal (默认: URL 参数或第一个对话)
  → activeSessionID = activeConversationID (对话就是子 session)
  → 复用现有 dataStore 获取消息/部件
  → files = createResource(directory, client.file.list)
```

### 复用的现有组件（无需修改）

| 组件 | 路径 | 用途 |
|------|------|------|
| `InsightTurn` | `pages/make/components/insight-turn.tsx` | 消息渲染 |
| `ResultViewer` | `pages/make/components/result-viewer/` | 生成结果查看 |
| `DesignSystemPicker` | `pages/make/components/design-system-picker.tsx` | 设计系统选择 |
| `TemplatePicker` | `pages/make/components/template-picker.tsx` | 模板选择 |
| `tab-store` | `pages/make/components/result-viewer/tab-store.ts` | 标签页状态 |
| `snapshot-store` | `pages/make/utils/snapshot-store.ts` | 版本快照 |
| `artifact-parser` | `pages/make/utils/artifact-parser.ts` | Artifact 解析 |
| `srcdoc-builder` | `pages/make/utils/srcdoc-builder.ts` | iframe srcdoc |

---

## Phase 4: Title-bar 新增 Make 标签 + 侧边栏更新

### 修改文件

**`packages/app/octoapp/components/titlebar-simple.tsx`** — TitlebarSimple 组件
- 当前 3 个标签：Chat / Cowork / Studio（分段控件）
- 新增第 4 个标签：**Make**
- 标签顺序：Chat | Cowork | **Make** | Studio
- `activeTab` 计算逻辑：识别 `/make` 路由
- 点击 Make 标签：导航到 `/make`（显示空状态/最近项目列表）

**`packages/app/octoapp/context/layout.tsx`** — Layout 上下文
- `lastSessionPerTab` 扩展：添加 `make` 键
- 记住上次打开的 make 项目 session ID

**`packages/app/octoapp/pages/_shell/sidebar.tsx`** — 侧边栏
- "Octo Make" 部分：改为显示项目列表（`listProjects()` 返回的父 session 列表）
- 每个项目项：项目名称 + 类型标签（从 meta 读取）
- 点击导航到 `/make/<sessionID>`
- "+" 按钮打开 NewProjectModal
- "Octo Insight" 部分保持不变

**`packages/app/octoapp/app.tsx`** — 路由注册
- Make 路由从 OctoSidebarLayout 移出，作为独立标签页
- 或保持侧边栏布局，调整 `isOctoPage()` 逻辑

---

## Phase 5: 旧 URL 兼容

### 修改文件

**`packages/app/octoapp/pages/make/index.tsx`**
- 旧 URL `/make/<sessionID>` 兼容：
  - 检测 URL 中的 ID 是否是一个已有的 session
  - 如果是父 session（项目）：直接导航到 `/make/<sessionID>`
  - 如果是子 session（对话）：查找其 parentID，导航到 `/make/<parentID>/<sessionID>`
  - 如果没有 parentID 的旧 session：自动提升为项目（在 meta 中添加默认元数据），导航到 `/make/<sessionID>`

---

## 文件清单

### 新建文件（纯前端，10 个）

| 文件 | 说明 |
|------|------|
| `packages/app/octoapp/pages/make/utils/make-project-adapter.ts` | Session API → Project 概念适配层 |
| `packages/app/octoapp/pages/make/utils/make-project-meta.ts` | localStorage 元数据管理 |
| `packages/app/octoapp/pages/make/utils/make-project-types.ts` | 共享类型定义 |
| `packages/app/octoapp/pages/make/project-page.tsx` | 项目主页面 |
| `packages/app/octoapp/pages/make/components/new-project-modal.tsx` | 新建项目对话框 |
| `packages/app/octoapp/pages/make/components/new-project-panel.tsx` | 新建项目表单（6 类型） |
| `packages/app/octoapp/pages/make/components/conversation-sidebar.tsx` | 对话列表面板 |
| `packages/app/octoapp/pages/make/components/file-workspace.tsx` | 文件工作区 |
| `packages/app/octoapp/pages/make/components/file-tree.tsx` | 文件树 |
| `packages/app/octoapp/pages/make/components/file-viewer.tsx` | 文件查看器 |

### 修改文件（6 个）

| 文件 | 修改内容 |
|------|----------|
| `packages/app/octoapp/app.tsx` | 新增项目页路由 + Make 标签页布局 |
| `packages/app/octoapp/octo.tsx` | 同步路由变更（双入口文件） |
| `packages/app/octoapp/components/titlebar-simple.tsx` | 新增 Make 标签 |
| `packages/app/octoapp/context/layout.tsx` | 扩展 lastSessionPerTab |
| `packages/app/octoapp/pages/_shell/sidebar.tsx` | 项目列表替代 session 列表 |
| `packages/app/octoapp/pages/make/index.tsx` | 旧 URL 兼容重定向 |

### Open-Design 源文件（移植参考，React → SolidJS 重写）

| 文件 | 移植内容 |
|------|----------|
| `apps/web/src/components/NewProjectModal.tsx` | 对话框结构 |
| `apps/web/src/components/NewProjectPanel.tsx` (~3000 行) | 新建项目表单 |
| `apps/web/src/components/ProjectView.tsx` (~5000 行) | 项目页面主体 |
| `apps/web/src/components/FileWorkspace.tsx` | 文件工作区 |
| `apps/web/src/components/FileViewer.tsx` | 文件查看器 |
| `apps/web/src/components/DesignFilesPanel.tsx` | 文件树 |
| `apps/web/src/components/ConversationsMenu.tsx` | 对话切换 |
| `apps/web/src/components/ChatPane.tsx` | 聊天面板结构 |
| `apps/web/src/components/ChatComposer.tsx` | 输入栏结构 |
| `packages/contracts/src/api/projects.ts` | DTO 类型 |

---

## 验证方案

1. **新建项目**：点击侧边栏 "+" → 打开 NewProjectModal → 切换类型标签 → 填写表单 → 提交 → 创建父 session + 保存 meta → 导航到项目页
2. **项目页面**：三栏布局（对话列表 | 聊天 | 文件工作区），发送消息 → 生成 artifact → 文件树更新
3. **多对话**：点击 "+" 新建对话 → 创建子 session → 切换对话 → 消息独立
4. **文件工作区**：文件树列出文件 → 点击打开 → 标签页管理
5. **Title-bar**：Make 标签高亮，点击切换，记住上次项目
6. **旧 URL 兼容**：`/make/<旧sessionID>` 自动迁移
7. **类型检查**：`cd packages/app && bun typecheck`
