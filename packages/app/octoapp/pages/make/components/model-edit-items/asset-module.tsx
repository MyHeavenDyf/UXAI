import { createSignal, createEffect, Show, For, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import type { AssetConfig, AssetState, ModelEditElement } from "./types"
import {
  fetchTeamTree,
  fetchAssetFiles,
  encodeAssetUrl,
  joinUrl,
  assetFileId,
  type AssetFolder,
  type AssetFile,
} from "../addon-menu/asset-library"
import { FolderIcon } from "../addon-menu/icons"
import { sendTextToAgent } from "../../utils/agent-events"
import "./asset-module.css"

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

  createEffect(() => {
    if (props.dom && props.assetConfig.getInitialState) {
      setAssetValue(props.assetConfig.getInitialState(props.dom))
    }
  })

  const handleConfirm = async (file: AssetFile) => {
    setPopupOpen(false)
    if (!props.dom) return
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
        <AssetDialog
          productId={props.productId}
          onConfirm={handleConfirm}
          onCancel={() => setPopupOpen(false)}
        />
      </Show>
    </>
  )
}

function AssetDialog(props: {
  productId?: number
  onConfirm: (file: AssetFile) => void
  onCancel: () => void
}): JSX.Element {
  const [tree, setTree] = createSignal<AssetFolder[]>([])
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null)
  const [files, setFiles] = createSignal<AssetFile[]>([])
  const [treeLoading, setTreeLoading] = createSignal(false)
  const [filesLoading, setFilesLoading] = createSignal(false)
  const [treeError, setTreeError] = createSignal<string | null>(null)
  const [dialogPos, setDialogPos] = createSignal<{ left: number; top: number } | null>(null)
  const [leftWidth, setLeftWidth] = createSignal(200)
  const [rightWidth, setRightWidth] = createSignal(400)
  const [selectedFile, setSelectedFile] = createSignal<AssetFile | null>(null)
  const [previewFile, setPreviewFile] = createSignal<AssetFile | null>(null)
  const [previewPos, setPreviewPos] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 })
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  let dialogRef: HTMLDivElement | undefined
  let middleRef: HTMLDivElement | undefined

  createEffect(() => {
    setTreeLoading(true)
    setTreeError(null)
    setTree([])
    setExpanded(new Set<string>())
    setSelectedKey(null)
    setFiles([])
    setDialogPos(null)
    setLeftWidth(200)
    setRightWidth(400)
    setSelectedFile(null)
    fetchTeamTree(props.productId)
      .then((folders) => {
        setTree(folders)
        const first = folders[0]
        if (first) {
          const key = `${first.id}`
          setSelectedKey(key)
          setExpanded(prev => new Set(prev).add(key))
        }
      })
      .catch((err) => setTreeError(err instanceof Error ? err.message : String(err)))
      .finally(() => setTreeLoading(false))
    requestAnimationFrame(() => {
      if (!dialogRef) return
      const rect = dialogRef.getBoundingClientRect()
      setDialogPos({ left: rect.left, top: rect.top })
    })
  })

  const findFolderByKey = (folders: AssetFolder[], key: string): AssetFolder | undefined => {
    const segments = key.split("/")
    let current: AssetFolder | undefined
    let list = folders
    for (const seg of segments) {
      current = list.find(f => `${f.id}` === seg)
      if (!current) return undefined
      list = current.children ?? []
    }
    return current
  }

  const loadFiles = (key: string) => {
    const folder = findFolderByKey(tree(), key)
    if (!folder) return
    setFilesLoading(true)
    setFiles([])
    fetchAssetFiles(folder.id)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false))
  }

  createEffect(() => {
    const key = selectedKey()
    if (key && tree().length > 0) loadFiles(key)
  })

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const isFileSelected = (file: AssetFile) => {
    const sel = selectedFile()
    return sel ? assetFileId(sel) === assetFileId(file) : false
  }

  const selectFile = (file: AssetFile) => {
    setSelectedFile(prev => prev && assetFileId(prev) === assetFileId(file) ? null : file)
  }

  const onTitleMouseDown = (e: MouseEvent) => {
    if (!dialogRef) return
    e.preventDefault()
    const rect = dialogRef.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    setDialogPos({ left: rect.left, top: rect.top })
    const onMove = (ev: MouseEvent) => {
      setDialogPos({ left: Math.max(0, ev.clientX - offsetX), top: Math.max(0, ev.clientY - offsetY) })
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const startLeftDrag = (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftWidth()
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(200, Math.min(400, startW + ev.clientX - startX))
      setLeftWidth(w)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const startRightDrag = (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightWidth()
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(190, Math.min(790, startW - (ev.clientX - startX)))
      setRightWidth(w)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const handleStageEnter = (e: MouseEvent, file: AssetFile) => {
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    if (previewTimer) clearTimeout(previewTimer)
    const stageRight = rect.right
    const panelW = 256
    const fitsRight = stageRight + 8 + panelW <= window.innerWidth
    setPreviewPos({
      left: fitsRight ? stageRight + 8 : rect.left - panelW - 8,
      top: rect.top,
    })
    previewTimer = setTimeout(() => setPreviewFile(file), 100)
  }

  const handleStageLeave = () => {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = undefined }
    previewTimer = setTimeout(() => setPreviewFile(null), 100)
  }

  onCleanup(() => { if (previewTimer) clearTimeout(previewTimer) })

  const width = () => leftWidth() + rightWidth() + 20 + 48
  const dialogStyle = (): JSX.CSSProperties => {
    const w = { width: `${width()}px` }
    if (dialogPos()) return { ...w, left: `${dialogPos()!.left}px`, top: `${dialogPos()!.top}px` }
    return { ...w, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
  }

  return (
    <Portal>
      <div class="asset-dialog-overlay" onClick={props.onCancel}>
        <div
          ref={dialogRef}
          class="asset-dialog"
          style={dialogStyle()}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="asset-dialog-title" onMouseDown={onTitleMouseDown}>
            <span class="asset-dialog-title-text">产品资产库</span>
            <button type="button" class="asset-dialog-close" onClick={props.onCancel} aria-label="关闭">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <div class="asset-dialog-middle" ref={middleRef}>
            <div class="asset-dialog-left" style={{ width: `${leftWidth()}px`, flex: '1 1 auto', "min-height": "0" }}>
              <Show when={treeLoading()}><div class="asset-dialog-empty">加载中...</div></Show>
              <Show when={treeError()}><div class="asset-dialog-empty">{treeError()}</div></Show>
              <Show when={!treeLoading() && !treeError()}>
                <For each={tree()}>
                  {(folder) => <TreeItem folder={folder} depth={0} parentKey="" />}
                </For>
              </Show>
            </div>

            <div class="asset-dialog-split" onMouseDown={startLeftDrag} />

            <div class="asset-dialog-right" style={{ width: `${rightWidth()}px`, flex: '1 1 auto', "min-height": "0" }}>
              <Show when={filesLoading()}><div class="asset-dialog-empty">加载中...</div></Show>
              <Show when={!filesLoading() && files().length === 0}><div class="asset-dialog-empty">暂无内容</div></Show>
              <div class="asset-dialog-grid">
                <For each={files()}>
                  {(file) => {
                    const selected = () => isFileSelected(file)
                    return (
                      <div class="asset-grid-item" onClick={() => selectFile(file)}>
                        <div
                          class="asset-grid-stage"
                          onMouseEnter={(e) => handleStageEnter(e, file)}
                          onMouseLeave={handleStageLeave}
                        >
                          <Show when={file.snapshot}>
                            <img
                              class="asset-grid-thumb"
                              src={encodeAssetUrl(joinUrl(file.s3BaseUrl, file.snapshot))}
                              alt=""
                              draggable={false}
                            />
                          </Show>
                          <div class={`asset-grid-radio ${selected() ? "asset-grid-radio--checked" : ""}`}>
                            <Show when={selected()}>
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                                <path d="M3 8l3.5 3.5L13 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                              </svg>
                            </Show>
                          </div>
                        </div>
                        <div class="asset-grid-name" title={file.fileName}>{file.fileName}</div>
                      </div>
                    )
                  }}
                </For>
              </div>
            </div>
          </div>

          <div class="asset-dialog-footer">
            <button type="button" class="asset-dialog-btn" onClick={props.onCancel}>取消</button>
            <button
              type="button"
              class="asset-dialog-btn asset-dialog-btn-primary"
              disabled={!selectedFile()}
              onClick={() => { const f = selectedFile(); if (f) props.onConfirm(f) }}
            >确认</button>
          </div>

          <div class="asset-dialog-right-handle" onMouseDown={startRightDrag} />

          <Show when={previewFile()}>
            <div
              class="asset-dialog-preview"
              style={{ left: `${previewPos().left}px`, top: `${previewPos().top}px` }}
              onMouseEnter={() => { if (previewTimer) { clearTimeout(previewTimer); previewTimer = undefined } }}
              onMouseLeave={() => setPreviewFile(null)}
            >
              <div class="asset-dialog-preview-name">{previewFile()!.fileName}</div>
              <div class="asset-dialog-preview-stage">
                <Show
                  when={previewFile()!.snapshot}
                  fallback={<span style={{ "font-size": "14px", color: "#777" }}>无预览</span>}
                >
                  <img
                    class="asset-dialog-preview-img"
                    src={encodeAssetUrl(joinUrl(previewFile()!.s3BaseUrl, previewFile()!.snapshot))}
                    alt=""
                    draggable={false}
                  />
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  )

  function TreeItem(props: { folder: AssetFolder; depth: number; parentKey: string }): JSX.Element {
    const nodeKey = () => props.parentKey ? `${props.parentKey}/${props.folder.id}` : `${props.folder.id}`
    const hasChildren = () => (props.folder.children ?? []).length > 0
    const isExpanded = () => expanded().has(nodeKey())
    const isSelected = () => selectedKey() === nodeKey()
    return (
      <>
        <div
          class={`asset-tree-item ${isSelected() ? "asset-tree-item--active" : ""}`}
          style={{ "padding-left": `${8 + props.depth * 8}px` }}
          onClick={() => {
            setSelectedKey(nodeKey())
            if (hasChildren()) toggleExpand(nodeKey())
          }}
        >
          <FolderIcon class="asset-tree-icon" />
          <span style={{ flex: '1 1 0', "min-width": "0", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>{props.folder.name}</span>
          <Show when={hasChildren()}>
            <svg
              width="12" height="12" viewBox="0 0 8 8" fill="none"
              class="asset-tree-arrow"
              style={isExpanded() ? { transform: "rotate(90deg)" } : undefined}
            >
              <path d="M2 1L5.5 4L2 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </Show>
        </div>
        <Show when={hasChildren() && isExpanded()}>
          <For each={props.folder.children ?? []}>
            {(child) => <TreeItem folder={child} depth={props.depth + 1} parentKey={nodeKey()} />}
          </For>
        </Show>
      </>
    )
  }
}
