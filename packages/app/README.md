# packages/app 开发文档

## 目录结构

```
packages/app/
├── src/                    # OpenCode 导出入口 (export * from "../octoapp")
│   ├── index.ts            # 导出入口 (export * from "../octoapp")
│   ├── entry.tsx           # Web 渲染入口
│   ├── app.tsx             # OpenCode App 入口
│   ├── pages/              # 页面组件
│   │   └── layout/         # Layout 相关
│   │       ├── sidebar-items.tsx      # Sidebar 项目 (showArchive prop + onMarkViewed 回调)
│   │       ├── sidebar-workspace.tsx  # 工作区侧边栏
│   │       ├── sidebar-shell.tsx      # Shell 侧边栏
│   │       ├── sidebar-project.tsx    # 项目侧边栏
│   │       ├── inline-editor.tsx       # 内联编辑器
│   │       ├── deep-links.ts           # 深度链接
│   │       └── helpers.ts              # Layout 工具函数
│   │   └── session/        # Session 页面组件
│   │       ├── session-side-panel.tsx   # Session 侧边栏
│   │       ├── session-layout.ts        # Session 布局参数
│   │       ├── session-model-helpers.ts # 模型辅助函数
│   │       ├── terminal-panel.tsx       # 终端面板
│   │       ├── terminal-label.ts        # 终端标签
│   │       ├── message-timeline.tsx     # 消息时间线 (Chat 页隐藏分享/归档菜单，重命名失焦保存)
│   │       ├── message-id-from-hash.ts  # 从hash获取消息ID
│   │       ├── message-gesture.ts       # 消息手势
│   │       ├── file-tabs.tsx            # 文件标签页
│   │       ├── file-tab-scroll.ts       # 文件标签滚动
│   │       ├── handoff.ts               # 交接处理
│   │       ├── use-session-hash-scroll.ts # hash滚动 hook
│   │       ├── use-session-commands.tsx # 命令 hook
│   │       ├── helpers.ts               # 工具函数
│   │       ├── review-tab.tsx           # Review 标签页
│   │       └── composer/   # Session Composer 组件
│   │       │   ├── index.ts             # 导出入口
│   │       │   ├── session-composer-state.ts    # Composer 状态
│   │       │   ├── session-composer-region.tsx  # Composer 区域
│   │       │   ├── session-todo-dock.tsx        # Todo dock
│   │       │   ├── session-revert-dock.tsx      # Revert dock
│   │       │   ├── session-question-dock.tsx    # Question dock
│   │       │   ├── session-permission-dock.tsx  # Permission dock
│   │       │   ├── session-followup-dock.tsx    # Followup dock
│   │       │   └── session-request-tree.ts      # Request tree
│   ├── components/         # 共享组件
│   │   ├── titlebar.tsx           # 顶部标题栏
│   │   ├── titlebar-history.ts    # 历史记录
│   │   ├── debug-bar.tsx          # 调试工具栏
│   │   ├── model-tooltip.tsx       # 模型提示
│   │   ├── link.tsx                # 链接组件
│   │   ├── status-popover.tsx      # 状态弹窗
│   │   ├── status-popover-body.tsx # 状态弹窗内容
│   │   ├── dialog-custom-provider-form.ts # 自定义供应商表单
│   │   ├── session-context-usage.tsx # 会话上下文使用
│   │   ├── settings-*.tsx         # 设置相关组件
│   │   ├── prompt-input.tsx       # 底部对话栏
│   │   ├── session/               # Session 相关组件
│   │   │   ├── session-header.tsx      # Portal 到 Titlebar
│   │   │   ├── session-context-tab.tsx # Context 标签页
│   │   │   ├── session-new-view.tsx    # 新建视图
│   │   │   ├── session-sortable-tab.tsx # 可排序标签
│   │   │   ├── session-sortable-terminal-tab.tsx # 可排序终端标签
│   │   │   ├── session-context-metrics.ts # Context 指标
│   │   │   ├── session-context-breakdown.ts # Context 分解
│   │   │   └── session-context-format.ts # Context 格式化
│   │   ├── prompt-input/         # PromptInput 子组件
│   │   │   ├── slash-popover.tsx       # 斜杠命令弹窗
│   │   │   ├── image-attachments.tsx   # 图片附件
│   │   │   ├── drag-overlay.tsx        # 拖拽覆盖层
│   │   │   ├── context-items.tsx       # 上下文项目
│   │   │   ├── submit.ts               # 提交处理
│   │   │   ├── placeholder.ts          # 占位符
│   │   │   ├── paste.ts                # 粘贴处理
│   │   │   ├── history.ts              # 历史记录
│   │   │   ├── files.ts                # 文件处理
│   │   │   ├── editor-dom.ts           # 编辑器DOM
│   │   │   ├── build-request-parts.ts  # 构建请求部分
│   │   │   └── attachments.ts          # 附件处理
│   │   └── server/             # 服务器组件
│   │   │   └ server-row.tsx    # 服务器行
│   ├── context/            # Context Provider
│   │   ├── layout.tsx      # 布局状态 ★
│   │   ├── layout-scroll.ts # 滚动状态
│   │   ├── local.tsx       # 本地状态 (agent/model 选择)
│   │   ├── global-sync.tsx # 全局同步
│   │   ├── global-sdk.tsx  # 全局 SDK 客户端
│   │   ├── sdk.tsx         # SDK 客户端封装
│   │   ├── global-sync/    # global-sync 子模块 (拆分)
│   │   │   ├── utils.ts    # 工具函数
│   │   │   ├── types.ts    # 类型定义
│   │   │   ├── session-trim.ts    # Session裁剪
│   │   │   ├── session-prefetch.ts # Session预取
│   │   │   ├── session-load.ts    # Session加载
│   │   │   ├── session-cache.ts   # Session缓存
│   │   │   ├── queue.ts    # 队列管理
│   │   │   ├── eviction.ts # 淘汰策略
│   │   │   ├── event-reducer.ts   # 事件处理
│   │   │   ├── child-store.ts     # 子Store
│   │   │   └── bootstrap.ts       # 启动初始化
│   │   ├── file.tsx        # 文件管理
│   │   ├── file/           # file 子模块
│   │   │   ├── types.ts    # 类型定义
│   │   │   ├── tree-store.ts # 文件树Store
│   │   │   ├── path.ts     # 路径处理
│   │   │   ├── watcher.ts  # 文件监听
│   │   │   ├── content-cache.ts # 内容缓存
│   │   │   └ view-cache.ts    # 视图缓存
│   │   ├── model-variant.ts # 模型变体
│   │   ├── permission-auto-respond.ts # 权限自动响应
│   │   ├── terminal-title.ts # 终端标题
│   │   └── ...              # 其他 Context
│   ├── utils/              # 工具函数
│   │   ├── persist.ts      # 持久化工具 ★
│   │   ├── base64.ts       # Base64 编解码
│   │   ├── server.ts       # 服务器工具
│   │   ├── server-health.ts # 服务器健康检查
│   │   ├── server-errors.ts # 服务器错误处理
│   │   ├── session-title.ts # Session 标题
│   │   ├── terminal-writer.ts # 终端写入器
│   │   ├── terminal-websocket-url.ts # 终端WebSocket URL
│   │   ├── worktree.ts     # Worktree 处理
│   │   ├── diffs.ts        # Diff 工具
│   │   ├── scoped-cache.ts # 分级缓存
│   │   ├── runtime-adapters.ts # 运行时适配器
│   │   ├── prompt.ts       # Prompt 工具
│   │   ├── path-key.ts     # 路径键
│   │   ├── id.ts           # ID 工具
│   │   ├── uuid.ts         # UUID 工具
│   │   ├── time.ts         # 时间工具
│   │   ├── same.ts         # 相等比较
│   │   ├── sound.ts        # 声音工具
│   │   ├── agent.ts        # Agent 工具
│   │   ├── aim.ts          # AIM 工具
│   │   ├── comment-note.ts # 评论笔记
│   │   ├── notification-click.ts # 通知点击
│   │   └ solid-dnd.tsx   # SolidJS DnD
│   ├── addons/             # 插件工具
│   │   └ serialize.ts    # 序列化工具
│   ├── i18n/               # 国际化 (17种语言)
│   │   ├── ar.ts           # 阿拉伯语
│   │   ├── br.ts           # 巴西葡萄牙语
│   │   ├── bs.ts           # 波斯尼亚语
│   │   ├── da.ts           # 丹麦语
│   │   ├── de.ts           # 德语
│   │   ├── en.ts           # 英语
│   │   ├── es.ts           # 西班牙语
│   │   ├── fr.ts           # 法语
│   │   ├── ja.ts           # 日语
│   │   ├── ko.ts           # 韩语
│   │   ├── no.ts           # 挪威语
│   │   ├── pl.ts           # 波兰语
│   │   ├── ru.ts           # 俄语
│   │   ├── th.ts           # 泰语
│   │   ├── tr.ts           # 土耳其语
│   │   ├── zh.ts           # 中文简体
│   │   └ zht.ts          # 中文繁体
│   └ hooks/              # 自定义 hooks
│   │   └ use-providers.ts # Provider hooks
│   └ constants/          # 常量配置
│   │   └ file-picker.ts  # 文件选择器配置
│   └ index.css           # 主样式文件
│
├── octoapp/                # Octo AI 应用代码 ★
│   ├── index.ts            # 导出入口 (见下文导出说明)
│   ├── octo.tsx            # Octo App 主入口 ★
│   ├── app.tsx             # OpenCode App 入口 (备用)
│   ├── entry.tsx           # Web 渲染入口
│   ├── index.css           # 主样式文件
│   ├── constants/          # 常量配置
│   │   └ file-picker.ts  # 文件选择器配置
│   ├── addons/             # 插件工具
│   │   └ serialize.ts    # 序列化工具
│   ├── hooks/              # 自定义 hooks
│   │   ├── use-providers.ts # Provider hooks
│   │   └ use-project-dir.ts # 项目目录 hook ★
│   ├── pages/
│   │   ├── _shell/         # Shell 布局组件 ★
│   │   │   ├── index.tsx   # OctoShell, OctoPageShell
│   │   │   ├── sidebar.tsx # OctoSidebar (旧版，已废弃) ★
│   │   │   ├── topbar.tsx  # OctoTopbar (Tab 切换栏)
│   │   │   └ icons/      # Shell 图标 (SVG)
│   │   │   │   ├── index.tsx        # 图标导出
│   │   │   │   ├── OctoLogo.svg     # Octo Logo
│   │   │   │   ├── IconChat.svg     # Chat 图标
│   │   │   │   ├── IconMake.svg     # Make 图标 ★
│   │   │   │   ├── IconCowork.svg   # Cowork 图标
│   │   │   │   ├── IconStudio.svg   # Studio 图标
│   │   │   │   ├── IconSkill.svg    # 技能库图标
│   │   │   │   ├── IconAsset.svg    # 资产库图标
│   │   │   │   ├── IconSettings.svg # 设置图标
│   │   │   │   ├── IconSearch.svg   # 搜索图标
│   │   │   │   ├── IconHost.svg     # Host 图标 ★
│   │   │   │   └ ...            # 其他图标 (1状态变体)
│   │   ├── insight/        # Insight 页面 ★
│   │   │   ├── index.tsx   # Insight 主页面
│   │   │   ├── octo-tokens.css # Insight 主题变量
│   │   │   ├── lib/        # 库函数 ★
│   │   │   │   ├── upload.ts    # 上传工具 (端点由 VITE_OCTO_UPLOAD_ENDPOINT 配置)
│   │   │   │   └ electron-api.ts # Electron桌面API类型安全封装 (Make页有独立副本) ★
│   │   │   ├── utils/      # 工具函数
│   │   │   │   ├── mindmap-adapter.ts   # UXR JSON → Markdown 思维导图转换 ★
│   │   │   │   ├── resource-link.ts     # MCP 资源链接解析器 (3分支策略) ★
│   │   │   │   ├── markdown-table.ts    # Markdown 表格工具
│   │   │   │   ├── detect.ts            # 类型检测
│   │   │   │   ├── detect.test.ts       # 类型检测测试
│   │   │   │   ├── task-detect.ts       # 任务检测 ★
│   │   │   │   └ task-refresh.ts      # 任务刷新 ★
│   │   │   ├── store/      # 状态管理
│   │   │   │   └ preset-prompts.ts     # 预置提示词状态 ★
│   │   │   ├── components/
│   │   │   │   ├── attachment-bar.tsx   # 附件栏
│   │   │   │   ├── insight-turn.tsx     # 对话消息渲染
│   │   │   │   ├── preset-prompts.tsx   # 预置提示词按钮组 ★
│   │   │   │   ├── task-card/           # 任务卡片 ★
│   │   │   │   │   └ index.tsx      # 任务卡片组件
│   │   │   │   └ result-viewer/       # 结果查看器
│   │   │   │       ├── index.tsx
│   │   │   │       ├── tab-store.ts
│   │   │   │       ├── tab-store.tsx    # Tab Store (SolidJS) ★
│   │   │   │       ├── tab-bar.tsx      # Tab 栏
│   │   │   │       ├── action-bar.tsx   # 操作栏
│   │   │   │       ├── table-renderer.tsx # 表格渲染
│   │   │   │       ├── html-renderer.tsx # HTML渲染
│   │   │   │       └ mindmap-renderer.tsx # 思维导图渲染
│   │   │   └ icons/      # Insight 图标 (SVG)
│   │   │   │   ├── index.tsx            # 图标导出
│   │   │   │   ├── illustrations.tsx    # 插图组件
│   │   │   │   ├── IconSend.svg         # 发送图标
│   │   │   │   ├── IconAttach.svg       # 附件图标
│   │   │   │   ├── IconActionCopy.svg   # 复制图标
│   │   │   │   ├── IconActionDownload.svg # 下载图标
│   │   │   │   ├── IconTabClose.svg     # Tab关闭图标
│   │   │   │   ├── IconCard*.svg        # 卡片类型图标
│   │   │   │   └ IllustrationInsightEmpty.svg # 空态插图
│   │   │   │   └ IllustrationResultEmpty.svg  # 结果空态插图
│   │   ├── make/           # Make 页面 ★
│   │   │   ├── index.tsx   # Make 主页面
│   │   │   ├── octo-tokens.css # Make 主题变量
│   │   │   ├── components/
│   │   │   │   ├── attachment-bar.tsx   # 附件栏
│   │   │   │   ├── insight-turn.tsx     # 对话消息渲染 ★ (WaitingPill 只显示 artifact 内容，不显示 prose)
│   │   │   │   ├── design-system-picker.tsx # 设计系统选择器 (151种主题) ★
│   │   │   │   ├── tool-call-card.tsx   # 工具调用状态卡片 ★
│   │   │   │   ├── file-ops-summary.tsx # 文件操作汇总卡片 ★
│   │   │   │   └ result-viewer/       # 结果查看器
│   │   │   │       ├── index.tsx
│   │   │   │       ├── tab-store.ts
│   │   │   │       ├── tab-bar.tsx
│   │   │   │       ├── action-bar.tsx      # 操作栏 (下载使用 writeFileBuffer 系统保存框) ★
│   │   │   │       ├── table-renderer.tsx
│   │   │   │       ├── html-renderer.tsx  # HTML渲染器
│   │   │   │       ├── deck-renderer.tsx  # 幻灯片渲染器 ★
│   │   │   │       └ svg-renderer.tsx    # SVG渲染器 ★
│   │   │   ├── utils/      # 工具函数 ★
│   │   │   │   ├── artifact-parser.ts        # Artifact XML标签流式解析器 ★
│   │   │   │   ├── artifact-markdown-context.ts # Artifact markdown跳过范围 ★
│   │   │   │   ├── artifact-strip.ts         # Artifact标签清除 ★
│   │   │   │   ├── design-system-loader.ts   # 设计系统懒加载 (Vite glob) ★
│   │   │   │   └ srcdoc-builder.ts           # iframe srcdoc构建器 ★
│   │   │   ├── lib/        # 库函数 ★
│   │   │   │   └ electron-api.ts             # Electron桌面API类型安全封装 ★
│   │   │   └ icons/      # Make 图标 (SVG, 同 insight)
│   │   │   └ sidebar.tsx   # Make 侧边栏 ★ (仅显示 Make sessions)
│   │   ├── cowork/         # Cowork 相关组件 ★
│   │   │   ├── octo-tokens.css # Insight 主题变量
│   │   │   ├── components/
│   │   │   │   ├── project-info.tsx       # 项目信息卡片 ★
│   │   │   │   ├── project-info-dialog-content.tsx # 项目信息对话框内容 ★
│   │   │   │   ├── project-product-select.tsx      # 产品选择 Popover ★
│   │   │   │   ├── project-product-select-panel.tsx # 产品选择面板 ★
│   │   │   │   ├── project-product-select-api.ts   # 产品/版本 API 接口 ★
│   │   │   │   ├── attachment-bar.tsx     # 附件栏
│   │   │   │   ├── insight-turn.tsx       # 对话消息渲染
│   │   │   │   └ result-viewer/         # 结果查看器
│   │   │   │       ├── index.tsx
│   │   │   │       ├── tab-store.ts
│   │   │   │       ├── tab-bar.tsx
│   │   │   │       ├── action-bar.tsx
│   │   │   │       └ table-renderer.tsx
│   │   ├── chat.tsx        # Chat 页面 ★ (Sidebar 宽度已持久化)
│   │   ├── session.tsx     # Session 核心
│   │   ├── skills/         # 技能库页面 ★
│   │   │   └ index.tsx   # 技能库管理页面
│   │   ├── studio/         # Studio 页面 ★
│   │   │   ├── index.tsx   # Studio 主页面
│   │   │   ├── data.ts     # Studio 能力配置
│   │   │   ├── types.ts    # 类型定义
│   │   │   ├── turns.ts    # 对话轮次处理
│   │   │   ├── studio.css  # Studio 样式
│   │   │   ├── plus.svg    # Plus 图标
│   │   │   └ settings-gear.svg # 设置齿轮图标
│   │   ├── session/        # Session 页面组件 (同 src/pages/session)
│   │   │   ├── session-side-panel.tsx   # Session 侧边栏
│   │   │   ├── session-layout.ts        # Session 布局参数
│   │   │   ├── session-model-helpers.ts # 模型辅助函数
│   │   │   ├── terminal-panel.tsx       # 终端面板
│   │   │   ├── terminal-label.ts        # 终端标签
│   │   │   ├── message-timeline.tsx     # 消息时间线 (Chat 页隐藏分享/归档菜单，重命名失焦保存)
│   │   │   ├── message-id-from-hash.ts  # 从hash获取消息ID
│   │   │   ├── message-gesture.ts       # 消息手势
│   │   │   ├── file-tabs.tsx            # 文件标签页
│   │   │   ├── file-tab-scroll.ts       # 文件标签滚动
│   │   │   ├── handoff.ts               # 交接处理
│   │   │   ├── use-session-hash-scroll.ts # hash滚动 hook
│   │   │   ├── use-session-commands.tsx # 命令 hook
│   │   │   ├── helpers.ts               # 工具函数
│   │   │   ├── review-tab.tsx           # Review 标签页
│   │   │   └ composer/   # Session Composer 组件
│   │   │   │   ├── index.ts             # 导出入口
│   │   │   │   ├── session-composer-state.ts    # Composer 状态
│   │   │   │   ├── session-composer-region.tsx  # Composer 区域
│   │   │   │   ├── session-todo-dock.tsx        # Todo dock
│   │   │   │   ├── session-revert-dock.tsx      # Revert dock
│   │   │   │   ├── session-question-dock.tsx    # Question dock
│   │   │   │   ├── session-permission-dock.tsx  # Permission dock
│   │   │   │   ├── session-followup-dock.tsx    # Followup dock
│   │   │   │   └ session-request-tree.ts      # Request tree
│   │   ├── layout/         # Layout 相关
│   │   │   ├── sidebar-items.tsx        # Sidebar 项目 (showArchive prop + onMarkViewed 回调)
│   │   │   └ helpers.ts  # Layout 工具函数
│   │   ├── home.tsx        # 项目选择页
│   │   ├── layoutnet.tsx   # Shell 布局
│   │   ├── directory-layout.tsx # 目录布局
│   │   └ error.tsx       # 错误页面
│   ├── components/
│   │   ├── titlebar-simple.tsx  # 顶部标题栏 + Tab + 搜索栏 (所有 Tab)
│   │   ├── sidebar.tsx     # Chat 左侧边栏 (搜索框已注释保留)
│   │   ├── prompt-input.tsx    # 底部对话栏
│   │   ├── settings-default-model.tsx # 默认模型设置 ★
│   │   ├── session/      # Session 相关组件
│   │   │   ├── session-header.tsx      # Portal 到 Titlebar (搜索栏已注释保留)
│   │   │   ├── session-context-tab.tsx # Context 标签页
│   │   │   ├── session-new-view.tsx    # 新建视图
│   │   │   ├── session-sortable-tab.tsx # 可排序标签
│   │   │   ├── session-sortable-terminal-tab.tsx # 可排序终端标签
│   │   │   ├── session-context-metrics.ts # Context 指标
│   │   │   ├── session-context-breakdown.ts # Context 分解
│   │   │   ├── session-context-format.ts # Context 格式化
│   │   │   ├── index.ts               # Session 组件导出
│   │   ├── dialog-*.tsx    # 各种 Dialog 组件
│   │   │   ├── dialog-project-onboarding.tsx # 项目引导弹窗 ★
│   │   │   ├── dialog-settings.tsx        # 设置对话框
│   │   │   ├── dialog-select-model.tsx    # 选择模型
│   │   │   ├── dialog-select-model-unpaid.tsx # 未付费模型选择
│   │   │   ├── dialog-select-provider.tsx # 选择供应商
│   │   │   ├── dialog-select-server.tsx   # 选择服务器
│   │   │   ├── dialog-select-mcp.tsx      # 选择 MCP
│   │   │   ├── dialog-select-directory.tsx # 选择目录
│   │   │   ├── dialog-select-file.tsx     # 选择文件
│   │   │   ├── dialog-select-default-model.tsx # 选择默认模型 ★
│   │   │   ├── dialog-custom-provider.tsx # 自定义供应商
│   │   │   ├── dialog-custom-provider-form.ts # 自定义供应商表单
│   │   │   ├── dialog-connect-provider.tsx # 连接供应商
│   │   │   ├── dialog-manage-models.tsx   # 管理模型
│   │   │   ├── dialog-fork.tsx            # Fork 对话框
│   │   │   ├── dialog-edit-project.tsx    # 编辑项目
│   │   │   ├── dialog-release-notes.tsx   # 发布说明
│   │   ├── settings-*.tsx  # 设置相关组件
│   │   │   ├── settings-general.tsx       # 通用设置
│   │   │   ├── settings-models.tsx        # 模型设置
│   │   │   ├── settings-providers.tsx     # 供应商设置
│   │   │   ├── settings-list.tsx          # 设置列表
│   │   │   ├── settings-keybinds.tsx      # 快捷键设置
│   │   │   ├── settings-default-model.tsx # 默认模型设置 ★
│   │   ├── file-tree.tsx   # 文件树组件
│   │   ├── prompt-input/   # PromptInput 子组件
│   │   │   ├── slash-popover.tsx       # 斜杠命令弹窗
│   │   │   ├── image-attachments.tsx   # 图片附件
│   │   │   ├── drag-overlay.tsx        # 拖拽覆盖层
│   │   │   ├── context-items.tsx       # 上下文项目
│   │   │   ├── submit.ts               # 提交处理
│   │   │   ├── placeholder.ts          # 占位符
│   │   │   ├── paste.ts                # 粘贴处理
│   │   │   ├── history.ts              # 历史记录
│   │   │   ├── files.ts                # 文件处理
│   │   │   ├── editor-dom.ts           # 编辑器DOM
│   │   │   ├── build-request-parts.ts  # 构建请求部分
│   │   │   └ attachments.ts          # 附件处理
│   │   ├── server/      # 服务器组件
│   │   │   └ server-row.tsx   # 服务器行
│   ├── context/
│   │   ├── layout.tsx      # 布局状态 ★
│   │   ├── layout-scroll.ts # 滚动状态
│   │   ├── local.tsx       # 本地状态 (agent/model 选择)
│   │   ├── global-sync.tsx # 全局同步
│   │   ├── global-sdk.tsx  # 全局 SDK 客户端
│   │   ├── sdk.tsx         # SDK 客户端封装
│   │   ├── global-sync/    # global-sync 子模块 (同 src)
│   │   ├── file.tsx        # 文件管理
│   │   ├── file/           # file 子模块 (同 src)
│   │   ├── model-variant.ts # 模型变体
│   │   ├── permission-auto-respond.ts # 权限自动响应
│   │   ├── terminal-title.ts # 终端标题
│   │   └ ...              # 其他 Context (同 src)
│   ├── utils/
│   │   ├── persist.ts      # 持久化工具 ★
│   │   ├── path-valid.ts   # 路径验证工具 ★
│   │   ├── base64.ts       # Base64 编解码
│   │   ├── server.ts       # 服务器工具
│   │   ├── server-health.ts # 服务器健康检查
│   │   ├── server-errors.ts # 服务器错误处理
│   │   ├── session-title.ts # Session 标题
│   │   ├── terminal-writer.ts # 终端写入器
│   │   ├── terminal-websocket-url.ts # 终端WebSocket URL
│   │   ├── worktree.ts     # Worktree 处理
│   │   ├── diffs.ts        # Diff 工具
│   │   ├── scoped-cache.ts # 分级缓存
│   │   ├── runtime-adapters.ts # 运行时适配器
│   │   ├── prompt.ts       # Prompt 工具
│   │   ├── path-key.ts     # 路径键
│   │   ├── id.ts           # ID 工具
│   │   ├── uuid.ts         # UUID 工具
│   │   ├── time.ts         # 时间工具
│   │   ├── same.ts         # 相等比较
│   │   ├── sound.ts        # 声音工具
│   │   ├── agent.ts        # Agent 工具
│   │   ├── comment-note.ts # 评论笔记
│   │   ├── notification-click.ts # 通知点击
│   │   └ solid-dnd.tsx   # SolidJS DnD
│   ├── style/              # 样式文件
│   │   ├── index.css
│   │   ├── sidebar.css     # 侧边栏样式
│   │   ├── cowork.css
│   │   ├── user-message.css # 用户消息样式
│   │   ├── header.css
│   │   ├── text-field.css   # 文本框样式
│   │   ├── prompt-input.css
│   │   ├── session-title.css # 会话标题样式
│   │   ├── dialog.css       # 对话框样式
│   │   ├── button.css       # 按钮样式
│   │   ├── studio.css       # Studio 样式
│   │   ├── loading.css      # 加载样式
│   │   ├── list.css         # 列表样式 ★
│   │   ├── switch.css       # 开关样式 ★
│   │   └ select.css         # 产品/版本选择框样式 ★
│   └ i18n/               # 国际化 (17种语言, 同 src)
│   └ design-systems/      # 设计系统目录 ★ (151种主题，Make页面使用)
│       ├── index.json     # 设计系统索引
│       └ <name>/          # 每个主题包含 DESIGN.md + tokens.css
│           ├── DESIGN.md  # 设计系统说明
│           └ tokens.css   # CSS变量/Tokens
│   └ crafts/              # Craft 文档目录 ★ (12个设计规范，Make页面使用)
│       ├── README.md      # Craft 文档索引
│       ├── anti-ai-slop.md    # 反AI刻板样式
│       ├── typography.md      # 字体规范
│       ├── color.md           # 颜色规范
│       └ accessibility-baseline.md # 无障碍基线
│       └ animation-discipline.md    # 动效纪律
│       └ form-validation.md         # 表单验证
│       └ laws-of-ux.md               # UX法则
│       └ rtl-and-bidi.md             # RTL/BIDI支持
│       └ state-coverage.md           # 状态覆盖
│       └ typography-hierarchy.md     # 字体层级
│       └ typography-hierarchy-editorial.md # 编辑字体层级
│   └ templates/           # 设计模板目录 ★ (110个模板，Make页面使用)
│       ├── index.json     # 模板索引 (分类标签 + 搜索)
│       └ <name>/          # 每个模板包含 SKILL.md
│           └ SKILL.md     # 模板技能描述
│
│── package.json            # 包配置
│── vite.config.ts          # Vite 配置
│── tsconfig.json           # TypeScript 配置
│── playwright.config.ts    # E2E 测试配置
│── happydom.ts             # 单元测试 DOM 环境
│── public/                 # 静态资源
│   ├── headerLogo.png      # Octo AI Logo (Sidebar/Titlebar 使用) ★
│   ├── chevron_down.svg    # 下拉箭头图标 ★
│   ├── insightIcon.svg     # Insight 分组图标 (OctoSidebar 使用) ★
│   ├── makeIcon.svg        # Make 分组图标 (OctoSidebar 使用) ★
│   ├── IconChat.svg / IconChat1.svg   # Chat 图标 (默认/激活)
│   ├── IconCowork.svg / IconCowork1.svg # Cowork 图标
│   ├── IconStudio.svg / IconStudio1.svg # Studio 图标
│   └ setting/              # 设置对话框图标 ★
│       ├── OctoAgentLogo.png   # 底部 Logo
│       ├── generalIcon.svg     # 通用设置图标
│       ├── modeIcon.svg        # 模型设置图标
│       ├── providerIcon.svg    # 供应商设置图标
│       └ clip path group.svg   # Clip path 图标
│   └── ...
└── e2e/                    # E2E 测试
```

