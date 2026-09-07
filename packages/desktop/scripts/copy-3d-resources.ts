#!/usr/bin/env bun
// 3D 资源 staging：把 3d-templete / 3d-components / bun.exe 拷进 .3d-dist/，供 electron-builder
// extraResources 打进安装包（asar 外 resources/3d/...）。prebuild 阶段跑，每次全量重拷。
//
// 关键约束：
// - 模板 node_modules 必须带（workspace junction 指向它、vite 从它解析），但剪纯 dev 顶层包省 ~45MB
// - .env.local 不拷（混元密钥不入包，见打包方案；需手动放 resources/3d/template/.env.local）
// - 3d-components 必须有 fresh dist（导出工程 vendor 用，stale dist 会炸 export named X）
// - dist 缺失 / 源缺失 → 硬失败，避免静默打出坏 3D 的包（OCTO_SKIP_3D=1 可显式跳过）
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const skip = process.env.OCTO_SKIP_3D === "1"

// 约定：UXAI / 3d-templete / 3d-components 三个仓库 clone 到同一父目录下（同级兄弟）。
//   <parent>/UXAI/packages/desktop  ← 脚本 cwd（prebuild 从这跑）
//   <parent>/3d-templete
//   <parent>/3d-components
// 故从 cwd 往上三层 = <parent>，再进 3d-templete / 3d-components。
// env 可覆盖（TEMPLATE_3D_SRC / COMPONENTS_3D_SRC）；找不到硬失败报清晰错误。
const parentDir = resolve(process.cwd(), "../../..")
const templateSrc = process.env.TEMPLATE_3D_SRC ?? join(parentDir, "3d-templete")
const componentsSrc = process.env.COMPONENTS_3D_SRC ?? join(parentDir, "3d-components")

const distDir = ".3d-dist"
const tplDist = join(distDir, "template")
const compDist = join(distDir, "3d-components")
const binDist = join(distDir, "bin")

// 模板顶层排除（.git/dist 不需要；.husky/.claude 开发工具；.env.local 密钥不入包；.env.example 无用；
// node_modules 走下方单独的剪枝拷贝，这里必须排除——否则先整份拷入、剪枝第二轮白剪）
const TEMPLATE_TOP_EXCLUDE = new Set([
  ".git",
  "dist",
  ".husky",
  ".claude",
  ".env.local",
  ".env.example",
  "node_modules",
])
// node_modules 内纯 dev 顶层包（vite dev 运行时用不到：TS/vue-tsc 类型检查、eslint、husky）。
// 注意 @vue 其余保留（compiler-* 是 runtime 依赖）；adm-zip 是 devDep 但混元中间件运行时要，保留。
const NM_EXCLUDE = new Set([
  "typescript",
  "vue-tsc",
  "eslint",
  "@typescript-eslint",
  "@eslint",
  "@types",
  "husky",
  "lint-staged",
  "@vue/tsconfig",
])

function fail(msg: string): never {
  console.error(`[copy-3d-resources] ${msg}`)
  process.exit(1)
}

function listEntries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).map((e) => e.name)
}

function dirSizeBytes(p: string): number {
  let total = 0
  for (const name of listEntries(p)) {
    const full = join(p, name)
    const st = lstatSync(full)
    if (st.isDirectory()) total += dirSizeBytes(full)
    else if (st.isFile()) total += st.size
  }
  return total
}

function dirSizeMb(p: string): number {
  return Math.round(dirSizeBytes(p) / 1024 / 1024)
}

/** 目录树内最新文件 mtime（ms）。用于 dist 新鲜度检查：src 比 dist 新 = dist 是 stale 构建产物。 */
function latestMtime(p: string): number {
  let latest = 0
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, e.name)
    const st = lstatSync(full)
    if (st.isDirectory()) latest = Math.max(latest, latestMtime(full))
    else if (st.isFile()) latest = Math.max(latest, st.mtimeMs)
  }
  return latest
}

if (skip) {
  console.log("[copy-3d-resources] OCTO_SKIP_3D=1 跳过（打出的包不含 3D）")
  process.exit(0)
}

if (!existsSync(templateSrc)) fail(`模板母版不存在: ${templateSrc}（可设 TEMPLATE_3D_SRC）`)
if (!existsSync(join(templateSrc, "node_modules"))) fail(`模板缺 node_modules（先在 3d-templete npm install）`)
if (!existsSync(componentsSrc)) fail(`3d-components 不存在: ${componentsSrc}（可设 COMPONENTS_3D_SRC）`)
if (!existsSync(join(componentsSrc, "dist")))
  fail(`3d-components 缺 dist（先 cd 3d-components && npm run build，stale/缺失 dist 会让导出工程炸 export named）`)
