import { createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { PlatformAssets } from "./platform-assets"
import { ProjectAssets } from "./project-assets"

type Scope = "platform" | "project"

const SCOPES: { key: Scope; label: string }[] = [
  { key: "platform", label: "平台资产" },
  { key: "project", label: "产品资产" },
]

export function AssetsContent(): JSX.Element {
  const [scope, setScope] = createSignal<Scope>("platform")

  return (
    <div class="h-full flex flex-col" style={{ background: "var(--octo-surface-page, #ffffff)" }}>
      <div
        class="flex items-center justify-between border-b shrink-0"
        style={{ "border-color": "var(--octo-border-default, #E5E7EB)", padding: "24px 24px 16px" }}
      >
        <div class="flex items-center text-sm" style={{ color: "var(--octo-text-primary, #191919)" }}>
          <For each={SCOPES}>
            {(s) => {
              const isActive = () => scope() === s.key
              return (
                <button
                  type="button"
                  aria-pressed={isActive()}
                  onClick={() => setScope(s.key)}
                  classList={{
                    "rounded-full": isActive()
                  }}
                  style={{
                    background: isActive() ? "var(--octo-brand-subtle, #EFF6FF)" : "transparent",
                    color: isActive() ? "var(--octo-brand, #0a59f7)" : "var(--octo-text-primary, #191919)",
                    "font-weight": isActive() ? "600" : "400",
                    padding: "4px 12px",
                    height: "32px",
                    "margin-right": "16px",
                    "font-size": "14px",
                    "line-height": "22px",
                    "border-radius": "20px",
                    "box-sizing": "border-box",
                  }}
                >
                  {s.label}
                </button>
              )
            }}
          </For>
        </div>
      </div>
      <div class="flex-1 min-h-0">
        <Show when={scope() === "platform"}>
          <PlatformAssets />
        </Show>
        <Show when={scope() === "project"}>
          <ProjectAssets />
        </Show>
      </div>
    </div>
  )
}
