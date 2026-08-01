/**
 * 快速修改工作流 —— 直接修改已生成页面的 JSON 数据，无需经过 AI 管线。
 *
 * 与 modify_json_ai.ts 不同，本模块不走意图识别 → 重新规划 → 模块生成的完整链路，
 * 而是直接操作 A2UI JSON 树中指定元素的 props，适用于用户在预览区手动调整样式/属性的场景。
 */
import type { VersionEntry } from "../utils/version-history"
import { appendPatternVersion } from "../utils/version-history"
import { clearDebugLog, saveDebugSnapshot } from "../utils/debug-log"
/** 一次快速修改操作的数据，由 PropertyEditorPopup 提交 */
export type ModifyElementData = {
  /** A2UI 元素 ID */
  elementId: string
  /** 修改后的 Tailwind className */
  className: string
  /** 文本内容（如为文本元素） */
  textContent: string
  /** 组件属性键值对 */
  componentProps: Record<string, string | boolean>
  /** 操作标签，用于版本记录摘要 */
  tag?: string
  /** 是否保存到版本历史 */
  saveToHistory?: boolean
  /** 是否保持属性编辑器打开（自动提交场景） */
  keepOpen?: boolean
}

/**
 * 快速修改所需的上下文依赖。
 *
 * 通过 getter/setter 模式注入，避免直接耦合组件内部 Signal，
 * 使本模块可独立测试或复用。
 */
export type QuickModifyContext = {
  /** 获取当前预览中的 A2UI JSON 数据 */
  getPendingData: () => unknown
  /** 向 iframe 预览区发送更新后的 JSON */
  sendToPreview: (data: unknown) => void
  /** 强制刷新预览 iframe */
  refreshPreview: () => void
  /** 获取版本历史存储目录 */
  getHistoryDir: () => string
  /** 获取当前 session ID */
  getSessionId: () => string | undefined
  /** 获取最近一次页面意图 */
  getLastIntent: () => Record<string, unknown> | null
  /** 获取最近一次布局规划 */
  getLastPlanner: () => Record<string, unknown> | null
  /** 获取最近一次模块 JSON 列表 */
  getLastModules: () => Array<Record<string, unknown>>
  /** 更新版本列表 */
  setVersions: (fn: (prev: VersionEntry[]) => VersionEntry[]) => void
  /** 设置当前版本 ID */
  setCurrentVersionId: (id: string) => void
  /** 版本保存节流间隔（毫秒），默认 2000 */
  versionThrottleMs?: number
}

/** 版本保存默认节流间隔（毫秒） */
const VERSION_THROTTLE_MS = 2000

function parseInstanceId(elementId: string) {
  const m = elementId.match(/^(.+?)((:\d+)+)$/)
  if (!m) return null
  return {
    baseId: m[1],
    indices: m[2].split(":").filter(Boolean).map(Number),
  }
}

function buildParentMap(elements: { id: string; children?: unknown }[]) {
  const map = new Map<string, string>()
  for (const el of elements) {
    if (Array.isArray(el.children)) {
      for (const childId of el.children) map.set(childId, el.id)
    } else if (el.children && typeof el.children === "object") {
      const cid = (el.children as Record<string, unknown>).componentId
      if (typeof cid === "string") map.set(cid, el.id)
    }
  }
  return map
}

function resolveDataPath(
  elementId: string,
  elements: { id: string; props?: Record<string, unknown>; children?: unknown }[],
  parentMap: Map<string, string>,
  indices: number[],
): { pathParts: string[]; index: number }[] | null {
  let current = elementId
  let idx = 0
  const levels: { pathParts: string[]; index: number }[] = []
  while (true) {
    const parentId = parentMap.get(current)
    if (!parentId) break
    const parent = elements.find((e) => e.id === parentId)
    if (!parent) break
    if (parent.children && typeof parent.children === "object" && !Array.isArray(parent.children)) {
      const p = (parent.children as Record<string, unknown>).path
      if (typeof p === "string") {
        const pathParts = p.replace(/^\//, "").split("/").filter(Boolean)
        const ii = indices.length - 1 - idx
        if (ii >= 0) levels.unshift({ pathParts, index: indices[ii] })
        idx++
      }
    }
    current = parentId
  }
  if (levels.length === 0) return null
  return levels
}

function isDataBinding(value: unknown): value is { path: string } {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).path === "string"
}

function coerceValue(prev: unknown, val: string | boolean): string | boolean | number {
  if (typeof val === "boolean") return val
  if (typeof prev === "boolean") return val === "true"
  if (typeof prev === "number") {
    const n = Number(val)
    return isNaN(n) ? val : n
  }
  return val
}

