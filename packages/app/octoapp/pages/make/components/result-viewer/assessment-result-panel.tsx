import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import {
  ASSESSMENT_CATEGORIES,
  ASSESSMENT_CATEGORY_OF,
  exitPendingAssessment,
  pauseAssessment,
  pendingAssessment,
  type AssessmentReviewItem,
} from "../../utils/assessment-state"
import { sendTextToAgent } from "../../utils/agent-events"
import { tracker } from "@/utils/tracker"
import { showOctoToast } from "../octo-toast"
import { onAssessmentPinActivated, dispatchAssessmentActivatePin } from "../../utils/assessment-events"
import { assessmentTypeIcon } from "./assessment-type-icons"
import checkSvg from "../../icons/check.svg"
import chevronSvg from "../../icons/chevron_down_L.svg"
import successPng from "../../icons/IllHdSceneSuccess.png"

const TAB_ALL = "全部"

/** 评估结果面板
 *  默认页面右上角 12px，头部拖拽移动 。
 *  挂载于 html-renderer（仅本 tab 处于待修改态时渲染），状态直接读 assessment-state 模块信号。 */
export function AssessmentResultPanel(): JSX.Element {
  const pending = pendingAssessment
  const items = createMemo(() => pending()?.reviewData ?? [])

  const [primaryTab, setPrimaryTab] = createSignal<string>(TAB_ALL)
  const [secondaryFilter, setSecondaryFilter] = createSignal<string>(TAB_ALL)
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null)
  const [checked, setChecked] = createSignal<Record<number, boolean>>({})
  const [position, setPosition] = createSignal<{ left: number; top: number } | null>(null)

  let panelRef: HTMLDivElement | undefined
  let selectAllRef: HTMLButtonElement | undefined
  const rowRefs: Record<number, HTMLDivElement> = {}

  const categoryOf = (item: AssessmentReviewItem) => ASSESSMENT_CATEGORY_OF[item.type]

  /** 一级 Tab：全部 + 有问题的分类*/
  const visibleTabs = createMemo(() => {
    const present = new Set(items().map(categoryOf))
    return [TAB_ALL, ...Object.keys(ASSESSMENT_CATEGORIES).filter((c) => present.has(c))]
  })

  /** 二级筛选项：当前分类下有问题的子类 */
  const visibleSubFilters = createMemo(() => {
    const tab = primaryTab()
    if (tab === TAB_ALL || !ASSESSMENT_CATEGORIES[tab]) return []
    const present = new Set(items().filter((it) => categoryOf(it) === tab).map((it) => it.type))
    return ASSESSMENT_CATEGORIES[tab].filter((s) => present.has(s))
  })

  const visibleItems = createMemo(() => {
    const tab = primaryTab()
    if (tab === TAB_ALL) return items().map((it, i) => ({ it, i }))
    const sub = secondaryFilter()
    return items()
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => categoryOf(it) === tab && (sub === TAB_ALL || it.type === sub))
  })

  const isChecked = (index: number) => !!checked()[index]
  const checkedCount = createMemo(() => Object.values(checked()).filter(Boolean).length)
  const visibleCheckedState = createMemo(() => {
    const visible = visibleItems()
    const some = visible.some(({ i }) => checked()[i])
    const all = some && visible.every(({ i }) => checked()[i])
    return { all, some }
  })

  createEffect(() => {
    const el = selectAllRef
    if (el) el.dataset.indeterminate = visibleCheckedState().some && !visibleCheckedState().all ? "true" : "false"
  })

  const toggleVisibleAll = () => {
    const { all } = visibleCheckedState()
    setChecked((prev) => {
      const next = { ...prev }
      for (const { i } of visibleItems()) {
        if (all) delete next[i]
        else next[i] = true
      }
      return next
    })
  }

  const toggleCheck = (index: number) => {
    setChecked((prev) => {
      const next = { ...prev }
      if (next[index]) delete next[index]
      else next[index] = true
      return next
    })
  }

  /** 行点击（非箭头/复选框区域）：本行展开（其余收起，恒展开不 toggle——收起走箭头点击）
   *  + 激活对应 pin 并打开 pin 弹窗 */
  const handleRowClick = (index: number) => {
    setExpandedIndex(index)
    dispatchAssessmentActivatePin(index, { openPopup: true })
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex((cur) => (cur === index ? null : index))
  }

  // pin 激活联动：一级 Tab 切到「全部」，对应项 scrollIntoView 后展开
  createEffect(() => {
    onCleanup(onAssessmentPinActivated((index) => {
      setPrimaryTab(TAB_ALL)
      setSecondaryFilter(TAB_ALL)
      setExpandedIndex(index)
      queueMicrotask(() => rowRefs[index]?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
    }))
  })

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  const clampPosition = () => {
    const el = panelRef
    const pos = position()
    if (!el || !pos) return
    const parent = el.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const panelRect = el.getBoundingClientRect()
    const pad = 8
    const left = clamp(pos.left, pad, Math.max(pad, parentRect.width - panelRect.width - pad))
    const top = clamp(pos.top, pad, Math.max(pad, parentRect.height - panelRect.height - pad))
    if (left !== pos.left || top !== pos.top) setPosition({ left, top })
  }

  const updatePanelMaxHeight = () => {
    const el = panelRef
    if (!el) return
    const parent = el.parentElement
    if (!parent) return
    const available = parent.getBoundingClientRect().height - el.offsetTop - 12
    el.style.maxHeight = `${Math.max(200, available)}px`
  }

  createEffect(() => {
    if (!panelRef) return
    const parent = panelRef.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => {
      updatePanelMaxHeight()
      clampPosition()
    })
    observer.observe(parent)
    onCleanup(() => observer.disconnect())
  })

  const startPanelDrag = (event: PointerEvent) => {
    const el = panelRef
    const parent = el?.parentElement
    if (!el || !parent) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, [role='button']")) return
    event.preventDefault()

    const header = event.currentTarget as HTMLElement
    header.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = el.offsetLeft
    const startTop = el.offsetTop
    const parentRect = parent.getBoundingClientRect()
    const panelRect = el.getBoundingClientRect()
    const pad = 8
    const maxLeft = Math.max(pad, parentRect.width - panelRect.width - pad)
    const maxTop = Math.max(pad, parentRect.height - panelRect.height - pad)

    let rafId: number | null = null
    let pendingLeft = startLeft
    let pendingTop = startTop

    const updatePosition = () => {
      rafId = null
      setPosition({ left: pendingLeft, top: pendingTop })
      updatePanelMaxHeight()
    }
    const move = (moveEvent: PointerEvent) => {
      pendingLeft = clamp(startLeft + moveEvent.clientX - startX, pad, maxLeft)
      pendingTop = clamp(startTop + moveEvent.clientY - startY, pad, maxTop)
      if (rafId === null) rafId = requestAnimationFrame(updatePosition)
    }
    const up = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      try { header.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      header.removeEventListener("pointermove", move)
      header.removeEventListener("pointerup", up)
      header.removeEventListener("pointercancel", up)
    }
    header.addEventListener("pointermove", move)
    header.addEventListener("pointerup", up)
    header.addEventListener("pointercancel", up)
  }

  // ── 操作 ──────────────────────────────────────────────────────────

  /** × 关闭面板 = 暂停 */
  const handleClose = () => {
    tracker.interaction({ module: "design", name: "assessment-pause-panel" })
    pauseAssessment()
  }

  /** 空态 退出（清磁盘数据） */
  const handleExit = (action: string) => {
    tracker.interaction({ module: "design", name: "assessment-exit", extend: JSON.stringify({ action }) })
    exitPendingAssessment()
  }

  /** 「采纳」：以选中项生成结构化改进意见发送模型，成功后退出 */
  const handleAdopt = async () => {
    const all = items()
    const selected = Object.keys(checked())
      .map(Number)
      .sort((a, b) => a - b)
    if (selected.length === 0) return
    tracker.interaction({ module: "design", name: "assessment-adopt", extend: JSON.stringify({ count: selected.length }) })
    const lines = ["请按以下评审意见修改页面：", ""]
    selected.forEach((idx, n) => {
      const it = all[idx]
      lines.push(`【问题${n + 1}】${it.title}（${it.xpath}）`)
      for (const s of it.solution) {
        lines.push(`问题描述：${s.desc}`)
        lines.push(`修改建议：${s.suggest}`)
      }
      lines.push("")
    })
    const result = await sendTextToAgent(lines.join("\n").trim(), {
      source: "assessment-adopt",
      timeoutMs: 1200000,
    })
    if (!result.ok) {
      showOctoToast({ title: "采纳发送失败", description: result.message })
      return
    }
    exitPendingAssessment()
  }

  const switchTab = (tab: string) => {
    setPrimaryTab(tab)
    setSecondaryFilter(TAB_ALL)
  }

  const panelStyle = (): Record<string, string> => {
    const pos = position()
    if (pos) return { left: `${pos.left}px`, top: `${pos.top}px` }
    return { right: "12px", top: "12px" }
  }

  return (
    <div ref={panelRef} class="od-assessment-panel" style={panelStyle()}>
      <div class="od-assessment-panel-header" onPointerDown={startPanelDrag}>
        <span class="od-assessment-panel-title">评估结果</span>
        <button type="button" class="od-assessment-panel-close" aria-label="关闭" onClick={handleClose}>
          ×
        </button>
      </div>

      <Show
        when={items().length > 0}
        fallback={
          <div class="od-assessment-panel-empty">
            <img src={successPng} alt="" draggable={false} />
            <div class="od-assessment-panel-empty-text">
              本次评估未发现问题,{" "}
              <span class="od-assessment-panel-empty-link" onClick={() => handleExit("end-round")}>
                结束此轮评估
              </span>
            </div>
          </div>
        }
      >
        <div class="od-assessment-tabs">
          <For each={visibleTabs()}>
            {(tab) => (
              <button
                type="button"
                class={`od-assessment-tab${primaryTab() === tab ? " od-assessment-tab--active" : ""}`}
                onClick={() => switchTab(tab)}
              >
                {tab}
              </button>
            )}
          </For>
        </div>

        <Show when={visibleSubFilters().length > 0}>
          <div class="od-assessment-subfilters">
            <For each={[TAB_ALL, ...visibleSubFilters()]}>
              {(sub, i) => (
                <>
                  <Show when={i() > 0}>
                    <span class="od-assessment-subfilter-divider" />
                  </Show>
                  <button
                    type="button"
                    class={`od-assessment-subfilter${secondaryFilter() === sub ? " od-assessment-subfilter--active" : ""}`}
                    onClick={() => setSecondaryFilter(sub)}
                  >
                    {sub}
                  </button>
                </>
              )}
            </For>
          </div>
        </Show>

        <div class="od-assessment-list octo-thin-scroll">
          <For each={visibleItems()}>
            {({ it, i }) => (
              <div
                class="od-assessment-card"
                ref={(el) => (rowRefs[i] = el)}
                onClick={() => handleRowClick(i)}
              >
                <div class="od-assessment-row">
                  <button
                    type="button"
                    class={`od-assessment-checkbox${isChecked(i) ? " od-assessment-checkbox--checked" : ""}`}
                    aria-label="采纳勾选"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleCheck(i)
                    }}
                  >
                    <Show when={isChecked(i)}>
                      <img src={checkSvg} alt="" draggable={false} />
                    </Show>
                  </button>
                  <Show when={assessmentTypeIcon(it.type)}>
                    {(src) => <img class="od-assessment-row-icon" src={src()} alt="" draggable={false} />}
                  </Show>
                  <span class="od-assessment-row-title" title={it.title}>{it.title}</span>
                  <img
                    class={`od-assessment-row-chevron${expandedIndex() === i ? " od-assessment-row-chevron--open" : ""}`}
                    src={chevronSvg}
                    alt=""
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(i)
                    }}
                  />
                </div>
                <Show when={expandedIndex() === i}>
                  <div class="od-assessment-details">
                    <For each={it.solution}>
                      {(s) => (
                        <>
                          <div class="od-assessment-details-section">
                            <div class="od-assessment-details-title">问题描述</div>
                            <div class="od-assessment-details-body">{s.desc}</div>
                          </div>
                          <div class="od-assessment-details-section">
                            <div class="od-assessment-details-title">修改建议</div>
                            <div class="od-assessment-details-suggest">
                              <div class="od-assessment-details-suggest-line" />
                              <div class="od-assessment-details-body">{s.suggest}</div>
                            </div>
                          </div>
                        </>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <div class="od-assessment-footer">
          <button
            ref={selectAllRef}
            type="button"
            class={`od-assessment-checkbox od-assessment-select-all${visibleCheckedState().all ? " od-assessment-checkbox--checked" : ""}`}
            aria-label="全选"
            onClick={toggleVisibleAll}
          >
            <Show when={visibleCheckedState().all}>
              <img src={checkSvg} alt="" draggable={false} />
            </Show>
          </button>
          <span class="od-assessment-select-all-label">全选</span>
          <div class="od-assessment-footer-actions">
            <button type="button" class="od-assessment-btn-reject" onClick={() => handleExit("reject")}>
              不采纳
            </button>
            <button
              type="button"
              class="od-assessment-btn-adopt"
              disabled={checkedCount() === 0}
              onClick={() => void handleAdopt()}
            >
              采纳
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
