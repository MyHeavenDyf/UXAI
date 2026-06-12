# HTTP API 请求链路诊断日志 + 外部链接崩溃修复

## 背景

用户点击 /insight webfetch 链接后，Electron 应用整体崩溃。崩溃后重开应用立即显示 400 Bad Request 错误，应用完全无法使用。

错误信息：`opencode server GET http://127.0.0.1:61158/session?directory=C%3A%5CUSER%5Ch00574684 → 400 Bad Request: (empty response body)`

## 修改内容

### 1. desktop: 外部链接崩溃修复 (packages/desktop/src/main/windows.ts)

**问题根因**：Electron 默认对 `target="_blank"` / `window.open` 会创建新的 BrowserWindow，但自定义 `oc://` 协议无法加载外部 URL，导致整个应用卡死/崩溃。

**修复**：
- 在 `createMainWindow()` 和 `createLoadingWindow()` 中添加 `setWindowOpenHandler`
- 所有 HTTP/HTTPS 外部链接强制走系统默认浏览器 (`shell.openExternal`)
- 非外部链接直接 deny，避免创建新窗口

### 2. workspace-routing.ts: 入口点目录解析日志

添加日志点：
- `defaultDirectory()`: 记录 fromQuery/fromHeader/fallback 三种来源
- `planRequest():start`: 记录请求 method/pathname/search/directoryParam/workspaceID
- `planRequest():missing-workspace`: workspace 找不到时的警告
- `planRequest():workspace-plan`: workspace plan 类型
- `planRequest():local`: local plan 的 directory/workspaceID

### 3. instance-context.ts: URL 解码诊断

添加日志点：
- `decode()`: 记录 input/result/changed，捕获解码失败
- `provideInstanceContext()`: 记录 rawDirectory/decodedDirectory/workspaceID

**关键发现**：`decode()` 在 URL query 参数自动解码后再次调用 `decodeURIComponent()`，可能导致双重解码问题。

### 4. error.ts: 错误分类增强

添加日志点：
- `error-middleware:passthrough`: 非 defect 错误透传时的警告
- `error-middleware:named`: NamedError 的 name/status/message
- `error-middleware:busy`: Session.BusyError 的 message
- `error-middleware:unknown-defect`: 未识别缺陷的 type/constructor/message

### 5. instance-store.ts: 实例加载追踪

添加日志点：
- `load:input`: 记录 directory/hasProject/hasWorktree
- `load:resolve-failed`: AppFileSystem.resolve() 失败时的错误
- `load:resolved`: 解析前后的 directory 对比
- `load:cache-hit`: 缓存命中
- `load:cache-miss`: 缓存未命中

### 6. project.ts: Git 发现过程追踪

添加日志点：
- `fromDirectory:no-git`: 无 .git 目录
- `fromDirectory:no-git-binary`: 无 git 命令
- `fromDirectory:git-common-dir-failed`: rev-parse 失败
- `fromDirectory:rev-list`: 根提交计数和生成的 ID
- `fromDirectory:no-id`: 无法生成项目 ID
- `fromDirectory:toplevel-failed`: show-toplevel 失败
- `fromDirectory:discovered`: 成功发现的 id/worktree/sandbox

### 7. session.ts handler: Session 列表请求日志

添加日志点：
- `list:enter`: 记录 scope/directory/path/start/limit
- `list:success`: 记录返回数量

## 涉及文件

| 文件 | 操作 |
|------|------|
| packages/desktop/src/main/windows.ts | 修改：添加 setWindowOpenHandler |
| packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts | 修改：添加诊断日志 |
| packages/opencode/src/server/routes/instance/httpapi/middleware/instance-context.ts | 修改：添加诊断日志 |
| packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts | 修改：添加诊断日志 |
| packages/opencode/src/project/instance-store.ts | 修改：添加诊断日志 |
| packages/opencode/src/project/project.ts | 修改：添加诊断日志 |
| packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts | 修改：添加诊断日志 |

## 验证方式

1. 运行桌面端，点击 /insight webfetch 链接，确认链接在系统浏览器打开而非崩溃
2. 观察日志文件，追踪完整请求链路：workspace-routing → instance-context → instance-store → project.fromDirectory → session handler
3. 若出现 400 错误，日志可定位到具体失败环节

## 相关 issue

- 点击 webfetch 外部链接导致 Electron 应用崩溃
- 400 Bad Request (empty response body) 错误排查