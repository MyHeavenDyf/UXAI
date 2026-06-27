import type { OutputCardType } from "../components/insight-turn"

/**
 * 路径 C:Agent 写文件工具(write / edit)产物 → OutputCard。
 * 详见 docs/specs/ui/output-renderers.md §2.6。
 *
 * 与路径 A(MCP resource_link,见 resource-link.ts)平行:都是"强信号、零嗅探",
 * 区别仅在内容位置——resource_link 指向内网 S3(http fetch),write 产物在本地磁盘
 * (渲染时走 opencode SDK `file.read({ path })` 读盘,见 result-viewer PathTabBody)。
 */

// ── 扩展名分类(SOT:与 docs/specs/ui/output-renderers.md §2.6.1 扩展名清单同源)──
//
// 分流总原则(write 写的都是文本,内容不在对话流里 → 全部出卡):
//   1. RENDER_EXT —— 我们渲染得好的,应用内专用 renderer(md→markdown / html→iframe / json→shiki)
//   2. FILE_EXT   —— office / 表格 / 图片 / 媒体 / 压缩 / 字体 / 二进制:拉本地应用打开
//   3. 兜底 code  —— 其余一律当"能读到文本内容的代码/纯文本",应用内 shiki 预览
//      (无需穷举代码扩展名——不在 RENDER/FILE 的都走 code,新语言零维护)

const RENDER_EXT: Record<string, OutputCardType> = {
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
  html: "html", htm: "html", xhtml: "html",
  // .json 扩展名不携带语义 —— 普通配置 JSON 与思维导图 JSON 同扩展名,无法靠扩展名区分。
  // 故一律出 json 卡(shiki 高亮 + 复制);真正要 markmap 预览的思维导图产物走路径 A
  // (MCP resource_link + business_type:"mindmap" 显式声明),不靠路径 C 嗅探。见 output-renderers.md §2.6.1。
  json: "json",
}

// 走 file 卡(本地应用打开)的扩展名。判据:**office/系统能打开但我们应用内渲染无价值或无法渲染**。
// 列全这一类即可——其余文本自动兜底 code(见 extToOutputType)。
const FILE_EXT = new Set([
  // 表格(含 csv:Agent 写的原始逗号数据,Excel/Numbers 打开体验远好过硬渲染)
  "csv", "tsv", "xls", "xlsx", "xlsm", "xlsb", "ods",
  // 文档 / 演示
  "doc", "docx", "ppt", "pptx", "odt", "odp", "rtf", "pdf", "pages", "numbers", "key", "epub",
  // 图片
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "ico", "svg", "heic", "heif", "avif", "psd", "ai", "sketch", "fig",
  // 音视频
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus",
  // 压缩 / 镜像 / 安装包
  "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "rar", "7z", "iso", "dmg", "pkg", "deb", "rpm", "msi", "apk",
  // 字体
  "woff", "woff2", "ttf", "otf", "eot",
  // 可执行 / 库 / 目标文件(出 file 卡但隐藏打开按钮,见 NON_OPENABLE_EXT)
  "exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "obj", "class", "wasm", "app",
])