---

## 双应用架构

| 应用 | 入口文件 | 路由特点 | 用途 |
|------|----------|----------|------|
| **Octo AI** | `octoapp/octo.tsx` | Chat/Insight/Make/Studio 四 Tab | Octo AI 分支应用 |
| **OpenCode** | `src/app.tsx` | 仅 Session 页面 | OpenCode 主应用 |

**导出说明** (`octoapp/index.ts`)：
```ts
export { AppBaseProviders, AppInterface } from "./octo"
export { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_TYPES, filePickerFilters } from "./constants/file-picker"
export { useCommand } from "./context/command"
export { loadLocaleDict, normalizeLocale, type Locale } from "./context/language"
export { type DisplayBackend, type Platform, PlatformProvider } from "./context/platform"
export { ServerConnection } from "./context/server"
export { handleNotificationClick } from "./utils/notification-click"
```

**src 导出入口** (`src/index.ts`)：
```ts
export * from "../octoapp"
```

---

## Shell 布局系统

### OctoShell (`pages/_shell/index.tsx`)

提供 Octo AI 应用的整体布局框架：
- **OctoTopbar**: 顶部 Tab 栏 (Chat/Insight/Make/Studio 四 Tab 分段控制)
- **OctoSidebar**: 左侧边栏 (可拖拽调整宽度，显示 Insight session 列表)
- **MakeSidebar**: Make 页面专用侧边栏 (显示 Make session 列表)

```tsx
<OctoShell withSidebar={true}>
  {children}
</OctoShell>
```

### OctoTopbar (`pages/_shell/topbar.tsx`) — **未使用**

此组件定义了 OctoShell 布局中的顶部栏，但当前 Octo AI 应用实际使用的是 `TitlebarSimple`（见下文）。

### TitlebarSimple (`components/titlebar-simple.tsx`) — **实际使用**

- 实际渲染在 `layoutnet.tsx` 中，作为 Octo AI 应用的顶部栏
- 四 Tab 分段控制: Chat, Insight, Make, Studio
- macOS traffic lights 兼容
- Windows zoom 兼容
- **搜索栏**: 右侧显示搜索按钮
- 用户头像占位
- **Tab 切换保留 session**: 切换 Tab 时恢复上次访问的 session 状态（见下文详细说明）
- Tab 图标使用 SVG 文件 (`IconChat.svg`, `IconMake.svg`, `IconCowork.svg`, `IconStudio.svg` 等)

---

## Tab 切换 Session 状态管理

用户在 Tab 之间切换时，会恢复上次访问的 session 状态。

### 数据结构

```typescript
type LastSessionPerTab = {
  cowork?: { id: string }           // 仅 Insight session ID（全局单一）
  make?: { id: string }             // 仅 Make session ID（全局单一）
  chat: Record<string, string>      // 按目录存储: { [dirPath]: sessionID }
  studio: Record<string, string>    // 按目录存储: { [dirPath]: sessionID }
}
```

### 存储方式

**纯内存存储**，不持久化到 localStorage：

- 存储位置：`context/layout.tsx` 中独立的 `createStore`
- App 启动时：空状态
- App 关闭时：数据丢失
- App 重启后：重新从空状态开始

**设计原因**：session 记忆仅在当前会话有效，避免跨会话混淆。

### 记录时机

各页面监听 URL 参数变化，记录 session ID：

| 页面 | 文件 | 记录方式 |
|------|------|---------|
| Insight | `pages/insight/index.tsx` | `lastSessionPerTab.setCowork(id)` |
| Make | `pages/make/index.tsx` | `lastSessionPerTab.setMake(id)` |
| Chat | `pages/chat.tsx` | `lastSessionPerTab.setChat(decodedDir, id)` |
| Studio | `pages/studio/index.tsx` | `lastSessionPerTab.setStudio(decodedDir, id)` |

### Tab 切换行为

| 从 | 到 | 导航目标 |
|------|-----|---------|
| Insight | Cowork | `/insight/{id}`（恢复 Insight session） |
| Insight | Make | `/make/{id}`（恢复 Make session） |
| Insight | Chat | `/{dir}/chat/{id}`（使用最后项目目录的 Chat session） |
| Insight | Studio | `/{dir}/studio/{id}`（使用最后项目目录的 Studio session） |
| Make | Cowork | `/insight/{id}`（恢复 Insight session） |
| Make | Chat | `/{dir}/chat/{id}`（同一目录的 Chat session） |
| Make | Studio | `/{dir}/studio/{id}`（同一目录的 Studio session） |
| Chat | Cowork | `/insight/{id}`（恢复 Insight session） |
| Chat | Make | `/make/{id}`（恢复 Make session） |
| Chat | Studio | `/{dir}/studio/{id}`（同一目录的 Studio session） |
| Studio | Cowork | `/insight/{id}`（恢复 Insight session） |
| Studio | Make | `/make/{id}`（恢复 Make session） |
| Studio | Chat | `/{dir}/chat/{id}`（同一目录的 Chat session） |

**无 session 记录时**：导航到 Tab 根路径（不带 session ID）

### 技能库来源管理 (sidebarSource) ★

技能库页面 `/skills` 根据 `sidebarSource` 状态决定显示哪个侧边栏：

```typescript
type SidebarSource = "cowork" | "make"
```

**设置时机**：

| 来源 | 文件 | 设置方式 |
|------|------|---------|
| OctoSidebar | `pages/_shell/sidebar.tsx` | 点击技能库时 `sidebarSource.set("cowork")` |
| MakeSidebar | `pages/make/sidebar.tsx` | 点击技能库时 `sidebarSource.set("make")` |

**默认值**: `"cowork"`

**Tab 显示**: `/skills` 页面的 activeTab 根据 `sidebarSource` 决定：
- `sidebarSource === "make"` → Make Tab 选中
- `sidebarSource === "cowork"` → Insight Tab 选中

### 代码位置

- 状态定义：`context/layout.tsx:54-61`（类型）、`context/layout.tsx:275-280`（store）
- Tab 切换逻辑：`components/titlebar-simple.tsx:110-155`（`handleTabClick` 函数）
- 各页面监听：见上方表格

### OctoSidebar (`pages/_shell/sidebar.tsx`) — **已废弃**

- **顶部项目信息卡片**: 显示当前项目名称、类型、版本等上下文信息 (`ProjectInfo` 组件)
- **"新建"按钮**: 直接创建 Insight session → `/insight/${session.id}`（无下拉菜单）
- **Octo Insight 分组**: 可折叠，标题行含 `/insightIcon.svg` 图标 + 粗体标题 + 折叠箭头，显示 Insight session 列表 (agent: `octo_insight`)
- **底部导航**: 技能库、资产库
  - 技能库点击时：`sidebarSource.set("cowork")` → 导航到 `/skills` ★
- **设置按钮**: 打开 DialogSettings
- **清理机制**: `onCleanup` 中清理防抖 timer，防止组件卸载后触发 refetch
- 使用 `useProjectDir` hook 获取项目目录
- **Onboarding 状态**: 当 `!resolvedDir()` 时（项目引导弹窗显示），不请求 session 列表，显示"请先选择项目目录"而非"暂无对话" ★

**注意**: 此组件已废弃，Insight 页面现在使用独立的 `InsightSidebar`（见下文）。

### InsightSidebar (`pages/insight/sidebar.tsx`) — Insight 侧边栏 ★

Insight 页面使用的独立侧边栏组件，自包含宽度/拖拽/持久化功能。

- **宽度**: 默认 296px，可拖拽调整 (200-420px)
- **持久化**: localStorage 键 `octo:insight:sidebar-width`
- **会话列表**: 使用 `InsightSessionList` 组件（内部实现）
- **两个插槽**: `top` 和 `bottom` props，供宿主注入产品级 chrome
- **拖拽手柄**: 右边界贴 6px 宽拖拽区域
- **背景**: 蓝色渐变 (`linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)`)
- **独立性**: 对外零必填参数，Insight 页面直接渲染

