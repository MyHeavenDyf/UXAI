# Octo 内网打包服务

这套服务运行在一台具备完整桌面端打包环境的内网 Mac 上。同一内网的用户可以通过浏览器提交任务、查看实时日志、切换本地代码分支，并下载构建产物。

## 启动

在项目根目录执行：

```bash
bash packaging_shell/start_build_service.sh
```

默认监听所有网卡的 `8787` 端口。启动后终端会显示本机访问地址和可供其他内网用户访问的地址。

自定义端口：

```bash
BUILD_SERVICE_PORT=9000 bash packaging_shell/start_build_service.sh
```

## 一套网页连接三台构建机

每台构建机启动一个节点服务，目标平台必须与电脑一致：

```bash
# Apple 芯片 Mac
BUILD_NODE_TARGET=mac-arm64 BUILD_SERVICE_PORT=8787 bash packaging_shell/start_build_service.sh

# Intel Mac
BUILD_NODE_TARGET=mac-x64 BUILD_SERVICE_PORT=8787 bash packaging_shell/start_build_service.sh

# Windows（在 Git Bash 中执行）
BUILD_NODE_TARGET=win-x64 BUILD_SERVICE_PORT=8787 bash packaging_shell/start_build_service.sh
```

再选择一台电脑启动主控网页。将示例 IP 替换为三台构建机的实际内网 IP；如果主控和其中一个节点在同一台电脑上，主控需要使用另一个端口：

```bash
BUILD_SERVICE_PORT=8790 \
BUILD_WORKERS="mac-arm64=http://192.168.1.101:8787,mac-x64=http://192.168.1.102:8787,win-x64=http://192.168.1.103:8787" \
bash packaging_shell/start_build_service.sh
```

访问主控服务的 `8790` 端口即可在同一个页面选择目标平台。任务、实时日志和产物仍保存在实际执行任务的构建机中，主控网页会统一展示并代理安装包下载。未设置 `BUILD_WORKERS` 时，服务保持原来的单机模式并自动识别本机平台。

### 在一台电脑上模拟三个构建节点

当三个同级项目目录分别为 `UXAI`、`UXAITEST1`、`UXAITEST2` 时，可在 `UXAI` 中执行：

```bash
bash packaging_shell/start_local_build_cluster.sh
```

脚本使用以下固定映射：

- `UXAI`：macOS x64，端口 `8787`
- `UXAITEST1`：macOS ARM64，端口 `8788`
- `UXAITEST2`：Windows x64，端口 `8789`
- 统一主控网页：端口 `8790`

模拟模式会设置 `BUILD_ALLOW_CROSS_TARGET=1`，用于测试任务分发和尝试跨平台构建。实际部署到三台电脑时不要设置该变量，各节点会拒绝与本机平台不一致的任务。

本机模拟集群的三个节点共用 `UXAI/.env.proxy`，不需要把代理密码复制到两个测试项目。实际部署到三台电脑时，每台构建机都需要在自己的项目根目录准备 `.env.proxy`。

## 页面能力

- 基础代码分支始终来自 `packaging_shell` 所在的当前本地 Git 项目。
- 基础代码分支不定时轮询，需要时可通过页面刷新按钮立即重新读取。
- 下载分支始终来自固定仓库 `https://github.com/MyHeavenDyf/UXAI.git`，不受当前项目 `origin` 配置影响。
- 为每个任务选择基础代码分支和下载分支，填写应用版本和构建环境。
- 主控模式下可选择 `macOS ARM64`、`macOS x64` 或 `Windows x64`，任务会自动发送到对应构建机。
- 构建环境仅支持 `beta` 和 `prod`。
- 同一构建机的任务按顺序串行执行，不同平台的构建机可以并行工作。
- 实时查看构建日志和任务状态。
- 下载每次成功构建后独立归档的产物。
- 任务记录和日志落盘保存，页面刷新或服务重启后仍可查看。
- 自动删除三天前的任务记录及其归档产物。

任务索引保存在 `packaging_shell/artifacts/jobs.json`，每个任务的安装包保存在同目录下以任务 ID 命名的子目录中。
- 查看并切换打包机本地 Git 分支。
- 每个任务执行前自动切换到它绑定的基础代码分支，队列结束后自动切回服务启动分支。
- 每个任务结束后，自动还原已跟踪文件并删除任务产生的未跟踪文件。

## 安全规则

- 工作区存在未提交修改时禁止切换分支。
- 每个任务开始前要求工作区干净，避免删除任务开始前已有的人工修改。
- 存在运行中或排队中的任务时禁止切换分支。
- 只允许切换到打包机已有的本地分支。
- 任务开始后产生的 Git 改动会通过 `git reset --hard HEAD` 和 `git clean -fd` 自动清理；`packaging_shell` 服务目录与 Git 已忽略的缓存、产物目录会保留。
- 获取远端分支、下载源码和安装依赖时，从项目根目录 `.env.proxy` 读取 `HW_USER`、`HW_PASS`，通过内网代理访问外部资源。
- 构建前设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 并执行 `bun install`；脚本不会主动打印代理账号和密码。

## 运行要求

- 打包机需要安装 Bun 和项目依赖。
- macOS DMG 打包所需的系统依赖需要提前准备完成。
- 打包机需要保持开机，且 macOS 防火墙需要允许 Bun 接收入站连接。
- 页面没有账号系统，应仅在可信内网中开放，不要映射到公网。
