import { createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { PlatformAssets } from "./platform-assets"
import { ProjectAssets } from "./project-assets"
import { SearchBox } from "./search-box"

type Scope = "platform" | "project"

const SCOPES: { key: Scope; label: string }[] = [
  { key: "platform", label: "平台资产" },
  { key: "project", label: "项目资产" },
]

export function AssetsContent(): JSX.Element {
  const [scope, setScope] = createSignal<Scope>("platform")

  return (
    <div class="h-full overflow-y-auto" style={{ background: "#f5f5f7" }}>
      <div
        class="flex items-center justify-between bg-white border-b"
        style={{ "border-color": "#e1e1e1", padding: "24px 24px 16px" }}
      >
        <div class="flex items-center text-sm" style={{ color: "#333" }}>
          <For each={SCOPES}>
            {(s) => {
              const isActive = () => scope() === s.key
              return (
                <button
                  type="button"
                  onClick={() => setScope(s.key)}
                  classList={{
                    "rounded-full": isActive()
                  }}
                  style={{
                    background: isActive() ? "#e6f0fa" : "transparent",
                    color: isActive() ? "#007bff" : "#333",
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
        <Show when={scope() === "project"}>
          <SearchBox />
        </Show>
      </div>

      <Show when={scope() === "platform"}>
        <PlatformAssets />
      </Show>
      <Show when={scope() === "project"}>
        <ProjectAssets />
      </Show>
    </div>
  )
}