### MakeSidebar (`pages/make/sidebar.tsx`) — Make 侧边栏

- **顶部项目信息卡片**: 同 OctoSidebar
- **"新建"按钮**: 直接创建 Make session → `/make/${session.id}`（无下拉菜单）
- **Octo Make 分组**: 可折叠，标题行含 `/makeIcon.svg` 图标 + 粗体标题 + 折叠箭头，显示 Make session 列表 (agent: `octo_make`)
- **底部导航**: 技能库、资产库
  - 技能库点击时：`sidebarSource.set("make")` → 导航到 `/skills` ★
- **设置按钮**: 打开 DialogSettings

---

## 项目引导弹窗 (DialogProjectOnboarding)

每次启动应用时显示，要求用户选择项目目录。选择后当前会话内不再显示，下次重启会再次显示。

### 组件位置

`octoapp/components/dialog-project-onboarding.tsx`

### 显示逻辑

弹窗通过 `layout.onboarding.show()` signal 控制：
- **初始状态**: `true`（每次启动重置）
- **选择目录后**: 调用 `layout.onboarding.hide()` 设置为 `false`
- **重启后**: 重置为 `true`，再次显示弹窗

**状态存储**: 会话级内存状态（不持久化到 localStorage）

### 行为逻辑

| 场景 | 按钮显示 | 确定按钮 |
|------|---------|---------|
| 首次安装，无持久化数据 | "选择文件夹" placeholder | **禁用**（灰色） |
| 已选择目录 | 目录路径（相对主目录显示为 `~` + 相对路径） | 启用（蓝色） |

### 路径验证

使用 `isValidUserPath()` 过滤无效路径：

```ts
// octoapp/utils/path-valid.ts
export function isValidUserPath(path: string | undefined): boolean {
  if (!path || path === "") return false
  if (path === "/") return false  // Unix root 不适合作为用户工作目录
  // Windows: 排除仅有盘符的路径
  if (/^[A-Z]:$/i.test(path)) return false
  if (/^[A-Z]:[\\/]$/i.test(path)) return false
  return true
}
```

**过滤的无效路径**：
- 空字符串 `""`
- Unix 根目录 `"/"`
- Windows 盘符 `"C:"`, `"D:"`
- Windows 盘符根 `"C:\"`, `"D:/"`

### 文件选择器默认路径

```ts
// dialog-project-onboarding.tsx
const defaultPath = isValidUserPath(directory()) 
  ? directory() 
  : (isValidUserPath(home) ? home : undefined)
```

优先级：当前已选目录 → 用户主目录 → 无默认

### 相关文件

| 文件 | 功能 |
|------|------|
| `octoapp/utils/path-valid.ts` | 路径验证工具函数 |
| `octoapp/components/dialog-project-onboarding.tsx` | 项目引导弹窗组件 |
| `octoapp/hooks/use-project-dir.ts` | 项目目录 hook |
| `octoapp/context/server.tsx` | `projects.touch()` 验证并存储路径 |
| `octoapp/context/platform.tsx` | `OpenDirectoryPickerOptions` 类型定义（含 `defaultPath`） |

### 持久化存储

- **存储位置**: `%APPDATA%\ai.octo.desktop\opencode.global.dat`
- **存储键**: `server.v3.lastProject.{origin}`
- **存储时机**: 仅在 `isValidUserPath(directory)` 返回 `true` 时存储

**resolvedDir Signal**: 单一数据源，通过两个 effect 填充：
```tsx
const [resolvedDir, setResolvedDir] = createSignal<string>()

// Effect 1: 读取 projectDir() (server.projects.last 是 createMemo，响应式)
// 对于老用户，mount 时立即触发并获取持久化的目录
createEffect(() => {
  const d = projectDir()
  if (d) setResolvedDir(d)
})

// Effect 2: 等待 bootstrap 完成后，显式读取 projectDir()
// 此时 pathQuery.data 已缓存，getter 返回真实路径
createEffect(() => {
  if (!globalSync.data.ready) {
    const d = projectDir()
    if (d) setResolvedDir(d)
  }
})

// createResource 依赖 resolvedDir，而非 projectDir
const [sessions] = createResource(
  () => isOnboarding() ? "" : (resolvedDir() ?? ""),
  async (d) => { ... }
)
```

**Session 列表加载**: 使用 `resolvedDir()` 作为 resource fetcher 参数，而非 `projectDir()`，解决首次进入 Insight 页面 session 列表不加载的问题

---

## 产品选择器 (ProjectProductSelect)

项目引导弹窗中用于选择产品&版本的下拉选择器，支持领域 → 产品线 → 产品 → 版本四级联动。

### 组件结构

| 文件 | 功能 |
|------|------|
| `project-product-select.tsx` | Popover 容器，管理选中状态 signal |
| `project-product-select-panel.tsx` | 下拉面板，三列选择 + 搜索功能 |
| `project-product-select-api.ts` | API 接口函数（TODO: 待替换真实后台接口） |
| `project-info-dialog-content.tsx` | 对话框内容，组合产品选择器 + 版本选择 |
| `style/select.css` | 版本选择框样式 |
| `style/switch.css` | "隐藏已结项" Switch 开关样式 |

### 数据流

```
ProjectProductSelect (domain/productLine/product)
  → ProjectInfoDialogContent (+ version)
    → DialogProjectOnboarding (selections store)
      → onSelect(ProjectSelection)
        → project-info.tsx (显示 + 缓存)
```

### 四级选择

| 级别 | 数据来源 | 选择回调 |
|------|----------|----------|
| 领域 | `fetchDomains()` | `onDomainChange` |
| 产品线 | `fetchProductLines(domainId)` | `onProductLineChange` |
| 产品 | `fetchProducts(productLineId)` | `onProductChange` |
| 版本 | `fetchVersions(productId)` | 内部 `createResource` |

### 搜索功能

- 搜索关键词调用 `searchProducts(keyword)`
- 有搜索词时隐藏三列，显示平铺搜索结果（领域 / 产品线 / 产品路径）
- 点击搜索结果自动选中完整链路

### 缓存机制

- `saveCachedSelection()` / `loadCachedSelection()` 基于 localStorage
- 对话框打开时恢复上次选中值
- 确认时保存当前选中值

### 选中高亮实现

使用 `classList` 响应式指令而非 `class` 模板字符串：

```tsx
classList={{ "panel-item": true, "panel-item-selected": item.id === selectedId() }}
```

SolidJS 编译器能正确追踪 `classList` 的 signal 变化，自动添加/移除 class。

### Popover portal 渲染

- 默认 `portal={true}`（渲染到 `document.body`）
- `z-index: 60` 高于 dialog overlay (`z-index: 50`)
- 避免与 dialog 的 outside-click 检测冲突

---

## Session 列表存储位置

Session 数据保存在 **SQLite 数据库** 中：

| 环境 | 数据库路径 |
|------|------------|
| Linux/Mac | `$XDG_DATA_HOME/opencode/opencode.db`（默认 `~/.local/share/opencode/opencode.db`） |
| Windows | `%LOCALAPPDATA%\opencode\opencode.db` |
| Electron Desktop (prod) | `%APPDATA%\ai.octo.desktop\opencode.db` |
| Electron Desktop (dev) | `%APPDATA%\ai.octo.desktop.dev\opencode.db` |
| 自定义 | 设置 `OCTO_DB` 环境变量覆盖 |

### 相关代码位置

- 数据库路径定义：`packages/opencode/src/storage/db.ts:28-41`
- XDG 路径定义：`packages/core/src/global.ts:10`
- Session 表结构：`packages/opencode/src/session/session.sql.ts:16-53`

### Session 表结构

```sql
session (
  id            TEXT PRIMARY KEY  -- Session ID
  project_id    TEXT NOT NULL     -- 项目 ID（外键）
  workspace_id  TEXT              -- 工作区 ID
  parent_id     TEXT              -- 父 session ID
  slug          TEXT NOT NULL     -- URL slug
  directory     TEXT NOT NULL     -- 项目目录
  title         TEXT NOT NULL     -- 标题
  agent         TEXT              -- 使用的 agent
  model         JSON              -- 模型信息 {id, providerID, variant}
  time_created  INTEGER           -- 创建时间
  time_updated  INTEGER           -- 更新时间
  time_archived INTEGER           -- 归档时间
)
```

前端 session 列表通过 `global-sync` context 从后端 API 获取并缓存到内存 (`store.session`)。

---

## Session 标题自动更改机制

新建对话后，标题会根据用户第一条消息自动生成。

### 默认标题格式

`packages/opencode/src/session/session.ts:36-41`:

| 类型 | 格式 | 示例 |
|------|------|------|
| 父 session | `"New session - "` + ISO 时间戳 | `"New session - 2026-05-28T12:30:00.000Z"` |
| 子 session | `"Child session - "` + ISO 时间戳 | `"Child session - 2026-05-28T12:30:00.000Z"` |

### 触发条件

`packages/opencode/src/session/prompt.ts:170-183` (`ensureTitle` 函数):

| 条件 | 说明 |
|------|------|
| `session.parentID` 为空 | 不是子 session（fork 出来的不会触发） |
| `Session.isDefaultTitle()` 返回 true | 标题仍是默认格式（用户手动修改过的不触发） |
| `history.filter(real).length === 1` | 仅第一条真实用户消息（继续已有对话不触发） |

```ts
// "真实"用户消息定义：role === "user" 且不全是 synthetic parts
const real = (m) => m.info.role === "user" && !m.parts.every(p => "synthetic" in p && p.synthetic)
```

### 触发时机

`packages/opencode/src/session/prompt.ts:1457-1463`:

- 在对话循环的第一步 (`step === 1`) 时触发
- 异步执行 (`Effect.forkIn`)，不阻塞主流程
- 错误被静默忽略 (`Effect.ignore`)

### 生成方式

`packages/opencode/src/session/prompt.ts:193-229`:

1. 使用 `title` agent (`packages/opencode/src/agent/prompt/title.txt`)
2. 获取模型：`title` agent 配置的模型 → `small_model` 配置 → 主模型
3. Prompt: `"Generate a title for this conversation:\n"` + 第一条用户消息
4. 流式生成文本，过滤 `<think>` 标签
5. 取第一行非空文本
6. 超过 100 字符截断并加 `"..."`
7. 调用 `sessions.setTitle()` 更新数据库

### 不触发的情况

| 场景 | 原因 |
|------|------|
| Fork 出的对话 | 有 `parentID`，继承父标题 |
| 继续已有对话 | `history.filter(real).length !== 1` |
| 手动修改过标题 | `isDefaultTitle()` 返回 false |
| 无真实用户消息 | 所有 parts 都是 `synthetic: true` |

### 相关代码位置

- 默认标题生成：`packages/opencode/src/session/session.ts:36-47`
- 标题自动生成逻辑：`packages/opencode/src/session/prompt.ts:170-230`
- 触发时机：`packages/opencode/src/session/prompt.ts:1457-1463`
- Title agent prompt：`packages/opencode/src/agent/prompt/title.txt`
- Small model 优先级：`packages/opencode/src/provider/provider.ts:1701-1740`

---

## 思考流程 (Reasoning Process)

Chat 页面消息列表中的"思考中"状态，通过完整的流程从 AI Provider 传递到前端 UI。

### 流程概览

```
AI SDK streamText.fullStream
  → LLM.Service.stream (Effect Stream)
    → SessionProcessor.handleEvent
      → SessionEvent (v2 events) + session.updatePart/updatePartDelta
        → Bus.publish → SSE
          → globalSDK.event.listen (前端)
            → event-reducer (message.part.updated/delta)
              → store.part[messageID] 更新
                → UI 渲染
```

### 数据结构定义

| 层级 | 文件位置 | 内容 |
|------|---------|------|
| **后端 Schema** | `packages/opencode/src/session/message.ts:81-88` | `ReasoningPart` Schema 定义 |
| **SDK 类型** | `packages/sdk/js/src/v2/gen/types.gen.ts:487-500` | 前端使用的 `ReasoningPart` 类型 |
| **v2 事件** | `packages/opencode/src/v2/session-event.ts:176-208` | `Started/Delta/Ended` 三种事件 schema |

### 后端：LLM 层事件产生

| 阶段 | 文件位置 | 说明 |
|------|---------|------|
| **streamText 调用** | `packages/opencode/src/session/llm.ts:336-415` | AI SDK `streamText()` 配置，返回 `result.fullStream` |
| **Stream 封装** | `packages/opencode/src/session/llm.ts:418-432` | `Stream.fromAsyncIterable(result.fullStream)` 封装为 Effect Stream |
| **事件类型** | `packages/opencode/src/session/llm.ts:55` | `Event = Result["fullStream"] extends AsyncIterable<infer T> ? T : never` |

AI SDK `fullStream` 产出的事件类型包括：
- `start`
- `reasoning-start` (id, text, providerMetadata)
- `reasoning-delta` (id, text, providerMetadata)
- `reasoning-end` (id, providerMetadata)
- `text-delta`
- `tool-call` 等

### 后端：Processor 处理事件

**文件**: `packages/opencode/src/session/processor.ts`

| 事件类型 | 代码行 | 处理逻辑 |
|---------|-------|---------|
| **reasoning-start** | 226-244 | 创建 `ReasoningPart`，写入 `ctx.reasoningMap[id]`，发送 v2 `Started` 事件，调用 `session.updatePart()` |
| **reasoning-delta** | 246-257 | 累积文本 `text += value.text`，调用 `session.updatePartDelta({ field: "text", delta })` |
| **reasoning-end** | 259-274 | 发送 v2 `Ended` 事件（含完整 `text`），设置 `time.end`，调用 `session.updatePart()`，删除 `reasoningMap[id]` |

**ProcessorContext 结构** (`processor.ts:70-78`):
```typescript
interface ProcessorContext {
  reasoningMap: Record<string, MessageV2.ReasoningPart>  // 累积 reasoning 内容
  toolcalls: Record<string, ToolCall>
  currentText: MessageV2.TextPart | undefined
  // ...
}
```

### 后端：v2 事件发送

**文件**: `packages/opencode/src/v2/session-event.ts`

| 事件 | Schema | 包含字段 |
|------|--------|---------|
| `session.next.reasoning.started` | 177-185 | `sessionID, reasoningID, timestamp` |
| `session.next.reasoning.delta` | 187-196 | `sessionID, reasoningID, delta, timestamp` |
| `session.next.reasoning.ended` | 198-207 | `sessionID, reasoningID, **text**, timestamp` |

### 后端：session 服务更新 Part

| 方法 | 调用位置 | 作用 |
|------|---------|------|
| `session.updatePart()` | processor.ts:243, 272 | 写入/更新完整 Part 到数据库，触发 `message.part.updated` 事件 |
| `session.updatePartDelta()` | processor.ts:250-256 | 流式追加 delta，触发 `message.part.delta` 事件 |

### 前端：事件接收

**文件**: `packages/app/src/context/global-sync.tsx`

| 代码行 | 功能 |
|-------|------|
| 333-374 | `globalSDK.event.listen()` 监听 SSE 事件，分发到 `applyDirectoryEvent()` |
| 362-373 | 调用 `applyDirectoryEvent()` 处理目录级事件 |

### 前端：事件 Reducer

**文件**: `packages/app/src/context/global-sync/event-reducer.ts`

| 事件 | 代码行 | 处理逻辑 |
|------|-------|---------|
| `message.part.updated` | 219-240 | 更新 `store.part[messageID][index]` 为完整 Part（含 `time.end`） |
| `message.part.delta` | 260-277 | 追加 delta 到 `part[field]`，用于流式显示 |

### 前端：UI 渲染

**文件**: `packages/ui/src/components`

| 组件 | 文件位置 | 功能 |
|------|---------|------|
| **SessionTurn** | `session-turn.tsx:364-369` | `showThinking` 计算属性：判断是否显示 "Thinking..." 状态 |
| **SessionTurn** | `session-turn.tsx:414-426` | 渲染 `<TextShimmer>` 显示 "Thinking..." 动画 |
| **partState()** | `session-turn.tsx:95-108` | 判断 Part 是否可见（reasoning 需 `showReasoningSummaries && text.trim()`） |
| **ReasoningPartDisplay** | `message-part.tsx:1506-1550` | 渲染完成的 reasoning 内容：折叠面板 + "已深度思考（用时Xs）" |

**showThinking 逻辑** (`session-turn.tsx:364-369`):
```tsx
const showThinking = createMemo(() => {
  if (!working() || !!error()) return false       // 不工作或有错误时不显示
  if (status().type === "retry") return false     // 重试时不显示
  if (showReasoningSummaries()) return assistantVisible() === 0  // 有 reasoning summaries 时，无可见内容才显示
  return true                                    // 默认显示
})
```

### 思考状态判断

| 状态 | 判断依据 | UI 表现 |
|------|---------|---------|
| **思考中** | `streaming() === true` (`message-part.tsx:1508-1510`) | `<TextShimmer>` 动画 + "Thinking..." |
| **思考结束** | `typeof time.completed === "number"` 或 `time.end` 存在 | 折叠面板："已深度思考（用时Xs）" |
| **会话空闲** | `session_status[id].type === "idle"` | 不显示 Thinking 状态 |

### 相关文件列表

| 类别 | 文件路径 |
|------|---------|
| 后端事件定义 | `packages/opencode/src/v2/session-event.ts` |
| 后端处理器 | `packages/opencode/src/session/processor.ts` |
| 后端 LLM 层 | `packages/opencode/src/session/llm.ts` |
| 状态管理 | `packages/opencode/src/session/status.ts` |
| 前端事件 reducer | `packages/app/src/context/global-sync/event-reducer.ts` |
| 前端 global-sync | `packages/app/src/context/global-sync.tsx` |
| UI 组件 | `packages/ui/src/components/session-turn.tsx`, `packages/ui/src/components/message-part.tsx` |
| SDK 类型 | `packages/sdk/js/src/v2/gen/types.gen.ts` |
| 详细分析文档 | `analysis/reasoning-process.md` |

---

## Make 页面：阻塞检测功能

当模型生成内容时，如果超过一定时间无新内容到达，会触发阻塞检测并显示渐进式提示。

### 阻塞检测逻辑

**触发条件**：
- `isBusy()` = session 正在执行
- `Date.now() - lastDeltaTime > 3000`（超过 3 秒无新内容）

**数据流**：
```
SSE "message.part.delta" 事件
  → setLastDeltaTime(Date.now())
    → setBlockTime(0)（重置阻塞计时）
  
每秒定时检测
  → 计算阻塞时间 = Date.now() - lastDeltaTime()
    → 若 > 3000ms，setBlockTime(Math.floor(blockedMs / 1000))
      → UI 根据 blockTime 显示渐进式提示
```

