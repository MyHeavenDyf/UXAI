# Octo 内网打包服务

这套服务运行在具备完整桌面端打包环境的内网构建机上。同一内网的用户可以通过浏览器提交任务、查看实时日志、切换本地代码分支，并下载构建产物。服务支持 macOS ARM64、macOS x64 和 Windows x64 构建节点。

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

## 将产物上传到内网服务器

构建节点可选配置统一的内网产物服务器。配置后，打包成功的文件仍会在构建机本地保留一份，同时通过 HTTP `PUT` 上传到服务器，网页下载按钮会直接使用服务器地址：

```bash
cp packaging_shell/artifact_server.env.example packaging_shell/.env.artifact
```

然后编辑 `packaging_shell/.env.artifact`：

```bash
BUILD_ARTIFACT_UPLOAD_URL="http://内网服务器地址:端口/upload"
BUILD_ARTIFACT_DOWNLOAD_URL="http://内网服务器地址:端口/artifacts"
BUILD_ARTIFACT_UPLOAD_TOKEN=""
```

`.env.artifact` 已被仓库的 `.env.*` 规则忽略，不会提交服务器令牌。之后仍按原命令启动节点即可，`start_build_service.sh` 会自动加载该文件。也可以通过 `BUILD_ARTIFACT_ENV_FILE` 指定其他配置文件。

地址暂时不确定时不创建配置文件，服务会继续使用现有的构建机本地下载方式。确定服务器后，只需在每台构建节点填写配置，不需要修改代码。三台构建机都应填写相同的服务器地址；主控服务不负责上传，因此主控不需要配置。

产物服务器需要提供以下约定：

- 接受 `PUT <BUILD_ARTIFACT_UPLOAD_URL>/<任务ID>/<文件名>`，成功时返回任意 `2xx` 状态。
- 可通过 `GET <BUILD_ARTIFACT_DOWNLOAD_URL>/<任务ID>/<文件名>` 下载相同文件。
- 建议返回正确的 `Content-Length`，并支持 HTTP Range，以便大文件完整下载和断点续传。
- 如果设置了上传令牌，上传请求会携带 `Authorization: Bearer <令牌>`；下载地址默认不携带令牌，适合仅在可信内网开放。
- 服务器端文件的保留周期由服务器自行管理；构建节点只会自动清理本机三天前的归档。

任一产物上传失败时，任务会标记为失败并在日志中列出文件和 HTTP 状态；本地归档不会删除，可以从构建机继续下载。

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

## 运行机制与原理

### 1. 服务角色

`build_service.ts` 根据 `BUILD_WORKERS` 是否存在自动决定角色：

- 未设置 `BUILD_WORKERS`：作为构建节点运行，接收并实际执行本机平台的任务。
- 设置了 `BUILD_WORKERS`：作为主控运行，提供统一网页，并把请求转发给目标平台的构建节点。

整体请求链路如下：

```text
浏览器
  │
  ▼
主控服务（统一页面）
  ├── mac-arm64 构建节点
  ├── mac-x64 构建节点
  └── win-x64 构建节点
```

主控本身不执行打包。用户提交任务后，主控根据目标平台把任务转发到对应构建节点。主控每秒读取一次各节点的任务状态，并通过 SSE 长连接把状态和新增日志推送给浏览器。安装包下载请求也由主控转发给实际保存产物的构建节点。

每个构建节点维护独立队列。同一节点一次只执行一个任务，不同节点之间可以并行执行，因此三个平台互不占用彼此的工作区。

### 2. 两类分支的区别

每个任务包含两个用途完全不同的分支：

- **基础代码分支**：来自构建节点上 `packaging_shell` 所在的本地 Git 项目，决定使用哪套内网基础代码、自动化脚本和定制资源。
- **下载分支**：来自固定仓库 `https://github.com/MyHeavenDyf/UXAI.git`，决定打包时下载并合并哪个 GitHub 分支的 `packages` 内容。

主控模式下，选择目标平台后，基础代码分支列表会从对应构建节点读取。下载分支列表由服务通过 `git ls-remote --heads` 从固定 GitHub 仓库获取。

基础代码分支和下载分支都支持输入关键字搜索，但提交时必须选择列表中真实存在的分支。

### 3. 基础代码分支刷新

点击基础代码分支旁的“刷新”后，实际执行以下过程：

1. 读取当前构建节点本地项目配置的 Git 远端，优先使用 `origin`。
2. 通过代理执行 `git fetch --prune`，获取该远端的全部分支引用。
3. 比较 `refs/remotes/<remote>` 与本地 `refs/heads`。
4. 为缺失的远端分支创建同名本地跟踪分支。
5. 返回最新本地分支列表并更新基础代码分支搜索框。

