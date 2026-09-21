import { extOf, resolveOutputType, type OutputCardType } from "./output-type"

/**
 * 路径 C:Agent 写文件工具(write / edit)产物 → OutputCard。
 * 详见 docs/specs/ui/output-renderers.md §2.6。
 *
 * 与路径 A(MCP resource_link,见 resource-link.ts)平行:都是"强信号、零嗅探",
 * 区别仅在内容位置——resource_link 指向内网 S3(http fetch),write 产物在本地磁盘。
 *
 * 类型判定不在本模块 —— 扩展名表已收进 ./output-type.ts 的 `resolveOutputType`
 * (SPEC-INS-026 §4.2 单一入口);本模块只负责「从 tool part 里认出 write 产物」。
 */

// 即便出 file 卡也不给"用本地应用打开"(无意义 / 不安全),只留"文件夹中打开"。
const NON_OPENABLE_EXT = new Set(["exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "obj", "class", "wasm"])

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

/** 是否仅「write 工具」(排除 edit,统计产物打点用:artifact-file-write 只计 write 不计 edit)。 */
function isWriteOnlyTool(tool: unknown): boolean {
  if (typeof tool !== "string") return false
  const bare = tool.includes(":") ? tool.split(":").pop()! : tool
  return bare === "write" || bare.endsWith("_write")
}

/** 是否仅「edit 工具」(统计产物打点用:artifact-file-edit 单独计 edit 操作)。 */
function isEditOnlyTool(tool: unknown): boolean {
  if (typeof tool !== "string") return false
  const bare = tool.includes(":") ? tool.split(":").pop()! : tool
  return bare === "edit" || bare.endsWith("_edit")
}

/** 防御性读 write 工具的目标路径(opencode write 参数名 filePath;兜底 path / file_path)。 */
function readFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const i = input as Record<string, unknown>
  const v = i.filePath ?? i.path ?? i.file_path
  return typeof v === "string" && v.length > 0 ? v : undefined
}

/** 从 completed 态 tool part 的 metadata 读服务端权威落点(write/edit 均返回 metadata.filepath = 实际写盘绝对路径)。 */
function readMetadataFilepath(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const v = (metadata as Record<string, unknown>).filepath
  return typeof v === "string" && v.length > 0 ? v : undefined
}

/**
 * 解析产物卡应使用的本地路径。**优先 state.metadata.filepath**(服务端 write/edit 实际写盘的绝对路径,
 * 权威且恒等于真实落点),兜底 state.input.filePath。
 *
 * 为什么不能只信 state.input:insight 会话的 write 相对落点由服务端插件(octo-session-workdir)重定向到
 * 会话 outputs/,但 state.input 记录的是模型产出的原始裸文件名(如 `报告.md`),与真实落点脱钩——客户端拿裸名
 * 走 file.read / openPath 会相对项目根解析而定位失败。metadata.filepath 才是写盘用的那个路径,不受重定向 / 相对
 * join 影响。见 output-renderers.md §2.6.3。
 */
function resolveCardPath(state: Record<string, unknown>): { filePath: string; source: "metadata" | "input" } | undefined {
  const fromMeta = readMetadataFilepath(state.metadata)
  if (fromMeta) return { filePath: fromMeta, source: "metadata" }
  const fromInput = readFilePath(state.input)
  if (fromInput) return { filePath: fromInput, source: "input" }
  return undefined
}

export type WriteCard = {
  filePath: string
  type: OutputCardType
}

// 类型判定统一走 resolveOutputType(filename)。write 产物在磁盘上,没有 mimeType 可传,
// 也不需要 —— 扩展名就是结论(§4.2)。

/**
 * 在一组 part 中找所有「写文件工具产物」卡(write 新建 / edit 修改)。
 * 触发条件:type:"tool" + tool ∈ {write,edit} + state.status:"completed"(见 §2.6.2)。
 * 所有写入的文件都出卡(resolveOutputType 不返回 null,按内容分流到预览卡 / file 卡)。
 * 同一 filePath 多次写(覆盖)→ 去重保留最后一次(内容点开时读盘总取最新,只需避免重复卡)。
 */
export function findWriteCards(parts: unknown[]): WriteCard[] {
  return findWriteCardsByFilter(parts, isFileWriteTool, true)
}

/**
 * 在一组 part 中找所有 write 工具产物(排除 edit)。
 * 用于统计产物打点(artifact-file-write):只计 write 工具调用产生的文件(含覆盖写),不计 edit。
 * 复用 findWriteCards 的逻辑,但过滤条件改为 isWriteOnlyTool。
 */
export function findWriteOnlyCards(parts: unknown[]): WriteCard[] {
  return findWriteCardsByFilter(parts, isWriteOnlyTool, false)
}

/**
 * 在一组 part 中找所有 edit 工具产物。
 * 用于统计产物打点(artifact-file-edit):单独计 edit 工具调用产生的文件。
 * 复用 findWriteCards 的逻辑,但过滤条件改为 isEditOnlyTool。
 */
export function findEditCards(parts: unknown[]): WriteCard[] {
  return findWriteCardsByFilter(parts, isEditOnlyTool, false)
}

/**
 * 通用的写文件工具检测函数(按自定义过滤器)。
 * 内部逻辑与原 findWriteCards 完全一致,仅工具判定可注入;可选诊断日志(供 findWriteCards 定位"写了文件却不出卡")。
 */
function findWriteCardsByFilter(parts: unknown[], toolFilter: (tool: unknown) => boolean, logDiagnostic: boolean): WriteCard[] {
  const byPath = new Map<string, WriteCard>()
  type DiagRec = { tool: unknown; status: unknown; isMatch: boolean; filePath?: string; pathSource?: string; type?: string; skip?: string }
  const seen: DiagRec[] | undefined = logDiagnostic ? [] : undefined

  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const p = part as Record<string, unknown>
    if (p.type !== "tool") continue

    const state = p.state as Record<string, unknown> | undefined
    const isMatch = toolFilter(p.tool)
    const rec: DiagRec = { tool: p.tool, status: state?.status, isMatch }

    if (!isMatch) {
      rec.skip = "not-match-tool"
      if (logDiagnostic) seen!.push(rec)
      continue
    }
    if (!state || state.status !== "completed") {
      rec.skip = `status:${String(state?.status)}`
      if (logDiagnostic) seen!.push(rec)
      continue
    }
    const resolved = resolveCardPath(state)
    if (!resolved) {
      rec.skip = "no-filePath"
      rec.type = `metaKeys:${state.metadata && typeof state.metadata === "object" ? Object.keys(state.metadata as object).join(",") : typeof state.metadata}` +
        `|inputKeys:${state.input && typeof state.input === "object" ? Object.keys(state.input as object).join(",") : typeof state.input}`
      if (logDiagnostic) seen!.push(rec)
      continue
    }
    const filePath = resolved.filePath
    const cardType = resolveOutputType(filePath)
    rec.filePath = filePath
    rec.pathSource = resolved.source
    rec.type = cardType
    if (logDiagnostic) seen!.push(rec)
    byPath.delete(filePath)
    byPath.set(filePath, { filePath, type: cardType })
  }

  const out = [...byPath.values()]
  if (logDiagnostic && seen && (out.length > 0 || seen.some((s) => s.isMatch))) {
    console.log("[octo:write-card] scan", {
      cardCount: out.length,
      cards: out.map((c) => ({ filePath: c.filePath, type: c.type })),
      toolParts: seen,
    })
  }
  return out
}
