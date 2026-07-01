import { createResource, Show, For } from "solid-js"
import type { JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"

interface Props {
  filePath: string
  refreshKey: number
}

export function TextRenderer(props: Props): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()

  const [content] = createResource(
    () => ({ path: props.filePath, url: globalSDK.url, dir: sdk.directory, key: props.refreshKey }),
    async ({ path, url, dir }) => {
      const resp = await fetch(`${url}/artifact/content?path=${encodeURIComponent(path)}`, {
        headers: { "x-opencode-directory": dir || "" },
      })
      if (!resp.ok) throw new Error("Failed to load")
      const data = await resp.json()
      return data.content as string
    }
  )

  const lines = () => content()?.split("\n") ?? []

  return (
    <div class="h-full overflow-auto" style={{ background: "var(--octo-surface-base)" }}>
      <Show when={content.loading}>
        <div class="p-4 text-[12px]" style={{ color: "var(--octo-text-secondary)" }}>
          Loading...
        </div>
      </Show>
      <Show when={content.error}>
        <div class="p-4 text-[12px]" style={{ color: "var(--octo-text-error)" }}>
          Failed to load
        </div>
      </Show>
      <Show when={!content.loading && content()}>
        <pre class="grid grid-cols-[auto_1fr] m-0">
          <div
            class="p-2 px-3 text-right"
            style={{
              color: "var(--octo-text-secondary)",
              "user-select": "none",
              "border-right": "1px solid var(--octo-border-divider)",
              background: "var(--octo-surface-page)",
            }}
          >
            <For each={lines()}>
              {(_, i) => <div>{i() + 1}</div>}
            </For>
          </div>
          <code class="p-2 px-3 whitespace-pre overflow-auto">
            {content()}
          </code>
        </pre>
      </Show>
    </div>
  )
}