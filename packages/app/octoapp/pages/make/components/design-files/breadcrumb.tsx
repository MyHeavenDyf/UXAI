import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { ArtifactCategory } from "../../utils/artifact-file-store"

interface BreadcrumbProps {
  currentPath: string
  currentCategory: ArtifactCategory | null
  onNavigate: (path: string) => void
}

export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
  const language = useLanguage()
  const segments = () => props.currentPath.split("/").filter(Boolean)

  return (
    <div
      class="flex items-center gap-1 px-6 pt-6 shrink-0" style={{ "font-size": "14px", "line-height": "22px", color: "rgba(0, 0, 0, 0.9)", "margin-bottom": "16px", background: "var(--octo-surface-page)" }}
    >
      <button
        type="button"
        onClick={() => props.onNavigate("")}
        class="hover:text-text-interactive-base transition-colors cursor-pointer font-medium"
        style={{ color: props.currentCategory ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.9)" }}
      >
        {language.t("designFiles.title")}
      </button>

      <For each={segments()}>
        {(segment, index) => {
          const isLast = () => index() === segments().length - 1
          const pathUpTo = () => segments().slice(0, index() + 1).join("/")

          return (
            <>
              <Icon name="chevron-right" style={{ width: "16px", height: "16px", color: "var(--octo-text-secondary)" }} />
              <Show when={!isLast()} fallback={<span class="font-medium" style={{ color: "rgba(0, 0, 0, 0.9)" }}>{segment}</span>}>
                <button
                  type="button"
                  onClick={() => props.onNavigate(pathUpTo())}
                  class="hover:text-text-interactive-base transition-colors cursor-pointer"
                  style={{ color: "rgba(0, 0, 0, 0.6)" }}
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