刷新不会强制删除本地独有分支，避免误删尚未合并的代码。已有本地分支也不会在刷新时被强制重置；真正执行任务时，服务会切换到所选分支并使用 `git pull --ff-only` 更新它。

存在运行中或排队中的任务时禁止刷新基础代码分支，避免在任务使用工作区时修改 Git 引用。

### 4. 任务从提交到完成的完整流程

构建节点按以下顺序执行每个任务：

1. 校验目标平台、基础代码分支、下载分支、版本号和构建环境。
2. 将任务写入节点队列，状态设为 `queued`。
3. 轮到该任务时将状态改为 `running`，并记录开始时间。
4. 检查 Git 工作区；如果存在任务外的未提交修改，立即终止任务。
5. 使用 `git checkout` 切换到任务绑定的基础代码分支。
6. 从 `.env.proxy` 读取代理，通过 `git pull --ff-only` 拉取该分支最新远端代码；无法快进合并时任务失败，不自动执行 merge 或 rebase。
7. 根据切换后的分支重新生成自动化资源缓存。
8. 从缓存执行 `run_all.sh`，传入下载分支、版本、构建环境和目标平台。
9. 打包成功后，从 `packages/desktop/dist` 收集安装包和更新文件到任务独立归档目录；配置了产物服务器时，再上传并记录服务器下载地址。
10. 无论打包成功还是失败，都清理本次任务对 Git 工作区产生的修改。
11. 写入结束时间、退出码、日志和最终状态。
12. 队列全部完成后，在工作区干净的前提下切回服务启动时所在的分支。

`git pull --ff-only` 要求本地分支已配置上游。通过页面刷新自动创建的本地分支会跟踪对应远端分支。

### 5. 自动化脚本与资源缓存

服务启动时会在系统临时目录创建运行缓存，例如：

```text
/tmp/octo-build-service-xxxxxx/
```

Windows 上对应 `%TEMP%/octo-build-service-xxxxxx/`。缓存目录名称每次启动都可能不同，不应在脚本中写死。

每个任务切换并拉取基础代码分支后，服务会清空旧缓存，再递归复制该分支 `packaging_shell` 下的自动化脚本和资源，同时排除：

- `packaging_shell/artifacts`
- `packaging_shell/packages`
- `packaging_shell/zip`
- `.DS_Store`

因此以下内容新增、修改或删除后，会在下一个任务中自动同步，不需要维护缓存白名单，也不需要仅因资源变化而重启服务：

- `packaging_shell/libs/` 中的辅助脚本和子目录。
- `packaging_shell/jk-j60099994/` 中的 `.sh`、`.tsx`、`.ts`、`.css`、`.svg` 等资源。
- `packaging_shell` 下其他新的自动化资源目录。

服务向脚本传入三个目录变量：

- `PACKAGING_PROJECT_ROOT`：构建节点当前项目根目录。
- `PACKAGING_SCRIPT_DIR`：本次任务的临时脚本缓存目录。
- `PACKAGING_DATA_DIR`：项目中的 `packaging_shell` 数据目录，用于保存下载 ZIP 和解压后的临时 `packages`。

脚本应通过变量引用缓存资源，例如：

```bash
source "$PACKAGING_SCRIPT_DIR/libs/replace.sh"
cp "$PACKAGING_SCRIPT_DIR/jk-j60099994/dialog-login.tsx" "目标路径"
```

不要写死系统临时目录，也不要在跨平台脚本中使用反斜杠拼接缓存路径。

如果任务选择的基础代码分支完全没有 `packaging_shell`，或者缺少 `packaging_shell/run_all.sh`，缓存无法生成，该任务会失败。服务进程通常仍能继续运行，因为服务代码已经加载到内存；队列结束后会尝试切回启动分支。

### 6. `run_all.sh` 打包流水线

当前主流程依次执行以下必需脚本，任意一步返回非零退出码都会立即中断：