// dist 新鲜度防呆：src 比 dist 新 → dist 是 stale 产物。stale dist 陷阱：workspace 预览不炸
//（vite alias 读 src），只有导出工程炸 "does not provide an export named X"（vendor 复制 dist），
// 极隐蔽（既有踩坑）。git checkout/切分支会摸 src mtime 造成误报——此时重跑一次 build 即可，
// 确认无改动可 OCTO_3D_ALLOW_STALE_DIST=1 跳过。
if (process.env.OCTO_3D_ALLOW_STALE_DIST !== "1") {
  const srcMtime = latestMtime(join(componentsSrc, "src"))
  const distMtime = latestMtime(join(componentsSrc, "dist"))
  if (srcMtime > distMtime)
    fail(
      `3d-components 的 dist 比 src 旧（src ${new Date(srcMtime).toISOString()} > dist ${new Date(distMtime).toISOString()}）` +
        `——先 cd 3d-components && npm run build 重出 fresh dist 再打包（stale dist 只炸导出工程不炸预览）；` +
        `确认无改动可 OCTO_3D_ALLOW_STALE_DIST=1 跳过`,
    )
}

// bun 二进制文件名按平台定（win: bun.exe / mac·linux: bun）。staging 拷进 bin/ 供打包版
// workspace vite 运行时；IPC resolveDevRuntime 从 resources/bin 按同名解析。
const bunBinName = process.platform === "win32" ? "bun.exe" : "bun"
const bunCandidates = [
  process.env.OCTO_3D_BUN_SRC,
  process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", bunBinName) : null,
  process.env.USERPROFILE ? join(process.env.USERPROFILE, ".bun", "bin", bunBinName) : null,
  process.env.HOME ? join(process.env.HOME, ".bun", "bin", bunBinName) : null,
  // mac：homebrew 装的 bun（Apple Silicon / Intel 路径各一）
  process.platform === "darwin" ? "/opt/homebrew/bin/bun" : null,
  process.platform === "darwin" ? "/usr/local/bin/bun" : null,
].filter((p): p is string => !!p)
const bunSrc = bunCandidates.find((p) => existsSync(p))
if (!bunSrc) fail(`找不到 ${bunBinName}（打包版 workspace vite 的运行时；可设 OCTO_3D_BUN_SRC 指向绝对路径）`)

console.log(`[copy-3d-resources] 模板   ${templateSrc}`)
console.log(`[copy-3d-resources] 组件库 ${componentsSrc}`)
console.log(`[copy-3d-resources] bun    ${bunSrc}`)

rmSync(distDir, { recursive: true, force: true })

// ── 模板：源码 + assetsLibrary + public + vite.config 等 + 剪过的 node_modules ──
mkdirSync(tplDist, { recursive: true })
for (const entry of listEntries(templateSrc)) {
  if (TEMPLATE_TOP_EXCLUDE.has(entry)) continue
  cpSync(join(templateSrc, entry), join(tplDist, entry), { recursive: true, dereference: true })
}
// node_modules 单独拷（剪 dev 顶层包）到兄弟目录 template-node-modules/，而非 template/node_modules：
// electron-builder createFilter 硬编码排除 from 根下直接名为 node_modules 的目录（app-builder-lib
// out/util/filter.js: relative === "node_modules" → false），写什么 filter 都救不回来——
// 12:38/12:54 两次实证 resources/3d/template 缺 node_modules 的根因。extraResources 用
// 第二条 entry 把它映射到 3d/template/node_modules。
const nmSrc = join(templateSrc, "node_modules")
const nmDst = join(distDir, "template-node-modules")
mkdirSync(nmDst, { recursive: true })
for (const entry of listEntries(nmSrc)) {
  if (NM_EXCLUDE.has(entry)) continue
  cpSync(join(nmSrc, entry), join(nmDst, entry), { recursive: true, dereference: true })
}

// ── 3d-components：src（workspace vite alias）+ dist（导出 vendor）+ package.json（vendor 精简源）──
mkdirSync(compDist, { recursive: true })
for (const entry of ["src", "dist", "package.json"]) {
  cpSync(join(componentsSrc, entry), join(compDist, entry), { recursive: true, dereference: true })
}

// ── bun 二进制 ──
mkdirSync(binDist, { recursive: true })
cpSync(bunSrc, join(binDist, bunBinName))

console.log(
  `[copy-3d-resources] staging 完成: template=${dirSizeMb(tplDist)}MB node_modules=${dirSizeMb(nmDst)}MB ` +
    `components=${dirSizeMb(compDist)}MB bun=${Math.round(statSync(join(binDist, bunBinName)).size / 1024 / 1024)}MB → ${distDir}/`,
)
