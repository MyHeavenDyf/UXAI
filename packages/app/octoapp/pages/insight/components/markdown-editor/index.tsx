import { createSignal, onCleanup, onMount, createEffect, Show } from "solid-js"
import type { JSX } from "solid-js"
import Vditor from "vditor"
import "vditor/dist/index.css"
import { showToast } from "@opencode-ai/ui/toast"
import { useTheme } from "@opencode-ai/ui/theme/context"
import type { ResultTab } from "../result-viewer/tab-store"
import { getDesktopApi } from "../../lib/electron-api"
import { defaultFilename, ensureMarkdownExt } from "../../utils/local-file"
import { ensureLocalMarkdownFile } from "../../utils/local-resource"
import { interceptExternalLink } from "../../utils/external-link"
import { usePlatform } from "@/context/platform"

// 无边框窗口(titleBarStyle:"hidden")macOS 在左上画红绿灯,留出避让宽度(与 _shell/topbar 一致)
const TRAFFIC_LIGHT_INSET = 80
// Windows titleBarOverlay 的窗口控件在右上角,顶栏右侧避让宽度(与 titlebar-simple 的 windowsControlsBaseWidth 一致)
const WINDOWS_CONTROLS_INSET = 138

// Vditor 资源本地化:运行时按 `cdn + "/dist/js/..."` 拉懒加载资源(katex/mermaid/echarts…),
// 指向本地 publicDir(vite.js copyVditorAssets 拷到 /vendor/vditor/dist),零公网 CDN、断网可用。
// 见 docs/specs/ui/insight-markdown-editor.md §6.2。
const VDITOR_LOCAL_CDN = "/vendor/vditor"

// 裁剪工具栏:保留较完整能力(标题/格式/列表/引用/表格/代码/撤销/大纲/预览/导出)。
// 去掉:
//   - upload / record:与自有附件体系冲突;
//   - fullscreen:已是全屏 overlay 且进全屏后无可见退出入口,冗余;
//   - content-theme / code-theme:换肤项,与「跟随 app 明暗」冲突,徒增困惑;
//   - edit-mode(所见即所得/即时渲染/分屏):固定用分屏(sv),纯预览用工具栏最后的「预览」👁 切换即可,
//            三选项里「所见即所得」「即时渲染」对本场景区分意义不大,去掉减少困惑(spec §6.3)。
// 导出(export)用 Vditor 原生入口(在工具栏左侧,不与窗口控件位置冲突);其 PDF 项走 window.print()
// 弹系统打印框,先用 CSS 隐藏(octo-tokens.css),只留 Markdown/HTML;PDF 后续再做(spec §6.3)。
// 公式/流程图/图表/脑图是预览渲染特性(写 $$ / ```mermaid 即出图,资源走本地 cdn),无需工具栏按钮。见 §6.3。
const TRIMMED_TOOLBAR = [
  "emoji", "headings", "bold", "italic", "strike", "link",
  "|", "list", "ordered-list", "check", "outdent", "indent",
  "|", "quote", "line", "code", "inline-code", "insert-before", "insert-after",
  "|", "table",
  "|", "undo", "redo",
  "|", "outline", "preview", "export",
]

const SAVE_DEBOUNCE_MS = 1000

