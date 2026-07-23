/**
 * 批注系统 composable
 *
 * 从 PreviewPage 中抽出的批注相关逻辑，包括：
 *   - 批注数据加载/持久化/增删改
 *   - selector 有效性验证（过滤已失效的批注）
 *   - rAF 循环：实时计算批注标记 & 批注弹窗在页面中的绝对位置
 *   - iframe 就绪状态追踪
 *
 * 使用方式：在 PreviewPage 中调用 useAnnotations(deps)，通过返回的对象
 * 访问状态和操作函数，JSX 渲染仍留在 index.tsx 中。
 */
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { A2UIDocument, A2UIElement } from "../../utils/a2ui-protocol"
import { loadAnnotations, saveAnnotations, saveAttachment, type AnnotationRecord } from "../../utils/annotation-persist"
import { getCommenterInfo } from "../../utils/user-info"
import type { AnnotationTarget } from "./annotation-popup"

/** iframe 内元素的原始坐标（未经缩放变换） */
export type RawRect = {
  top: number
  left: number
  width: number
  height: number
}

/** 批注条目，pos 为经 rAF 计算后的页面绝对坐标，null 表示尚未计算 */
type AnnotationItem = AnnotationRecord & {
  pos: { top: number; left: number; width: number; height: number } | null
}

/**
 * 批注 composable 的依赖项
 *
 * 所有外部状态均通过 accessor 函数注入，保证 SolidJS 响应式追踪正常工作。
 * previewIframeRef / previewPageRef 为 DOM ref accessor，
 * canvasRef.viewportElement 为画布视口元素 accessor，
 * unfreezeDomPicker 为解除 DOM 选择器冻结的回调。
 */