### 渐进式提示策略

| 阻塞时间 | 提示内容 | 样式 | 操作 |
|---------|---------|------|------|
| **< 30秒** | 无提示 | - | - |
| **30-59秒** | "模型响应较慢，请耐心等待..." | 灰色轻提示（边框 + 淡灰背景） | - |
| **≥ 60秒** | "模型超过 X分X秒 没有响应，建议重新请求" | 黄色警告（边框 + 橙色背景） | [中止对话] 按钮 |

### UI 渲染位置

**文件**: `octoapp/pages/make/components/insight-turn.tsx:1222-1249`

阻塞提示显示在：
- 生成中 artifact 卡片下方
- 已执行时间下方
- 仅在最新 turn（`showGenerating()`）显示

### 执行计时器

**文件**: `octoapp/pages/make/index.tsx:285-311`

显示"已执行 X秒"计时，位置已从顶部标题栏移至 artifact 卡片下方。

**数据来源**：
- 查找最新未完成的 assistant 消息（`time.completed === undefined`）
- 计时起点：`pending.time.created`（消息创建时间）
- 计时方式：`Date.now() - start`，每秒更新
- 显示位置：artifact 卡片下方（`insight-turn.tsx:1212-1219`）

### 相关代码位置

| 功能 | 文件位置 |
|------|---------|
| 阻塞检测状态 | `octoapp/pages/make/index.tsx:313-330` |
| delta 事件重置 | `octoapp/pages/make/index.tsx:240-242` |
| 执行计时器 | `octoapp/pages/make/index.tsx:285-311` |
| 阻塞提示 UI | `octoapp/pages/make/components/insight-turn.tsx:1222-1249` |
| 时间格式化 | `octoapp/pages/make/components/insight-turn.tsx:197-213` |
| props 定义 | `octoapp/pages/make/components/insight-turn.tsx:361-373` |

---

## Session 状态判断逻辑 (isBusy)

各页面判断 session 是否正在执行时，应**仅依赖 `sessionStatus`**，避免使用 message completion 检查导致状态不一致。

### isBusy 实现对比

| 页面 | 文件位置 | isBusy 逻辑 |
|------|----------|------------|
| **Studio** | `octoapp/pages/studio/index.tsx:490` | `sending() \|\| sessionStatus().type === "busy"` |
| **Insight** | `octoapp/pages/insight/index.tsx:247` | `sessionStatus().type === "busy"` |
| **Chat** | `octoapp/pages/session/composer/session-composer-state.ts:185` | `state.busy()` (基于 sessionStatus) |
| **Make** | `octoapp/pages/make/index.tsx:283` | `sessionStatus().type !== "idle"` |

### 状态数据流

```
后端 SessionRunState
  → SessionStatus.set(sessionID, { type: "busy" })
    → Bus.publish Event.Status → SSE "session.status"
      → 前端 event-reducer → store.session_status[sessionID]
        → UI sessionStatus() → isBusy()
```

当 session 进入 idle 状态时：
```
后端 Runner.onIdle → SessionStatus.set(sessionID, { type: "idle" })
  → Bus.publish Event.Status + Event.Idle
    → SSE "session.status" + "session.idle"
      → 前端 store.session_status[sessionID] = { type: "idle" }
```

### 问题：Message Completion 检查（已移除）

**旧实现**（已废弃）：
```tsx
const isBusy = createMemo(() => {
  if (sessionStatus().type !== "idle") return true
  // 第二层检查：message completion（已移除）
  return messages.some(
    (item) => item.role === "assistant" && typeof item.time.completed !== "number",
  )
})
```

**问题场景**：
1. 模型回复中途用户关闭 app → assistant message.time.completed 未写入数据库
2. 用户重新打开 app → 后端 session 已 idle，SSE 发送 session.status + session.idle
3. 前端从数据库加载消息 → assistant message.time.completed 仍为 undefined
4. isBusy() 第二层检查返回 true → UI 显示"正在执行"
5. 停止按钮调用 abort() → 后端 session 已 idle，无法中止

**修复**：移除 message completion 检查，仅依赖 sessionStatus。

### 相关文件

| 类别 | 文件路径 |
|------|---------|
| 前端 Make isBusy | `octoapp/pages/make/index.tsx:283` |
| 前端 Studio isBusy | `octoapp/pages/studio/index.tsx:490` |
| 前端 Insight isBusy | `octoapp/pages/insight/index.tsx:247` |
| 后端 SessionStatus | `packages/opencode/src/session/status.ts` |
| 后端 SessionRunState | `packages/opencode/src/session/run-state.ts` |
| 前端 event-reducer | `packages/app/octoapp/context/global-sync/event-reducer.ts:179-183` |

---

## Make 页面：拖拽分隔条 Bug 修复

Make 页面对话面板和结果预览之间的分隔条（`octo-split-handle`）拖拽时，鼠标进入 iframe 区域后松开会导致拖拽卡住。

### 问题原因

拖拽流程中鼠标进入 `<iframe>`（HtmlRenderer 的预览区域）：

```
用户拖拽分隔条 → document 监听 mouseup
  → 鼠标移动进入 iframe 区域
    → iframe 内部文档触发 mouseup 事件
      → 事件不会冒泡到父页面
        → 父页面的 mouseup 监听器永远不触发
          → 拖拽卡住，document.body 保持 col-resize 状态
```

### 解决方案：Overlay 覆盖层

拖拽开始时创建透明覆盖层，确保鼠标始终在父页面文档上：

```tsx
function handleDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = chatWidth()
  
  // 创建透明 overlay，覆盖整个页面（包括 iframe）
  const overlay = document.createElement("div")
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 9999;
    cursor: col-resize;
    background: transparent;
  `
  document.body.appendChild(overlay)
  
  const onMove = (ev: MouseEvent) => {
    setChatWidth(Math.max(MIN_CHAT, Math.min(MAX_CHAT, startWidth + ev.clientX - startX)))
  }
  const onUp = () => {
    overlay.remove()  // 移除覆盖层
    localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth()))
    overlay.removeEventListener("mousemove", onMove)
    overlay.removeEventListener("mouseup", onUp)
  }
  overlay.addEventListener("mousemove", onMove)
  overlay.addEventListener("mouseup", onUp)
}
```

### 为什么使用 Overlay 而非其他方案

| 方案 | 缺点 |
|------|------|
| **pointer-events: none** | iframe 内部所有交互失效，包括预览功能 |
| **window.addEventListener** | 需监听所有 iframe window，复杂且难维护 |
| **drag overlay（采用）** | 简洁可靠，不影响 iframe 功能 |

### 相关文件

| 文件 | 功能 |
|------|------|
| `octoapp/pages/make/index.tsx:397-430` | 分隔条拖拽处理 `handleDividerMouseDown` |
| `octoapp/pages/make/octo-tokens.css:88-94` | `.octo-split-handle` 样式 |
| `octoapp/pages/make/components/result-viewer/html-renderer.tsx` | iframe 预览渲染 |

---

## 子 Agent 中止机制 (Subagent Abort)

Make 页面点击中止按钮时，需要正确停止正在运行的子 agent（通过 Task tool 调用的 `make_component` 等子任务）。

### 子任务 UI 显示

`InsightTurn` 组件 (`octoapp/pages/make/components/insight-turn.tsx`) 中，子任务卡片 (`SubtaskInfo`) 有四种状态：

| 状态 | UI 表现 | 触发条件 |
|------|---------|----------|
| **running** | 蓝色动画点 + "运行中" | `state.status !== "error"` 且无输出 |
| **done** | 绿色标签 + "完成" | `state.status === "completed"` 或有输出 |
| **cancelled** | 灰色标签 + "已中止" | `state.status === "error"` 且 `error === "Cancelled"` 或 `"Tool execution aborted"` |
| **error** | 红色标签 + "错误" | 其他错误情况 |

### 子任务卡片展开状态持久化

子任务卡片支持折叠/展开操作。展开状态通过 `createStore` 提升到 `<For>` 外部管理，确保用户折叠后状态在以下场景持久化：

- **新消息提交时**：当用户发送新消息，`userMessages()` 和 `subtasks()` memo 重算不会重置已折叠的卡片展开状态
- **组件重渲染时**：状态独立于渲染周期，不受 SolidJS `<For>` 回调重算影响

**实现原理**：

```tsx
// 状态提升到 For 外部 (insight-turn.tsx:378-379)
const [subtaskExpandState, setSubtaskExpandState] = createStore<Record<string, boolean>>({})

// For 回调内使用提升的状态，而非 createSignal (insight-turn.tsx:997-1005)
<For each={subtasks()}>
  {(task) => {
    // 初始化默认展开 (true)
    if (subtaskExpandState[task.subSessionID] === undefined) {
      setSubtaskExpandState(task.subSessionID, true)
    }
    const expanded = () => subtaskExpandState[task.subSessionID] ?? true
    // onClick 使用 setSubtaskExpandState 切换状态
  }}
</For>
```

**问题背景**：

之前使用 `createSignal(true)` 在 `<For>` 回调内部，当用户发送新消息时：
1. `msgStore` 变化 → 所有 `InsightTurn` 的 `assistantMsgs()` 重算
2. `assistantParts()` 重算 → `subtasks()` 返回新数组引用
3. SolidJS `<For>` 响应式追踪 → 回调函数重新执行
4. 新 `createSignal(true)` 创建 → 展开状态重置为 `true`

**修复方案**：状态提升到外部 `createStore`，与渲染周期解耦。

**代码位置**：

| 部分 | 文件位置 |
|------|---------|
| 状态定义 | `octoapp/pages/make/components/insight-turn.tsx:378-379` |
| 状态初始化 | `octoapp/pages/make/components/insight-turn.tsx:998-1000` |
| 状态使用 | `octoapp/pages/make/components/insight-turn.tsx:1001, 1005, 1010, 1045` |

### 中止流程

```
用户点击中止 → sdk.client.session.abort({ sessionID })
  → SessionPrompt.cancel → SessionRunState.cancel
    → Runner.cancel → Fiber.interrupt(fiber)
      → Effect.onInterrupt 触发
        ├→ taskAbort.abort() → AbortSignal abort 事件
        │    → Task tool onAbort → Effect.runPromise(ops.cancel(childSessionID))
        └→ prompt.ts 直接从 metadata 提取 childSessionID
             → state.cancel(childSessionID)
               → 子 agent runner.cancel → Fiber.interrupt(subSessionFiber)
                 → ToolState 设置为 { status: "error", error: "Cancelled" }
                   → SSE message.part.updated 事件
                     → 前端 event-reducer 更新 store.part
                       → UI 读取 state.status + state.error → 显示 "已中止"
```

### 双重保障机制

中止机制有两层保障确保子 agent 正确停止：

| 层级 | 文件位置 | 机制 |
|------|----------|------|
| **AbortSignal 监听** | `tool/task.ts:127-134` | `onAbort` 使用 `Effect.runPromise` 执行 cancel，确保在 AbortSignal 触发时执行 |
| **Effect 中断** | `session/prompt.ts:664-693` | `handleSubtask` 的 `onInterrupt` 直接从 `metadata.sessionId` 提取子 session ID 并调用 `state.cancel()` |

### 错误消息来源

中止时设置的错误消息有两个来源：

| 来源 | 错误消息 | 文件位置 |
|------|----------|----------|
| `handleSubtask` 中断 | `"Cancelled"` | `session/prompt.ts:684` |
| AI SDK tool 执行中断 | `"Tool execution aborted"` | `session/processor.ts:635` |

UI 层 (`insight-turn.tsx:520`) 同时识别两种消息：
```ts
const isCancelled = stateStatus === "error" && 
  (stateError === "Cancelled" || stateError === "Tool execution aborted")
```

### 相关文件

| 类别 | 文件路径 |
|------|---------|
| 前端中止按钮 | `octoapp/pages/make/index.tsx:615-619` (`halt()` 函数) |
| 前端子任务状态判断 | `octoapp/pages/make/components/insight-turn.tsx:505-540, 595-607` |
| 前端子任务 UI 标签 | `octoapp/pages/make/components/insight-turn.tsx:1017-1026` |
| 后端 Task tool abort 监听 | `packages/opencode/src/tool/task.ts:127-134` |
| 后端 handleSubtask 中断处理 | `packages/opencode/src/session/prompt.ts:664-693` |
| 后端 processor tool 中断 | `packages/opencode/src/session/processor.ts:630-644` |
| 后端 Runner cancel | `packages/opencode/src/session/run-state.ts:77-85` |
| 后端 Runner 实现 | `packages/opencode/src/effect/runner.ts:176-207` |

---

## Make 页面：生成中 Delta 日志显示

Make 页面的消息渲染组件（`insight-turn.tsx`）在生成过程中，通过 `WaitingPill` 组件显示实时状态和内容。

### 数据流

```
SSE message.part.delta 事件
  → MakeContent (index.tsx) 监听 sdk.event.listen
    → setDeltaLog() 记录最新 20 条
      → InsightTurn props.deltaLog
        → WaitingPill filteredDeltaLog()
          → 条件渲染：累积文本为空时显示 delta 日志
```

### 条件显示逻辑

| 条件 | 显示内容 |
|------|---------|
| `accumulatedText.length === 0` | 实时 delta 日志（最新 20 条，格式：`[HH:mm:ss] field delta片段`） |
| `accumulatedText.length > 0` | 累积文本内容 |

### DeltaLogEntry 类型

```typescript
export type DeltaLogEntry = {
  timestamp: number    // 事件时间戳
  eventType: string    // 事件类型："message.part.delta"
  messageID: string    // 消息 ID
  partID: string       // Part ID
  field: string        // 字段名：通常为 "text"
  delta: string        // Delta 内容片段
}
```

### 相关文件

| 文件 | 功能 |
|------|------|
| `octoapp/pages/make/index.tsx` | SSE 事件监听，deltaLog signal |
| `octoapp/pages/make/components/insight-turn.tsx` | WaitingPill 组件，DeltaLogEntry 类型导出 |

---

## 图标系统 (`packages/ui/src/components/logo.tsx`)

Octo AI 应用包含三种主要图标：

| 图标 | viewBox | 描述 |
|------|---------|------|
| **Mark** | `0 0 16 20` | 品牌标志：粗黑边框长方形，上半部分空白，下半部分灰色填充 |
| **Splash** | `0 0 80 100` | 启动页图标：放大版 Mark，用于加载界面 |
| **Logo** | `0 0 234 42` | 完整品牌标识：Mark + "Octo AI" 文字 |

### Mark 图标结构

```
viewBox="0 0 16 20"
- 外框：M16 20H0V0H16V20Z (黑色边框)
- 内部下半部分：M12 16H4V8H12V16Z (灰色填充)
- 内部上半部分：空白
```

### Shell 图标文件位置

`octoapp/pages/_shell/icons/`：
- `OctoLogo.svg` - Octo Logo
- `IconChat.svg` / `IconChat1.svg` - Chat 图标 (默认/激活)
- `IconCowork.svg` / `IconCowork1.svg` - Cowork 图标
- `IconStudio.svg` / `IconStudio1.svg` - Studio 图标
- `IconSkill.svg` / `IconSkill1.svg` - 技能库图标
- `IconAsset.svg` / `IconAsset1.svg` - 资产库图标
- `IconSettings.svg` / `IconSettings1.svg` - 设置图标
- `IconSearch.svg` - 搜索图标
- `IconHost.svg` - Host 图标 (彩色渐变球) ★

### 应用图标文件位置

Electron Desktop 应用图标位于 `packages/desktop/icons/`：
- `icons/prod/` - 生产环境图标
- `icons/beta/` - Beta 环境图标
- `icons/dev/` - 开发环境图标

格式：`icon.ico` (Windows), `icon.icns` (macOS), `icon.png` (通用), `dock.png` (macOS Dock)

### 加载界面图标

刷新页面/数据库迁移时显示的图标是 **Splash** (`packages/ui/src/components/logo.tsx:18-32`)，渲染在 `packages/desktop/src/renderer/loading.tsx:67`：

```tsx
<Splash class="w-20 h-25 opacity-15" />
```

### Electron 右键菜单配置

Electron Desktop 应用通过 `electron-context-menu` 包配置渲染进程的右键菜单。

**配置位置**：`packages/desktop/src/main/index.ts:14`

```ts
contextMenu({
  showSaveImageAs: true,
  showLookUpSelection: false,
  showSearchWithGoogle: false,
  showSelectAll: false,        // 禁用 "Select All"
})
```

**菜单项说明**：

| 选项 | 值 | 说明 |
|------|-----|------|
| `showSaveImageAs` | `true` | 图片右键显示 "Save Image As..." |
| `showLookUpSelection` | `false` | 禁用 macOS "Look Up {selection}" |
| `showSearchWithGoogle` | `false` | 禁用 "Search with Google" |
| `showSelectAll` | `false` | 禁用 "Select All"（避免误触全选） |

**设计原因**：
- Select All 在编辑场景容易误触导致全选覆盖，且用户可通过 Cmd+A/Ctrl+A 快捷键执行
- Inspect Element 在开发和调试场景有实际用途，保留以支持问题排查

---

## Chat Tab 页面结构

切换到 **Chat Tab** (导航到 `/:dir/chat/:id?`) 时，页面结构如下：

### 布局示意图

```
┌─────────────────────────────────────────────────────────────────────┐
│  TitlebarSimple (顶部栏，含 Logo + 四 Tab + 搜索/头像)               │
│  Chat (active)  │  Insight  │  Make  │  Studio                     │
├─────────┬───────────────────────────────────────────────────────────┤
│         │                                                            │
│ Sidebar │          SessionPage                                       │
│ (左侧边栏)│          (路由匹配的页面)                                 │
│         │                                                            │
│ ┌─────┐ │  ┌─────────────────────────────────────────────────────┐  │
│ │ Chat│ │  │                                                     │  │
│ │─────│ │  │                                                     │  │
│ │     │ │  │                                                     │  │
│ │新建 │ │  │                                                     │  │
│ │对话 │ │  │                                                     │  │
│ │     │ │  │                                                     │  │
│ │─────│ │  │                     消息列表                        │  │
│ │历史 │ │  │                    (MessageTimeline)                │  │
│ │记录 │ │  │                                                     │  │
│ │     │ │  │                                                     │  │
│ │─────│ │  │                                                     │  │
│ │设置 │ │  │                                                     │  │
│ └─────┘ │  └─────────────────────────────────────────────────────┘  │
│         │  ┌─────────────────────────────────────────────────────┐  │
│         │  │                  PromptInput                        │  │
│         │  │              (底部对话输入区)                        │  │
│         │  │   ┌──────────────────────────────────────────────┐  │  │
│         │  │   │ textarea + Agent/Model/Variant 选择器        │  │  │
│         │  │   └──────────────────────────────────────────────┘  │  │
│         │  └─────────────────────────────────────────────────────┘  │
└─────────┴───────────────────────────────────────────────────────────┘
```

### 层级结构

```
AppShellProviders → Layout (layoutnet.tsx)
├── TitlebarSimple
│   ├── Logo + Octo AI 标题
│   ├── 四 Tab 分段控制 (Chat/Insight/Make/Studio)
│   └── 搜索栏 (右侧，与 Cowork 页风格一致)
│       └── 原 Sidebar 搜索框已注释保留
│       └── 原 SessionHeader Portal 搜索栏已注释保留
└── ChatPage (路由组件 `pages/chat.tsx`)
    ├── Sidebar (宽度可拖拽 160-360px，已持久化)
    │   ├── Chat 标题
    │   ├── 新建对话按钮
    │   ├── 历史记录 (按日期分组，归档图标已隐藏)
    │   └── 设置按钮
    ├── 拖拽句柄
    └── SessionProviders
        └── SessionPage
            ├── 消息列表 (MessageTimeline)
            │   └── SessionHeader (搜索栏 Portal 已注释保留)
            │   └── 消息右上角菜单 (分享/归档已隐藏，重命名失焦自动保存)
            └── PromptInput (底部对话输入区)
                ├── textarea
                └── DockTray (Agent/Model/Variant 选择器)
