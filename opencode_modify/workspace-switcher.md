# octoapp 顶栏全局 Workspace 切换器

> 功能:把原生 UI 的"创建和切换 workspace"(选择本地目录 → 决定 session 存储与工作位置)引入 octoapp。
> 实现主体在 `packages/app/octoapp`,packages/opencode 零改动。

## 需求与决策

- /insight、/design(make)、/studio 三页都要能切换/创建 workspace,且任何页面切换都全局生效
- "创建" = 选择已有本地目录(系统目录选择器),不做 worktree 沙盒
- UI = 顶栏全局切换器(titlebar 三页共用,一处实现全局生效)
- 切换行为:insight/make 留在当前页自动重挂载;studio 跳转新目录 URL

## 实现文件

### 1. 新建 `packages/app/octoapp/components/workspace-switcher.tsx`

自包含组件(不建 context):

- **trigger**:目录图标 + 当前目录名 + chevron;当前目录取 `useProjectDir({mode:"project"})`(insight/make 解析 projects.last(),studio 解析 params.dir,三页统一)
- **菜单**(Portal + fixed,自带 `octo-ws-*` 样式):已打开目录列表(主行 name/目录名,次行 `~` 替换 home 的路径,当前项高亮勾)+ 分隔线 + "选择文件夹…"入口
- 定位模式照抄 titlebar 现有 dropdown(triggerRef + getBoundingClientRect + resize/scroll 跟随 + 外点/Escape 关闭),不用 ui/Popover(Windows zoom 兼容)
- **switchWorkspace(dir) 步骤序列**:
  1. `layout.projects.open(dir)`(rootFor 归并去重 + loadSessions)
  2. `server.projects.touch(dir)`(持久化 lastProject —— 全局切换的核心)
  3. `globalSDK.createClient({directory}).session.list()` 预热(InstanceMiddleware → InstanceStore.load → 服务端注册 project)
  4. `/^\/[^/]+\/studio/.test(pathname)` → `navigate(`/${base64Encode(dir)}/studio`)`;insight/make 不导航,由页面机制自动响应(见下)
- **chooseFolder()**:desktop 本地(`platform.openDirectoryPickerDialog && server.isLocal()`)走原生 picker(defaultPath=当前目录);否则降级 `dialog.show(<DialogSelectDirectory onSelect/>)`(octoapp 自带的目录搜索对话框)
- 埋点:`tracker.interaction({module:"workspace-switcher", name:"switch"|"choose-folder"})`

### 2. `packages/app/octoapp/components/titlebar-simple.tsx`

import WorkspaceSwitcher,插在右侧区 `<TaskList />` 之前(用户头像区左侧)。三页共用 titlebar,一处接入全局生效。

### 3. i18n(`octoapp/i18n/en.ts` / `zh.ts`)

新增 `titlebar.workspace.select` / `titlebar.workspace.chooseFolder`。注意勿复用 zh.ts 既有的 `workspace.*` 键(那是上游 worktree 沙盒概念,指 Local/Sandbox 标签)。

## 为什么页面零改动(insight/make/studio 均未动)

- 全局状态链路已存在:`server.projects.touch()` 持久化 lastProject → `useProjectDir()`(params.dir → last → home)响应
- insight/make 页面均用 `<Show when={projectDir()} keyed>` 包 SDKProvider(insight/index.tsx:153、make/index.tsx:152),touch 后整树重挂;旧 URL 里的 :id 由页面挂载守卫自动清理(navigate 回 /insight、/make)
- studio 的 `:dir` 段由 DirectoryLayout 消费(挂 SDKProvider + `lastSessionPerTab.studio(dir)` 每目录 last session),跳 `/${b64(dir)}/studio`(不带 id,恢复 effect 自动带出该目录 last session,与 titlebar studio tab 逻辑一致)
- studio 会话数据实际存 `octoSessionsDir(config)` 跨 workspace 共享(现状架构),切换器只影响 :dir 与 last session 恢复,不过滤 studio 会话列表

## 已知边界

- `layout.projects.open` 的 rootFor 会把所选子目录归并到已打开的 git 根(与 onboarding/home 行为一致)
- 列表为空(首次使用)时菜单只有"选择文件夹…"
- web 环境"选择文件夹"走 DialogSelectDirectory(服务端 file.list 搜索),desktop 走系统原生选择器

## Workspace 分类(普通/代码) — 2026-10-12 追加

workspace 增加分类标记:**普通工作区(normal)/ 代码工作区(code)**,纯 UI 展示(不影响 agent 行为、session 存储)。存量 workspace 无 kind 字段一律视为 normal,零迁移。

### 数据层

- `octoapp/context/server.tsx`:导出 `type WorkspaceKind = "normal" | "code"`;`StoredProject` 加 optional `kind`(持久化在 `Persist.global("server", ["server.v3"])`,persist.ts 的 merge 保留存量字段,旧数据天然兼容)
- `server.projects.open(directory, kind?)`:已存在且传 kind → 更新(重选文件夹+选分类=改分类);新建 → 写入;不传 → 保留
- `server.projects.setKind(directory, kind)`:事后修改分类
- `octoapp/context/layout.tsx`:`LocalProject` 加 `kind` 字段;`layout.projects.open` 透传 kind(仅当所选目录即 root 时,归并到别的 root 不覆盖已有分类)、新增 `layout.projects.setKind` 透传;enrich 的 `{...metadata, ...project}` 展开顺序保证 kind 透传
- 已知边缘:layout.tsx rootFor 归并 effect 重建 StoredProject 时,子目录上的 kind 不迁移到 root(可接受)

### 切换器 UI(`workspace-switcher.tsx`)

- **KindPickerDialog**(同文件内联组件,`dialog.show()` 渲染):两张卡片(普通/代码,图标+名称+说明),点卡片即生效并关弹窗,点遮罩/Escape 取消放弃;create/edit 两种标题
- **创建流程**:chooseFolder 选完文件夹 → 弹 KindPickerDialog(create)→ 选完才 `switchWorkspace(dir, kind)`(取消则不加入)
- **事后修改**:列表项悬停右侧出现标签图标按钮 → 弹 KindPickerDialog(edit)→ `layout.projects.setKind`
- **徽章**:列表项名称旁,normal=灰底"普通"、code=蓝底"代码"(`kindOf(project)` 兜底 undefined→normal);trigger 不显示徽章
- 埋点:`kind-set`(dir+kind)、switch 的 extend 增加 kind 字段

### i18n

`titlebar.workspace.kind.*` 共 10 键(title/editTitle/normal/code/normalDesc/codeDesc/badge.normal/badge.code/edit),en+zh。

## 验证

- `bun run typecheck`(packages/app)通过;`vite build` 通过
- 手测路径:见 workspace-switcher 功能验收——/insight/:id 切目录回 /insight 新列表;/make/:id 同理;/:dir/studio/:id 切目录跳新 dir 的 studio 并恢复 last session;刷新后 lastProject 持久保持
- 分类手测:选新文件夹→弹分类→选"代码"→蓝徽章+切换;弹窗取消→不加入;悬停列表项→修改分类→徽章变化;重选已有文件夹+换分类→分类更新;存量 workspace 显示灰"普通";重启后分类保持
