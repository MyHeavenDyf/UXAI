// 虚拟化纯文本查看器:大 markdown(> MARKDOWN_LARGE_THRESHOLD)走这里 —— 只把可见行进 DOM,
// 5MB 毫秒级开、滚动瞬响。放弃富 markdown 渲染(表格/标题样式),换"大文件可读可滚可复制"。
// 与小文件路径(Vditor 富预览)按阈值分流,见 result-viewer/index.tsx TabContent 的 markdown 分支。
//
// 实现:固定行高 + 按滚动位置算可见窗口 [start,end),仅渲染窗口内行(absolute 定位)。
// 不换行(white-space: pre + 横向滚动)→ 每行等高,虚拟化简单可靠;长行横向滚,不折行。
// 固有取舍:read-only;跨滚动选中会丢(行回收)。这是 line-virtualization 的固有取舍,
// 想边滚边选中/编辑需上 CM6 这类按行视口的编辑器(后续 PoC)。
import { createMemo, createSignal, Index, onCleanup, onMount } from "solid-js"
import type { JSX } from "solid-js"

const LINE_HEIGHT = 20
const OVERSCAN = 8
// 等宽 13px 单字宽约 7.8px,用于估算横向滚动宽度(稳定 h-scrollbar,不随可见行宽度跳动)。
// 上限 2M px:防病态单行长文件(maxLen 极大)撑爆布局;正常 md 行宽远小于此。
const CHAR_WIDTH = 7.8
const MAX_SCROLL_WIDTH = 2_000_000

export function VirtualizedText(props: { content: string }): JSX.Element {
  // 一次性切行 + 量最长行(5MB split O(n),毫秒级)。行数组常驻内存(约文件大小 1.x 倍),可接受。
  const meta = createMemo(() => {
    const lines = (props.content ?? "").split("\n")
    let max = 0
    for (const l of lines) if (l.length > max) max = l.length
    return { lines, count: lines.length, maxLen: max }
  })

  let scrollRef: HTMLDivElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportH, setViewportH] = createSignal(0)

  // 视口高度随容器尺寸变(ResizeObserver),据此算可见行数;挂载取一次初值避免首帧渲染空。
  onMount(() => {
    if (!scrollRef) return
    setViewportH(scrollRef.clientHeight)
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height
      if (h && h !== viewportH()) setViewportH(h)
    })
    ro.observe(scrollRef)
    onCleanup(() => ro.disconnect())
  })

  const start = () => Math.max(0, Math.floor(scrollTop() / LINE_HEIGHT) - OVERSCAN)
  const end = () => Math.min(meta().count, start() + Math.ceil(viewportH() / LINE_HEIGHT) + OVERSCAN * 2)
  // 固定窗口(Index 按位置复用 DOM,滚动时原地更新 top/text,不重挂载)。
  const win = createMemo(() => {
    const s = start(), e = end()
    const arr: number[] = []
    for (let i = s; i < e; i++) arr.push(i)
    return arr
  })

  const scrollWidth = () => Math.min(meta().maxLen * CHAR_WIDTH, MAX_SCROLL_WIDTH)

  return (
    <div class="h-full flex flex-col">
      <div
        class="shrink-0 px-4 py-2 text-xs"
        style={{ color: "var(--octo-text-secondary)", background: "var(--octo-surface-hover)", "border-bottom": "1px solid var(--octo-border-divider)" }}
      >
        文件较大，以纯文本视图展示（富渲染已关闭）
      </div>
      <div
        ref={scrollRef}
        class="flex-1 min-h-0 overflow-auto font-mono"
        style={{ "font-size": "13px", "line-height": `${LINE_HEIGHT}px`, color: "var(--octo-text-primary)" }}
        onScroll={() => scrollRef && setScrollTop(scrollRef.scrollTop)}
      >
        <div style={{ position: "relative", height: `${meta().count * LINE_HEIGHT}px`, "min-width": `${scrollWidth()}px` }}>
          <Index each={win()}>
            {(lineNumber) => (
              <div
                style={{ position: "absolute", top: `${lineNumber() * LINE_HEIGHT}px`, left: 0, height: `${LINE_HEIGHT}px`, "white-space": "pre" }}
              >
                {meta().lines[lineNumber()] ?? ""}
              </div>
            )}
          </Index>
        </div>
      </div>
    </div>
  )
}
