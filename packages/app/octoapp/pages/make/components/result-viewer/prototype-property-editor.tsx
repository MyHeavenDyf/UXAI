import { createSignal, createMemo, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { PropertyEditorPopup } from "@/pages/pattern/modules/preview/property-editor-popup"
import type { ModifyElementData } from "@/pages/pattern/modules/preview/property-editor-popup/types"
import "@/pages/pattern/assets/style/preview/PropertyEditorPopup.css"
import { ModelEditAreaDialog } from "./model-edit-area-dialog"
import type { SkillConfig } from "../skill-config-types"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import {
  onPrototypeQuickFix,
  onPrototypeClosePanels,
  onPrototypeRectUpdate,
  closePrototypePanels,
  applyPrototypeModify,
  getSession,
  type PrototypeQuickFixData,
} from "../../utils/prototype-utils"

export function PrototypePropertyEditor(props: {
  sessionId?: string
  skillConfig?: SkillConfig
  artifactFiles?: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null
  productId?: number
  onDownloadProductAsset?: (file: import("../addon-menu/asset-library").AssetFile, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<string>
  onUpdateMentionPath?: (id: string, path: string) => void
}): JSX.Element {
  const [data, setData] = createSignal<PrototypeQuickFixData | null>(null)
  let lastData: PrototypeQuickFixData | null = null

  const closeUi = () => setData(null)
  const closeAll = () => {
    closeUi()
    closePrototypePanels()
  }

  // 已打开时换元素：先 null-toggle 触发 PropertyEditorPopup / ModelEditAreaDialog 重置，
  // 对齐 pattern 侧 openQuickModify 的 show:false → microtask → show:true。
  const unsubQuickFix = onPrototypeQuickFix((d) => {
    if (data()) {
      setData(null)
      queueMicrotask(() => {
        lastData = d
        setData(d)
      })
    } else {
      lastData = d
      setData(d)
    }
  })
  // 选中元素在编辑过程中尺寸/位置变化时，iframe ResizeObserver 经 message-handler
  // 派发 prototype:rect-update。按 elementId 匹配当前选中元素，更新 elementRect，
  // 让 ModelEditAreaDialog 的蒙层和弹窗跟随元素 resize。
  const unsubRectUpdate = onPrototypeRectUpdate((d) => {
    const cur = data() ?? lastData
    if (cur && cur.elementId === d.elementId) {
      const updated = { ...cur, elementRect: d.elementRect }
      lastData = updated
      if (data()) setData(updated)
    }
  })
  const unsubClose = onPrototypeClosePanels(() => closeUi())
  onCleanup(() => { unsubQuickFix(); unsubRectUpdate(); unsubClose() })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeAll()
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  const kind = () => (data() ?? lastData)?.kind ?? 'a2ui'
  const isHost = () => kind() === 'host'

  const hasRect = createMemo(() => {
    const r = (data() ?? lastData)?.elementRect
    return !!r && r.width > 0 && r.height > 0
  })

  // ModelEditAreaDialog 期望 { rect: {x,y,width,height}, selector }；
  // prototype 的 elementRect 是视口坐标（message-handler 已做 iframe→视口换算）。
  // fixedPosition 时 model-edit-area-dialog 的 elementPos 直接用视口坐标，无需 iframe 偏移。
  const elementForDialog = createMemo(() => {
    const d = data() ?? lastData
    if (!d) return null
    const r = d.elementRect
    return {
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      selector: isHost() ? (d.selector || d.elementId) : d.elementId,
    }
  })

  // promptCallback 构建 [选中A2UI元素: id] / [选中页面元素: selector] 前缀，
  // 替代旧 index.tsx onPrototypePickerSubmit/Append 里手拼的文本行。
  const promptCallback = (_filePath: string, selector: string) => {
    const tag = isHost() ? '选中页面元素' : '选中A2UI元素'
    return `[${tag}: ${selector}]`
  }

  return (
    <>
      <Show when={data()}>
        <div onClick={closeAll} style={{ position: "fixed", inset: "0", "z-index": "49", background: "transparent" }} />
      </Show>

      <PropertyEditorPopup
        show={!!data() && !isHost()}
        elementId={(data() ?? lastData)?.elementId ?? ''}
        componentType={(data() ?? lastData)?.componentType ?? ''}
        currentClass={(data() ?? lastData)?.currentClass ?? ''}
        elementProps={(data() ?? lastData)?.elementProps ?? ''}
        htmlFilePath={(data() ?? lastData)?.filePath}
        elementRect={(data() ?? lastData)?.elementRect ?? { top: 0, left: 0, width: 0, height: 0 }}
        containerSize={{ width: window.innerWidth, height: window.innerHeight }}
        onConfirm={(mod: ModifyElementData) => {
          applyPrototypeModify(mod)
          if (!mod.keepOpen) closeAll()
        }}
        onCancel={closeAll}
      />

      <Show when={data() && hasRect()}>
        <ModelEditAreaDialog
          element={elementForDialog()}
          filePath={(data() ?? lastData)?.filePath ?? ''}
          tabTitle={getSession()?.ctx?.tab?.title ?? ''}
          sessionId={props.sessionId}
          skillConfig={props.skillConfig}
          artifactFiles={props.artifactFiles}
          productId={props.productId}
          onDownloadProductAsset={props.onDownloadProductAsset}
          onUpdateMentionPath={props.onUpdateMentionPath}
          fixedPosition
          maskBorderColor={isHost() ? '#fa8c16' : '#007bff'}
          maskBgColor={isHost() ? 'rgba(250,140,22,0.12)' : 'rgba(0,123,255,0.1)'}
          promptCallback={promptCallback}
          onClose={closeAll}
          onSubmitStart={closeAll}
        />
      </Show>
    </>
  )
}