```

### 关键点

- Chat Tab 导航到 `/:dir/chat/:id?`
- 使用 `AppShellProviders` 布局（Chat/Studio 不带侧栏包裹）
- Sidebar 仅显示 `octo_ai` agent 的 session
- **搜索栏位置**: 在 `TitlebarSimple` 右侧，与 Cowork 页风格一致
  - 原 Sidebar 搜索框已完全移除
  - 原 SessionHeader Portal 搜索栏 (`session-header.tsx:284-313`) 已注释保留
- **Sidebar 宽度持久化**: 使用 `Persist.global("chat.sidebar.width")` 持久化，切换 Tab 后保留
- **Session 列表归档图标**: 通过 `showArchive={false}` 隐藏（调用处传入 prop，`sidebar-items.tsx:247` 默认 `props.showArchive ?? true`）
- **Session 点击标记已查看**: `onMarkViewed` 回调调用 `notification.session.markViewed(session.id)` (`sidebar-items.tsx:218`)
- **消息菜单**: 分享和归档选项已注释隐藏 (`message-timeline.tsx:883-897`)
- **重命名功能**: 失焦时自动保存 (`message-timeline.tsx:820`)
- **Sidebar 样式**: 使用 `headerLogo.png` 替代文字 Logo，更新了 session 列表和新建按钮布局 ★
- **模型持久化**: `lastState` 内存缓存跨 `LocalProvider` 生命周期保持模型状态；`savedReady()` 守卫防止异步持久化未加载时返回错误模型；draft 模式支持模型缓存恢复 ★
- SessionPage 包含消息列表和对话输入区
- Agent 自动设置为 `octo_ai`
- **Followup 队列机制**: AI 响应期间发送的消息自动排队，响应完成后自动发送 ★
- **回答时禁止输入**: PromptInput 组件新增 `disabled` prop，busy 状态下输入框、附加文件按钮、发送按钮全部禁用 ★

### 回答时禁止输入

AI 响应期间 (`busy` 状态)，PromptInput 所有交互元素被禁用。

**状态区分**：

| 状态 | 含义 | Composer 区域 | PromptInput |
|------|------|---------------|-------------|
| `blocked` | permission/question 阻塞 | **隐藏** 整个 composer | N/A |
| `busy` | AI 响应中 | **显示** composer | **禁用** 输入框 + 附加文件按钮 + 发送按钮 |

**实现位置**：

| 文件 | 功能 |
|------|------|
| `session-composer-state.ts:44-48` | `blocked` 状态定义 |
| `session-composer-state.ts:185-196` | `busy` 状态导出 |
| `prompt-input.tsx:72` | `disabled?: boolean` prop 定义 |
| `prompt-input.tsx:1354` | 输入框 `contenteditable={props.disabled ? "false" : "true"}` |
| `prompt-input.tsx:1373` | 输入框禁用样式：`opacity-50 cursor-not-allowed` |
| `prompt-input.tsx:1429` | 附加文件按钮 `disabled={store.mode !== "normal" || props.disabled}` |
| `prompt-input.tsx:1584` | 发送按钮 `disabled={props.disabled || (!working() && blank())}` |
| `session-composer-region.tsx:271` | 传递 `disabled={props.state.busy()}` |

---

## Session 删除清理机制

删除 session 时需要清理两部分数据，防止删除后显示旧内容或导航错误。

### 问题场景

| 问题 | 原因 | 表现 |
|------|------|------|
| **缓存残留** | `sync.data.message[id]` 未清理 | 删除后仍显示旧消息 |
| **导航残留** | `lastSessionPerTab` 未清理 | Tab 切换后导航到已删除 session |

### Chat 和 Studio 共享 Sync Store

```
/:dir (DirectoryLayout)
  ├── /chat/:id? → SyncProvider → sync.data (共享)
  └── /studio/:id? → globalSync.child(projectDir) → syncStore (共享)
```

两者都使用 `octoSessionsDir(config)` 作为目录，指向 `.../octo/sessions`。

### 修复实现

**位置**：`message-timeline.tsx`

```tsx
// 1. 导入
import { dropSessionCaches } from "@/context/global-sync/session-cache"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"

// 2. 删除 session 时清理缓存
sync.set(
  produce((draft) => {
    draft.session = draft.session.filter((s) => !removed.has(s.id))
    dropSessionCaches(draft, removed) // 清理 message/part/todo 等
  }),
)

// 3. 导航无新 session 时清理 lastSessionPerTab
const navigateAfterSessionRemoval = (sessionID, parentID, nextSessionID) => {
  // ...
  if (!nextSessionID && !parentID) {
    const decoded = decode64(params.dir)
    if (decoded) layout.lastSessionPerTab.setChat(decoded, "")
  }
  navigate(`/${params.dir}/chat`)
}
```

### `dropSessionCaches` 清理内容

| 缓存 | 说明 |
|------|------|
| `message[sessionID]` | 消息列表 |
| `part[messageID]` | 消息 parts |
| `todo[sessionID]` | Todo 列表 |
| `session_diff[sessionID]` | Diff 列表 |
| `session_status[sessionID]` | Session 状态 |
| `permission[sessionID]` | 权限请求 |
| `question[sessionID]` | 问题请求 |

**定义位置**：`context/global-sync/session-cache.ts:23-41`

---

## Make 页面项目切换清理机制

切换项目文件夹时，Make 页面需要清理不属于新项目的 session 数据，防止旧内容残留。

### 问题场景

| 问题 | 原因 | 表现 |
|------|------|------|
| **数据残留** | `sync.data.message[id]` 未清理 | 切换项目后仍显示旧 session 内容 |
| **导航残留** | `lastSessionPerTab` 未清理 | Tab 切换回来时恢复旧 session |

### 数据存储架构

Make 页面的 session 数据存储在 `homeDir` 的全局 child store 中：

```
/make/:id?
  → SDKProvider(directory: homeDir)
    → SyncProvider → sync.data (全局共享)
```

所有 Make sessions 都存储在同一个 store 中，不按项目隔离。

### 修复实现

**位置**：`pages/make/index.tsx`

```tsx
// 1. 监听项目切换
createEffect(
  on(
    projectDir,
    (newDir, oldDir) => {
      if (!newDir || !oldDir || newDir === oldDir) return
      
      const currentId = params.id
      if (!currentId) return

      // 检查当前 session 是否属于新项目
      const client = globalSDK.createClient({ directory: newDir })
      void client.session.list().then((result) => {
        const sessions = (result.data ?? []) as Session[]
        const belongsToNewProject = sessions.some(
          s => s.id === currentId && s.agent === "octo_make"
        )
        
        if (!belongsToNewProject) {
          // 清理旧 session 数据
          const [store, setStore] = globalSync.child(sdk.directory)
          dropSessionCaches(store, [currentId])
          setStore(
            produce((draft) => {
              delete draft.message[currentId]
              delete draft.session_status[currentId]
            }),
          )
          
          // 清除 lastSessionPerTab 记录，防止切换回来时恢复
          layout.lastSessionPerTab.setMake("")
          
          // 导航到空态
          navigate("/make")
        }
      })
    },
  ),
)

// 2. 切换 session 时清理旧数据
createEffect(
  on(
    () => params.id,
    (newId, oldId) => {
      if (oldId && oldId !== newId) {
        const [store, setStore] = globalSync.child(sdk.directory)
        dropSessionCaches(store, [oldId])
        setStore(
          produce((draft) => {
            delete draft.message[oldId]
            delete draft.session_status[oldId]
          }),
        )
      }

      if (newId) {
        layout.lastSessionPerTab.setMake(newId)
        void sync.session.sync(newId)
      }
    },
  ),
)
```

### 清理流程

```
切换项目文件夹
  │
  ▼
检查当前 session 是否属于新项目
  │
  ├─ 属于 → 保持当前 session
  │
  └─ 不属于 → 清理旧数据
       │
       ├─ dropSessionCaches(store, [currentId])
       ├─ delete message[currentId]
       ├─ delete session_status[currentId]
       ├─ lastSessionPerTab.setMake("")
       └─ navigate("/make")
```

### 相关文件

| 文件 | 功能 |
|------|------|
| `pages/make/index.tsx:164-199` | 项目切换监听 + 清理逻辑 |
| `pages/make/index.tsx:201-214` | Session 切换清理逻辑 |
| `context/global-sync/session-cache.ts` | `dropSessionCaches` 函数 |
| `hooks/use-project-dir.ts` | 项目目录 hook |

---

## 模型选择器架构

### Chat 页面模型选择器

Chat 页面仅包含 **一个** 模型选择器，位于 `PromptInput` 组件底部：

```
chat.tsx → SessionPage (lazy import)
         → session.tsx → SessionComposerRegion
                       → PromptInput
                       → ModelSelectorPopover (单个)
```

**组件位置**：`prompt-input.tsx:1526-1542`

### 双 UI 机制：付费/未付费用户

`PromptInput` 根据用户是否连接付费 provider，显示不同的模型选择 UI：

```tsx
<Show when={providers.paid().length > 0} fallback={<DialogSelectModelUnpaid />}>
  <ModelSelectorPopover />
