import type { SubtypeHandlerContext } from "../../subtype-handlers/types"
import { getDesktopApi } from "../../lib/electron-api"
import type { A2uiDocEntry, PrototypeSession } from "./types"

type A2uiElement = { id?: string; children?: unknown[] }
type A2uiDocument = { rootId?: string; elements?: A2uiElement[]; state?: Record<string, unknown> }

function dirOf(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]+$/, "")
}

function joinPath(dir: string, name: string): string {
  return dir.replace(/[\\/]+$/, "") + "/" + name
}

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || ""
}

function rootIdOf(doc: unknown): string {
  if (doc && typeof doc === "object") {
    const r = (doc as { rootId?: unknown }).rootId
    if (typeof r === "string") return r
  }
  return ""
}

/** 从 A2UI 文档构建同层元素 siblingMap（用于 od:drag-mode 拖拽换序）。
 *  混合页多 doc：concat 所有 entry 的 elements（id 全页唯一）。 */
export function buildSiblingMap(entries: A2uiDocEntry[]): Record<string, string[]> | undefined {
  const map: Record<string, string[]> = {}
  for (const entry of entries) {
    const elements = (entry.doc as A2uiDocument | null)?.elements
    if (!Array.isArray(elements)) continue
    for (const el of elements) {
      const kids = Array.isArray(el.children) ? el.children.filter((k): k is string => typeof k === "string") : []
      if (kids.length < 2) continue
      for (const kid of kids) map[kid] = kids
    }
  }
  return Object.keys(map).length > 0 ? map : undefined
}

// 解析 data.js 的 JSON 文本，三层兜底：严格 JSON → 空格归一后 JSON → new Function 求值。
function parseA2uiJson(raw: string): { doc: unknown } | { err: string } {
  // 1) 严格解析：干净文件（含 persist 回写后的）走这层，零开销。
  try {
    return { doc: JSON.parse(raw) }
  } catch {}
  // 2) 把字符串字面量之外的非 ASCII 空格类字符（NBSP/全角空格/零宽空格/BOM/行段分隔）归一成普通空格后重试：
  //    AI 偶用它们当缩进，但 JSON 合法空白只有 0x20/0x09/0x0A/0x0D，V8 报 "Expected property name or '}'"。
  const out: string[] = []
  let inStr = false
  let esc = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    const c = raw.charCodeAt(i)
    if (esc) {
      out.push(ch)
      esc = false
      continue
    }
    if (ch === "\\") {
      out.push(ch)
      esc = true
      continue
    }
    if (ch === '"') {
      out.push(ch)
      inStr = !inStr
      continue
    }
    if (!inStr && (c === 0xA0 || c === 0xFEFF || c === 0x3000 || (c >= 0x2000 && c <= 0x200B) || c === 0x2028 || c === 0x2029)) {
      out.push(" ")
      continue
    }
    out.push(ch)
  }
  try {
    return { doc: JSON.parse(out.join("")) }
  } catch {}
  // 3) new Function 求值：AI 偶把 data.js 写成 JS 对象字面量（键名无引号、尾逗号），JSON.parse 吃不下。
  //    data.js 本就被 iframe 当 <script> 执行（index.html:444），同信任级；仅自家 AI 生成、不导入第三方。
  try {
    return { doc: new Function("return (" + raw + ")")() }
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e) }
  }
}

/** 读单个 A2UI 数据文件并解析：自动识别并剥离 window.__A2UI_DATA__ / __A2UI_FILE_DATA__ 包装
 *  （裸 .json / .data.js 孪生 / 旧 data.js 三态统一处理）。失败返回 null。 */