// Vditor sv 模式只内置「左源 → 右预览」单向同步滚动(见 spec §6.6),补「右预览 → 左源」做双向。
//
// 核心难点:Vditor 正向监听(左滚→写右)**无条件、无节流**。拖右栏时,我反向写左 → 触发它 →
// 它又按(有异步滞后的)左栏值回写右栏,和你正在拖的右栏打架 → 闪烁。
//
// 解法:拖右栏期间**拦掉 Vditor 对右栏 scrollTop 的回写**。原理 —— 用户拖拽/滚轮是引擎层改
// scrollTop,**不走 JS setter**;只有 Vditor 的 `pv.scrollTop=` 走 setter。给右栏元素的 scrollTop
// setter 做实例级覆盖,在「用户正驱动右栏」的时间窗内丢弃写入 → 右栏由用户独占、不被拽,不闪。
//
// 「用户正驱动右栏」的判定:
//   - 拖拽:右栏上 pointerdown 起、到 pointerup 止(整段按住都算,即便滑到顶/底不再产生 scroll 事件)
//   - 滚轮/触摸惯性:右栏 wheel 起、到最后一次滚动后 200ms
// 左栏发生手势则释放动量锁(让 Vditor 正向同步接管;拖拽以 pointerup 收尾)。反向用 Vditor 公式的逆。
//
// 早期 bug:只靠 scroll 事件续锁 → 拖到顶/底滚动事件停发、锁过期,再拖回来左栏就不同步了。
// 故拖拽必须靠 pointerdown/up 维持锁,不依赖 scroll 事件。
function setupScrollSync(sv: HTMLElement, pv: HTMLElement): () => void {
  const GRACE_MS = 200
  let pvDragging = false
  let pvMomentumUntil = 0
  let activeUp: (() => void) | undefined
  const pvLocked = () => pvDragging || performance.now() < pvMomentumUntil

  const endDrag = () => {
    pvDragging = false
    if (activeUp) {
      window.removeEventListener("pointerup", activeUp)
      window.removeEventListener("pointercancel", activeUp)
      window.removeEventListener("blur", activeUp)
      activeUp = undefined
    }
  }
  const onPvPointerDown = () => {
    pvDragging = true
    activeUp = endDrag
    // pointerup/cancel + 窗口失焦兜底:任一收尾,避免拖拽在窗口外松开/被取消导致锁卡死
    window.addEventListener("pointerup", activeUp)
    window.addEventListener("pointercancel", activeUp)
    window.addEventListener("blur", activeUp)
  }
  const onPvWheel = () => (pvMomentumUntil = performance.now() + GRACE_MS)
  const onSvGesture = () => (pvMomentumUntil = 0) // 左栏手势释放动量锁(拖拽由 pointerup 收尾)

  pv.addEventListener("pointerdown", onPvPointerDown)
  pv.addEventListener("wheel", onPvWheel, { passive: true })
  sv.addEventListener("wheel", onSvGesture, { passive: true })
  sv.addEventListener("pointerdown", onSvGesture)

  // 拦掉 Vditor 对右栏的回写(仅用户正驱动右栏时)。用户原生拖拽/滚轮不走此 setter,不受影响。
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!
  Object.defineProperty(pv, "scrollTop", {
    configurable: true,
    get() {
      return (desc.get as () => number).call(this)
    },
    set(v: number) {
      if (pvLocked()) return // 用户正驱动右栏,丢弃 Vditor 回写,防闪
      ;(desc.set as (n: number) => void).call(this, v)
    },
  })

  // 反向:右栏滚动(仅用户驱动时)→ 左栏。用 Vditor 正向公式的逆,保持两向对齐一致。
  const onPvScroll = () => {
    if (!pvLocked()) return // 非用户驱动(Vditor 回写已被拦,这里多为残留),不反向同步
    if (!pvDragging) pvMomentumUntil = performance.now() + GRACE_MS // 滚轮/惯性续锁(拖拽不需要)
    const r = sv.clientHeight
    const pvSH = pv.scrollHeight
    const i = sv.scrollHeight - (parseFloat(sv.style.paddingBottom || "0") || 0)
    if (i <= 0 || pvSH <= pv.clientHeight || sv.scrollHeight <= r) return
    const P = (desc.get as () => number).call(pv)
    let target = (P * i) / pvSH
    if (target > r / 2) target = ((P + r) * i) / pvSH - r // 拐点支
    target = Math.max(0, Math.min(target, sv.scrollHeight - r))
    if (Math.abs(sv.scrollTop - target) < 2) return // 幂等,吸收取整残差
    sv.scrollTop = target
  }
  pv.addEventListener("scroll", onPvScroll, { passive: true })

  return () => {
    pv.removeEventListener("pointerdown", onPvPointerDown)
    pv.removeEventListener("wheel", onPvWheel)
    sv.removeEventListener("wheel", onSvGesture)
    sv.removeEventListener("pointerdown", onSvGesture)
    pv.removeEventListener("scroll", onPvScroll)
    endDrag() // 解绑可能仍挂着的 pointerup/cancel/blur
    delete (pv as unknown as { scrollTop?: number }).scrollTop // 还原原型访问器
  }
}

type SaveState = "idle" | "saving" | "saved" | "error"

