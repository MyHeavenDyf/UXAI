import { For, Show, createSignal, createMemo, createEffect, onCleanup } from "solid-js"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useLanguage } from "@/context/language"
import type { ArtifactCategory } from "../../utils/artifact-file-store"
import { IconTableEllipsis } from "../../icons/design-files-icons"

interface BreadcrumbProps {
  currentPath: string
  currentCategory: ArtifactCategory | null
  onNavigate: (path: string) => void
}

const CHEVRON_W = 20
const COLLAPSE_BTN_W = 24

export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const language = useLanguage()
  const segments = () => props.currentPath.split("/").filter(Boolean)
  const N = () => segments().length

  const [containerWidth, setContainerWidth] = createSignal(0)
  const [rootWidth, setRootWidth] = createSignal(0)
  const [segWidths, setSegWidths] = createSignal<number[]>([])
  const [collapseOpen, setCollapseOpen] = createSignal(false)

  let containerRef: HTMLDivElement | undefined
  let rootBtnRef: HTMLButtonElement | undefined
  let measureRef: HTMLDivElement | undefined

  createEffect(() => {
    if (!containerRef) return
    const el = containerRef
    const update = () => setContainerWidth(el.offsetWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })

  createEffect(() => {
    const _ = segments()
    if (rootBtnRef) setRootWidth(rootBtnRef.offsetWidth)
    if (!measureRef) return
    const widths = Array.from(measureRef.children).map((el) => (el as HTMLElement).offsetWidth)
    setSegWidths(widths)
  })

  const layout = createMemo(() => {
    const cw = containerWidth()
    const rw = rootWidth()
    const sws = segWidths()
    const n = N()

    if (cw <= 0 || rw <= 0 || sws.length !== n || n === 0) {
      return { mode: "all" as const, visibleCount: n, collapsedCount: 0 }
    }

    const allWidth = rw + n * CHEVRON_W + sws.reduce((a, b) => a + b, 0)
    if (allWidth <= cw || n <= 1) {
      return { mode: "all" as const, visibleCount: n, collapsedCount: 0 }
    }

    let bestK = 1
    for (let k = n - 1; k >= 1; k--) {
      const sumTail = sws.slice(n - k).reduce((a, b) => a + b, 0)
      const w = rw + (k + 1) * CHEVRON_W + COLLAPSE_BTN_W + sumTail
      if (w <= cw) {
        bestK = k
        break
      }
    }

    return { mode: "collapsed" as const, visibleCount: bestK, collapsedCount: n - bestK }
  })

  const visibleStart = createMemo(() => N() - layout().visibleCount)

  return (
    <div
      class="px-6 pt-6 shrink-0 relative"
      style={{ "margin-bottom": "16px", background: "var(--octo-surface-page)" }}
    >
      <Show when={N() > 0}>
        <div
          ref={measureRef}
          class="absolute flex items-center gap-1"
          style={{ left: "-9999px", top: "0", visibility: "hidden", "font-size": "14px", "line-height": "22px" }}
          aria-hidden="true"
        >
          <For each={segments()}>
            {(segment, index) => {
              const isLast = () => index() === N() - 1
              return (
                <Show when={!isLast()} fallback={<span class="font-medium">{segment}</span>}>
                  <button type="button" class="cursor-pointer" style={{ color: "rgba(0, 0, 0, 0.6)" }}>{segment}</button>
                </Show>
              )
            }}
          </For>
        </div>
      </Show>

      <div
        ref={containerRef}
        class="flex items-center gap-1"
        style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)" }}
      >
        <button
          ref={rootBtnRef}
          type="button"
          onClick={() => props.onNavigate("")}
          class="hover:text-text-interactive-base transition-colors cursor-pointer font-medium shrink-0"
          style={{ color: props.currentCategory ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.9)" }}
        >
          {language.t("designFiles.title")}
        </button>

        <Show when={layout().mode === "all" && N() > 0}>
          <For each={segments()}>
            {(segment, index) => {
              const isLast = () => index() === N() - 1
              const pathUpTo = () => segments().slice(0, index() + 1).join("/")
              return (
                <>
                  <Icon name="chevron-right" class="shrink-0" style={{ width: "16px", height: "16px", color: "var(--octo-text-secondary)" }} />
                  <Show when={!isLast()} fallback={<span class="font-medium shrink-0" style={{ color: "rgba(0, 0, 0, 0.9)" }}>{segment}</span>}>
                    <button
                      type="button"
                      onClick={() => props.onNavigate(pathUpTo())}
                      class="hover:text-text-interactive-base transition-colors cursor-pointer shrink-0"
                      style={{ color: "rgba(0, 0, 0, 0.6)" }}
                    >
                      {segment}
                    </button>
                  </Show>
                </>
              )
            }}
          </For>
        </Show>

        <Show when={layout().mode === "collapsed"}>
          <Icon name="chevron-right" class="shrink-0" style={{ width: "16px", height: "16px", color: "var(--octo-text-secondary)" }} />

          <Kobalte open={collapseOpen()} onOpenChange={setCollapseOpen} modal={false} placement="bottom-start" gutter={4}>
            <Kobalte.Trigger
              as="button"
              type="button"
              class="flex items-center justify-center rounded transition-colors hover:bg-[rgba(0,0,0,0.05)] cursor-pointer shrink-0"
              style={{ height: "22px", "min-width": "24px", color: "rgba(0, 0, 0, 0.6)" }}
            >
              <IconTableEllipsis size={16} />
            </Kobalte.Trigger>
            <Kobalte.Portal>
              <Kobalte.Content
                class="z-50 rounded-md p-1"
                style={{ "box-shadow": "0 4px 12px rgba(0,0,0,0.16)", "background-color": "#fff", "min-width": "120px" }}
              >
                <For each={segments().slice(0, visibleStart())}>
                  {(segment, index) => {
                    const pathUpTo = () => segments().slice(0, index() + 1).join("/")
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          props.onNavigate(pathUpTo())
                          setCollapseOpen(false)
                        }}
                        class="block w-full text-left px-3 py-1.5 rounded text-[14px] hover:bg-[rgba(0,0,0,0.05)] transition-colors"
                        style={{ color: "rgba(0, 0, 0, 0.9)" }}
                      >
                        {segment}
                      </button>
                    )
                  }}
                </For>
              </Kobalte.Content>
            </Kobalte.Portal>
          </Kobalte>

          <Icon name="chevron-right" class="shrink-0" style={{ width: "16px", height: "16px", color: "var(--octo-text-secondary)" }} />

          <For each={segments().slice(visibleStart())}>
            {(segment, index) => {
              const absoluteIndex = () => visibleStart() + index()
              const isLast = () => absoluteIndex() === N() - 1
              const pathUpTo = () => segments().slice(0, absoluteIndex() + 1).join("/")
              return (
                <>
                  <Show when={index() > 0}>
                    <Icon name="chevron-right" class="shrink-0" style={{ width: "16px", height: "16px", color: "var(--octo-text-secondary)" }} />
                  </Show>
                  <Show when={!isLast()} fallback={<span class="font-medium shrink-0" style={{ color: "rgba(0, 0, 0, 0.9)" }}>{segment}</span>}>
                    <button
                      type="button"
                      onClick={() => props.onNavigate(pathUpTo())}
                      class="hover:text-text-interactive-base transition-colors cursor-pointer shrink-0"
                      style={{ color: "rgba(0, 0, 0, 0.6)" }}
                    >
                      {segment}
                    </button>
                  </Show>
                </>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}