1. `download_git_zip.sh`：通过代理下载固定 GitHub 仓库中所选分支的 ZIP。
2. `extract.sh`：解压 ZIP，并将其中的 `packages` 放入 `PACKAGING_DATA_DIR/packages`。
3. `copy_packages.sh`：将下载内容合并到基础代码项目的 `packages`，同名文件覆盖，本地独有文件保留。
4. `version.sh`：更新 `packages/desktop/package.json` 的版本号。
5. `build_desktop.sh`：加载代理、设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`、执行 `bun install`，再按平台和环境完成编译与打包。

构建环境只允许 `beta` 和 `prod`。目标平台与实际构建机不一致时会拒绝执行；`BUILD_ALLOW_CROSS_TARGET=1` 仅用于单机模拟集群测试。

### 7. Git 清理机制

任务脚本会修改基础代码工作区，因此任务结束后服务执行：

```bash
git reset --hard HEAD
git clean -fd -e packaging_shell/
```

含义如下：

- `git reset --hard HEAD`：还原所有已跟踪文件的修改。
- `git clean -fd`：删除任务产生的未跟踪文件和目录。
- `-e packaging_shell/`：保留服务数据目录、任务记录、下载缓存和归档产物。

这会清除任务开始后对 Git 工作区产生的改动，所以服务在任务开始前必须确认工作区干净。任务开始前已经存在人工修改时，服务拒绝执行，而不是擅自暂存、覆盖或删除。

### 8. 任务记录、日志与产物

任务数据由实际执行任务的构建节点保存：

```text
packaging_shell/artifacts/jobs.json
packaging_shell/artifacts/<任务 ID>/
```

- `jobs.json` 保存近三天任务的参数、状态、时间、退出码、日志和产物索引。
- 每个任务的安装包使用独立任务 ID 目录归档，不会被后续任务覆盖。
- 配置产物服务器后，任务记录会保存每个文件的服务器下载地址，刷新页面或通过主控查看时仍会直接从服务器下载。
- 服务每小时清理一次创建时间超过三天的任务及其产物目录。
- 页面刷新后从服务重新读取任务记录，因此最近三天记录仍会显示。
- 如果节点服务在任务处于 `queued` 或 `running` 时重启，该任务会在恢复记录时标记为失败，不会自动续跑。
- 单个任务日志最多保留最近约 400,000 个字符，避免记录无限增长。

服务会归档 `.dmg`、`.zip`、`.exe`、`.appimage`、`.deb`、`.rpm`、`.yml`、`.yaml` 和 `.blockmap` 文件。主控下载时会使用不受普通接口 10 秒超时限制的专用链路转发请求，并保留 `Content-Length`、`Content-Range`、`Accept-Ranges` 和 `ETag`。构建节点支持 HTTP Range 请求，因此大安装包可以校验完整长度并支持断点续传。

### 9. 代理配置

以下操作需要通过内网代理访问外部资源：

- 同步基础代码项目的 Git 远端分支。
- 任务开始前拉取基础代码分支。
- 获取固定 GitHub 仓库的下载分支。
- 下载分支 ZIP。
- `bun install` 和桌面端打包依赖下载。

默认读取项目根目录 `.env.proxy`，也可以使用 `PACKAGING_PROXY_ENV_FILE` 指定其他文件。服务端兼容在根目录文件不存在时读取 `merge-option/.env.proxy`。配置格式：

```bash
HW_USER="内网代理账号"
HW_PASS="内网代理密码"
HW_PROXY_HOST="proxyhk.huawei.com:8080"
```

`HW_PROXY_HOST` 可省略，默认使用 `proxyhk.huawei.com:8080`。不要把包含真实账号密码的 `.env.proxy` 提交到 Git。

### 10. Git 2.15 兼容

Intel macOS 构建机使用 Git 2.15.0，因此服务使用以下兼容命令：

- 使用 `git symbolic-ref --quiet --short HEAD` 读取当前分支。
- 使用 `git checkout <branch>` 切换分支。
- 不使用较新版本才支持的 `git branch --show-current`、`git switch` 或 `git restore`。

### 11. 哪些改动需要重启服务

- 修改 `build_service.ts`：需要重启对应服务进程。
- 修改 `build_service.html`：页面内容在服务启动时读入内存，需要重启主控服务。
- 修改 `run_all.sh`、`libs/`、`jk-j60099994/` 或其他缓存资源：不需要重启；下一个任务会重新缓存。
- 首次部署新的缓存机制：需要重启一次，让新的 `build_service.ts` 生效。

## 页面能力

- 基础代码分支始终来自 `packaging_shell` 所在的当前本地 Git 项目。
- 基础代码分支不定时轮询；点击刷新会从当前项目的 Git 远端获取全部分支，并为缺失的远端分支创建同名本地跟踪分支。
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
- 每个任务执行前自动切换到它绑定的基础代码分支，并通过 `git pull --ff-only` 拉取该分支的最新远端代码；队列结束后自动切回服务启动分支。
- 服务会递归缓存 `packaging_shell` 中的自动化脚本和资源目录（排除 `artifacts`、`packages`、`zip`）；每个任务切换基础分支后都会重新生成缓存，新脚本和配套资源无需维护缓存白名单。
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
