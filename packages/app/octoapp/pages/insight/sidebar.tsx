import { createSignal, Show, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { InsightSessionList } from "./components/session-list"

/**
 * InsightSidebar —— insight 自带的左侧会话栏(SPEC-INS-010 §11:废弃 _shell 后侧栏归 insight)
 *
 * 自包含:宽度/拖拽/持久化 + 会话列表全在内部,对外零必填参数。insight/index.tsx 直接渲染。
 * 宿主(UXAI 等)挂 insight 时,topbar 在它之上,本组件就是 topbar 以下的左栏。
 *
 * 两个槽(props,默认空)留给宿主注入产品级 chrome:
 *   - top    顶部项目/产品切换器(D5,UXAI 抽共享组件后注入)
 *   - bottom 底部 技能库/资产库/设置(D7,同上)
 * octo-agent 本地不传 → 空着即可。
 */
const WIDTH_KEY = "octo:insight:sidebar-width"

const MIN_W = 200
const MAX_W = 420
function initialWidth(): number {
  const stored = localStorage.getItem(WIDTH_KEY)
  if (stored) {
    const n = parseInt(stored, 10)
    if (!isNaN(n) && n >= MIN_W && n <= MAX_W) return n
  }
  return 296
}

function ChevronIcon(props: { collapsed: boolean }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none"
      style={{
        transform: props.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
        "flex-shrink": "0",
      }}
    >
      <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgba(0,0,0,0.6)"/>
    </svg>
  )
}

export function InsightSidebar(props: { top?: JSX.Element; bottom?: JSX.Element }): JSX.Element {
  const [width, setWidth] = createSignal(initialWidth())
  const [collapsed, setCollapsed] = createSignal(false)
  const navigate = useNavigate()

  function handleResize(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = width()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const onMove = (ev: MouseEvent) => setWidth(Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX)))
    const onUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      localStorage.setItem(WIDTH_KEY, String(width()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div
      class="shrink-0 relative flex flex-col h-full overflow-hidden"
      style={{
        width: `${width()}px`,
        background: "linear-gradient(166deg, #ffffff 0%, #fdfeff 48%, #e9f5ff 99%)",
        "border-right": "1px solid var(--octo-border-default, #E5E7EB)",
      }}
    >
      {/* 顶部槽:项目/产品切换器(D5) */}
      <Show when={props.top}>
        <div class="shrink-0 flex flex-col px-[12px] pt-[12px]">{props.top}</div>
      </Show>

      {/* 新建按钮 + 分隔线 — 固定不滚动 */}
      <div class="shrink-0 px-[12px]" style={{ "padding-top": props.top ? "0" : "12px" }}>
        <button
          type="button"
          class="flex items-center gap-3 w-full mb-[8px] rounded-lg text-left transition-colors hover:bg-[rgba(25,25,25,0.06)]"
          style={{ height: "36px", padding: "0 12px", color: "#191919", "font-size": "12px", "line-height": "20px" }}
          onClick={() => navigate("/insight")}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="shrink-0">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <span>新建</span>
        </button>
        <div style={{ height: "1px", background: "rgba(0,0,0,0.1)", margin: "0 0 6px" }} />
      </div>

      {/* Octo Insight 段标题 — 固定不滚动 */}
      <div class="shrink-0 px-[12px]">
        <div class="flex items-center h-[36px] px-[12px]">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            class="flex items-center justify-between flex-1 min-w-0 text-left select-none"
          >
            <span class="flex items-center gap-[12px] min-w-0">
              <img src="/insightIcon.svg" alt="" style={{ width: "20px", height: "20px" }} />
              <span class="text-[12px] leading-[20px] select-none truncate" style={{ color: "rgba(0,0,0,0.9)", "font-weight": 700 }}>
                Octo Insight
              </span>
            </span>
            <ChevronIcon collapsed={collapsed()} />
          </button>
        </div>
      </div>

      {/* 会话列表 — 仅此区域可滚动;收起时容器保留占位,底部槽不上移 */}
      <div data-slot="list-scroll" class="flex-1 min-h-0 overflow-y-auto px-[12px]">
        <Show when={!collapsed()}>
          <InsightSessionList />
        </Show>
      </div>

      {/* 底部槽:技能库/资产库/设置(D7) */}
      {props.bottom}

      {/* 拖拽手柄 */}
      <div
        class="absolute top-0 bottom-0"
        style={{ right: "-3px", width: "6px", cursor: "col-resize", "z-index": "10" }}
        onMouseDown={handleResize}
      />
    </div>
  )
}