async function readA2uiFile(api: ReturnType<SubtypeHandlerContext["getDesktopApi"]>, path: string): Promise<{ doc: unknown; size: number | null } | null> {
  const size = (await api?.statFile?.(path))?.size ?? null
  const buffer = await api?.readFileBuffer?.(path)
  if (!buffer) return null
  let text = new TextDecoder().decode(new Uint8Array(buffer)).replace(/^\uFEFF/, "").trimStart()
  const wrapped = text.match(/^window\.(__A2UI_DATA__|__A2UI_FILE_DATA__)\s*=\s*/)
  if (wrapped) text = text.slice(wrapped[0].length).replace(/;\s*$/, "")
  const parsed = parseA2uiJson(text)
  if ("err" in parsed) {
    console.error("[loadA2uiDocs] parse failed", { path, err: parsed.err })
    return null
  }
  return { doc: parsed.doc, size }
}

/** 解析 prototype.html 内联脚本里的 dataPath 字面量（如 './a2ui-data/x/x.json'），
 *  解析成绝对路径对 (jsonPath 裸 JSON / dataJsPath .data.js 孪生)。
 *  仅依赖 readFileBuffer + statFile，不依赖 dirExists/listDirectory（后者部分桌面端未实现）。 */
async function discoverA2uiNodes(api: ReturnType<SubtypeHandlerContext["getDesktopApi"]>, htmlPath: string): Promise<Array<{ jsonPath: string; dataJsPath: string | null }>> {
  const buffer = await api?.readFileBuffer?.(htmlPath)
  if (!buffer) return []
  const html = new TextDecoder().decode(new Uint8Array(buffer))
  const protoDir = dirOf(htmlPath)
  const out: Array<{ jsonPath: string; dataJsPath: string | null }> = []
  const re = /dataPath\s*:\s*['"]([^'"]+)['"]/g
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const rel = m[1].replace(/^\.\//, "")
    const abs = joinPath(protoDir, rel)
    if (seen.has(abs)) continue
    seen.add(abs)
    let jsonPath = abs
    let dataJsPath: string | null = null
    if (abs.endsWith(".data.js")) {
      dataJsPath = abs
      jsonPath = abs.slice(0, -8) + ".json"
    } else if (abs.endsWith(".json")) {
      jsonPath = abs
      const twin = abs.slice(0, -5) + ".data.js"
      if (await api?.statFile?.(twin)) dataJsPath = twin
    }
    // 其它后缀（如裸 .js wrapper）→ jsonPath=abs, dataJsPath=null
    out.push({ jsonPath, dataJsPath })
  }
  return out
}

// 绝对路径 → 相对 prototype.html 的相对路径（./ 前缀，正斜杠），供 history 记录/恢复用。
function toRel(absPath: string, filePath: string): string {
  const dir = dirOf(filePath).replace(/\\/g, "/").replace(/\/+$/, "")
  const norm = absPath.replace(/\\/g, "/")
  const stripped = norm.startsWith(dir + "/") ? norm.slice(dir.length + 1) : norm.replace(/^\/+/, "")
  return "./" + stripped
}

/** 返回当前 prototype 需记入历史的 A2UI 数据文件相对路径数组。
 *  混合页：解析 prototype.html 的 dataPath → a2ui-data 下各 .json（+ .data.js 孪生）；
 *  纯 A2UI 页（无 dataPath）→ ['./data.js']。供 history-controller 的 onHistoryTrigger 调用。 */
export async function getA2uiDataRelativePaths(ctx: SubtypeHandlerContext): Promise<string[]> {
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return ["./data.js"]
  const api = ctx.getDesktopApi()
  const nodes = await discoverA2uiNodes(api, filePath)
  if (nodes.length === 0) return ["./data.js"]
  const rels: string[] = []
  for (const n of nodes) {
    rels.push(toRel(n.jsonPath, filePath))
    if (n.dataJsPath) rels.push(toRel(n.dataJsPath, filePath))
  }
  return rels
}

/** 加载当前 prototype 的所有 A2UI 数据文件（混合页多文件 / 旧页单 data.js），逐文件缓存 + 脏检测。
 *  命中缓存按 (jsonPath, stat size)；size 变了丢弃重读。解析失败的条目跳过。 */
