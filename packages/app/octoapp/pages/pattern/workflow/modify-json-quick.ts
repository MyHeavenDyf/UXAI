/**
 * 快速修改工作流 —— 直接修改已生成页面的 JSON 数据，无需经过 AI 管线。
 *
 * 与 modify_json_ai.ts 不同，本模块不走意图识别 → 重新规划 → 模块生成的完整链路，
 * 而是直接操作 A2UI JSON 树中指定元素的 props，适用于用户在预览区手动调整样式/属性的场景。
 */
import type { VersionEntry } from "../utils/version-history"
import { appendPatternVersion } from "../utils/version-history"
import { getDebugSnapshot, clearDebugLog, saveDebugLog } from "../utils/debug-log"
import { mergeModules } from "../agents/merge"
/** 一次快速修改操作的数据，由 PropertyEditorPopup 提交 */
export type ModifyElementData = {
  /** A2UI 元素 ID */
  elementId: string
  /** 修改后的 Tailwind className */
  className: string
  /** 文本内容（如为文本元素） */
  textContent: string
  /** 组件属性键值对 */
  componentProps: Record<string, string>
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

function findListDataPath(
  elementId: string,
  elements: { id: string; props?: Record<string, unknown>; children?: unknown }[],
  parentMap: Map<string, string>,
) {
  let current = elementId
  while (true) {
    const parentId = parentMap.get(current)
    if (!parentId) return null
    const parent = elements.find((e) => e.id === parentId)
    if (!parent) return null
    if (parent.children && typeof parent.children === "object" && !Array.isArray(parent.children)) {
      const path = (parent.children as Record<string, unknown>).path
      if (typeof path === "string") return path
    }
    current = parentId
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
 * 2. 在 elements 数组中定位并更新目标元素的 props
 * 3. 将修改后的 JSON 推送到预览区
 * 4. 若 saveToHistory 为 true，则在节流后追加版本历史
 * 5. 刷新预览 iframe 确保渲染生效
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

  let found = false
  let beforeProps: unknown = null

  const instanceInfo = data.textContent ? parseInstanceId(data.elementId) : null

  if (instanceInfo) {
    const { baseId, indices } = instanceInfo
    const elements = (doc as any).elements as { id: string; props?: Record<string, unknown>; children?: unknown }[]
    const el = elements.find((e: { id: string }) => e.id === baseId)
    if (el) {
      const valueBinding = el.props?.value
      if (valueBinding && typeof valueBinding === "object" && (valueBinding as Record<string, unknown>).path) {
        const leafPath = (valueBinding as Record<string, unknown>).path as string
        const parentMap = buildParentMap(elements)
        const listDataPath = findListDataPath(baseId, elements, parentMap)
        if (listDataPath) {
          const modules = ctx.getLastModules()
          const owningModule = modules.find((mod) =>
            (mod as Record<string, unknown>).elements &&
            Array.isArray((mod as Record<string, unknown>).elements) &&
            ((mod as Record<string, unknown>).elements as { id: string }[]).some((e) => e.id === baseId)
          ) as Record<string, unknown> | undefined
          if (owningModule?.state) {
            const state = owningModule.state as Record<string, unknown>
            const dataPath = listDataPath.replace(/^\//, "")
            const raw = state[dataPath]
            if (raw && Array.isArray(raw) && indices[0] < raw.length) {
              const arr = [...raw] as Record<string, unknown>[]
              const item = { ...arr[indices[0]] }
              const field = leafPath.replace(/^\//, "").split("/").pop() ?? ""
              item[field] = data.textContent
              arr[indices[0]] = item
              state[dataPath] = arr

              const planner = ctx.getLastPlanner()
              const shell = {
                rootId: (planner as Record<string, unknown>)?.rootId as string ?? "",
                elements: ((planner as Record<string, unknown>)?.elements as never[]) ?? [],
              }
              const merged = mergeModules(
                { ...shell, state: {} } as { rootId: string; elements: never[]; state?: Record<string, unknown> },
                modules as { rootId: string; elements: never[]; state?: Record<string, unknown> }[],
                ((planner as Record<string, unknown>)?.slots as never[]) ?? undefined,
              )
              Object.assign(doc, merged)
              found = true
            }
          }
        }
      }
    }
  }

  if (!found) {
    const baseElementId = data.elementId.replace(/:\d+$/, "")
    for (const el of (doc as any).elements) {
      if (el.id === baseElementId) {
        found = true
        beforeProps = JSON.parse(JSON.stringify(el.props ?? {}))
        el.props = el.props || {}
        if (data.className) el.props.className = data.className
        if (data.textContent) el.props.value = data.textContent
        if (data.componentProps) Object.assign(el.props, data.componentProps)
        break
      }
    }
  }
  console.log("[Pattern] element modify diff:", {
    elementId: data.elementId,
    found,
    totalElements: (doc as any).elements.length,
    before: beforeProps,
    after: found ? (doc as any).elements.find((el: any) => el.id === data.elementId)?.props : null,
  })

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
          data.componentProps?.value ||
          Object.keys(data.componentProps || {}).join(",") ||
          "快速修改"
        ).slice(0, 80)

        // 收集调试日志
        const debug = getDebugSnapshot()

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

        clearDebugLog()

        void saveDebugLog(dir, sid, {
          lastIntent: ctx.getLastIntent(),
          lastPlanner: ctx.getLastPlanner(),
          lastModules: ctx.getLastModules(),
          mergedA2UI: doc as unknown as Record<string, unknown>,
          debug,
        }, summary)

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
