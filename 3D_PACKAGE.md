# 3D 打包手册（exe）

一条命令打包，3d-templete / 3d-components 自动取打包时刻的最新源码：

```bash
cd packages/desktop
bun scripts/release.ts --win --channel dev
```

产物：`packages/desktop/dist/octo-desktop-win-x64.exe`（NSIS 安装包，首次较慢：opencode build + electron build + 250MB 资源打包）。

> 本地打包前请确保 Windows 已开启「开发者模式」（设置 → 隐私和安全性 → 开发者选项）。否则主 exe 会保留 Electron 默认图标（功能无损，仅图标差异）。详见下方「已知边界」。

## 打包链自动做的事

`release.ts` → `build`（prebuild 自动跑）→ `package`：

1. **prebuild** 依次：
   - copy-icons
   - opencode `build-node.ts`（sidecar bundle，3D agent prompt 已静态打进 bundle）
   - **`copy-3d-resources.ts`** ← 3D 资源 staging（本手册核心，见下）
2. electron-vite build（main/preload/renderer）
3. electron-builder → NSIS exe

## staging 拷了什么（`.3d-dist/` → 安装包 `resources/3d/`）

| staging | 装机后位置 | 用途 |
|---|---|---|
| `template/`（3d-templete 源码 + 剪过 dev 依赖的 node_modules，~144MB） | `resources/3d/template` | workspace materialize 拷贝源 + node_modules junction 目标 |
| `3d-components/`（src + dist + package.json） | `resources/3d/3d-components` | workspace vite alias（src）+ 导出工程 vendor（dist） |
| `bin/bun.exe`（~94MB） | `resources/bin/bun.exe` | workspace vite 的运行时 |

源路径默认 `D:/cyc/project/octo/3d-templete` / `D:/cyc/project/octo/3d-components`，可用 env 覆盖：`TEMPLATE_3D_SRC` / `COMPONENTS_3D_SRC` / `OCTO_3D_BUN_SRC`。`OCTO_SKIP_3D=1` 可打出不含 3D 的包。

**注意**：`.env.local`（混元密钥）不打包。需要混元 GLB 的机器，手动把它放到 `resources/3d/template/.env.local`（安装目录下）即可恢复；不放则走 low-poly 兜底。

## 打包前唯一要手动留意的

- **3d-templete**：不需要任何 build，直接拷源码（运行时 workspace 走 vite dev 读源码）。改完直接打包即可。
- **3d-components**：改过源码必须先出 fresh dist：

  ```bash
  cd D:/cyc/project/octo/3d-components
  npm run build
  ```

  staging 有**新鲜度防呆**：src 比 dist 新 → 打包直接失败并提示（stale dist 预览正常、只炸导出工程，极隐蔽）。git 切分支摸了 src mtime 导致误报时，重跑一次 build 或 `OCTO_3D_ALLOW_STALE_DIST=1` 跳过。
  （已知怪癖：build 在 dts 阶段报错非零退出属正常，JS 产物在报错前已写出、是 fresh 的，防呆检查能过。）
- **新增/修改了组件 API**（要让 LLM 用上）：

  ```bash
  cd D:/cyc/project/octo/3d-components && npm run gen:component-docs   # docs/components.json
  cd UXAI/packages/opencode && npm run gen:component-catalog           # plan prompt 静态目录
  ```

  不重烘 catalog，plan LLM 不知道有新组件。

## 渠道

`--channel dev | beta | prod`（默认 prod）。dev 渠道独立 appid「Octo Agent Dev」，可与本机正式版共存，日常自测用 dev。

## 装好后的快速验证

1. 3D tab → 生成小场景 → 控制台 materialize 路径应为 `...\resources\3d\template` → 51857 预览渲染
2. 编辑态改色 → 提交 → 切版本切回 → 持久
3. 下载导出工程 → 解压含 `vendor/3d-components/dist` + 生成 handler
4. 实时预览 → 开 51857 新窗

## 免重打包调试（可选）

装好的 exe 设系统 env 后重启，直接吃活母版（改 template/组件源码立即生效于下次 materialize）：

```
OCTO_3D_TEMPLATE_SRC=D:\cyc\project\octo\3d-templete
OCTO_3D_COMPONENTS_SRC=D:\cyc\project\octo\3d-components
```

仅本机调试用；目标用户机器不设，走 resources 快照。

## 已知边界

- 仅 Windows（bun.exe 是 win32）。
- 本地打出的 exe 未签名（签名只在 GitHub Actions 跑）。
- 本地未开 Windows「开发者模式」时，主 exe 保留 Electron 默认图标（rcedit 工具链在无开发者模式时下载解压会失败，已用 `signAndEditExecutable: false` 绕过；NSIS 安装包图标不受影响）。开启开发者模式后主 exe 图标也会正常应用。
- 旧 JSON-only 会话（无 code 维度的历史版本）预览回退 5173 在打包版是死链；codegen 会话全走 51857 不受影响。
