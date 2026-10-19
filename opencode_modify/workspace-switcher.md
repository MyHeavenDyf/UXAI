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

## Workspace 分类(普通/代码) — 2026-10-12 追加,同日移除事后修改

workspace 增加分类标记:**普通工作区(normal)/ 代码工作区(code)**,纯 UI 展示(不影响 agent 行为、session 存储)。存量 workspace 无 kind 字段一律视为 normal,零迁移。

**分类一旦选定不可更改**(2026-10-12 二次调整):已删除事后修改入口与 setKind 数据层方法;重复选择已存在的文件夹直接切换、不弹分类窗;`server.projects.open` 恢复"已存在直接 return"。

### 数据层

- `octoapp/context/server.tsx`:导出 `type WorkspaceKind = "normal" | "code"`;`StoredProject` 加 optional `kind`(持久化在 `Persist.global("server", [...])`,落盘桌面端 electron-store `%APPDATA%\ai.octo.desktop[.dev]\opencode.global.dat` 的 `server` key / web 端 localStorage `opencode.global.dat:server`,不进 opencode-local.db、不跨设备同步)
- `server.projects.open(directory, kind?)`:仅新建时写入 kind,已存在直接 return(分类定死)
- `octoapp/context/layout.tsx`:`LocalProject` 加 `kind` 字段;`layout.projects.open` 透传 kind(仅当所选目录即 root 时,归并到别的 root 时不生效);enrich 的 `{...metadata, ...project}` 展开顺序保证 kind 透传
- 已知边缘:layout.tsx rootFor 归并 effect 重建 StoredProject 时,子目录上的 kind 不迁移到 root(可接受)

### 切换器 UI(`workspace-switcher.tsx`)

- **KindPickerDialog**(同文件内联组件,`dialog.show()` 渲染):两张卡片(普通/代码,图标+名称+说明),点卡片即生效并关弹窗,点遮罩/Escape 取消放弃
- **创建流程**:chooseFolder 选完文件夹 → 已在列表(按 worktree 匹配)→ 直接 switchWorkspace 不弹窗;新文件夹 → 弹 KindPickerDialog → 选完才创建+切换(取消则不加入)
- **徽章**:列表项名称旁,normal=灰底"普通"、code=蓝底"代码"(`kindOf(project)` 兜底 undefined→normal);trigger 不显示徽章
- 埋点:switch 的 extend 含 kind 字段

### i18n

`titlebar.workspace.kind.*` 共 8 键(title/normal/code/normalDesc/codeDesc/badge.normal/badge.code),en+zh。

## workspace 分类驱动的 sendMessage 注入差异 — 2026-10-13 追加

分类的**首个行为差异**在 make 页:按 workspace 分类注入**不同**的上下文前缀——

- **普通工作区(normal)**:注入原有 `[Artifact Folder]` 前缀(产物锁定 .octo/<sid>/outputs,优先 <artifact>),与历史行为逐字节一致
- **代码工作区(code)**:注入 `[Workspace]` 提示词——声明工作区路径,直接在本工作区内用 read/write/edit/bash 读写、创建与修改项目文件;**产物目录(artifact folder)用声明式映射为工作区目录本身**(非条件式"如果需要就用"),需要落盘的文件在项目内选合适位置,不写 .octo 会话目录,不用 <artifact> 直接输出产物内容(write/edit 成功后用 `<artifact type="text/link">` 返回文件路径除外,保留前端渲染修改文件的契约)

实现要点:

- `packages/app/octoapp/pages/make/index.tsx` 的 `buildArtifactFolderPrefix()`:函数开头按 `kindOf(layout.projects.list().find(x => x.worktree === projectDir()))` 分流,code 早返回 `[Workspace]` 段(跳过 outputs 扫盘),normal 走原有逻辑不动
- 覆盖三个注入点:sendMessage 命令路径(cmdParts.unshift synthetic)、sendMessage prompt 路径(promptText 前缀)、handleConfirmPlan 直发路径——三者共用此函数,自动生效
- 无需服务端配合:octo-session-workdir 插件只对 octo_insight 会话生效(make 会话走原生行为,相对路径天然解析到工作区根)
- kind 查不到(如 URL 直进未在列表的目录)→ kindOf 兜底 normal → 行为与普通工作区一致

## 新建默认代码工作区、分类选择 UI 移除 — 2026-10-19

分类弹窗与徽章整体下线,改为**新建默认 code**:

- **新建默认 code**:默认值放数据层 `server.projects.open(directory, kind: WorkspaceKind = "code")` —— 切换器/onboarding/home/settings 页设置所有新建入口统一生效;rootFor 归并 effect(layout.tsx)重建 root 时也默认 code
- **不再弹分类选择**:`workspace-switcher.tsx` 删除 KindPickerDialog 与 pickKindThenSwitch,chooseFolder 选完目录直接 switchWorkspace;`switchWorkspace(dir)` 去掉 kind 参数
- **不展示分类徽章**:列表项徽章渲染与 `.octo-ws-badge` / `.octo-ws-kind-card` 样式删除;trigger 本来就不显示
- **layout 层简化**:`layout.projects.open(directory)` 去掉 kind 透传参数(无调用方传值,原"归并到别的 root 时不生效"逻辑随之消失 —— 归并新建 root 现在也默认 code,与全局默认一致)
- i18n 删除 `titlebar.workspace.kind.*` 8 键(en+zh)

### 保持不变(明确验证过)

- **存量兜底**:`kindOf()` 的 `?? "normal"` 不动,老数据无 kind 字段仍视为普通工作区,零迁移
- **已分类工作区不受影响**:`server.projects.open` 已存在直接 return 的逻辑不动,已有 kind(normal 或 code)不被覆盖
- **kind 驱动的行为差异全保留**:make 页 `buildArtifactFolderPrefix` 的 [Workspace]/[Artifact Folder] 分流、Design 页(use-workspace-kind / artifact-auto-save / scope=project 产物布局)、服务端 artifact.ts 的 scope=project 接口均未改动
- 埋点:switch 的 extend.kind 语义微调 —— 已存在工作区记实际 kind,新建记 "code"(原为弹窗所选 kind)

## 验证

- `bun run typecheck`(packages/app)通过;`vite build` 通过
- 手测路径:见 workspace-switcher 功能验收——/insight/:id 切目录回 /insight 新列表;/make/:id 同理;/:dir/studio/:id 切目录跳新 dir 的 studio 并恢复 last session;刷新后 lastProject 持久保持
- 分类手测:选新文件夹→弹分类→选"代码"→蓝徽章+切换;弹窗取消→不加入;重选已有文件夹→直接切换不弹窗且分类不变;存量 workspace 显示灰"普通";重启后分类保持
