import type { SubtypeHandlerContext } from "../../subtype-handlers/types"
import { getDesktopApi } from "../../lib/electron-api"
import type { PrototypeSession } from "./types"

type A2uiElement = { children?: unknown[] }
type A2uiDocument = { elements?: A2uiElement[] }

/** 从 A2UI 文档构建同层元素 siblingMap（用于 od:drag-mode 拖拽换序） */
export function buildSiblingMap(data: unknown): Record<string, string[]> | undefined {
  const elements = (data as A2uiDocument | null)?.elements
  if (!Array.isArray(elements)) return undefined
  const map: Record<string, string[]> = {}
  for (const el of elements) {
    const kids = Array.isArray(el.children) ? el.children.filter((k): k is string => typeof k === "string") : []
    if (kids.length < 2) continue
    for (const kid of kids) map[kid] = kids
  }
  return Object.keys(map).length > 0 ? map : undefined
}

/** 读取与 prototype.html 同目录的 data.js（内联 window.__A2UI_DATA__），按 session 缓存。
 *  命中缓存时比对 data.js 的 stat size；size 变了（外部修改/刷新）就丢弃重读，避免用旧 doc 覆盖。
 *  无 statFile（纯 web、无 desktopApi）时无法检测，退回「有缓存就用」。解析失败不缓存，下次重试。 */
export async function loadA2uiData(session: PrototypeSession, ctx: SubtypeHandlerContext): Promise<unknown | null> {
  const filePath = ctx.tab.filePath || ctx.tab.absoluteFilePath
  if (!filePath) return null
  const dir = filePath.replace(/[\\/][^\\/]+$/, "")
  const dataJsPath = `${dir}/data.js`
  const api = ctx.getDesktopApi()
  const currentSize = (await api?.statFile?.(dataJsPath))?.size ?? null
  if (session.a2ui && currentSize !== null && session.a2ui.loadSize === currentSize) {
    return session.a2ui.doc
  }
  const buffer = await api?.readFileBuffer?.(dataJsPath)
  if (!buffer) return null
  const text = new TextDecoder().decode(new Uint8Array(buffer))
  const stripped = text.replace(/^\uFEFF/, "").trimStart()
  const jsonStr = stripped.replace(/^window\.__A2UI_DATA__\s*=\s*/, "").replace(/;\s*$/, "")
  try {
    const doc = JSON.parse(jsonStr)
    session.a2ui = { doc, loadSize: currentSize }
    return doc
  } catch {
    return null
  }
}

/** 把缓存的 A2UI JSON 序列化回 data.js（window.__A2UI_DATA__ = ...）写盘，iframe 重载即生效。
 *  原子写：先写同目录临时文件再 rename 到目标，避免写到一半崩溃截断 data.js。
 *  无 renameFile API（旧桌面端）时回退到直接覆盖写。
 *  写盘前重 stat：若 size 与加载时不一致（外部改过），中止写盘并 toast，避免覆盖外部改动。 */
export async function persistA2uiData(session: PrototypeSession, filePath: string) {
  const data = session.a2ui?.doc
  if (!data || typeof data !== "object") return
  const dir = filePath.replace(/[\\/][^\\/]+$/, "")
  const dataJsPath = `${dir}/data.js`
  const api = getDesktopApi()
  const currentSize = (await api?.statFile?.(dataJsPath))?.size ?? null
  if (currentSize !== null && session.a2ui?.loadSize !== null && session.a2ui?.loadSize !== currentSize) {
    session.a2ui = null
    session.ctx.showToast({ title: "文件已被外部修改，已取消写入", variant: "error" })
    return
  }
  const content = `window.__A2UI_DATA__ = ${JSON.stringify(data)};\n`
  const buffer = new TextEncoder().encode(content).buffer as ArrayBuffer
  if (api?.renameFile) {
    const tmp = `${dir}/.data.js.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await api.writeFileBuffer?.(tmp, buffer)
    await api.renameFile(tmp, dataJsPath)
    session.a2ui = { doc: data, loadSize: buffer.byteLength }
    return
  }
  await api?.writeFileBuffer?.(dataJsPath, buffer)
  session.a2ui = { doc: data, loadSize: buffer.byteLength }
}

/** 防抖排程写盘（合并连续拖滑块等快速编辑），按 session 独立计时 */
export function schedulePersistA2ui(session: PrototypeSession, filePath: string) {
  session.persistFilePath = filePath
  if (session.persistTimer) clearTimeout(session.persistTimer)
  session.persistTimer = setTimeout(() => {
    session.persistTimer = null
    const fp = session.persistFilePath
    session.persistFilePath = null
    if (fp) void persistA2uiData(session, fp)
  }, 600)
}

/** 统一提交点：更新缓存 + od:a2ui-update 回推重渲染 + 排程写盘 */
export function commitA2ui(session: PrototypeSession, filePath: string, doc: unknown) {
  const loadSize = session.a2ui?.loadSize ?? null
  session.a2ui = { doc, loadSize }
  session.ctx.postMessageToIframe?.({ type: "od:a2ui-update", payload: doc })
  schedulePersistA2ui(session, filePath)
}