</Show>
```

| 用户类型 | `providers.paid().length` | 显示组件 | 功能 |
|----------|---------------------------|----------|------|
| **付费用户** | `> 0` | `ModelSelectorPopover` | 下拉选择已连接的付费模型 |
| **未付费用户** | `=== 0` | `DialogSelectModelUnpaid` | 弹窗显示免费模型 + 添加 provider 引导 |

### `providers.paid()` 定义

`use-providers.ts:38-42`:

```ts
paid: () => {
  const connected = new Set(providers().connected)
  return providers().all.filter(
    (p) => connected.has(p.id) && (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
  )
}
```

**判定逻辑**：
1. Provider 已连接 (`connected.has(p.id)`)
2. 满足以下任一条件：
   - 非 `opencode` provider（如 anthropic、openai、google 等）
   - `opencode` provider 但有至少一个付费模型 (`cost?.input > 0`)

### DialogSelectModelUnpaid 弹窗

**触发条件**：`providers.paid().length === 0`

**显示内容**：
- **免费模型列表**：带 "Free" 和 "Latest" 标签
- **添加 Provider 区域**：热门 provider（opencode、anthropic、openai 等）+ "查看全部"按钮

**组件位置**：`dialog-select-model-unpaid.tsx`

### Insight/Make 页面模型选择器

Insight 和 Make 页面各有 **两个** 模型选择器，但互斥显示：

| 状态 | 显示位置 | 文件位置 |
|------|----------|----------|
| **空态界面**（无消息） | 底部输入区 | `insight/index.tsx:1094-1109` |
| **对话界面**（有消息） | 底部输入区 | `insight/index.tsx:1280-1295` |

两个选择器由 `<Show when={...} fallback={...}>` 控制，不会同时渲染。

---

## Followup 队列机制

当用户在 AI 响应期间发送新消息时，消息会自动排队等待，响应完成后自动发送。

### 配置位置

| 配置项 | 文件位置 | 默认值 |
|--------|----------|--------|
| `settings.general.followup` | `context/settings.tsx:110` | `"queue"` |

### 队列模式选项

| 模式 | 行为 |
|------|------|
| `"queue"` | AI 响应期间发送的消息排队，完成后自动发送 |
| `"steer"` | 不排队，前端需手动处理（旧默认值，已弃用） |

### 队列流程

```
用户发送消息
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  handleSubmit (submit.ts:290)                           │
│  ├── session busy? → shouldQueue?.()                    │
│  │     ├── YES → onQueue(draft) → 入队                  │
│  │     └── NO  → sendFollowupDraft()                    │
└─────────────────────────────────────────────────────────┘
    │
    ▼ session 变 idle
┌─────────────────────────────────────────────────────────┐
│  createEffect (session.tsx:1711-1725)                   │
│  ├── 检查队列是否有消息                                   │
│  ├── session idle + !blocked + 有排队消息                │
│  └── void sendFollowup(sessionID, item.id)              │
└─────────────────────────────────────────────────────────┘
```

### 相关代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| 队列启用判断 | `pages/session.tsx` | 1554-1558 |
| 入队函数 | `pages/session.tsx` | 1577-1584 |
| 自动 flush 队列 | `pages/session.tsx` | 1711-1725 |
| 提交时入队检查 | `components/prompt-input/submit.ts` | 435-440 |
| 设置默认值 | `context/settings.tsx` | 110 |

### 注意事项

- **子 session 不入队**: `isChildSession()` 检查阻止 fork 的 session 入队
- **blocked 状态不入队**: permission/question 阻塞时不入队
- **Insight 页面独立队列**: Insight 使用简化队列逻辑（单容量，覆盖式入队）

---

## Insight Tab 页面结构

切换到 **Insight Tab** (导航到 `/insight` 或 `/insight/:id`) 时，页面结构如下：

### 布局示意图

```
┌─────────────────────────────────────────────────────────────────────┐
│  TitlebarSimple (顶部栏，含 Logo + 四 Tab + 搜索/头像)               │
│  Chat  │  Insight (active)  │  Make  │  Studio                       │
├─────────┬───────────────────────────────────────────────────────────┤
│         │                                                            │
│ Octo    │              InsightPage (空态页或对话)                    │
│ Sidebar │                                                            │
│         │  ┌─────────────────────────────────────────────────────┐  │
│┌───────┐│  │                                                     │  │
││ProjInf││  │          IllustrationInsightEmpty (166x166)         │  │
│├───────┤│  │                                                     │  │
││+新建  ││  │                 Octo Insight                         │  │
││交付件 ││  │             AI辅助用户洞察研究                        │  │
│├───────┤│  │                                                     │  │
││Insight││  │  ┌───────────────────────────────────────────────┐  │  │
││session││  │  │ 预置提示词按钮组 (PresetPrompts)               │  │  │
││列表   ││  │  └───────────────────────────────────────────────┘  │  │
│├───────┤│  │                                                     │  │
││Make   ││  │  ┌───────────────────────────────────────────────┐  │  │
││session││  │  │ 输入框 + 附件栏 + 模型选择器                   │  │  │
││列表   ││  └─────────────────────────────────────────────────────┘  │
│└───────┘│                                                            │
└─────────┴───────────────────────────────────────────────────────────┘
```

### 层级结构

```
Layout (无侧栏包裹，InsightPage 自带侧栏)
├── TitlebarSimple
└── InsightPage (顶级路由组件)
    ├── InsightSidebar (左侧，独立组件) ★
    │   ├── InsightSessionList (session 列表)
    │   └── 拖拽手柄 (宽度调整 200-420px)
    └── 空态展示区 (无 session ID 时)
        ├── IllustrationInsightEmpty 图标
        ├── 标题 + 描述
        ├── 预置提示词 (PresetPrompts)
        └── 输入框 + 附件栏 + 模型选择器
```

MakeSidebarLayout → Layout
├── TitlebarSimple
├── MakeSidebar (左侧)
│   ├── ProjectInfo (项目信息卡片) ★
│   ├── "新建"按钮 (直接创建 Make session)
│   └── Octo Make 分组 (session 列表)
└── MakePage (顶级路由组件)

### 关键点

- **顶级路由**: `/` 和 `/cowork` 都重定向到 `/insight`，InsightPage 自带侧栏 ★
- **Insight 路由**: `/insight/:id?` 为顶级路由，`id` 可选 ★
- **Make 路由**: `/make/:id?` 为顶级路由，使用 `MakeSidebarLayout` 布局
- **Onboarding 流程**: 每次启动应用时显示项目引导弹窗，选择目录后跳转到 `/insight` ★
- **Tab 切换逻辑**: 从 Insight/Make 切换到 Chat/Studio 时，使用 `lastSessionPerTab` 恢复上次 session
- `/:dir/cowork/:id?` 重定向到 `/insight` ★
- 搜索栏位置在 `TitlebarSimple` 右侧

---

## Make Tab 页面结构

切换到 **Make Tab** (导航到 `/make/:id?`) 时，页面结构如下：

### 布局示意图

```
┌─────────────────────────────────────────────────────────────────────┐
│  TitlebarSimple (顶部栏，含 Logo + 四 Tab + 搜索/头像)               │
│  Chat  │  Insight  │  Make (active)  │  Studio                       │
├─────────┬───────────────────────────────────────────────────────────┤
│         │                                                            │
│ Make    │              MakePage                                       │
│ Sidebar │              (路由匹配的页面)                                │
│ (左侧)  │                                                            │
│         │  ┌───────────────────────────────────────────────────────┐│
│ ┌─────┐ │  │                   对话面板                            ││
│ │Proj │ │  │ ┌───────────────────────────────────────────────────┐││
│ │Info │ │  │ │ SessionTitleBar (标题 + 重命名/删除下拉)            │││
│ │──── │ │  │ └───────────────────────────────────────────────────┘││
│ │     │ │  │ ┌───────────────────────────────────────────────────┐││
│ │+新建│ │  │ │                                                   │││
│ │     │ │  │ │              InsightTurn                           │││
│ │──── │ │  │ │              (消息渲染)                             │││
│ │Make │ │  │ │                                                   │││
│ │sess │ │  │ │              或 ChatEmptyState (空态)              │││
│ │ion  │ │  │ │                                                   │││
│ │列表 │ │  │ └───────────────────────────────────────────────────┘││
│ │     │ │  │ ┌───────────────────────────────────────────────────┐││
│ │──── │ │  │ │              Composer (底部输入区)                  │││
│ │技能 │ │  │ │  ┌──────┐ textarea  工具按钮  发送按钮              │││
│ │库   │ │  │ │  │上传  │                                           │││
│ │资产 │ │  │ │  └──────┘                                           │││
│ │库   │ │  │ │  DesignSystemPicker  TemplatePicker  ModelSelector │││
│ │──── │ │  │ └───────────────────────────────────────────────────┘││
│ │设置 │ │  └───────────────────────────────────────────────────────┘│
│ └─────┘ │                                                            │
│         │  ┌───────────────────────────────────────────────────────┐│
│         │  │                   ResultViewer                         ││
│         │  │  ┌───────────────────┬───────────────────────────────┐││
│         │  │  │ TabBar            │ ActionBar                      │││
│         │  │  │ HTML/Deck/SVG Tab │ 预览/编辑 + 复制/下载           │││
│         │  │  └───────────────────┴───────────────────────────────┘││
│         │  │  ┌───────────────────────────────────────────────────┐││
│         │  │  │                   渲染区                           │││
│         │  │  │  HtmlRenderer / DeckRenderer / SvgRenderer         │││
│         │  │  │  (视口切换 desktop/tablet/mobile)                  │││
│         │  │  └───────────────────────────────────────────────────┘││
│         │  │  ┌───────────────────────────────────────────────────┐││
│         │  │  │ VersionPanel (版本历史，可选)                      │││
│         │  │  │  快照列表 + 恢复按钮                               │││
│         │  │  └───────────────────────────────────────────────────┘││
│         │  └───────────────────────────────────────────────────────┘│
└─────────┴───────────────────────────────────────────────────────────┘
```

### 层级结构

```
MakeSidebarLayout → Layout (octo.tsx)
├── TitlebarSimple
├── MakeSidebar (左侧)
│   ├── ProjectInfo (项目信息卡片)
│   ├── "新建"按钮 (直接创建 Make session)
│   ├── Octo Make 分组 (可折叠，agent: octo_make)
│   ├── 底部导航 (技能库/资产库)
│   └── 设置按钮
└── MakePage (路由组件)
    ├── MakeContent (主内容区)
    │   ├── 标题栏 (SessionTitleBar)
    │   │   ├── 标题 (双击重命名)
    │   │   └── 下拉菜单 (重命名/删除)
    │   ├── 对话消息列表 (InsightTurn)
    │   │   ├── 用户消息气泡
    │   │   └── assistant 消息 + ToolCallCard + FileOpsSummary
    │   │   └── ChatEmptyState (空态: Host 图标 + "描述需求，开始生成原型")
    │   └── Composer (底部输入区)
    │       ├── AttachmentBar (附件栏)
    │       ├── textarea (输入框)
    │       ├── DesignSystemPicker (151种主题选择) ★
    │       ├── TemplatePicker (110个模板选择) ★
    │       ├── 添加附件按钮
    │       ├── ModelSelectorPopover (模型选择)
    │       └── 发送/停止按钮
    └── ResultViewer (右侧结果区)
        ├── TabBar (Tab 栏)
        ├── ActionBar (操作栏)
        │   ├── 预览/编辑切换
        │   ├── 复制/下载
        │   └── 多格式导出下拉
        ├── 渲染区
        │   ├── HtmlRenderer (HTML 渲染，视口切换)
        │   ├── DeckRenderer (幻灯片渲染)
        │   └── SvgRenderer (SVG 渲染)
        └── VersionPanel (版本历史面板，可选)
            ├── 快照列表
            └── 恢复/删除按钮
```

### 关键点

- **顶级路由**: `/make/:id?` 为独立顶级路由，不依赖项目目录 ★
- **MakeSidebarLayout**: 使用独立的 MakeSidebar 布局
- **Session 记忆**: Make 使用全局 `{id}` 存储，与 Cowork 一致（非按目录）
- **设计系统**: DesignSystemPicker 提供 151 种主题，localStorage 按 session 存储 ★
- **模板系统**: TemplatePicker 提供 110 个预置模板，点击插入到输入框 ★
- **Prompt 存储**: 输入框文本按 session 存储在 localStorage，切换 session 时恢复 ★
- **结果查看**: ResultViewer 支持 HTML/Deck/SVG 多格式渲染 + 视口切换 ★
- **版本历史**: createSnapshotStore localStorage 存储，支持恢复/删除 ★
- **搜索栏位置**: 在 `TitlebarSimple` 右侧

### Prompt 存储 (localStorage) ★

Make 页面的输入框文本按 session 存储，切换 session 时自动恢复：

| Key 格式 | 说明 |
|---------|------|
| `octo:make:prompt:{sessionId}` | 按 session 存储输入框文本 |

**行为**：
- 用户输入文本时，实时保存到当前 session 的 localStorage key
- 切换到新 session 时，清空输入框（新 session 无保存文本）
- 返回旧 session 时，恢复之前输入的文本
- 发送消息后，清除该 session 的保存文本

**代码位置**: `pages/make/index.tsx`
- `savePromptToStorage()` / `loadPromptFromStorage()` 函数
- `createEffect(on(prompt, ...))` 实时保存
- `createEffect(on(() => params.id, ...))` 切换时恢复

---

## Studio Tab 页面结构

切换到 **Studio Tab** (导航到 `/:dir/studio/:id?`) 时，页面结构如下：

### 布局示意图

```
┌─────────────────────────────────────────────────────────────────────┐
│  TitlebarSimple (顶部栏，含 Logo + 四 Tab + 搜索/头像)               │
│  Chat  │  Cowork  │  Studio (active)                               │
├─────────┬───────────────────────────────────────────────────────────┤
│         │                                                            │
│ Studio  │          StudioPage                                        │
│ History │          (路由匹配的页面)                                   │
│ (左侧)  │                                                            │
│         │  ┌───────────────────────────────────────────────────────┐│
│ ┌─────┐ │  │                    studio-center                      ││
│ │Studio│ │  │ ┌───────────────────────────────────────────────────┐││
│ │─────│ │  │ │ 标题栏 (currentTitle + projectDir)                 │││
│ │     │ │  │ └───────────────────────────────────────────────────┘││
│ │新建 │ │  │ ┌───────────────────────────────────────────────────┐││
│ │对话 │ │  │ │                                                   │││
│ │     │ │  │ │              StudioConversation                    │││
│ │─────│ │  │ │              (对话消息列表)                        │││
│ │历史 │ │  │ │                                                   │││
│ │记录 │ │  │ │              或 StudioIntro (空态)                 │││
│ │     │ │  │ │                                                   │││
│ │─────│ │  │ └───────────────────────────────────────────────────┘││
│ │设置 │ │  │ ┌───────────────────────────────────────────────────┐││
│ └─────┘ │  │ │              StudioComposer                        │││
│         │  │ │              (底部输入区)                           │││
│         │  │ │  ┌──────┐  textarea  工具按钮  发送按钮             │││
│         │  │ │  │上传  │                                           │││
│         │  │ │  │参考图│                                           │││
│         │  │ │  └──────┘                                           │││
│         │  │ └───────────────────────────────────────────────────┘││
│         │  └───────────────────────────────────────────────────────┘│
│         │                                                            │
│         │  ┌───────────────────────────────────────────────────────┐│
│         │  │                   studio-workspace                     ││
│         │  │  ┌───────────────────────────┬───────────────────────┐││
│         │  │  │                           │                       │││
│         │  │  │    studio-canvas          │    studio-details     │││
│         │  │  │                           │    (右侧详情面板)      │││
│         │  │  │    StudioResultCanvas     │                       │││
│         │  │  │    或 StudioOutpaintEditor│    图片缩略图列表      │││
│         │  │  │                           │    生成信息            │││
│         │  │  │                           │    提示词              │││
│         │  │  │                           │    再次生成按钮        │││
│         │  │  │                           │    变清晰/抠图/扩图    │││
│         │  │  │                           │    风格标签            │││
│         │  │  │                           │                       │││
│         │  │  └───────────────────────────┴───────────────────────┘││
│         │  └───────────────────────────────────────────────────────┘│
└─────────┴───────────────────────────────────────────────────────────┘
```

### 层级结构

```
AppShellProviders → Layout (layoutnet.tsx)
├── TitlebarSimple
└── StudioPage (路由组件)
    ├── studio-left (左侧边栏)
    │   └── StudioHistory (过滤 octo_studio agent，可折叠)
    │       ├── 新建对话按钮 + 分隔线
    │       ├── "Octo Studio" 可折叠分组标题 (IconStudio1 + 箭头)
    │       ├── 历史记录 (按日期分组)
    │       └── 设置按钮
    ├── studio-center (中间区域)
    │   ├── 标题栏 (currentTitle + projectDir)
    │   ├── StudioConversation (对话消息列表)
    │   │   └── For each turn: 用户消息 + assistant消息 + 结果卡片
    │   │       └── StudioIntro (空态显示能力矩阵)
    │   └── StudioComposer (底部输入区)
    │       ├── 上传参考图按钮
    │       ├── textarea
    │       ├── 工具按钮 (能力/生图工具/风格/参数/素材)
    │       └── 发送按钮
    └── studio-workspace (右侧工作区)
        ├── studio-canvas (画布区域)
        │   ├── StudioResultCanvas (预览模式)
        │   │   ├── StudioGlassSphere (空态)
        │   │   ├── 加载动画 (生成中)
        │   │   └── 图片预览 + 操作栏
        │   └── StudioOutpaintEditor (扩图模式)
        └── studio-details (详情面板，有图片时显示)
            ├── 图片缩略图列表
            ├── 生成信息 (模型/比例/文件名)
            ├── 提示词
            ├── 再次生成按钮
            └── 操作按钮 (变清晰/抠图/局部重绘/扩图)
```

### 关键点

- Studio Tab 导航到 `/:dir/studio/:id?`
- 使用 `AppShellProviders` 布局（Chat/Studio 不带侧栏包裹）
- StudioHistory 仅显示 `octo_studio` agent 的 session
- 三栏布局：左侧历史 + 中间对话 + 右侧画布/详情
- Agent 自动设置为 `octo_studio`
- **7 种能力**: 图片生成、视频生成、变清晰、抠图、局部重绘、扩图、场景融合 ★
- **2 种生图工具**: 内部生图 (`internel_image_generate`)、即梦 AI (`jimeng_image_generate`)
- **12 种风格模型**: qwen、BDIcon、portrait、developer、xiaoyi、smart-3D、abstract、yunbao、hdesign、hongmeng、hdesign-illustration、3d-abstract ★
- **7 种画幅比例**: 1:1、2:3、3:4、9:16、3:2、4:3、16:9 ★
- 支持参考图上传、生成数量设置
- **变清晰能力**: `upscaleCurrentImage()` 将当前图片作为 `sourceImage` 传入，自动选择 `internel_image_generate` 工具 ★
- **再次生成**: `regenerateCurrentResult()` 复用上一轮的 capability 和 prompt ★
- **Prompt 工具参数**: 包含 `capability` 字段，upscale 时自动注入 `sourceImage` ★

### Session ID 验证机制

**问题背景**：SolidJS 嵌套路由的 `params.id` 会继承同级路由的参数。

```
/:dir/chat/:chatId    → params = { dir: "...", id: "chatId" }
/:dir/studio          → params = { dir: "...", id: "chatId" } ← 参数污染
```

从 Chat 切换到 Studio 时，URL 变为 `/:dir/studio`（无 `:id`），但 `params.id` 仍保留 `"chatId"`。

**解决方案**：Studio 在使用 `params.id` 前验证是否为有效的 Studio session。

```ts
// studio/index.tsx
const [syncStore] = globalSync.child(projectDir(), { bootstrap: true })

const isValidStudioSession = (sessionId: string | undefined): boolean => {
  if (!sessionId) return false
  const session = syncStore.session.find(s => s.id === sessionId)
  return session?.agent === "octo_studio"
}

// runGeneration 中
const sessionID = isValidStudioSession(params.id) ? params.id! : await createAndNavigate(text)
```

| 场景 | `params.id` | `isValidStudioSession` | 行为 |
|------|-------------|------------------------|------|
| History 点击进入 | `"studioSessionId"` | true | 使用该 session ✓ |
| 新建对话（URL 无 id） | `undefined` | false | 创建新 session ✓ |
| 从 Chat 切换过来 | `"chatId"` | false | 创建新 session ✓ |

---

## 双应用入口

| 入口文件 | 应用名称 | 路由特点 |
|---------|---------|----------|
| `octoapp/octo.tsx` | **Octo AI** | 4 Tab (Chat/Insight/Make/Studio)，Insight/Make 为顶级路由 |
| `octoapp/app.tsx` | **Octo AI (备用)** | 同 octo.tsx |
| `src/app.tsx` | **OpenCode** | 仅 Session 页面，无 Tab |

---

## 路由结构

### Octo AI 路由树

```
/
├── /                              → 重定向到 /insight + DialogProjectOnboarding (项目引导弹窗)
├── /cowork                         → 重定向到 /insight ★
├── /insight/:id?                  → InsightPage (独立路由，自带 OctoSidebar)
├── /make/:id?                     → MakePage (独立路由，MakeSidebarLayout) ★
├── /skills                        → SkillsPage (独立路由，SkillsSidebarLayout)
└── /:dir                          → DirectoryLayout (项目目录)
    ├── /                          → 重定向到 /:dir/chat
    ├── /chat/:id?                 → ChatPage (左侧 Sidebar + 右侧 Session)
    ├── /cowork/:id?               → 重定向到 /insight ★
    ├── /studio/:id?               → StudioPage ★
    └── /session/:id?              → 重定向到 /:dir/chat/:id
```

### OpenCode 路由树

```
/
├── /                              → HomeRoute (项目选择页)
└── /:dir                          → DirectoryLayout
    ├── /                          → 重定向到 /:dir/session
    └── /session/:id?              → SessionPage (无 Tab，纯对话界面)
```

### 页面详情 (Octo AI)

| Tab | 路由 | 页面组件 | 左侧边栏 | 右侧内容 | Agent |
|-----|------|----------|----------|----------|-------|
| **首页** | `/` | 重定向到 `/insight` | `InsightSidebar` | 项目引导弹窗 + Insight 空态页 | - |
| **Insight** | `/insight/:id?` | `InsightPage` | `InsightSidebar` | 对话面板 + ResultViewer + 预置提示词 | `octo_insight` |
| **Make** | `/make/:id?` | `MakePage` (顶级路由) | `MakeSidebar` ★ | 对话面板 + ResultViewer + 设计系统 | `octo_make` |
| **Chat** | `/:dir/chat/:id?` | `ChatPage` | `Sidebar` (可拖拽宽度 160-360px) | `SessionPage` | `octo_ai` |
| **Studio** | `/:dir/studio/:id?` | `StudioPage` | `Sidebar` | Studio 内容 | `octo_studio` |
| - | `/skills` | `SkillsPage` | `OctoSidebar` 或 `MakeSidebar` (动态) ★ | 技能库管理 | - |

### 布局差异

| 路由类型 | 布局 | 顶部栏 | 左侧边栏 |
|---------|------|--------|----------|
| `/`, `/cowork` (首页/Insight) | 无侧栏包裹 (InsightPage 自带) | `TitlebarSimple` (Insight Tab 选中) | `InsightSidebar` (独立组件) + 项目引导弹窗 (仅 `/`) |
| `/insight/:id?` | 无侧栏包裹 (InsightPage 自带) | `TitlebarSimple` | `InsightSidebar` (独立组件) |
| `/make/:id?` | `MakeSidebarLayout` | `TitlebarSimple` (Make Tab 选中) | `MakeSidebar` |
| `/skills` | `SkillsSidebarLayout` (动态选择布局) ★ | `TitlebarSimple` | 根据 `sidebarSource` 显示 `OctoSidebar` 或 `MakeSidebar` |
| `/:dir/chat/:id?`, `/:dir/studio/:id?` | `AppShellProviders` → `Layout` | `TitlebarSimple` | `Sidebar` |
| `/:dir/cowork/:id?` | 重定向到 `/insight` | - | - |

### 关键区别 (Octo AI vs OpenCode)

| 特性 | Octo AI | OpenCode |
|------|---------|----------|
| Tab 栏 | 有 (Chat/Insight/Make/Studio) | 无 |
| Insight/Make 页面 | 有独立路由 | 无 |
| 左侧边栏类型 | OctoSidebar / Sidebar | Sidebar |
| Agent 选择 | 按页面不同 | 默认 |

### 路由代码 (`octoapp/octo.tsx`)
```tsx
<Route path="/" component={() => <Navigate href="/insight" />} />
<Route path="/cowork" component={() => <Navigate href="/insight" />} />
<Route path="/insight/:id?" component={InsightPage} />
<Route path="/make/:id?" component={MakePage} />
<Route path="/skills" component={SkillsPage} />
<Route path="/:dir" component={DirectoryLayout}>
  <Route path="/" component={ChatIndexRoute} />
  <Route path="/chat/:id?" component={ChatPage} />
  <Route path="/cowork/:id?" component={CoworkRedirectRoute} />
  <Route path="/studio/:id?" component={StudioPage} />
  <Route path="/session/:id?" component={SessionRedirectRoute} />
</Route>
```

### 项目引导弹窗 (`DialogProjectOnboarding`)

每次打开应用时显示项目引导弹窗，通过 `layout.onboarding.show()` signal 控制：

**组件位置**: `octoapp/components/dialog-project-onboarding.tsx`

**功能特性**:
- 400x520px 居中弹窗，半透明遮罩
- Splash Logo + 标题 "关联本地文件夹"
- 文件夹选择器（显示上次选择的目录，点击触发系统原生选择器）
  - 初始目录优先级: `server.projects.last()` → 最近更新项目的 worktree → 空
  - 过滤无效路径 (根目录 `/`、`C:\`、长度 < 3 的路径、空 home 目录) ★
  - 回退逻辑增强: projects 列表为空时直接返回空，worktree 长度 < 3 时跳过 ★
  - 显示路径时用 `~` 替代 home 目录前缀 (home 为空时直接显示原路径) ★
- 确定按钮（空时禁用，点击后导航到 `/insight`）
- 不可关闭（必须选择文件夹）

**显示条件**: `location.pathname === "/"`

**下方 Sidebar 状态**: 弹窗显示时，`InsightSidebar` 中的 `InsightSessionList` 检测到 onboarding 状态，不请求 session 列表，显示"请先选择项目目录"

**关键代码** (`octo.tsx:291-310`):
```tsx
function OnboardingLayer() {
  const navigate = useNavigate()
  const server = useServer()
  const layout = useLayout()

  const showOnboarding = createMemo(() => {
    if (!server.ready()) return false
    return layout.onboarding.show()
  })

  function handleOnboardingSelect(data: { directory: string }) {
    layout.onboarding.hide()
  }

  return (
    <Show when={showOnboarding()}>
      <DialogProjectOnboarding onSelect={handleOnboardingSelect} />
    </Show>
  )
}
```

### 路由布局切换

首页、Cowork、Insight 页面不使用侧栏包裹（InsightPage 自带侧栏），Make 使用 `MakeSidebarLayout`，Skills 使用 `SkillsSidebarLayout`，其他页面使用标准 `AppShellProviders`:

```tsx
// octo.tsx RouterRoot
const isInsightPage = () => {
  const p = location.pathname
  return p === "/" || p === "/cowork" || p === "/insight" || p.startsWith("/insight/")
}
const isMakePage = () => {
  const p = location.pathname
  return p === "/make" || p.startsWith("/make/")
}
const isSkillsPage = () => location.pathname === "/skills"

<Layout>
  <OnboardingLayer />
  {/* SPEC-INS-010: /insight 由 InsightPage 自带侧栏，不再套 OctoSidebarLayout */}
  <Show when={isInsightPage()}>
    {props.children}
  </Show>
  <Show when={isMakePage()}>
    <MakeSidebarLayout>{props.children}</MakeSidebarLayout>
  </Show>
  <Show when={isSkillsPage()}>
    <SkillsSidebarLayout>{props.children}</SkillsSidebarLayout>
  </Show>
  <Show when={!isInsightPage() && !isMakePage() && !isSkillsPage()}>
    {props.appChildren}
    {props.children}
  </Show>
</Layout>
```

---

## Insight 页面 (`pages/insight/index.tsx`)

### 功能特性

- 左栏: 对话面板 (可拖拽调整宽度 240px - 65%窗口宽度)
- 右栏: ResultViewer (结果查看器，支持 Tab 多卡片)
- 附件上传 (最多 5 个文件)
- 使用 `octo_insight` agent
- 支持思维导图、HTML、表格等多种结果渲染
- **Chat 宽度持久化**: localStorage 键 `octo:insight:chat-width`，初始值取 50% 可用宽
- **拖拽分隔线缩进**: top/bottom 缩进 20px，避免与 Windows classic 滚动条热区重合
- **Toast 通知**: `<Toast.Region />` 支持全局 Toast 显示

### 数据层架构 (SPEC-INS-005)

Insight 页面复用 opencode 原生数据层，不自建 SSE listener：

**Provider 层级**:
```tsx
<Show when={homeDir()} keyed>
  {(dir) => (
    <SDKProvider directory={() => dir}>
      <SyncProvider>
        <InsightContent />
      </SyncProvider>
    </SDKProvider>
  )}
</Show>
```

**核心组件**:
- `SDKProvider` - 提供 `useSDK()` 访问项目级 SDK 客户端
- `SyncProvider` - 提供 `useSync()` 访问项目级同步状态（`sync.data.message`, `sync.data.part` 等）
- `event-reducer` - 全局唯一，在 `GlobalSyncProvider` 内部注册，无需页面额外监听

**Session 同步**:
```tsx
createEffect(on(() => params.id, (id) => {
  if (!id) return
  void sync.session.sync(id)  // 原生 sync，带 inflight 去重 + cache + optimistic 合并
}))
```

**数据读取**:
```tsx
const messages = (sync.data.message[id] ?? []) as Message[]
const parts = sync.data.part[msg.id] ?? []
const status = sync.data.session_status[id] ?? { type: "idle" }
```

**优势**:
- 不再自建 `dataStore` + SSE listener
- 自动获得 inflight 去重、cache、optimistic 合并
- event-reducer 全局唯一，避免重复注册
- 状态变化日志统一前缀 `[octo:sync]`

### 核心组件

| 组件 | 位置 | 功能 |
|------|------|------|
| `InsightTurn` | `insight/components/insight-turn.tsx` | 消息渲染 + 输出卡片 |
| `AttachmentBar` | `insight/components/attachment-bar.tsx` | 附件管理 |
| `PresetPrompts` | `insight/components/preset-prompts.tsx` | 预置提示词按钮组 ★ |
| `ResultViewer` | `insight/components/result-viewer/index.tsx` | 结果多 Tab 查看 |
| `TabStore` | `insight/components/result-viewer/tab-store.ts` | Tab 状态管理 |

### 工具函数

| 文件 | 位置 | 功能 |
|------|------|------|
| `mindmap-adapter.ts` | `insight/utils/mindmap-adapter.ts` | UXR JSON → Markdown 转换，支持多文件 MCP 输出、多种 JSON 结构 ★ |
| `resource-link.ts` | `insight/utils/resource-link.ts` | MCP 资源链接解析器 (3 分支策略: resource_link/metadata/content 扫描) ★ |
| `markdown-table.ts` | `insight/utils/markdown-table.ts` | Markdown 表格解析 |
| `detect.ts` | `insight/utils/detect.ts` | 结果类型检测 |
| `upload.ts` | `insight/lib/upload.ts` | 文件上传 (端点由 `VITE_OCTO_UPLOAD_ENDPOINT` 配置) |
| `electron-api.ts` | `insight/lib/electron-api.ts` / `make/lib/electron-api.ts` | Electron桌面API类型安全封装 (openPath, saveFilePicker, writeFileBuffer等)，Make页独立副本 ★ |

**上传端点配置** (`insight/lib/upload.ts`):
- 端点从环境变量 `VITE_OCTO_UPLOAD_ENDPOINT` 读取
- 配置方式: `packages/app/.env.local` 里写 `VITE_OCTO_UPLOAD_ENDPOINT=<内网地址>`
- 日志前缀 `[octo:upload]`，便于内外网隔空调试

### OutputCard 检测逻辑 (`insight-turn.tsx`)

对 assistant parts 按优先级双路径扫描：

**Path A — MCP resource_link (强契约，零启发式)**:
- 调用 `findResourceLinks(parts)` 提取所有资源链接
- 按 `business_type` 路由: `"mindmap"` 生成双卡片 (JSON + 思维导图)，其余按 MIME 类型路由
- 卡片携带 `source: "uri"` + `uri`、`mimeType`、`fileName`、`description`

**Path B — 自由文本嗅探 (启发式兜底)**:
- B-1: `scanFencedHtml()` 扫描所有 HTML 代码块 (支持未闭合 fence)，每个独立成卡
- B-2: 最后一个 text part 分析: Markdown 表格 → "table" 卡片，思维导图 JSON → "mindmap" 卡片

**TaskCard 集成**: 当 turn 有 taskCards 时，常规 OutputCard 被抑制，由 taskCard 的"查看完整结果"按钮接管。

**卡片类型**: `OutputCardType = "table" | "mindmap" | "markdown" | "file" | "json" | "html"`

### 状态管理

| 文件 | 位置 | 功能 |
|------|------|------|
| `preset-prompts.ts` | `insight/store/preset-prompts.ts` | 预置提示词状态 ★ |

---

## Make 页面 (`pages/make/index.tsx`)

### 功能特性

- 结构与 Insight 类似
- 左栏: 对话面板，右栏: ResultViewer
- 使用 `octo_make` agent
- 空态显示 "Octo Make" 和 "描述需求，开始生成原型"
- **对话标题栏**: 显示当前对话标题，双击可内联编辑重命名，下拉菜单支持重命名/删除 ★
  - 删除时弹出确认对话框，调用 `session.delete()` 后导航到 `/make`
  - 对话进行中显示 Spinner 状态指示
  - 切换新对话时自动重置 sending 状态，避免输入被锁定
- **模型选择器**: 复用 Chat 的 `ModelSelectorPopover` 组件 ★
  - 与 Chat/Studio 完全隔离，使用 workspace 级持久化 (`Persist.workspace(dir, "make-model")`)
  - 位于输入区底部工具栏，与设计系统选择器和附件按钮并排
- **设计系统选择器**: 151种设计主题 (airbnb、ant、apple、claude、cursor 等)，通过 `design-system-picker.tsx` 选择 ★
  - **双栏布局**: 左侧列表 + 右侧 iframe 实时预览 tokens 颜色/字体/按钮 ★
  - **Craft 注入**: 选中设计系统时自动注入 `anti-ai-slop`、`typography`、`color` 三个核心 craft 到 prompt ★
- **模板选择器**: 110 个设计模板，分类标签 + 搜索 + 选择后填充输入框 ★
  - 位于输入区底部工具栏，向上弹出
- **视口预设切换**: HtmlRenderer 支持 desktop/tablet/mobile 三档 CSS transform 缩放 ★
- **调色板桥接**: 5 种预设调色板通过 postMessage 实时换色 ★
- **元素选择标注**: hover 高亮 + 点击显示元素信息面板 ★
- **版本历史**: localStorage 快照存储，自动保存 artifact，版本面板支持恢复/删除 ★
- **多格式导出**: ActionBar 支持导出下拉菜单，产物 Manifest 解析 `exports` 属性 ★
- **Artifact 解析**: 流式解析 `<artifact>` XML 标签，支持代码/原型/幻灯片等多种输出类型 ★
- 复用原生 SyncProvider 数据层，通过 `sync.session.sync()` 加载 session 数据
- **回答时禁止输入**: busy 状态下 textarea 禁用，显示 `opacity-50 cursor-not-allowed` ★
- **项目切换清理**: 切换项目文件夹时，检查当前 session 是否属于新项目，不属于则清理数据并导航到空态 ★
- **阻塞检测**: 模型响应超过 30秒显示提示，60秒显示警告并提供"中止对话"按钮 ★
- **拖拽分隔条修复**: 使用 overlay 覆盖层解决鼠标进入 iframe 后拖拽卡住的问题 ★

### 渲染器

| Tab 类型 | 渲染器 | 说明 |
|----------|--------|------|
| `table` | `TableRenderer` | Markdown 表格解析为 HTML 表格 |
| `html` | `HtmlRenderer` | HTML 渲染器 (视口切换 desktop/tablet/mobile + 调色板桥接 + 元素选择标注) ★ |
| `deck` | `DeckRenderer` | 幻灯片渲染器 (iframe 内展示，支持翻页) ★ |
| `svg` | `SvgRenderer` | SVG 渲染器 (预览/源码切换) ★ |

### 新增组件

| 组件 | 位置 | 功能 |
|------|------|------|
| `DesignSystemPicker` | `make/components/design-system-picker.tsx` | 设计系统下拉选择 (151种主题) ★ |
| `TemplatePicker` | `make/components/template-picker.tsx` | 模板选择器 (110个模板，分类标签+搜索) ★ |
| `VersionPanel` | `make/components/result-viewer/version-panel.tsx` | 版本历史面板 (恢复/删除) ★ |
| `PreviewOverlay` | `make/components/preview-overlay.tsx` | 设计系统预览覆盖层 (iframe 实时预览) ★ |
| `ToolCallCard` | `make/components/tool-call-card.tsx` | 工具调用状态卡片 (running/done/error) ★ |
| `FileOpsSummary` | `make/components/file-ops-summary.tsx` | 文件操作汇总 (read/write/edit 按路径聚合) ★ |
| `DeckRenderer` | `make/components/result-viewer/deck-renderer.tsx` | 幻灯片渲染 ★ |
| `SvgRenderer` | `make/components/result-viewer/svg-renderer.tsx` | SVG渲染 ★ |
| `ModelSelectorPopover` | `components/dialog-select-model.tsx` | 模型选择弹窗（Make 页复用） ★ |

### 工具函数

| 文件 | 位置 | 功能 |
|------|------|------|
| `artifact-parser.ts` | `make/utils/artifact-parser.ts` | Artifact XML标签流式解析器 ★ |
| `artifact-markdown-context.ts` | `make/utils/artifact-markdown-context.ts` | Artifact markdown跳过范围计算 ★ |
| `artifact-strip.ts` | `make/utils/artifact-strip.ts` | Artifact标签清除 ★ |
| `design-system-loader.ts` | `make/utils/design-system-loader.ts` | 设计系统懒加载 (Vite glob import) ★ |
| `design-system-preview.ts` | `make/utils/design-system-preview.ts` | 设计系统预览面板 (iframe 实时预览 tokens) ★ |
| `srcdoc-builder.ts` | `make/utils/srcdoc-builder.ts` | iframe srcdoc构建器 (注入设计系统token + 调色板桥接 + 元素选择标注) ★ |
| `craft-loader.ts` | `make/utils/craft-loader.ts` | Craft 文档加载 (选中设计系统时注入核心 craft) ★ |
| `template-loader.ts` | `make/utils/template-loader.ts` | 模板加载 (Vite glob import 110个模板) ★ |
| `snapshot-store.ts` | `make/utils/snapshot-store.ts` | 版本历史快照存储 (localStorage) ★ |

---

## Insight 空态页

### 路由变更

- `/cowork` 已移除空态展示页，现在重定向到 `/insight` ★
- `/insight/:id?` 的 `id` 参数可选，无 `id` 时显示空态内容 ★

### 空态内容 (`pages/insight/index.tsx`)

当访问 `/insight`（无 session ID）时显示：
- **IllustrationInsightEmpty** 图标 (166x166)
- 标题 "Octo Insight" + 描述 "AI辅助用户洞察研究"
- **预置提示词** (`PresetPrompts` 组件)：一组快捷提示按钮
- **输入框**：带附件栏 + 模型选择器的对话输入区域

### 功能特性

- 点击预置提示词或输入内容后自动创建 Insight session
- 创建后导航到 `/insight/${session.id}`
- **项目信息组件** (`cowork/components/project-info.tsx`): 显示项目名称、类型、版本 ★

---

## Make 页面 WaitingPill 设计

### 问题背景

Make 页面生成中时存在内容重复显示问题：

- **上方 Markdown 卡片**：实时渲染 `proseText()`（已剥离 `<artifact>` 标签的 prose 文本）
- **下方 WaitingPill**：原本显示 `accumulatedText()`（完整 text part 内容，包含 prose + artifact）
- 导致 prose 文本在两处重复显示

### 解决方案

修改 `WaitingPill` 组件的 `accumulatedText` memo，使用 `createArtifactParser` 过滤内容：

```tsx
const accumulatedText = createMemo(() => {
  if (!props.messageID) return ""
  const parts = props.partStore?.[props.messageID] ?? []
  const textPart = [...parts]
    .reverse()
    .find((p) => p.type === "text") as { type: "text"; text?: string } | undefined
  if (!textPart?.text) return ""
  
  const parser = createArtifactParser()
  let artifactContent = ""
  for (const ev of parser.feed(textPart.text)) {
    if (ev.type === "artifact:chunk") {
      artifactContent += ev.delta
    }
  }
  for (const ev of parser.flush()) {
    if (ev.type === "artifact:chunk") {
      artifactContent += ev.delta
    }
  }
  return artifactContent
})
```

**核心逻辑**：
- 只累积 `artifact:chunk` 事件的内容（artifact 内部的 HTML/代码）
- 忽略 `text` 事件的内容（prose 文本）
- 移除 fallback 显示 `filteredDeltaLog`（避免 prose delta 片段重复）

### 最终行为

| 场景 | WaitingPill 显示 |
|------|-----------------|
| 有 artifact | 只显示 artifact 内容（HTML/代码片段） |
| 无 artifact（纯 prose） | 只显示状态标签（"思考中"或"生成中"） |

**文件位置**: `make/components/insight-turn.tsx:235-242`（`accumulatedText` memo）

---

## Context 系统

| Context | 文件位置 | 功能 |
|---------|----------|------|
| `useLayout` | `context/layout.tsx` | 布局状态：sidebar, review panel, file tree, **onboarding signal** ★ |
| `useLayoutScroll` | `context/layout-scroll.ts` | 滚动状态 |
| `useLocal` | `context/local.tsx` | 本地状态：agent 选择, model 选择, workspace 级持久化 (`Persist.workspace`), `lastState` 内存缓存 + `handoff` 跨目录传递 + `savedReady()` 守卫 |
| `useGlobalSync` | `context/global-sync.tsx` | 全局同步状态管理 |
| `useGlobalSDK` | `context/global-sdk.tsx` | 全局 SDK 客户端 |
| `useSdk` | `context/sdk.tsx` | SDK 客户端封装 |
| `useSync` | `context/sync.tsx` | 项目级同步状态 |
| `useSettings` | `context/settings.tsx` | 用户设置 |
| `useCommand` | `context/command.tsx` | 命令注册系统 |
| `usePrompt` | `context/prompt.tsx` | 提示输入状态 |
| `useFile` | `context/file.tsx` | 文件管理、树形结构 |
| `useTerminal` | `context/terminal.tsx` | 终端面板状态 |
| `useComments` | `context/comments.tsx` | 评论系统 |
| `usePermission` | `context/permission.tsx` | 权限管理 |
| `useLanguage` | `context/language.tsx` | i18n 国际化 |
| `usePlatform` | `context/platform.tsx` | 平台检测 (web/desktop) |
| `useServer` | `context/server.tsx` | 服务器连接 |
| `useNotification` | `context/notification.tsx` | 系统通知 |
| `useModels` | `context/models.tsx` | 模型管理 |
| `useHighlights` | `context/highlights.tsx` | 高亮状态 |
| `useModelVariant` | `context/model-variant.ts` | 模型变体 |

### Layout onboarding 状态 ★

`useLayout().onboarding` 提供会话级的项目引导弹窗控制：

```ts
interface OnboardingState {
  show: Accessor<boolean>    // 是否显示弹窗 (初始 true)
  hide: () => void           // 隐藏弹窗 (选择目录后调用)
}
```

- **状态存储**: 会话级内存状态（不持久化到 localStorage）
- **每次启动**: 重置为 `true`，显示弹窗
- **选择目录后**: 调用 `hide()` 设置为 `false`，当前会话内不再显示

---

## Provider 层级结构

### AppBaseProviders (基础层)
```tsx
<MetaProvider>
  <Font />
  <ThemeProvider>
    <LanguageProvider>
      <UiI18nBridge>
        <ErrorBoundary>
          <QueryProvider>
            <DialogProvider>
              <MarkedProvider>
                <FileComponentProvider>{children}</FileComponentProvider>
              </MarkedProvider>
            </DialogProvider>
          </QueryProvider>
        </ErrorBoundary>
      </UiI18nBridge>
    </LanguageProvider>
  </ThemeProvider>
</MetaProvider>
```

### AppShellProviders (应用层)
```tsx
<SettingsProvider>
  <PermissionProvider>
    <LayoutProvider>
      <NotificationProvider>
        <ModelsProvider>
          <CommandProvider>
            <HighlightsProvider>
              <Layout>{children}</Layout>
            </HighlightsProvider>
          </CommandProvider>
        </ModelsProvider>
      </NotificationProvider>
    </LayoutProvider>
  </PermissionProvider>
</SettingsProvider>
```

### MakeSidebarLayout (Make 页面专用)
```tsx
<SettingsProvider>
  <PermissionProvider>
    <LayoutProvider>
      <NotificationProvider>
        <ModelsProvider>
          <CommandProvider>
            <HighlightsProvider>
              <Layout>
                <MakeSidebar width={sidebarWidth()} />
                {children}
              </Layout>
            </HighlightsProvider>
          </CommandProvider>
        </ModelsProvider>
      </NotificationProvider>
    </LayoutProvider>
  </PermissionProvider>
</SettingsProvider>
```

### SkillsSidebarLayout (Skills 页面专用)
根据 `sidebarSource` 动态选择 `OctoSidebar` 或 `MakeSidebar`。

### SessionProviders (会话层)
```tsx
<TerminalProvider>
  <FileProvider>
    <PromptProvider>
      <CommentsProvider>{children}</CommentsProvider>
    </PromptProvider>
  </FileProvider>
</TerminalProvider>
```

---

## Portal 机制

SessionHeader 通过 Portal 将搜索栏渲染到 TitlebarSimple：

### Mount Points (`titlebar-simple.tsx`)
```tsx
<div id="opencode-titlebar-center" class="flex items-center shrink-0 justify-end" />
```

### Portal 渲染 (`session-header.tsx`)
```tsx
createEffect(() => {
  const center = document.getElementById("opencode-titlebar-center")
  if (center) setCenterMount(center)
})

<Show when={centerMount()}>
  {(mount) => (
    <Portal mount={mount()}>
      <Button ... />
    </Portal>
  )}
</Show>
```

### Cowork/Studio 页面搜索栏

Cowork 和 Studio 页面不使用 Portal，而是在 `TitlebarSimple` 中直接渲染搜索按钮：

```tsx
<div id="opencode-titlebar-center" class="flex items-center shrink-0 justify-end">
  <Show when={activeTab() === "cowork" || activeTab() === "studio"}>
    <Button
      type="button"
      variant="ghost"
      size="small"
      class="hidden md:flex w-[240px] max-w-full min-w-0 items-center gap-2 ..."
      aria-label={language.t("session.header.searchFiles")}
    >
      <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
        {language.t("session.header.searchFiles")}
      </span>
    </Button>
  </Show>
</div>
```

### 注意事项
- Chat 页面：搜索栏由 `SessionHeader` 通过 Portal 渲染，显示项目名和快捷键
- Cowork/Studio 页面：搜索栏直接在 `TitlebarSimple` 中渲染，仅显示 UI（无弹框功能）
- 样式通过 CSS 选择器 `header[data-tauri-drag-region] #opencode-titlebar-center [data-component="button"]` 控制

---

## 持久化存储

### 版本控制
升级版本号强制重置默认值：
```tsx
const target = Persist.global("layout.v8", [])
```

### 默认值
```tsx
review: { panelOpened: false },
fileTree: { opened: false },
```

### 常见问题
**持久化旧值干扰**: 用户重启后默认值仍为旧值
**解决**: 升级版本号（如 `layout.v7` → `layout.v8`），不从旧版本迁移

---

## 关键组件位置

### Chat 页面左侧

| 组件 | 文件位置 |
|------|----------|
| Sidebar | `octoapp/components/sidebar.tsx` |
| 新建按钮 | `sidebar.tsx` |
| 设置按钮 | `sidebar.tsx` 底部 |
| 拖拽分隔线 | `octoapp/pages/chat.tsx` (宽度可拖拽 160-360px，已持久化) |

**Sidebar Loading 状态**: session 列表加载时显示 `<Spinner />` + "加载中"，而非空态提示
**滚动列表 data-slot**: session 列表滚动区域添加 `data-slot="list-scroll"` 属性，便于全局滚动条样式统一

### 统一 Sidebar 样式规范 ★

Chat、Cowork (OctoSidebar)、Studio 三处侧边栏已统一视觉规范：

| 特性 | 规范 |
|------|------|
| 折叠箭头 | `ChevronRightIcon` (20x20 viewBox)，`rotate(-90deg/0deg)` + 200ms cubic-bezier 过渡 |
| Session 项高度 | 36px，font-size: 12px，padding: `0 24px 0 44px` |
| 激活态 | 背景 `rgba(10,89,247,0.08)`，文字 `#0A59F7` |
| 激活指示条 | 右侧竖条 (right:8-12px，宽 4px，高 28px，圆角，`#0A59F7`) |
| 悬浮态 | `hover:bg-surface-base-hover` |
| 分组标题 | 左侧 icon (20x20 SVG) + 粗体标题 + 右侧折叠箭头，高 36px |
| "新建"按钮 | 高 36px，font-size: 12px，icon + 文字 |
| 分隔线 | `rgba(0,0,0,0.1)` 1px |

**图标资源**: `/insightIcon.svg`（Insight 分组）、`/makeIcon.svg`（Make 分组）、`/IconStudio1.svg`（Studio 分组）

### Chat 页面底部对话栏

| 组件 | 文件位置 |
|------|----------|
| PromptInput | `octoapp/components/prompt-input.tsx` |
| DockTray (agent/model/variant) | `prompt-input.tsx` |

**PromptInput 禁用状态** ★:
- 新增 `disabled` prop
- busy 状态下 textarea `contenteditable="false"`
- 样式: `opacity-50 cursor-not-allowed`

### Insight 页面

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| InsightPage | `octoapp/pages/insight/index.tsx` | 主页面 |
| InsightSidebar | `octoapp/pages/insight/sidebar.tsx` | Insight 侧边栏 (独立组件，仅 Insight sessions) ★ |
| InsightTurn | `insight/components/insight-turn.tsx` | 消息渲染 |
| AttachmentBar | `insight/components/attachment-bar.tsx` | 附件栏 |
| PresetPrompts | `insight/components/preset-prompts.tsx` | 预置提示词按钮组 ★ |
| ResultViewer | `insight/components/result-viewer/index.tsx` | 结果查看器 |
| TabBar | `insight/components/result-viewer/tab-bar.tsx` | Tab 栏 |
| ActionBar | `insight/components/result-viewer/action-bar.tsx` | 操作栏 |
| TableRenderer | `insight/components/result-viewer/table-renderer.tsx` | 表格渲染 |
| HtmlRenderer | `insight/components/result-viewer/html-renderer.tsx` | HTML 渲染 |
| MindmapRenderer | `insight/components/result-viewer/mindmap-renderer.tsx` | 思维导图渲染 |

### Make 页面

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| MakePage | `octoapp/pages/make/index.tsx` | 主页面 |
| MakeSidebar | `octoapp/pages/make/sidebar.tsx` | Make 侧边栏 (仅显示 Make sessions) ★ |
| SessionTitleBar | `make/index.tsx` (内嵌) | 对话标题栏 (双击重命名 + 下拉菜单: 重命名/删除 + Spinner 状态) ★ |
| ModelSelectorPopover | `components/dialog-select-model.tsx` | 模型选择弹窗 (workspace 级持久化，与 Chat/Studio 隔离) ★ |
| InsightTurn | `make/components/insight-turn.tsx` | 消息渲染 |
| WaitingPill | `make/components/insight-turn.tsx` (内嵌) | 生成中状态指示器：只显示 artifact 内容（HTML/代码），不显示 prose 文本，避免与上方 Markdown 卡片重复 ★ |
| AttachmentBar | `make/components/attachment-bar.tsx` | 附件栏 |
| DesignSystemPicker | `make/components/design-system-picker.tsx` | 设计系统选择器 (151种主题) ★ |
| ToolCallCard | `make/components/tool-call-card.tsx` | 工具调用状态卡片 ★ |
| FileOpsSummary | `make/components/file-ops-summary.tsx` | 文件操作汇总卡片 ★ |
| ResultViewer | `make/components/result-viewer/index.tsx` | 结果查看器 |
| TabBar | `make/components/result-viewer/tab-bar.tsx` | Tab 栏 |
| ActionBar | `make/components/result-viewer/action-bar.tsx` | 操作栏 (预览/编辑切换 + 复制/下载，支持 PDF 导出、CSV 转换、SVG 提取、代码片段下载 + 多格式导出下拉 + 调色板切换) ★ |
| TableRenderer | `make/components/result-viewer/table-renderer.tsx` | 表格渲染 |
| HtmlRenderer | `make/components/result-viewer/html-renderer.tsx` | HTML 渲染器 (视口切换 desktop/tablet/mobile + 调色板桥接 + 元素选择标注) ★ |
| DeckRenderer | `make/components/result-viewer/deck-renderer.tsx` | 幻灯片渲染 ★ |
| SvgRenderer | `make/components/result-viewer/svg-renderer.tsx` | SVG 渲染 ★ |

### Skills 页面

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| SkillsPage | `octoapp/pages/skills/index.tsx` | 技能库管理页面 |

功能特性:
- 管理各 Agent 的技能（按配置文件的 `type` 字段动态分组）
- 分组类型：`octo_insight`、`octo_make`、`octo_design`、`octo_studio`、`common`（公共技能）
- 包含开关切换功能
- **添加技能按钮**: 点击打开技能文件夹，将包含 `SKILL.md` 的文件夹放入即可
- **visibilitychange 监听**: 页面返回时自动刷新配置（从文件管理器返回后）
- **skill 刷新 API**: 技能切换后调用 `POST /skill/refresh` 清除后端缓存
- 使用 `SkillsSidebarLayout` 布局

**动态分组逻辑**:
```tsx
const groupedSkills = createMemo(() => {
  const groups: Record<string, { skills: string[]; label: string; subtitle: string }> = {}
  for (const [name, entry] of Object.entries(cfg)) {
    const type = entry.type || "common"  // 按 type 字段分组，默认 common
    if (!groups[type]) groups[type] = { skills: [], label: AGENT_INFO[type]?.label || type, ... }
    groups[type].skills.push(name)
  }
  return groups
})
```

**技能刷新调用**:
```tsx
api?.setSkillsConfig?.(updated)?.then?.(() => {
  const url = server.current?.http?.url
  if (url) fetch(`${url}/skill/refresh`, { method: "POST" }).catch(() => {})
})
```

### Insight 空态页

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| InsightPage | `octoapp/pages/insight/index.tsx` | Insight 主页面，无 session ID 时显示空态内容 ★ |
| PresetPrompts | `octoapp/pages/insight/components/preset-prompts.tsx` | 预置提示词按钮组 ★ |
| ProjectInfo | `octoapp/pages/cowork/components/project-info.tsx` | 项目信息卡片 (显示项目名/类型/版本) ★ |

**路由变更** ★:
- `/cowork` 已移除空态展示页 (`CoworkPage`)，现在重定向到 `/insight`
- `/insight/:id?` 的 `id` 参数可选，无 `id` 时直接显示 Insight 空态内容
- 空态内容：IllustrationInsightEmpty 图标 + 预置提示词 + 输入框

### Studio 页面

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| StudioPage | `octoapp/pages/studio/index.tsx` | 主页面 |
| StudioHistory | `studio/index.tsx` (内嵌) | 左侧历史面板 (可折叠，含 "Octo Studio" 分组标题 + `/IconStudio1.svg` 图标) ★ |
| StudioIntro | `studio/index.tsx` (内嵌) | 空态能力矩阵 (7种能力: 图片/视频生成、变清晰、抠图、局部重绘、扩图、场景融合) ★ |
| StudioConversation | `studio/index.tsx` (内嵌) | 对话消息列表 |
| StudioComposer | `studio/index.tsx` (内嵌) | 底部输入区 (能力选择 + 生图工具 + 风格模型 + 比例/数量 + 参考图上传) ★ |
| StudioResultCanvas | `studio/index.tsx` (内嵌) | 画布预览 (支持下载、收藏、再次生成) ★ |
| StudioDetails | `studio/index.tsx` (内嵌) | 详情面板 (缩略图列表 + 生成信息 + 操作按钮: 再次生成/变清晰/扩图) ★ |
| StudioOutpaintEditor | `studio/index.tsx` (内嵌) | 扩图编辑器 (比例选择 + prompt输入 + 一键生成) ★ |
| StudioGlassSphere | `studio/index.tsx` (内嵌) | 空态装饰玻璃球 |

**布局尺寸持久化**:
- 左侧历史面板宽度: `Persist.global("studio.left.width")`，初始 296px，范围 160-360px
- 中间对话区宽度: `Persist.global("studio.center.width")`，初始 468px，范围 360-700px
- 使用 `ScrollView` 替代原生滚动条，优化滚动体验

**拖拽分隔线**:
```tsx
function handleStudioLeftResize(event: MouseEvent) {
  const startX = event.clientX
  const startWidth = studioLeftWidth()
  function onMove(e: MouseEvent) {
    setStudioLeftWidth(Math.max(160, Math.min(360, startWidth + e.clientX - startX)))
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", () => { ... }, { once: true })
}
```

**Prompt 工具参数 JSON**: 生图 prompt 中序列化工具参数，确保 capability、styleModel、aspectRatio、count 传递：
```tsx
const toolSettings = JSON.stringify({
  capability: input.capability,                               // 当前能力 (image.upscale 等)
  styleModel: styleModelLabel(styleModel()),
  aspectRatio: aspectRatio(),
  count: count(),
  imageTool: selectedTool,                                    // upscale 强制 internel_image_generate
  ...(input.capability === "image.upscale" && input.sourceImage ? { sourceImage: input.sourceImage } : {}),
})
```

**Composer 菜单关闭**: 外部点击 (`document.pointerdown`) 自动关闭打开的菜单

**图片设置弹窗**: 比例/数量按钮添加 border，选中态蓝色边框+背景

### Dialog 组件

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| DialogProjectOnboarding | `octoapp/components/dialog-project-onboarding.tsx` | 项目引导弹窗 ★ |
| DialogSettings | `octoapp/components/dialog-settings.tsx` | 设置对话框 (样式重构: kobalte Tabs + 左侧导航 240px + 激活态蓝色背景+右侧竖条 + 底部 Logo + 版本号) ★ |
| DialogSelectModel | `octoapp/components/dialog-select-model.tsx` | 选择模型 |
| DialogSelectModelUnpaid | `octoapp/components/dialog-select-model-unpaid.tsx` | 未付费模型选择 |
| DialogSelectDefaultModel | `octoapp/components/dialog-select-default-model.tsx` | 选择默认模型 ★ |
| DialogSelectProvider | `octoapp/components/dialog-select-provider.tsx` | 选择供应商 |
| DialogSelectServer | `octoapp/components/dialog-select-server.tsx` | 选择服务器 |
| DialogSelectMcp | `octoapp/components/dialog-select-mcp.tsx` | 选择 MCP |
| DialogSelectDirectory | `octoapp/components/dialog-select-directory.tsx` | 选择目录 |
| DialogSelectFile | `octoapp/components/dialog-select-file.tsx` | 选择文件 |
| DialogCustomProvider | `octoapp/components/dialog-custom-provider.tsx` | 自定义供应商 |
| DialogConnectProvider | `octoapp/components/dialog-connect-provider.tsx` | 连接供应商 |
| DialogManageModels | `octoapp/components/dialog-manage-models.tsx` | 管理模型 |
| DialogFork | `octoapp/components/dialog-fork.tsx` | Fork 对话框 |
| DialogEditProject | `octoapp/components/dialog-edit-project.tsx` | 编辑项目 |
| DialogReleaseNotes | `octoapp/components/dialog-release-notes.tsx` | 发布说明 |

**DialogSettings 样式重构** ★:
- 使用 `@kobalte/core/tabs` 替代自定义 Tabs
- 左侧导航: 240px 宽度，激活态蓝色背景 + 右侧竖条指示
- 图标: `/setting/generalIcon.svg`、`/setting/modeIcon.svg`、`/setting/providerIcon.svg`
- 底部: `/setting/OctoAgentLogo.png` + 版本号
- 弹窗: 20px 圆角，16px-48px 阴影
- Switch 样式统一: 38x20 控件，16x16 thumb，蓝色激活态

### Settings 组件

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| SettingsGeneral | `octoapp/components/settings-general.tsx` | 通用设置 |
| SettingsModels | `octoapp/components/settings-models.tsx` | 模型设置 |
| SettingsProviders | `octoapp/components/settings-providers.tsx` | 供应商设置 |
| SettingsList | `octoapp/components/settings-list.tsx` | 设置列表 |
| SettingsKeybinds | `octoapp/components/settings-keybinds.tsx` | 快捷键设置 |
| SettingsDefaultModel | `octoapp/components/settings-default-model.tsx` | 默认模型设置 ★ |

**Provider 断开逻辑** (`settings-providers.tsx`):
- 断开时不显示 toast，简化逻辑
- `opencode` provider 被 disabled 时，在"未连接"列表显示合成入口，便于重新连接
- 断开流程: `auth.remove` → `global.dispose` → `disableProvider` → `invalidateProviders`

### Session 组件

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| SessionHeader | `octoapp/components/session/session-header.tsx` | Portal 到 Titlebar |
| SessionContextTab | `octoapp/components/session/session-context-tab.tsx` | Context 标签页 |
| SessionNewView | `octoapp/components/session/session-new-view.tsx` | 新建视图 |
| SessionSortableTab | `octoapp/components/session/session-sortable-tab.tsx` | 可排序标签 |
| SessionSortableTerminalTab | `octoapp/components/session/session-sortable-terminal-tab.tsx` | 可排序终端标签 |
| SessionContextMetrics | `octoapp/components/session/session-context-metrics.ts` | Context 指标 |
| SessionContextBreakdown | `octoapp/components/session/session-context-breakdown.ts` | Context 分解 |
| SessionContextFormat | `octoapp/components/session/session-context-format.ts` | Context 格式化 |

---

## 环境变量 (`octoapp/env.d.ts`)

| 变量 | 说明 |
|------|------|
| `VITE_OPENCODE_SERVER_HOST` | OpenCode 服务器地址 |
| `VITE_OPENCODE_SERVER_PORT` | OpenCode 服务器端口 |
| `VITE_OPENCODE_CHANNEL` | 发布通道 (dev/beta/prod) |
| `VITE_OCTO_UPLOAD_ENDPOINT` | Octo 上传服务端点 (Insight 附件上传) ★ |
| `VITE_SENTRY_DSN` | Sentry 错误追踪 DSN |
| `VITE_SENTRY_ENVIRONMENT` | Sentry 环境 |

**上传端点配置**: 在 `packages/app/.env.local` 设置 `VITE_OCTO_UPLOAD_ENDPOINT=<内网地址>`