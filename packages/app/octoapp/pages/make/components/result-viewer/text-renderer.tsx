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

// 与 make/index.tsx 的 MAX_LOCAL_PREVIEW_BYTES 同值:超过此规模不做文本预览。
const MAX_PREVIEW_BYTES = 1024 * 1024

export function TextRenderer(props: Props): JSX.Element {
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()

  const [content] = createResource(
    () => ({ path: props.filePath, url: globalSDK.url, dir: sdk.directory, key: props.refreshKey }),
    async ({ path, url, dir }): Promise<string | null> => {
      try {
        const resp = await fetch(`${url}/artifact/content?path=${encodeURIComponent(path)}`, {
          headers: { ...directoryHeader(dir || "") },
        })
        if (resp.ok) {
          const data = await resp.json()
          // 二进制文件:服务端返回 base64 + encoding 标记,不当文本渲染
          if (data.encoding === "base64") return null
          if (typeof data.content === "string" && data.content) {
            return data.content.length > MAX_PREVIEW_BYTES ? null : data.content
          }
        }
      } catch {
        /* fall through to desktop file read */
      }
      // HTTP 失败时(文件在项目目录外,服务端 File.read access-denied → 500)走
      // Electron IPC 读盘兜底(无项目目录限制),镜像 html-renderer 的 diskContent 模式
      const buf = await getDesktopApi()?.readFileBuffer?.(path)
      if (!buf) throw new Error("Failed to load")
      if (buf.byteLength > MAX_PREVIEW_BYTES) return null
      return new TextDecoder().decode(buf)
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
      <Show when={!content.loading && !content.error && content() === null}>
        <div class="flex items-center justify-center h-full">
          <span style={{ color: "var(--octo-text-secondary)", "font-size": "14px" }}>
            此文件为二进制或过大，不支持预览
          </span>
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