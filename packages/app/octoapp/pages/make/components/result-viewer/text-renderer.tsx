import { createResource, Show, For } from "solid-js"
import type { JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSDK } from "@/context/sdk"
import { directoryHeader } from "@/utils/headers"
import { getDesktopApi } from "../../lib/electron-api"
import { highlightCode, getLanguageFromFilename } from "../../utils/code-highlight"

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
      try {
        const resp = await fetch(`${url}/artifact/content?path=${encodeURIComponent(path)}`, {
          headers: { ...directoryHeader(dir || "") },
        })
        if (resp.ok) {
          const data = await resp.json()
          if (typeof data.content === "string" && data.content) return data.content
        }
      } catch {
        /* fall through to desktop file read */
      }
      // HTTP 失败时(文件在项目目录外,服务端 File.read access-denied → 500)走
      // Electron IPC 读盘兜底(无项目目录限制),镜像 html-renderer 的 diskContent 模式
      const buf = await getDesktopApi()?.readFileBuffer?.(path)
      if (buf) return new TextDecoder().decode(buf)
      throw new Error("Failed to load")
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
      <Show when={!content.loading && !content.error && content()}>
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
          <code
            class="p-2 px-3 whitespace-pre overflow-auto"
            innerHTML={highlightCode(content() ?? "", getLanguageFromFilename(props.filePath))}
          />
        </pre>
      </Show>
    </div>
  )
}