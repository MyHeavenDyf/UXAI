# 打包手册（Windows exe / macOS dmg）

一台机器一条命令出安装包。Windows 出 NSIS exe，macOS 出 dmg。3D 功能（模板+组件库+bun 运行时）自动打进包里，目标机器**不需要**任何开发环境。

> **本文档自包含**：从空目录到产出安装包的全部步骤都在下面。把本文档喂给 AI 助手（如 Claude Code），它照做即可自动打包，不需要额外上下文。

## 〇、三个 Git 仓库（必须全部 clone，缺一不可）

三个仓库都是 **`dev_cyc1` 分支**（打包用此分支，不要用 main/dev）：

| 仓库 | 作用 | 远程 URL |
|---|---|---|
| **UXAI** | 主仓库（桌面端 + opencode + app） | `https://github.com/MyHeavenDyf/UXAI.git` |
| **3d-templete** | 3D 渲染引擎母版（workspace materialize 的拷贝源） | `https://github.com/Viyan-cyc/3d-templete.git` |
| **3d-components** | 3D 组件库（vite alias + 导出工程 vendor） | `https://github.com/Viyan-cyc/3d-components.git` |

## 一、目录怎么放（强制约定）

三个仓库 clone 到**同一个父目录**下（同级兄弟），目录名必须分别是 `UXAI` / `3d-templete` / `3d-components`（与 clone 时的仓库名一致，不要改名）：

```
<任意父目录>/
  UXAI/              ← 主仓库
  3d-templete/       ← 3D 模板
  3d-components/     ← 3D 组件库
```

打包脚本从 `UXAI/packages/desktop` 往上三层定位父目录，再找同级的 `3d-templete` / `3d-components`。**不按此摆放 / 改了目录名 → 打包直接报错**（不想挪目录可设 env 覆盖：`TEMPLATE_3D_SRC` / `COMPONENTS_3D_SRC`，值 = 对应仓库绝对路径）。

## 二、每台新机器的首次准备（一次性）

### 1. 装工具

| 工具 | Windows | macOS | 用途 |
|---|---|---|---|
| git | √ | √ | 拉三个仓库 |
| Node.js LTS（含 npm） | √ | √ | 3d-templete / 3d-components 依赖 |
| bun | `powershell -c "irm bun.sh/install.ps1 \| iex"` | `curl -fsSL https://bun.sh/install \| bash`（或 `brew install bun`） | UXAI 构建 + 打进包里的 3D 运行时 |

- **Windows 建议**：设置 → 隐私和安全性 → 开发者选项 → 开启「开发者模式」。不开也能打包，只是主 exe 保留默认图标（功能无损，详见「签名」节）。
- **macOS**：不需要 Xcode、不需要 Apple 开发者账号（本地出的是未签名 dmg，见「签名」节）。

### 2. clone 三个仓库（同分支 `dev_cyc1`、同父目录）

```bash
# 选一个父目录（任意位置，三个仓库都放这下面）
mkdir my-build && cd my-build

git clone -b dev_cyc1 https://github.com/MyHeavenDyf/UXAI.git
git clone -b dev_cyc1 https://github.com/Viyan-cyc/3d-templete.git
git clone -b dev_cyc1 https://github.com/Viyan-cyc/3d-components.git
```

> `-b dev_cyc1` 直接切到打包分支；忘加的话 clone 后每个仓库都要 `git checkout dev_cyc1`。

### 3. 装依赖 + 出组件 dist

```bash
# UXAI（bun）
cd UXAI && bun install

# 3d-templete（npm；node_modules 含平台原生二进制，必须在打包同平台装）
cd ../3d-templete && npm install

# 3d-components（npm；必须 build 出 dist——导出工程 vendor 用，缺 dist/stale dist 打包会硬失败）
cd ../3d-components && npm install && npm run build
```

> 3d-components 的 build 在 dts 阶段报错非零退出属正常，JS 产物在报错前已写出、是 fresh 的，防呆检查能过。

## 三、怎么打

```bash
cd UXAI/packages/desktop

# Windows → exe
bun scripts/release.ts --win --channel dev

# macOS → dmg（Apple Silicon）
bun scripts/release.ts --mac --arm64 --channel dev
# macOS → dmg（Intel）
bun scripts/release.ts --mac --x64 --channel dev
```

产物在 `packages/desktop/dist/`：

| 平台 | 文件 |
|---|---|
| Windows | `octo-desktop-win-x64.exe`（NSIS 安装包，~242MB） |
| macOS arm64 | `octo-desktop-mac-arm64.dmg`（+ 同名 `.zip`） |
| macOS x64 | `octo-desktop-mac-x64.dmg`（+ 同名 `.zip`） |

首次较慢（opencode sidecar build + electron build + ~250MB 资源 staging），后续增量快。

### 渠道

`--channel dev | beta | prod`（默认 prod）。**日常自测一律用 dev**——独立 appid「Octo Agent Dev」，可与正式版共存互不干扰。

### 日常更新包内容

- **改了 3d-templete 源码**：直接重跑打包命令（staging 每次全量重拷最新源码，无需 build）。
- **改了 3d-components 源码**：先 `cd 3d-components && npm run build` 出 fresh dist，再打包。
- **新增/修改了组件 API**（要让 LLM 用上）：额外重烘两份文档，否则 plan LLM 不知道有新组件：

  ```bash
  cd 3d-components && npm run gen:component-docs
  cd ../UXAI/packages/opencode && npm run gen:component-catalog
  ```

