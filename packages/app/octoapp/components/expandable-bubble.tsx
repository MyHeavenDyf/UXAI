import { createSignal, onMount, onCleanup, Show, type JSX, type ParentProps } from "solid-js"

const MAX_CONTENT_HEIGHT = 222
const MASK_HEIGHT = 60

function ChevronDownIcon(props: { size?: number }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      width={props.size ?? 16}
      height={props.size ?? 16}
      fill="none"
      style={{ "flex-shrink": "0" }}
    >
      <path
        d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z"
        fill="rgba(0,0,0,0.6)"
      />
    </svg>
  )
}

const DEFAULT_GRADIENT =
  "linear-gradient(0deg, rgba(236,242,255,1) 50.226%, rgba(236,242,255,0.9) 70.355%, rgba(236,242,255,0) 100%)"

export function ExpandableBubble(
  props: ParentProps<{
    maskGradient?: string
    class?: string
    style?: JSX.CSSProperties
  }>,
): JSX.Element {
  const maskGradient = () => props.maskGradient ?? DEFAULT_GRADIENT
  const [expanded, setExpanded] = createSignal(false)
  const [needsExpand, setNeedsExpand] = createSignal(false)
  let contentRef: HTMLDivElement | undefined

  function checkHeight() {
    if (!contentRef) return
    setNeedsExpand(contentRef.scrollHeight > MAX_CONTENT_HEIGHT + 4)
  }

  onMount(() => {
    checkHeight()
    if (contentRef) {
      const observer = new ResizeObserver(() => checkHeight())
      observer.observe(contentRef)
      onCleanup(() => observer.disconnect())
    }
  })

  const collapsed = () => needsExpand() && !expanded()

  return (
    <div
      class={props.class}
      style={{
        ...props.style,
        position: "relative",
        overflow: "hidden",
        "padding-bottom": expanded() && needsExpand() ? "38px" : props.style?.["padding-bottom"] ?? undefined,
      }}
    >
      <div
        ref={contentRef}
        style={{
          "max-height": collapsed() ? `${MAX_CONTENT_HEIGHT}px` : "none",
          overflow: collapsed() ? "hidden" : "visible",
        }}
      >
        {props.children}
      </div>

      <Show when={collapsed()}>
        <div
          style={{
            position: "absolute",
            bottom: "0",
            left: "0",
            right: "0",
            height: `${MASK_HEIGHT}px`,
            background: maskGradient(),
            "pointer-events": "none",
          }}
        />
      </Show>

      <Show when={needsExpand()}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          style={{
            position: "absolute",
            bottom: "12px",
            right: "16px",
            display: "inline-flex",
            "align-items": "center",
            gap: "4px",
            padding: "0",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "rgba(0,0,0,0.6)",
            "font-size": "14px",
            "line-height": "22px",
            "z-index": "1",
          }}
        >
          <span>{expanded() ? "收起" : "展开"}</span>
          <span
            style={{
              display: "inline-flex",
              "align-items": "center",
              transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
              transform: expanded() ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <ChevronDownIcon size={16} />
          </span>
        </button>
      </Show>
    </div>
  )
}