function mergePropsSafe(target: Record<string, unknown>, source: Record<string, string | boolean>, before: Record<string, unknown>, skipBindings: boolean) {
  for (const key of Object.keys(source)) {
    const prev = before[key]
    if (skipBindings && isDataBinding(prev)) continue
    target[key] = coerceValue(prev, source[key])
  }
}

function applyStateBindings(
  beforeProps: Record<string, unknown>,
  componentProps: Record<string, string | boolean>,
  textContent: string,
  state: Record<string, unknown>,
  baseId: string,
  elements: { id: string; props?: Record<string, unknown>; children?: unknown }[],
  parsed: { baseId: string; indices: number[] } | null,
): { applied: boolean; failed: { key: string; val: string }[] } {
  if (!state || typeof state !== "object") return { applied: false, failed: [] }
  const bindings: { path: string; newValue: string; key: string; val: string }[] = []

  const valueBinding = beforeProps.value
  const hasValueInProps = "value" in componentProps
  if (!hasValueInProps && textContent && isDataBinding(valueBinding)) {
    bindings.push({ path: valueBinding.path, newValue: textContent, key: "value", val: textContent })
  }

  for (const key of Object.keys(componentProps)) {
    const prev = beforeProps[key]
    if (isDataBinding(prev)) {
      const val = String(componentProps[key])
      bindings.push({ path: prev.path, newValue: val, key, val })
    }
  }

  if (bindings.length === 0) return { applied: true, failed: [] }

  if (parsed) {
    const parentMap = buildParentMap(elements)
    const levels = resolveDataPath(baseId, elements, parentMap, parsed.indices)
    if (!levels) return { applied: false, failed: [] }

    let target: any = state
    for (let i = 0; i < levels.length - 1; i++) {
      const lv = levels[i]
      let arr: any = target
      for (const p of lv.pathParts) {
        if (!arr || typeof arr !== "object") return { applied: false, failed: [] }
        arr = arr[p]
      }
      if (!Array.isArray(arr) || lv.index >= arr.length) return { applied: false, failed: [] }
      target = arr[lv.index]
    }
    if (!target || typeof target !== "object") return { applied: false, failed: [] }

    const last = levels[levels.length - 1]
    let leafArr: any = target
    for (const p of last.pathParts) {
      if (!leafArr || typeof leafArr !== "object") return { applied: false, failed: [] }
      leafArr = leafArr[p]
    }
    if (!Array.isArray(leafArr) || last.index >= leafArr.length) return { applied: false, failed: [] }

    const arr = [...leafArr]
    const item = { ...arr[last.index] }
    for (const b of bindings) {
      const pathParts = b.path.replace(/^\//, "").split("/")
      let t: any = item
      for (let j = 0; j < pathParts.length - 1; j++) {
        if (!t[pathParts[j]] || typeof t[pathParts[j]] !== "object") t[pathParts[j]] = {}
        t = t[pathParts[j]]
      }
      const lastKey = pathParts[pathParts.length - 1]
      t[lastKey] = coerceValue(t[lastKey], b.newValue)
    }
    arr[last.index] = item
    let owner: any = target
    for (let i = 0; i < last.pathParts.length - 1; i++) owner = owner[last.pathParts[i]]
    owner[last.pathParts[last.pathParts.length - 1]] = arr
    return { applied: true, failed: [] }
  } else {
    let applied = false
    const failed: { key: string; val: string }[] = []
    for (const b of bindings) {
      const pathParts = b.path.replace(/^\//, "").split("/")
      let t: any = state
      let ok = true
      for (let i = 0; i < pathParts.length - 1; i++) {
        const k = pathParts[i]
        if (!t[k] || typeof t[k] !== "object" || Array.isArray(t[k])) { ok = false; break }
        t = t[k]
      }
      if (!ok) { failed.push({ key: b.key, val: b.val }); continue }
      const lastKey = pathParts[pathParts.length - 1]
      if (lastKey in t) { t[lastKey] = coerceValue(t[lastKey], b.newValue); applied = true }
    }
    return { applied, failed }
  }
}

/**
 * 按元素 ID 记录最近一次版本保存的时间戳，用于节流。
 *
 * 如果一个元素在短时间内被多次修改（如连续拖拽调节滑块），
 * 只有超过节流间隔的修改才会写入版本历史文件。
 */
const lastVersionSave = new Map<string, number>()

/**
 * 对已生成的 A2UI 页面 JSON 执行一次快速修改。
 *
 * 流程：
 * 1. 深拷贝当前预览数据（JSON.parse/stringify）
 * 2. 在 elements 数组中定位目标元素
 * 3. 非绑定属性直接写入 el.props；绑定属性保留不动，转而更新 doc.state
 * 4. 非实例化元素若无法解析绑定路径，降级为直接覆写（绑定变静态值）；
 *    实例化元素（parsed）失败时不降级，保留原绑定以避免破坏模板
 * 5. 将修改后的 JSON 推送到预览区
 * 6. 若 saveToHistory 为 true，则在节流后追加版本历史
 */
export async function handleModifyElement(
  ctx: QuickModifyContext,
  data: ModifyElementData,
) {
  console.log("[Pattern] modifyElement data:", data)

  const current = ctx.getPendingData()
  if (!current || typeof current !== "object") return

  const doc = JSON.parse(JSON.stringify(current))
  if (!(doc as any)?.elements || !Array.isArray((doc as any).elements)) return

  const parsed = parseInstanceId(data.elementId)
  const baseElementId = parsed?.baseId ?? data.elementId.replace(/:\d+$/, "")
  const elements = (doc as any).elements as { id: string; props?: Record<string, unknown>; children?: unknown }[]

  let beforeProps: unknown = null
  let found = false

  for (const el of elements) {
    if (el.id === baseElementId) {
      found = true
      beforeProps = JSON.parse(JSON.stringify(el.props ?? {}))
      el.props = el.props || {}

      el.props.className = data.className

      if (data.componentProps) mergePropsSafe(el.props, data.componentProps, beforeProps as Record<string, unknown>, true)

      const hasValueInProps = !!data.componentProps && "value" in data.componentProps
      if (!hasValueInProps && "value" in (beforeProps as Record<string, unknown>) && !isDataBinding((beforeProps as Record<string, unknown>).value)) {
        el.props.value = data.textContent
      }

      const result = applyStateBindings(
        beforeProps as Record<string, unknown>,
        data.componentProps ?? {},
        data.textContent,
        (doc as any).state,
        baseElementId,
        elements,
        parsed,
      )

      if (parsed && !result.applied) {
        console.warn("[Pattern] 实例化 state 回写失败，绑定保留，用户改动未应用:", data.elementId)
      }

      if (!parsed) {
        for (const f of result.failed) {
          (el.props as Record<string, unknown>)[f.key] = coerceValue((beforeProps as Record<string, unknown>)[f.key], f.val)
        }
      }

      break
    }
  }

  console.log("[Pattern] element modify diff:", {
    elementId: data.elementId,
    found,
    totalElements: elements.length,
    before: beforeProps,
    after: found ? elements.find((el) => el.id === baseElementId)?.props : null,
  })

  if (!found) return

  // 推送到预览区
  ctx.sendToPreview(doc)

  // 版本历史保存（带节流）
  if (data.saveToHistory) {
    const key = data.elementId
    const now = Date.now()
    const throttle = ctx.versionThrottleMs ?? VERSION_THROTTLE_MS
    const last = lastVersionSave.get(key) ?? 0

    if (now - last >= throttle) {
      lastVersionSave.set(key, now)

      const dir = ctx.getHistoryDir()
      const sid = ctx.getSessionId()
      if (dir && sid) {
        // 生成版本摘要：优先使用 tag > componentProps.value > 属性键列表 > "快速修改"
        const summary = (
          data.tag ||
          String(data.componentProps?.value ?? "") ||
          Object.keys(data.componentProps || {}).join(",") ||
          "快速修改"
        ).slice(0, 80)

        // 写入本地历史文件
        const vid = await appendPatternVersion(
          dir,
          sid,
          {
            lastIntent: ctx.getLastIntent(),
            lastPlanner: ctx.getLastPlanner(),
            lastModules: ctx.getLastModules(),
            mergedA2UI: doc as unknown as Record<string, unknown>,
          },
          summary,
        )

        const modifiedEl = elements.find((el) => el.id === baseElementId)
        void saveDebugSnapshot(dir, sid, "modify", {
          lastIntent: ctx.getLastIntent(),
          extra: {
            modifyElementData: {
              elementId: data.elementId,
              className: data.className,
              textContent: data.textContent,
              componentProps: data.componentProps,
              tag: data.tag,
            },
            beforeProps,
            afterProps: modifiedEl?.props ?? null,
            found,
            totalElements: elements.length,
          },
          lastPlanner: ctx.getLastPlanner(),
          lastModules: ctx.getLastModules(),
          mergedA2UI: doc as unknown as Record<string, unknown>,
          summary,
        })

        clearDebugLog()

        // 更新 UI 版本列表与当前选中
        ctx.setVersions((prev) => [
          ...prev,
          { id: vid, createdAt: Date.now(), summary },
        ])
        ctx.setCurrentVersionId(vid)
      }
    }
  }

}
