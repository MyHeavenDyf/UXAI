import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

interface BreadcrumbProps {
  currentPath: string
  onNavigate: (path: string) => void
}

export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const segments = () => props.currentPath.split("/").filter(Boolean)

  return (
    <div
      class="flex items-center gap-1 px-4 py-2 text-[12px] shrink-0"
      style={{
        background: "var(--octo-surface-page)",
        "border-bottom": "1px solid var(--octo-border-divider)",
      }}
    >
      <button
        type="button"
        onClick={() => props.onNavigate("")}
        classList={{
          "hover:text-text-interactive-base transition-colors cursor-pointer": true,
          "text-text-secondary": props.currentPath !== "",
          "text-text-base font-medium": props.currentPath === "",
        }}
      >
        项目文件
      </button>

      <For each={segments()}>
        {(segment, index) => {
          const isLast = () => index() === segments().length - 1
          const pathUpTo = () => segments().slice(0, index() + 1).join("/")

          return (
            <>
              <Icon name="chevron-right" size="small" style={{ color: "var(--octo-text-secondary)" }} />
              <Show when={!isLast()} fallback={<span class="font-medium">{segment}</span>}>
                <button
                  type="button"
                  onClick={() => props.onNavigate(pathUpTo())}
                  class="text-text-secondary hover:text-text-interactive-base transition-colors cursor-pointer"
                >
                  {segment}
                </button>
              </Show>
            </>
          )
        }}
      </For>
    </div>
  )
}