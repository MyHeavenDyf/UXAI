import { createSignal, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { PropertyEditorPopup } from "@/pages/pattern/modules/preview/property-editor-popup"
import type { ModifyElementData } from "@/pages/pattern/modules/preview/property-editor-popup/types"
import "@/pages/pattern/assets/style/preview/PropertyEditorPopup.css"
import {
  onPrototypeQuickFix,
  onPrototypeClosePanels,
  closePrototypePanels,
  applyPrototypeModify,
  type PrototypeQuickFixData,
} from "../../utils/prototype-utils"

export function PrototypePropertyEditor(): JSX.Element {
  const [data, setData] = createSignal<PrototypeQuickFixData | null>(null)
  const closeUi = () => setData(null)
  const closeAll = () => closePrototypePanels()

  const unsubQuickFix = onPrototypeQuickFix((d) => setData(d))
  const unsubClose = onPrototypeClosePanels(() => closeUi())
  onCleanup(() => { unsubQuickFix(); unsubClose() })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeAll()
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  return (
    <Show when={data()}>
      {(d) => (
        <PropertyEditorPopup
          show={true}
          elementId={d().elementId}
          componentType={d().componentType}
          currentClass={d().currentClass}
          elementProps={d().elementProps}
          htmlFilePath={d().filePath}
          elementRect={d().elementRect}
          containerSize={{ width: window.innerWidth, height: window.innerHeight }}
          onConfirm={(mod: ModifyElementData) => {
            applyPrototypeModify(mod)
            if (!mod.keepOpen) closeAll()
          }}
          onCancel={closeAll}
        />
      )}
    </Show>
  )
}