export function useAnnotations(deps: {
  dir: () => string | undefined
  sessionId: () => string | undefined
  pendingData: () => unknown
  editing: () => boolean
  annotating: () => boolean
  previewIframeRef: () => HTMLIFrameElement | undefined
  previewPageRef: () => HTMLDivElement | undefined
  canvasRef: { viewportElement: () => HTMLDivElement | undefined }
  targetWidth: () => number
  unfreezeDomPicker: () => void
}) {
  // ── 状态 ──────────────────────────────────────────────────────────────

  /** iframe 是否已发送 A2UI_READY，批注加载依赖此信号 */
  const [iframeReady, setIframeReady] = createSignal(false)

  /** 批注列表，pos 由 rAF 循环实时更新 */
  const [annotations, setAnnotations] = createStore<AnnotationItem[]>([])

  /** 批注弹窗状态：show / target / rawRect */
  const [annotationPopup, setAnnotationPopup] = createStore({
    show: false,
    target: null as AnnotationTarget | null,
    rawRect: null as RawRect | null,
  })

  /**
   * 可见的批注标记数据（用于渲染 badge 图标）
   * 排除当前弹窗所指向的元素，避免 badge 与弹窗重叠
   */
  const visibleAnnotationData = createMemo(() => {
    const popupSelector = annotationPopup.show ? annotationPopup.target?.elementId : null
    return annotations.reduce<Array<{ selector: string; account: string; pos: { top: number; left: number; width: number; height: number }; originalIndex: number }>>((acc, a, i) => {
      if (a.pos && a.selector !== popupSelector) acc.push({ selector: a.selector, account: a.account, pos: a.pos, originalIndex: i })
      return acc
    }, [])
  })

  // ── Selector 有效性验证 ───────────────────────────────────────────────
  // 批注保存的是元素 selector（如 "button:0:1"），加载时需验证该 selector
  // 在当前文档结构中是否仍然存在，过滤掉因 UI 变更而失效的批注。

  /**
   * 验证 selector 在 A2UIDocument 中是否有效
   *
   * selector 格式：baseId 或 baseId:loopIndex:loopIndex...
   * baseId 为元素 ID，后缀 :数字 表示嵌套循环的索引路径。
   * 例如 "list:item:0:2" 表示 list 内 item 组件的第 0 层循环第 2 个实例。
   */
  function selectorExists(selector: string, doc: A2UIDocument): boolean {
    selector = selector.startsWith("#") ? selector.slice(1) : selector
    const elMap = new Map(doc.elements.map((e) => [e.id, e]))
    const baseId = selector.replace(/(:\d+)+$/, "")
    if (!elMap.has(baseId)) {
      console.log("[preview] selectorExists FAIL:", selector, "baseId not found:", baseId)
      return false
    }
    if (baseId === selector) return true

    // 解析循环索引后缀
    const indices = selector.slice(baseId.length + 1).split(":").map(Number)
    const state = doc.state ?? {}

    // 向上遍历祖先链，收集所有 template 循环父节点的 path 信息
    const ancestorLoops: Array<{ path: string; index: number }> = []
    let currentId = baseId
    while (currentId) {
      const parentId = findParentId(currentId, doc.elements)
      if (!parentId) break
      const parent = elMap.get(parentId)!
      const isTemplate = typeof parent.children === "object" && "path" in parent.children && "componentId" in parent.children
      if (isTemplate) {
        ancestorLoops.push({ path: (parent.children as { path: string; componentId: string }).path, index: -1 })
      }
      currentId = parentId
    }

    if (ancestorLoops.length !== indices.length) {
      console.log("[preview] selectorExists FAIL:", selector, "loops:", ancestorLoops.length, "≠ indices:", indices.length)
      return false
    }

    // 将索引从外到内填入祖先链（祖先链是从内到外收集的，需反转）
    ancestorLoops.reverse()
    for (let i = 0; i < ancestorLoops.length; i++) {
      ancestorLoops[i].index = indices[i]
    }

    // 逐层验证：每层循环对应的数据数组长度必须足够容纳当前索引
    for (let i = 0; i < ancestorLoops.length; i++) {
      const resolvedPath = buildResolvedPath(ancestorLoops, i)
      const arr = resolveStatePath(state, resolvedPath)
      if (!Array.isArray(arr) || indices[i] >= arr.length) {
        console.log("[preview] selectorExists FAIL:", selector, "loop", i, "resolvedPath:", resolvedPath, "result:", Array.isArray(arr) ? `arr[${arr.length}]` : typeof arr, "index:", indices[i])
        return false
      }
    }
    console.log("[preview] selectorExists OK:", selector)
    return true
  }

  /** 构建循环数据的路径：外层索引 + path 逐级嵌套，最后一段为当前层的 path */
  function buildResolvedPath(loops: Array<{ path: string; index: number }>, upTo: number): string {
    let result = ""
    for (let i = 0; i < upTo; i++) {
      const p = loops[i].path.startsWith("/") ? loops[i].path : "/" + loops[i].path
      result += p + "/" + loops[i].index
    }
    const p = loops[upTo].path.startsWith("/") ? loops[upTo].path : "/" + loops[upTo].path
    result += p
    return result
  }

  /** 查找元素的父节点 ID，支持普通子节点列表和 template 子节点两种结构 */
  function findParentId(elementId: string, elements: A2UIElement[]): string | null {
    for (const el of elements) {
      if (!el.children) continue
      if (Array.isArray(el.children)) {
        if (el.children.includes(elementId)) return el.id
      }
      if (typeof el.children === "object" && "componentId" in el.children) {
        if ((el.children as { componentId: string }).componentId === elementId) return el.id
      }
    }
    return null
  }

  /** 沿路径逐段取值，解析 state 中的嵌套数据 */
  function resolveStatePath(state: Record<string, unknown>, path: string): unknown {
    if (!path || path === "/") return state
    const segments = path.split("/").filter(Boolean)
    let current: unknown = state
    for (const seg of segments) {
      if (current == null || typeof current !== "object") return undefined
      current = (current as Record<string, unknown>)[seg]
    }
    return current
  }

  // ── 批注加载 ──────────────────────────────────────────────────────────

  /** 防止竞态的序列号：新加载触发时旧加载结果会被丢弃 */
  let loadSeq = 0

  createEffect(() => {
    if (!deps.dir() || !deps.sessionId() || !iframeReady()) return
    const doc = deps.pendingData() as A2UIDocument | null
    const seq = ++loadSeq
    loadAnnotations(deps.dir()!, deps.sessionId()!).then((data) => {
      if (seq !== loadSeq) return
      // 若当前有文档数据，过滤掉 selector 已失效的批注
      const filtered = doc?.elements ? data.filter((a) => selectorExists(a.selector, doc)) : data
      setAnnotations(filtered.map((a) => ({
        ...a,
        // 兼容历史记录:旧批注落盘时无 account/userName,归一为空串避免 JSON 出现 undefined
        account: a.account ?? "",
        userName: a.userName ?? "",
        pos: null,
      })))
    })
  })

  /** 将批注列表持久化到磁盘 */
  async function persistAnnotations() {
    if (!deps.dir() || !deps.sessionId()) return
    const records: AnnotationRecord[] = annotations.map(({ pos: _, ...rest }) => rest)
    console.log("[preview] persistAnnotations", records.length, "records, selectors:", records.map((r) => r.selector))
    await saveAnnotations(deps.dir()!, deps.sessionId()!, records)
  }

  // ── rAF 位置更新循环 ─────────────────────────────────────────────────
  // iframe 内容有缩放（scale），批注的 rawRect 是 iframe 内原始坐标，
  // 需持续用 rAF 将 rawRect 转换为页面绝对坐标写入 pos / elementRect，
  // 以保证 badge 和弹窗跟随缩放与滚动实时更新。

  let rafId: number | null = null
  let debugOnce = false

  createEffect(() => {
    const shouldRun = annotations.length > 0 || (annotationPopup.show && annotationPopup.rawRect)
    if (shouldRun && rafId === null) {
      const loop = () => {
        rafId = requestAnimationFrame(loop)
        const canvasEl = deps.canvasRef.viewportElement()
        const canvasRect = canvasEl?.getBoundingClientRect()
        const paneRect = deps.previewPageRef()?.getBoundingClientRect()
        const wrapper = deps.previewIframeRef()?.closest('.preview-iframe-wrapper') as HTMLElement | null
        const wrapperRect = wrapper?.getBoundingClientRect()
        const scale = (wrapperRect?.width ?? deps.targetWidth()) / deps.targetWidth()

        // 首帧调试日志（仅一次）
        if (!debugOnce && annotations.length > 0) {
          debugOnce = true
          const r0 = annotations[0].rawRect
          console.log("[preview] rAF first frame", {
            hasCanvasEl: !!canvasEl,
            canvasRect,
            hasWrapper: !!wrapper,
            wrapperRect,
            scale,
            rawRect0: r0,
            firstPos: r0 ? {
              top: (wrapperRect?.top ?? 0) - (canvasRect?.top ?? 0) + r0.top * scale,
              left: (wrapperRect?.left ?? 0) - (canvasRect?.left ?? 0) + r0.left * scale,
              width: r0.width * scale,
              height: r0.height * scale,
            } : null,
          })
        }

        // 更新批注弹窗的元素矩形坐标
        if (annotationPopup.show && annotationPopup.rawRect) {
          const r = annotationPopup.rawRect!
          setAnnotationPopup('target', 'elementRect', {
            top: (wrapperRect?.top ?? 0) - (paneRect?.top ?? 0) + r.top * scale,
            left: (wrapperRect?.left ?? 0) - (paneRect?.left ?? 0) + r.left * scale,
            width: r.width * scale,
            height: r.height * scale,
          })
        }

        // 更新所有批注 badge 的绝对坐标
        for (let i = 0; i < annotations.length; i++) {
          const r = annotations[i].rawRect
          if (!r) continue
          setAnnotations(i, 'pos', {
            top: (wrapperRect?.top ?? 0) - (canvasRect?.top ?? 0) + r.top * scale,
            left: (wrapperRect?.left ?? 0) - (canvasRect?.left ?? 0) + r.left * scale,
            width: r.width * scale,
            height: r.height * scale,
          })
        }
      }
      rafId = requestAnimationFrame(loop)
    }
    if (!shouldRun && rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  })

  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
  })

  // ── 批注操作函数 ──────────────────────────────────────────────────────

  /** 发送新批注：保存附件、写入列表、持久化 */
  async function handleAnnotationSend(text: string, files: File[]) {
    console.log("[preview] handleAnnotationSend ENTER", { text, filesCount: files.length, hasTarget: !!annotationPopup.target, hasRawRect: !!annotationPopup.rawRect, dir: deps.dir(), sessionId: deps.sessionId() })
    const id = crypto.randomUUID()
    const attachments: Array<{ fileName: string; id: string }> = []
    for (const file of files) {
      const buf = await file.arrayBuffer()
      const result = await saveAttachment(deps.dir()!, deps.sessionId()!, id, file.name, buf)
      attachments.push(result)
    }
    // 归档时写入 comments.json 的用户身份(与 make ArchiveComment 的 account/userName 对齐)
    const userInfo = getCommenterInfo()
    const record = {
      id, note: text, selector: annotationPopup.target!.elementId,
      attachments, time: Date.now(),
      account: userInfo.account, userName: userInfo.userName,
      rawRect: annotationPopup.rawRect!,
      pos: null,
    }
    console.log("[preview] handleAnnotationSend", { selector: record.selector, dir: deps.dir(), sessionId: deps.sessionId(), annotationsBefore: annotations.length })
    setAnnotations([...annotations, record])
    console.log("[preview] handleAnnotationSend after setAnnotations", { annotationsAfter: annotations.length })
    await persistAnnotations()
    if (!deps.editing()) {
      deps.unfreezeDomPicker()
    }
  }

  /** 删除当前弹窗指向的批注 */
  async function handleDeleteAnnotation() {
    const selector = annotationPopup.target?.elementId
    if (!selector) return
    setAnnotations(annotations.filter((a) => a.selector !== selector))
    setAnnotationPopup({ show: false, target: null, rawRect: null })
    await persistAnnotations()
    deps.unfreezeDomPicker()
  }

  /** 编辑已有批注：追加新附件、更新文本和时间 */
  async function handleEditAnnotation(id: string, text: string, files: File[]) {
    const newAttachments: Array<{ fileName: string; id: string }> = []
    for (const file of files) {
      const buf = await file.arrayBuffer()
      const result = await saveAttachment(deps.dir()!, deps.sessionId()!, id, file.name, buf)
      newAttachments.push(result)
    }
    // 旧记录缺身份时用当前用户回填;已有值则保留原作者归属,不被编辑者覆盖
    const userInfo = getCommenterInfo()
    setAnnotations(annotations.map((a) => {
      if (a.id !== id) return a
      return {
        ...a,
        note: text,
        attachments: [...a.attachments, ...newAttachments],
        time: Date.now(),
        account: a.account || userInfo.account,
        userName: a.userName || userInfo.userName,
      }
    }))
    await persistAnnotations()
  }

  /**
   * 关闭批注弹窗
   * 非 editing 模式下解除 DOM 选择器冻结；
   * 非 editing 且非 annotating 模式下关闭 DOM 选择器。
   */
  function handleAnnotationClose() {
    setAnnotationPopup({ show: false, target: null, rawRect: null })
    if (!deps.editing()) {
      deps.unfreezeDomPicker()
    }
    if (!deps.editing() && !deps.annotating()) {
      deps.previewIframeRef()?.contentWindow?.postMessage({ type: "DOM_PICKER_TOGGLE", active: false }, "*")
    }
  }

  /**
   * 点击已有批注 badge 打开弹窗
   * 使用 rAF 计算好的 pos 坐标，加上 canvas→pane 偏移量
   */
  function openAnnotationFor(selector: string) {
    const anno = annotations.find((a) => a.selector === selector)
    if (!anno?.pos) return
    if (deps.annotating()) {
      deps.unfreezeDomPicker()
    }
    const paneRect = deps.previewPageRef()?.getBoundingClientRect()
    const canvasRect = deps.canvasRef.viewportElement()?.getBoundingClientRect()
    const offsetY = (canvasRect?.top ?? 0) - (paneRect?.top ?? 0)
    const offsetX = (canvasRect?.left ?? 0) - (paneRect?.left ?? 0)
    setAnnotationPopup({
      show: true,
      rawRect: anno.rawRect,
      target: { elementId: selector, elementRect: {
        top: anno.pos.top + offsetY,
        left: anno.pos.left + offsetX,
        width: anno.pos.width,
        height: anno.pos.height,
      }},
    })
    if (deps.annotating()) {
      deps.unfreezeDomPicker()
    }
  }

  /**
   * 由 DOM_PICKER_QUICK_FIX（annotating 模式下）触发的弹窗打开
   * 从 iframe 内原始坐标 rawRect 实时计算页面坐标
   */
  function openAnnotationFromRect(elementId: string, rawRect: RawRect) {
    const paneRect = deps.previewPageRef()?.getBoundingClientRect()
    const wrapper = deps.previewIframeRef()?.closest('.preview-iframe-wrapper') as HTMLElement | null
    const wrapperRect = wrapper?.getBoundingClientRect()
    const scale = (wrapperRect?.width ?? deps.targetWidth()) / deps.targetWidth()
    setAnnotationPopup({
      show: true,
      rawRect,
      target: {
        elementId,
        elementRect: {
          top: (wrapperRect?.top ?? 0) - (paneRect?.top ?? 0) + rawRect.top * scale,
          left: (wrapperRect?.left ?? 0) - (paneRect?.left ?? 0) + rawRect.left * scale,
          width: rawRect.width * scale,
          height: rawRect.height * scale,
        },
      },
    })
  }

  /** 强制关闭批注弹窗（用于模式切换等场景，不触发 DOM 选择器状态变更） */
  function closeAnnotationPopup() {
    setAnnotationPopup({ show: false, target: null, rawRect: null })
  }

  /** 清空所有批注数据（用于刷新 iframe） */
  function resetAnnotations() {
    setAnnotations([])
  }

  return {
    annotations,
    annotationPopup,
    visibleAnnotationData,
    iframeReady,
    setIframeReady,
    handleAnnotationSend,
    handleDeleteAnnotation,
    handleEditAnnotation,
    handleAnnotationClose,
    openAnnotationFor,
    openAnnotationFromRect,
    closeAnnotationPopup,
    resetAnnotations,
  }
}