export async function loadA2uiDocs(session: PrototypeSession, ctx: SubtypeHandlerContext): Promise<A2uiDocEntry[]> {
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return []
  const protoDir = dirOf(filePath)
  const api = ctx.getDesktopApi()
  const entries: A2uiDocEntry[] = []

  // 1. 新模型：解析 prototype.html 的 dataPath 字面量 → a2ui-data/<folder>/<name>.json(+.data.js 孪生)
  const discovered = await discoverA2uiNodes(api, filePath)
  for (const d of discovered) {
    const cached = session.a2uiDocs.find((e) => e.jsonPath === d.jsonPath)
    const size = (await api?.statFile?.(d.jsonPath))?.size ?? null
    if (cached && size !== null && cached.loadSize === size) {
      entries.push(cached)
      continue
    }
    // 优先读裸 JSON（jsonPath）；不存在则读 .data.js 孪生（带 __A2UI_FILE_DATA__ 包装）
    let read = await readA2uiFile(api, d.jsonPath)
    if (!read && d.dataJsPath) read = await readA2uiFile(api, d.dataJsPath)
    if (!read) continue
    entries.push({
      doc: read.doc,
      loadSize: read.size,
      jsonPath: d.jsonPath,
      dataJsPath: d.dataJsPath,
      rootId: rootIdOf(read.doc),
      persistTimer: null,
      persistPending: false,
    })
  }

  // 2. 回退：旧 <protoDir>/data.js（prototype.html 无 dataPath 字面量时）
  if (entries.length === 0) {
    const dataJsPath = joinPath(protoDir, "data.js")
    const cached = session.a2uiDocs.find((e) => e.jsonPath === dataJsPath)
    const size = (await api?.statFile?.(dataJsPath))?.size ?? null
    if (cached && size !== null && cached.loadSize === size) {
      entries.push(cached)
    } else {
      const read = await readA2uiFile(api, dataJsPath)
      if (read) {
        entries.push({
          doc: read.doc,
          loadSize: read.size,
          jsonPath: dataJsPath,
          dataJsPath: null,
          rootId: rootIdOf(read.doc),
          persistTimer: null,
          persistPending: false,
        })
      }
    }
  }

  session.a2uiDocs = entries
  console.log("[loadA2uiDocs] loaded", entries.length, "docs:", entries.map((e) => ({ rootId: e.rootId, jsonPath: e.jsonPath, dataJsPath: e.dataJsPath })))
  return entries
}

/** 旧调用点兼容：返回所有 doc 合并后的单 doc（concat elements / shallow merge state）。
 *  仅供代码导出 / 画布编辑等"整页"语义使用；编辑/持久化走 loadA2uiDocs + findDocByElementId。 */
export async function loadA2uiData(session: PrototypeSession, ctx: SubtypeHandlerContext): Promise<unknown | null> {
  const entries = await loadA2uiDocs(session, ctx)
  if (entries.length === 0) return null
  if (entries.length === 1) return entries[0].doc
  const elements: unknown[] = []
  const state: Record<string, unknown> = {}
  let rootId = ""
  for (const e of entries) {
    const d = e.doc as A2uiDocument | null
    if (!d) continue
    if (Array.isArray(d.elements)) elements.push(...d.elements)
    if (d.state && typeof d.state === "object") Object.assign(state, d.state)
    if (!rootId && d.rootId) rootId = d.rootId
  }
  return { elements, state, rootId }
}

/** 跨所有 doc 查找含 elementId（去 :N 后缀的 baseId）的 entry；未命中返回 null。 */
export function findDocByElementId(entries: A2uiDocEntry[], elementId: string): A2uiDocEntry | null {
  const baseId = elementId.replace(/(:\d+)+$/, "")
  for (const entry of entries) {
    const elements = (entry.doc as A2uiDocument | null)?.elements
    if (Array.isArray(elements) && elements.some((e) => e?.id === baseId)) return entry
  }
  return null
}

/** 按 rootId 查找 entry；rootId 为空（旧 iframe）时回退第一个 entry。 */
export function findDocByRootId(entries: A2uiDocEntry[], rootId: string | undefined): A2uiDocEntry | null {
  if (rootId) {
    const hit = entries.find((e) => e.rootId === rootId)
    if (hit) return hit
  }
  return entries[0] ?? null
}

