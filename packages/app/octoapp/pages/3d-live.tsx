/**
 * /3d-live —— 实时预览独立页(全屏,用 SceneCanvas 渲染 live-data.json)。
 *
 * 由 handleLivePreview 触发:先 writeLiveData 把当前场景写到 preview3d/live-data.json,
 * 再 window.open("/3d-live") 打开本页。本页从 preview-server(51857) fetch live-data.json,
 * 交给 SceneCanvas 渲染(支持 component/风车等全功能,与页内右侧一致)。
 */
import { createResource, Show, type JSX } from "solid-js"
import { SceneCanvas } from "@/pages/3d/modules/preview/SceneCanvas"
import type { SceneDocument } from "@/pages/3d/utils/scene-protocol"

const LIVE_DATA_URL = "http://127.0.0.1:51857/live-data.json"

export default function ThreeDLivePage(): JSX.Element {
  const [doc] = createResource(async (): Promise<SceneDocument | null> => {
    try {
      const res = await fetch(LIVE_DATA_URL)
      if (!res.ok) throw new Error(`${res.status}`)
      return (await res.json()) as SceneDocument
    } catch (err) {
      console.error("[3d-live] 加载 live-data.json 失败:", err)
      return null
    }
  })

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#ffffff", overflow: "hidden" }}>
      <Show
        when={doc() ?? null}
        fallback={
          <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "100%", color: "rgba(0,0,0,0.4)", "font-size": "13px" }}>
            加载中…
          </div>
        }
      >
        {(d) => <SceneCanvas doc={d()} />}
      </Show>
    </div>
  )
}
