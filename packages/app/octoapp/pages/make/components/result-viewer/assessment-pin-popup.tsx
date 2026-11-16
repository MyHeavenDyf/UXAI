import { For, Show, createEffect, type JSX } from "solid-js"
import { ASSESSMENT_CATEGORY_OF, type AssessmentReviewItem } from "../../utils/assessment-state"

/** 三大类类型标签配色；未知子类回退中性灰 */
const TAG_CLASS_BY_CATEGORY: Record<string, string> = {
  "Token遵从度": "od-assessment-tag--token",
  "组件遵从度": "od-assessment-tag--component",
  "页面完整度": "od-assessment-tag--page",
}

export function AssessmentTypeTag(props: { type: string }): JSX.Element {
  const category = () => ASSESSMENT_CATEGORY_OF[props.type]
  return (
    <span class={`od-assessment-tag${category() ? ` ${TAG_CLASS_BY_CATEGORY[category()]}` : " od-assessment-tag--default"}`}>
      {props.type}
    </span>
  )
}

type Rect = { left: number; top: number; width: number; height: number }

/** 弹窗相对锚点（pin 矩形）定位：顶部与 pin 对齐、左侧距 pin 右侧 10px；
 *  右侧/底部空间不足时翻转到 pin 左侧/上移，保持弹窗完整落在容器内 */
function anchorStyle(anchor: Rect | null, popupWidth: number): Record<string, string> {
  if (!anchor) return { left: "12px", top: "12px" }
  const left = anchor.left + anchor.width + 10
  return { left: `${left}px`, top: `${anchor.top}px`, "--od-assessment-flip-x": left >= 0 ? "" : "1" }
}

/** pin 弹窗：宽 340px、白底、12px 圆角、大投影、16px 内边距；
 *  头部（标题 + 类型标签 + ×）+ 每对 solution 的「问题描述」「修改建议」（绿线）按序展示 */
export function AssessmentPinPopup(props: {
  item: AssessmentReviewItem
  anchorRect: Rect | null
  onClose: () => void
}): JSX.Element {
  const POPUP_WIDTH = 340
  let popupRef: HTMLDivElement | undefined

  // 挂载后测量实际尺寸做右侧翻转与底部钳制（容器 = offsetParent）
  createEffect(() => {
    const el = popupRef
    const anchor = props.anchorRect
    if (!el || !anchor) return
    const parent = el.offsetParent as HTMLElement | null
    const parentW = parent?.clientWidth ?? window.innerWidth
    const parentH = parent?.clientHeight ?? window.innerHeight
    let left = anchor.left + anchor.width + 10
    if (left + el.offsetWidth > parentW - 8) {
      left = anchor.left - el.offsetWidth - 10
      if (left < 8) left = 8
    }
    let top = anchor.top
    if (top + el.offsetHeight > parentH - 8) {
      top = Math.max(8, parentH - el.offsetHeight - 8)
    }
    el.style.left = `${left}px`
    el.style.top = `${Math.max(8, top)}px`
  })

  return (
    <div ref={popupRef} class="od-assessment-popup" style={anchorStyle(props.anchorRect, POPUP_WIDTH)}>
      <div class="od-assessment-popup-header">
        <span class="od-assessment-popup-title" title={props.item.title}>{props.item.title}</span>
        <AssessmentTypeTag type={props.item.type} />
        <button type="button" class="od-assessment-popup-close" aria-label="关闭" onClick={props.onClose}>
          ×
        </button>
      </div>
      <For each={props.item.solution}>
        {(s) => (
          <>
            <div class="od-assessment-popup-section">
              <div class="od-assessment-popup-section-title">问题描述</div>
              <div class="od-assessment-popup-section-body">{s.desc}</div>
            </div>
            <div class="od-assessment-popup-section">
              <div class="od-assessment-popup-section-title">修改建议</div>
              <div class="od-assessment-popup-suggest">
                <div class="od-assessment-popup-suggest-line" />
                <div class="od-assessment-popup-section-body">{s.suggest}</div>
              </div>
            </div>
          </>
        )}
      </For>
    </div>
  )
}

/** 多值 pin 的第一步下拉：样式同评估下拉（一级、仅文字），
 *  选项 = 该元素对应的数据项「pin + 空格 + title」；位置同 pin 弹窗（顶部对齐 + 右侧 10px + 边界翻转） */
export function AssessmentPinDropdown(props: {
  items: AssessmentReviewItem[]
  indices: number[]
  anchorRect: Rect | null
  onSelect: (index: number) => void
  onClose: () => void
}): JSX.Element {
  let dropdownRef: HTMLDivElement | undefined

  createEffect(() => {
    const el = dropdownRef
    const anchor = props.anchorRect
    if (!el || !anchor) return
    const parent = el.offsetParent as HTMLElement | null
    const parentW = parent?.clientWidth ?? window.innerWidth
    const parentH = parent?.clientHeight ?? window.innerHeight
    let left = anchor.left + anchor.width + 10
    if (left + el.offsetWidth > parentW - 8) {
      left = anchor.left - el.offsetWidth - 10
      if (left < 8) left = 8
    }
    let top = anchor.top
    if (top + el.offsetHeight > parentH - 8) {
      top = Math.max(8, parentH - el.offsetHeight - 8)
    }
    el.style.left = `${left}px`
    el.style.top = `${Math.max(8, top)}px`
  })

  return (
    <div ref={dropdownRef} class="octo-assessment-menu od-assessment-pin-dropdown" style={anchorStyle(props.anchorRect, 200)}>
      <For each={props.indices}>
        {(idx) => (
          <Show when={props.items[idx]}>
            {(item) => (
              <button type="button" class="octo-assessment-item" onClick={() => props.onSelect(idx)}>
                <span class="octo-assessment-item-text">{item().pin} {item().title}</span>
              </button>
            )}
          </Show>
        )}
      </For>
    </div>
  )
}