// 原子写：先写同目录临时文件再 rename 到目标，避免写到一半崩溃截断。无 renameFile 时直接覆盖。
async function writeAtomic(api: ReturnType<SubtypeHandlerContext["getDesktopApi"]>, path: string, content: string): Promise<number> {
  const buffer = new TextEncoder().encode(content).buffer as ArrayBuffer
  if (api?.renameFile) {
    const tmp = joinPath(dirOf(path), `.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await api.writeFileBuffer?.(tmp, buffer)
    await api.renameFile(tmp, path)
  } else {
    await api?.writeFileBuffer?.(path, buffer)
  }
  return buffer.byteLength
}

/** 把 entry 的 doc 写回对应数据文件：
 *  - 旧 <protoDir>/data.js（jsonPath 是 data.js 且无孪生）→ window.__A2UI_DATA__ = <JSON>;
 *  - 否则 jsonPath 写裸 JSON；.data.js 孪生写 window.__A2UI_FILE_DATA__ = <JSON>;。
 *  写前 stat jsonPath 脏检：size 与加载时不一致（外部改过）→ 中止 + toast + 清缓存。 */
export async function persistA2uiDoc(session: PrototypeSession, entry: A2uiDocEntry) {
  const data = entry.doc
  if (!data || typeof data !== "object") return
  const api = getDesktopApi()
  const currentSize = (await api?.statFile?.(entry.jsonPath))?.size ?? null
  if (currentSize !== null && entry.loadSize !== null && entry.loadSize !== currentSize) {
    session.a2uiDocs = session.a2uiDocs.filter((e) => e !== entry)
    session.ctx?.showOctoToast?.({ title: "文件已被外部修改，已取消写入", variant: "error" })
    return
  }

  const jsonStr = JSON.stringify(data)
  const isLegacyDataJs = entry.dataJsPath === null && baseName(entry.jsonPath) === "data.js"
  const jsonContent = isLegacyDataJs ? `window.__A2UI_DATA__ = ${jsonStr};\n` : `${jsonStr}\n`
  await writeAtomic(api, entry.jsonPath, jsonContent)
  if (entry.dataJsPath) {
    await writeAtomic(api, entry.dataJsPath, `window.__A2UI_FILE_DATA__ = ${jsonStr};\n`)
  }

  entry.loadSize = (await api?.statFile?.(entry.jsonPath))?.size ?? currentSize
  dispatchA2uiPersisted(session.ctx?.tab.filePath || session.ctx?.tab.absoluteFilePath || "")
}

/** 写盘成功后派发事件，让 index.tsx 的 historyController 记录用户编辑版本。
 *  filePath 是 prototype.html 的绝对路径（tab.filePath），index.tsx 据此定位对应 tab。 */
function dispatchA2uiPersisted(filePath: string) {
  if (!filePath) return
  window.dispatchEvent(new CustomEvent("prototype:a2ui-persisted", { detail: { filePath } }))
}

/** 按 entry 独立防抖排程写盘（合并连续拖滑块等快速编辑） */
export function schedulePersistA2uiDoc(session: PrototypeSession, entry: A2uiDocEntry) {
  entry.persistPending = true
  if (entry.persistTimer) clearTimeout(entry.persistTimer)
  entry.persistTimer = setTimeout(() => {
    entry.persistTimer = null
    if (entry.persistPending) {
      entry.persistPending = false
      void persistA2uiDoc(session, entry)
    }
  }, 600)
}

/** 统一提交点：更新 entry 缓存 + od:a2ui-update 回推重渲染 + 排程写盘 */
export function commitA2uiDoc(session: PrototypeSession, entry: A2uiDocEntry, doc: unknown) {
  entry.doc = doc
  entry.rootId = rootIdOf(doc)
  session.ctx?.postMessageToIframe?.({ type: "od:a2ui-update", payload: doc })
  schedulePersistA2uiDoc(session, entry)
}
