import { createSignal, createEffect, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import type { AssetConfig, AssetState, ModelEditElement } from "./types"
import type { AssetFile } from "../addon-menu/asset-library"
import { assetFileId } from "../addon-menu/asset-library"
import { AssetDialog } from "../addon-menu/asset-dialog"
import type { MentionSelection } from "../mention-popover"
import { sendTextToAgent } from "../../utils/agent-events"

export function AssetModule(props: {
  assetConfig: AssetConfig
  dom: ModelEditElement | null
  filePath: string
  disabled: boolean
  onSubmitStart: () => void
  productId?: number
  onDownloadProductAsset?: (file: AssetFile, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<string>
}): JSX.Element {
  const [popupOpen, setPopupOpen] = createSignal(false)
  const [assetValue, setAssetValue] = createSignal<AssetState>({})
  const [selectedSelection, setSelectedSelection] = createSignal<MentionSelection | null>(null)

  createEffect(() => {
    if (props.dom && props.assetConfig.getInitialState) {
      setAssetValue(props.assetConfig.getInitialState(props.dom))
    }
    setSelectedSelection(null)
  })

  const handleConfirm = async (files: AssetFile[]) => {
    setPopupOpen(false)
    if (!files.length || !props.dom) return
    const file = files[0]
    const folderpath = await props.onDownloadProductAsset?.(file, () => {}, undefined)
    if (!folderpath) return
    const prompt = await props.assetConfig.onConfirm({
      dom: props.dom,
      filePath: props.filePath,
      folderpath,
      data: file,
    })
    if (prompt) {
      props.onSubmitStart()
      await sendTextToAgent(prompt, { source: 'asset-confirm' })
    }
  }

  const selections = (): MentionSelection[] => {
    const sel = selectedSelection()
    return sel ? [sel] : []
  }

  const onSelect = (sel: MentionSelection) => {
    setSelectedSelection(sel)
  }

  const onDeselect = () => {
    setSelectedSelection(null)
  }

  const handleCancel = () => {
    setSelectedSelection(null)
    setPopupOpen(false)
  }

  return (
    <>
      <div class="model-edit-group-title">产品资产库</div>
      <button type="button" disabled={props.disabled}
        onClick={() => setPopupOpen(true)}
        class="cc-row" style={{ width: '100%', height: '36px', border: '1px solid rgba(0,0,0,0.1)', 'border-radius': '8px', background: '#FFF', padding: '8px 12px', 'box-sizing': 'border-box', cursor: props.disabled ? 'wait' : 'pointer' }}>
        <span style={{ width: '16px', height: '16px', border: '1px solid #DFDFDF', background: 'white', 'border-radius': '3px', 'flex-shrink': '0' }} />
        <span class="flex-1 truncate text-[12px] text-slate-600">{assetValue().name || '未选择'}</span>
        <svg class="h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <Show when={popupOpen()}>
        <Portal>
          <AssetDialog
            open={true}
            productId={props.productId}
            selections={selections()}
            onSelect={onSelect}
            onDeselect={onDeselect}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        </Portal>
      </Show>
    </>
  )
}