export function MarkdownEditor(props: {
  tab: ResultTab
  projectDir: string
  /** 关闭编辑器,把最新内容回写 tab(供「预览/代码」显示编辑后内容) */
  onClose: (latestContent: string) => void
}): JSX.Element {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"
  const platform = usePlatform()
  const isMac = () => platform.platform === "desktop" && platform.os === "macos"
  // Windows 无边框窗口的最小化/最大化/关闭(titleBarOverlay)在右上角,顶栏右侧留出避让,
  // 否则关闭 ✕ 会和原生控件位置重合(与 _shell/titlebar 的 windowsControlsBaseWidth 一致)。
  const isWindows = () => platform.platform === "desktop" && platform.os === "windows"

  let editorEl: HTMLDivElement | undefined
  let vditor: Vditor | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let targetPath: string | null = null
  let scrollSyncCleanup: (() => void) | undefined
  // 编辑器初值:用 tab 已 fetch 的内容(与本地文件一致,省一次读盘)。§3.2。
  // 不再做「还原初始内容」(要回到原始版本重新从 MCP 下载即可),故无需单独快照。
  const initialContent = props.tab.content ?? ""
  // 最近一次拿到的编辑器内容(关闭时回写 tab + flush 未保存)
  let latestValue = initialContent

  const [ready, setReady] = createSignal(false)
  const [saveState, setSaveState] = createSignal<SaveState>("idle")
  const [saveError, setSaveError] = createSignal("")
  const [persistent, setPersistent] = createSignal(true)
  const [initError, setInitError] = createSignal("")

  const fileName = () => ensureMarkdownExt(defaultFilename(props.tab))

  async function doSave(value: string) {
    if (!targetPath) return
    const api = getDesktopApi()
    if (typeof api?.writeFile !== "function") {
      setSaveState("error")
      setSaveError("缺少 window.api.writeFile")
      showToast({ title: "保存失败", description: "桌面端缺少 writeFile 能力,请联系开发团队补壳", variant: "error" })
      return
    }
    setSaveState("saving")
    console.log("[octo:mdedit] save-start", { path: targetPath, bytes: value.length })
    try {
      await api.writeFile!(targetPath, value)
      console.log("[octo:mdedit] save-ok", { path: targetPath, bytes: value.length })
      setSaveState("saved")
      setSaveError("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[octo:mdedit] save-failed", { path: targetPath, err: msg })
      setSaveState("error")
      setSaveError(msg)
      // 内存内容不丢:下次输入或手动重试再写(§4.2)
      showToast({ title: "保存失败", description: msg, variant: "error" })
    }
  }

  function scheduleSave(value: string) {
    latestValue = value
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void doSave(value)
    }, SAVE_DEBOUNCE_MS)
  }

  // 立即写盘(关闭前 flush / Cmd+S 手动保存),绕过防抖
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    const value = vditor?.getValue() ?? latestValue
    latestValue = value
    void doSave(value)
  }

  function handleClose() {
    // 关闭前 flush 未保存的最后一次编辑,内容不丢
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      void doSave(latestValue)
    }
    console.log("[octo:mdedit] close", { path: targetPath })
    props.onClose(latestValue)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      handleClose()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault()
      flushSave()
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown)
    // 预览里的外链点击 → 系统浏览器(§6.5,与卡片预览共用 interceptExternalLink)
    editorEl?.addEventListener("click", interceptExternalLink, true)
    void (async () => {
      try {
        const { path, persistent: isPersistent } = await ensureLocalMarkdownFile(props.tab, props.projectDir)
        targetPath = path
        setPersistent(isPersistent)
        console.log("[octo:mdedit] open", { tabId: props.tab.id, source: props.tab.source, path, persistent: isPersistent })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("[octo:mdedit] open-failed", { tabId: props.tab.id, err: msg })
        setInitError(msg)
        // 仍允许在内存里编辑(不硬禁),但保存会因 targetPath 为空而提示
      }
      if (!editorEl) return
      vditor = new Vditor(editorEl, {
        mode: "sv",
        value: initialContent,
        theme: isDark() ? "dark" : "classic",
        cdn: VDITOR_LOCAL_CDN,
        cache: { enable: false }, // 自管落盘,关掉 Vditor 的 localStorage 缓存
        toolbar: TRIMMED_TOOLBAR,
        toolbarConfig: { pin: true },
        preview: {
          // 去掉预览面板顶部的设备/平台切换栏(Desktop/Tablet/Mobile-Wechat/知乎/刷新)——
          // 写作场景用不到,留着干扰。actions:[] 即清空。
          actions: [],
          theme: { current: isDark() ? "dark" : "light", path: `${VDITOR_LOCAL_CDN}/dist/css/content-theme` },
          hljs: { style: isDark() ? "native" : "github" },
        },
        input: (val) => scheduleSave(val),
        after: () => {
          setReady(true)
          // 补「右预览 → 左源」反向同步,形成双向(Vditor 只内置左→右),见 setupScrollSync。
          const sv = editorEl?.querySelector<HTMLElement>(".vditor-sv")
          const pv = editorEl?.querySelector<HTMLElement>(".vditor-preview")
          if (sv && pv) scrollSyncCleanup = setupScrollSync(sv, pv)
        },
      })
    })()
  })

  // 主题跟随 octo 明暗(§6.4)
  createEffect(() => {
    const dark = isDark()
    if (!ready() || !vditor) return
    vditor.setTheme(dark ? "dark" : "classic", dark ? "dark" : "light", dark ? "native" : "github")
  })

  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown)
    editorEl?.removeEventListener("click", interceptExternalLink, true)
    scrollSyncCleanup?.()
    // 销毁前 flush 一次:防抖未触发就关闭也不丢最后编辑
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
      void doSave(latestValue)
    }
    vditor?.destroy()
    vditor = undefined
  })

  return (
    <div
      class="fixed inset-0 z-[1000] flex flex-col"
      style={{ background: "var(--octo-surface-page)" }}
    >
      {/* 顶栏:文件名 + 保存状态 + 关闭。
          无边框窗口:顶栏作拖拽区(可拖动窗口),mac 左侧避让红绿灯;按钮/交互元素设 no-drag,
          否则在拖拽区上点击会被 Electron 吞掉(这是关闭按钮"点了没反应"的根因)。 */}
      <div
        class="flex items-center gap-3 shrink-0"
        style={{
          height: "44px",
          "padding-left": isMac() ? `${TRAFFIC_LIGHT_INSET}px` : "16px",
          "padding-right": isWindows() ? `${WINDOWS_CONTROLS_INSET}px` : "12px",
          "border-bottom": "1px solid var(--octo-border-divider)",
          background: "var(--octo-surface-page)",
          "-webkit-app-region": "drag",
        }}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true" style={{ flex: "0 0 auto" }}>
          <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5z" stroke="var(--octo-text-secondary)" stroke-width="1.3" stroke-linejoin="round" />
        </svg>
        <span class="text-sm font-medium truncate" style={{ color: "var(--octo-text-primary)", "max-width": "40%" }}>
          {fileName()}
        </span>
        <SaveIndicator state={saveState()} error={saveError()} />
        <Show when={!persistent() && !initError()}>
          <span class="text-xs truncate" style={{ color: "var(--octo-warning, #b45309)" }}>
            未关联本地目录，编辑暂存临时目录、可能丢失，建议先关联目录
          </span>
        </Show>
        <Show when={initError()}>
          <span class="text-xs truncate" style={{ color: "var(--octo-danger, #dc2626)" }}>
            {initError()}（无法保存）
          </span>
        </Show>
        <div class="flex-1" />
        <button
          type="button"
          onClick={handleClose}
          class="flex items-center justify-center rounded transition-colors hover:bg-[var(--octo-surface-hover,#f1f1f1)]"
          style={{ width: "28px", height: "28px", color: "var(--octo-text-secondary)", "-webkit-app-region": "no-drag" }}
          aria-label="关闭编辑器（Esc）"
          title="关闭（Esc）"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      {/* 主体:Vditor sv 分屏 */}
      <div class="flex-1 min-h-0 octo-md-editor-host" ref={(el) => (editorEl = el)} />
    </div>
  )
}

function SaveIndicator(props: { state: SaveState; error: string }): JSX.Element {
  const label = () => {
    switch (props.state) {
      case "saving": return "保存中…"
      case "saved": return "已保存"
      case "error": return "保存失败"
      default: return ""
    }
  }
  const color = () => {
    switch (props.state) {
      case "error": return "var(--octo-danger, #dc2626)"
      case "saved": return "var(--octo-success, #16a34a)"
      default: return "var(--octo-text-secondary)"
    }
  }
  return (
    <Show when={props.state !== "idle"}>
      <span class="text-xs shrink-0" style={{ color: color() }} title={props.error || undefined}>
        {label()}
      </span>
    </Show>
  )
}