// 即便出 file 卡也不给"用本地应用打开"(无意义 / 不安全),只留"文件夹中打开"。
const NON_OPENABLE_EXT = new Set(["exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "obj", "class", "wasm"])

function extOf(filePath: string): string {
  if (!filePath.includes(".")) return ""
  return filePath.split(".").pop()?.toLowerCase() ?? ""
}

export function extToOutputType(filePath: string): OutputCardType {
  const ext = extOf(filePath)
  if (ext && RENDER_EXT[ext]) return RENDER_EXT[ext]
  if (ext && FILE_EXT.has(ext)) return "file"
  // 其余(代码 / 配置 / 纯文本 / 无扩展名 Makefile-Dockerfile / 未知扩展名)→ 应用内代码预览
  return "code"
}

/** file 卡是否显示"用本地应用打开"按钮(可执行/库类无意义,只给文件夹定位)。 */
export function canOpenLocally(filePath: string): boolean {
  return !NON_OPENABLE_EXT.has(extOf(filePath))
}

// 扩展名 → shiki 语言标识(供 code 卡 SourceCodeView 高亮);未知归 text(shiki 容错)。
// 不必穷举——这里只是让常见语言高亮更准,缺失的走 text 也能正常显示。
const EXT_LANG: Record<string, string> = {
  py: "python", pyw: "python", ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", groovy: "groovy",
  c: "c", h: "c", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp", cs: "csharp",
  rb: "ruby", php: "php", swift: "swift", m: "objective-c", mm: "objective-cpp",
  dart: "dart", lua: "lua", pl: "perl", pm: "perl", r: "r", jl: "julia",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure", nim: "nim", zig: "zig",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", ps1: "powershell", bat: "bat", cmd: "bat",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "bash",
  xml: "xml", json5: "json", jsonc: "json", plist: "xml",
  css: "css", scss: "scss", sass: "sass", less: "less", styl: "stylus",
  vue: "vue", svelte: "svelte", astro: "astro",
  dockerfile: "docker", makefile: "makefile", cmake: "cmake", gradle: "groovy",
  tex: "latex", rst: "rest", csv: "csv", tsv: "csv", txt: "text", text: "text", log: "text",
}

export function langFromPath(filePath: string): string {
  const ext = extOf(filePath)
  if (!ext) {
    // 无扩展名:按 basename 认 Makefile / Dockerfile,其余 text
    const base = (filePath.split(/[\\/]/).pop() ?? "").toLowerCase()
    if (base === "makefile") return "makefile"
    if (base === "dockerfile") return "docker"
    return "text"
  }
  return EXT_LANG[ext] ?? "text"
}

/** 文件路径取 basename(兼容 / 与 \\),作卡片标题。 */
export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

/**
 * 是否「写本地文件」的工具(opencode `write` 新建 / `edit` 修改,都产生本地文件且 input 带 filePath)。
 * 工具名可能带前缀(`clientName_write` / `mcp:edit`),取 bare 名判定。
 * 注:bash/python 等脚本产生的文件无法从 tool part 可靠识别,不在此列(见 §2.6 已知边界)。
 */
function isFileWriteTool(tool: unknown): boolean {
  if (typeof tool !== "string") return false
  const bare = tool.includes(":") ? tool.split(":").pop()! : tool
  return bare === "write" || bare === "edit" || bare.endsWith("_write") || bare.endsWith("_edit")
}

/** 防御性读 write 工具的目标路径(opencode write 参数名 filePath;兜底 path / file_path)。 */
function readFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const i = input as Record<string, unknown>
  const v = i.filePath ?? i.path ?? i.file_path
  return typeof v === "string" && v.length > 0 ? v : undefined
}

export type WriteCard = {
  filePath: string
  type: OutputCardType
}

/**
 * 在一组 part 中找所有「写文件工具产物」卡(write 新建 / edit 修改)。
 * 触发条件:type:"tool" + tool ∈ {write,edit} + state.status:"completed"(见 §2.6.2)。
 * 所有写入的文件都出卡(extToOutputType 不返回 null,按内容分流到预览卡 / file 卡)。
 * 同一 filePath 多次写(覆盖)→ 去重保留最后一次(内容点开时读盘总取最新,只需避免重复卡)。
 */
export function findWriteCards(parts: unknown[]): WriteCard[] {
  // 用 Map 按 filePath 去重并保留最后出现的顺序
  const byPath = new Map<string, WriteCard>()
  // 诊断:把扫到的每个工具 part 的判定过程记下来,便于"写了文件却不出卡"时定位是哪一环断的
  const seen: Array<{ tool: unknown; status: unknown; isWrite: boolean; filePath?: string; type?: string; skip?: string }> = []

  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const p = part as Record<string, unknown>
    if (p.type !== "tool") continue

    const state = p.state as Record<string, unknown> | undefined
    const isWrite = isFileWriteTool(p.tool)
    const rec: { tool: unknown; status: unknown; isWrite: boolean; filePath?: string; type?: string; skip?: string } = {
      tool: p.tool,
      status: state?.status,
      isWrite,
    }

    if (!isWrite) {
      rec.skip = "not-write-tool"
      seen.push(rec)
      continue
    }
    if (!state || state.status !== "completed") {
      rec.skip = `status:${String(state?.status)}`
      seen.push(rec)
      continue
    }
    const filePath = readFilePath(state.input)
    if (!filePath) {
      rec.skip = "no-filePath"
      // 把 input 的 key 也带上,便于发现服务端用了别的字段名
      rec.type = `inputKeys:${state.input && typeof state.input === "object" ? Object.keys(state.input as object).join(",") : typeof state.input}`
      seen.push(rec)
      continue
    }
    rec.filePath = filePath
    rec.type = extToOutputType(filePath)
    seen.push(rec)
    // 重新插入以更新顺序到最后(覆盖语义)
    byPath.delete(filePath)
    byPath.set(filePath, { filePath, type: extToOutputType(filePath) })
  }

  const out = [...byPath.values()]
  // 出卡 或 扫到 write/edit 工具(无论是否产出卡)时打印——"写了文件却不出卡"的定位抓手;
  // 纯 read 轮次(无写文件工具)不打,避免刷屏。
  if (out.length > 0 || seen.some((s) => s.isWrite)) {
    console.log("[octo:write-card] scan", {
      cardCount: out.length,
      cards: out.map((c) => ({ filePath: c.filePath, type: c.type })),
      toolParts: seen,
    })
  }
  return out
}