## 四、打包链自动做的事

`release.ts` → `build`（prebuild）→ `package`：

1. prebuild：copy-icons → opencode sidecar build → **copy-3d-resources staging**
2. electron-vite build（main/preload/renderer）
3. electron-builder → NSIS / dmg

staging 拷贝（`.3d-dist/` → 安装包 `resources/3d/`）：

| staging | 装机后位置 | 用途 |
|---|---|---|
| `template/`（3d-templete 源码，~7MB） | `resources/3d/template` | workspace materialize 拷贝源 |
| `template-node-modules/`（剪过纯 dev 包的 node_modules，~137MB） | `resources/3d/template/node_modules` | workspace 依赖（junction/symlink 目标） |
| `3d-components/`（src + dist + package.json） | `resources/3d/3d-components` | workspace vite alias + 导出工程 vendor |
| `bin/bun`（本机 bun 二进制，~90MB） | `resources/bin/bun(.exe)` | workspace vite 运行时 |

- **`.env.local`（混元密钥）不打包**。需要混元 GLB 生成的机器，手动放一份到安装目录 `resources/3d/template/.env.local`（mac 路径：`<App>.app/Contents/Resources/3d/template/.env.local`）；不放则 3D 模型走 low-poly 兜底，其余功能不受影响。
- `OCTO_SKIP_3D=1` 可打出不含 3D 的包（体积小 ~250MB）。

## 五、签名（本地 vs CI）

本地打的包**不签名**（CI 在 GitHub Actions 上才走真签名+公证），配置里已做好自动分叉，无需关心：

| | Windows 本地 | macOS 本地 | CI |
|---|---|---|---|
| 行为 | 跳过 rcedit+签名（无开发者模式时工具链下载必失败，已规避） | 跳过 codesign+公证（无苹果证书/凭据则必失败，已规避） | 真签名（win）/ 签名+公证（mac） |
| 代价 | 主 exe 默认图标（安装包图标正常） | 首次打开被 Gatekeeper 拦：**右键 App → 打开**，或 `xattr -dr com.apple.quarantine '<App>.app>'` | 无 |

## 六、装好后的快速验证（5 分钟）

1. 3D tab → 生成小场景 → 开发者工具 console 里 materialize 路径应为 `...\resources\3d\template` → 预览渲染（127.0.0.1:51857）
2. 编辑态改色 → 提交 → 切版本切回 → 持久
3. 下载导出工程 → 解压含 `vendor/3d-components/dist` + 生成的 handler
4. 实时预览 → 开 51857 新窗
5. 生成含 `asset:rack` 类场景 → 混元无密钥走 low-poly 兜底不报错

## 七、免重打包调试（可选）

装好的 app 设系统 env 后重启，直接吃活母版（改 template/组件源码立即生效于下次 materialize，省去重打包）：

```
OCTO_3D_TEMPLATE_SRC=<父目录>/3d-templete
OCTO_3D_COMPONENTS_SRC=<父目录>/3d-components
```

仅本机调试用；目标用户机器不设，走 resources 快照。

## 八、常见报错

| 报错 | 原因 / 处理 |
|---|---|
| `模板母版不存在: <parent>/3d-templete` | 目录没按同级约定摆，或设 `TEMPLATE_3D_SRC` 覆盖 |
| `3d-components 缺 dist` / `dist 比 src 旧` | `cd 3d-components && npm run build` 出 fresh dist（git 切分支摸了 mtime 导致误报时，确认无改动可 `OCTO_3D_ALLOW_STALE_DIST=1` 跳过）。build 在 dts 阶段报错非零退出属正常，JS 产物已 fresh。 |
| `找不到 bun(.exe)` | bun 没装或不在常规路径；设 `OCTO_3D_BUN_SRC` 指向绝对路径 |
| 打包版生成场景报 vite resolve 失败 / CORS | 旧包已知 bug（路径反斜杠转义），2026-09-02 后的包已修；用新配置重打 |
| Windows 打包到一半 EB_EXIT=1 提及 winCodeSign | 旧配置问题已修（本地自动跳过）；确认没改掉 config 里 `signAndEditExecutable: false` 分叉 |
| NSIS 阶段 `spawn UNKNOWN`（间歇） | Defender 实时扫描撞 spawn 的瞬时竞态（刚落盘的 exe stub 被占）。手动跑一下 stub 或直接重跑 `bun run package:dev --win` 即过；频繁出现可给项目目录加 Defender 排除项 |

## 九、已知边界

- Windows exe 与 macOS dmg 各自只能在对应系统的机器上打（mac 的 codesign/hdiutil、win 的 NSIS 工具链互不可用）。
- **mac 路径已配置完整但尚未实测**（2026-09-02）：bun/签名门控/资源路径均已按跨平台处理，首次在 mac 上跑如遇报错找维护者。
- mac 打包版的 3D 孤儿进程清理（残留 vite 占 51857）是降级 no-op：极端情况下切版本报「端口被占」，重启 app 即恢复。
- 旧 JSON-only 会话（无 code 维度的历史版本）预览回退 5173 在打包版是死链；codegen 会话全走 51857 不受影响。
- 混元无密钥 → low-poly 兜底。
