import { createSignal, createEffect, For, Show, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { tracker } from "@/utils/tracker"
import type { MentionSelection } from "../mention-popover"
import {
  fetchTeamTree,
  fetchAssetFiles,
  encodeAssetUrl,
  joinUrl,
  assetFileId,
  type AssetFolder,
  type AssetFile,
} from "./asset-library"
import { FolderIcon } from "./icons"

interface AssetDialogProps {
  open: boolean
  productId?: number
  selections: MentionSelection[]
  onSelect: (selection: MentionSelection) => void
  onDeselect: (selection: MentionSelection) => void
  /** 确认:父组件执行"关闭弹窗 + 批量下载选中文件" */
  onConfirm: (selectedFiles: AssetFile[]) => void
  /** 取消/关闭:父组件移除本次新增 chip 并关闭弹窗 */
  onCancel: () => void
}

export function AssetDialog(props: AssetDialogProps): JSX.Element {
  const [tree, setTree] = createSignal<AssetFolder[]>([])
  // 树节点用「根到节点的 id 路径」作 key:mock 数据存在父子 id 重复(如 312220),
  // 裸 id 会让父子节点同时命中选中/展开状态
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null)
  const [files, setFiles] = createSignal<AssetFile[]>([])
  const [treeLoading, setTreeLoading] = createSignal(false)
  const [filesLoading, setFilesLoading] = createSignal(false)
  const [treeError, setTreeError] = createSignal<string | null>(null)

  // 弹窗位置(标题栏拖动,不持久化)
  const [dialogPos, setDialogPos] = createSignal<{ left: number; top: number } | null>(null)
  // 左侧宽度 200-400 / 右侧宽度 190-790(拖拽,不持久化)
  const [leftWidth, setLeftWidth] = createSignal(200)
  const [rightWidth, setRightWidth] = createSignal(390)

  // hover 预览(预览窗左上角对展示区右上角)
  const [previewFile, setPreviewFile] = createSignal<AssetFile | null>(null)
  const [previewPos, setPreviewPos] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 })
  let previewTimer: ReturnType<typeof setTimeout> | undefined

  let dialogRef: HTMLDivElement | undefined
  let middleRef: HTMLDivElement | undefined

  // 打开时加载文件夹树,默认选中并展开第一个根文件夹
  createEffect(() => {
    if (!props.open) return
    setTreeLoading(true)
    setTreeError(null)
    setTree([])
    setExpanded(new Set<string>())
    setSelectedKey(null)
    setFiles([])
    setDialogPos(null)
    setLeftWidth(200)
    setRightWidth(390)
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
    // 首帧 transform 居中后,固定为像素定位:后续拖拽改宽度时左缘/上缘不动(不保持居中)
    requestAnimationFrame(() => {
      if (!dialogRef) return
      const rect = dialogRef.getBoundingClientRect()
      setDialogPos({ left: rect.left, top: rect.top })
    })
  })

  // 按路径 key 查找节点(key = 根到节点的 id 链,如 "311100/312220")
  const findFolderByKey = (folders: AssetFolder[], key: string): AssetFolder | undefined => {
    const segments = key.split("/")
    const head = Number(segments[0])
    const node = folders.find(f => f.id === head)
    if (!node) return undefined
    if (segments.length === 1) return node
    return findFolderByKey(node.children ?? [], segments.slice(1).join("/"))
  }

  // 选中文件夹变化时加载文件
  createEffect(() => {
    const key = selectedKey()
    const folder = key === null ? undefined : findFolderByKey(tree(), key)
    if (!folder) {
      setFiles([])
      return
    }
    setFilesLoading(true)
    fetchAssetFiles(folder.id)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false))
  })

  const isFileSelected = (file: AssetFile) => {
    const id = assetFileId(file)
    return props.selections.some(s => s.type === "file" && (s as any).id === id)
  }

  const toggleFile = (file: AssetFile) => {
    const id = assetFileId(file)
    const isZip = (file.versionInfo?.[0]?.fileName ?? "").toLowerCase().endsWith(".zip")
    const selection: MentionSelection = {
      type: "file",
      filename: file.fileName,
      path: id,
      isFolder: isZip || undefined,
    }
    if (isFileSelected(file)) {
      props.onDeselect(selection)
    } else {
      props.onSelect(selection)
      tracker.interaction({ module: "design", name: "addon-select-product-asset", extend: JSON.stringify({ fileName: file.fileName }) })
    }
  }

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── 标题栏拖动 ──
  const onTitleMouseDown = (e: MouseEvent) => {
    if (!dialogRef) return
    e.preventDefault()
    const rect = dialogRef.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    setDialogPos({ left: rect.left, top: rect.top })
    const onMove = (ev: MouseEvent) => {
      setDialogPos({
        left: Math.max(0, ev.clientX - offsetX),
        top: Math.max(0, ev.clientY - offsetY),
      })
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    onCleanup(() => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    })
  }

  // ── 分隔条拖拽(左宽 200-400 / 右宽 190-790)──
  const startLeftDrag = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = leftWidth()
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(400, Math.max(200, startWidth + (ev.clientX - startX)))
      setLeftWidth(next)
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
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = rightWidth()
    const onMove = (ev: MouseEvent) => {
      // 把手在弹窗右缘:鼠标向右拖 = 右缘右移 = 变宽(左缘已固定为像素)
      const next = Math.min(790, Math.max(190, startWidth + (ev.clientX - startX)))
      setRightWidth(next)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // ── hover 预览(预览窗左上角对展示区右上角)──
  const handleStageEnter = (e: MouseEvent, file: AssetFile) => {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = undefined }
    const stageRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dialogRect = dialogRef?.getBoundingClientRect()
    if (!dialogRect) return
    let left = stageRect.right - dialogRect.left
    const top = stageRect.top - dialogRect.top
    const previewWidth = 256
    // 超出弹窗右缘则放到展示区左侧
    if (left + previewWidth > dialogRect.width) {
      left = stageRect.left - dialogRect.left - previewWidth
    }
    setPreviewPos({ left, top })
    setPreviewFile(file)
  }

  const handleStageLeave = () => {
    previewTimer = setTimeout(() => setPreviewFile(null), 100)
  }

  const dialogStyle = () => {
    const pos = dialogPos()
    // width = leftWidth + rightWidth + splitter(4 + 8*2 margins) + padding(24*2)
    const width = leftWidth() + rightWidth() + 68
    const widthStyle = { width: `${width}px` }
    if (pos) return { ...widthStyle, left: `${pos.left}px`, top: `${pos.top}px` }
    return { ...widthStyle, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
  }

  // 收集当前选中的 AssetFile(确认时交给父组件批量下载)
  // "未下载"判据:path === id(插入时 path 即 assetFileId;下载后 path 被补成本地路径 ≠ id)
  const collectSelected = (): AssetFile[] => {
    const result: AssetFile[] = []
    const seen = new Set<string>()
    for (const sel of props.selections) {
      if (sel.type !== "file") continue
      const id = (sel as any).id as string | undefined
      const path = (sel as any).path as string
      if (!id || !path) continue
      if (path !== id) continue // 已下载(本地路径)的跳过
      if (seen.has(id)) continue
      seen.add(id)
      const found = files().find(f => assetFileId(f) === id)
      if (found) result.push(found)
    }
    return result
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div class="asset-dialog-overlay">
          <div
            ref={dialogRef}
            class="asset-dialog"
            style={dialogStyle()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏(可拖动) */}
            <div class="asset-dialog-title" onMouseDown={onTitleMouseDown}>
              <span class="asset-dialog-title-text">产品资产库</span>
              <button
                type="button"
                class="addon-menu-url-close asset-dialog-close"
                onClick={props.onCancel}
                aria-label="关闭"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>

            {/* 中间区域:左树 + 分隔条 + 右文件网格 */}
            <div class="asset-dialog-middle" ref={middleRef}>
              <div class="asset-dialog-left" style={{ width: `${leftWidth()}px` }}>
                <Show when={treeLoading()}>
                  <div class="asset-dialog-empty">加载中...</div>
                </Show>
                <Show when={treeError()}>
                  <div class="asset-dialog-empty">{treeError()}</div>
                </Show>
                <Show when={!treeLoading() && !treeError()}>
                  <For each={tree()}>
                    {(folder) => <TreeItem folder={folder} depth={0} parentKey="" />}
                  </For>
                </Show>
              </div>

              <div
                class="asset-dialog-split"
                onMouseDown={startLeftDrag}
              />

              <div class="asset-dialog-right" style={{ width: `${rightWidth()}px` }}>
                <Show when={filesLoading()}>
                  <div class="asset-dialog-empty">加载中...</div>
                </Show>
                <Show when={!filesLoading() && files().length === 0}>
                  <div class="asset-dialog-empty">暂无内容</div>
                </Show>
                <div class="asset-dialog-grid">
                  <For each={files()}>
                    {(file) => {
                      const selected = () => isFileSelected(file)
                      return (
                        <div class="asset-grid-item" onClick={() => toggleFile(file)}>
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
                            <div class={`mention-checkbox asset-grid-checkbox ${selected() ? "mention-checkbox--checked" : ""}`}>
                              <Show when={selected()}>
                                <Icon name="check" size="small" style="color: white" />
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

            {/* 下方按钮区 */}
            <div class="asset-dialog-footer">
              <button type="button" class="asset-dialog-btn" onClick={props.onCancel}>取消</button>
              <button
                type="button"
                class="asset-dialog-btn asset-dialog-btn-primary"
                onClick={() => props.onConfirm(collectSelected())}
              >
                确认
              </button>
            </div>

            {/* 右缘拖拽把手(不可见,仅光标变化) */}
            <div class="asset-dialog-right-handle" onMouseDown={startRightDrag} />

            {/* hover 预览窗(预览窗左上角对展示区右上角) */}
            <Show when={previewFile()}>
              <div
                class="addon-menu-asset-preview asset-dialog-preview"
                style={{ left: `${previewPos().left}px`, top: `${previewPos().top}px` }}
                onMouseEnter={() => {
                  if (previewTimer) { clearTimeout(previewTimer); previewTimer = undefined }
                }}
                onMouseLeave={() => setPreviewFile(null)}
              >
                <div class="addon-menu-asset-preview-name">{previewFile()!.fileName}</div>
                <div class="addon-menu-asset-preview-stage">
                  <Show
                    when={previewFile()!.snapshot}
                    fallback={<span class="addon-menu-empty-state-text">无预览</span>}
                  >
                    <img
                      class="addon-menu-asset-preview-img"
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
    </Show>
  )

  // 树节点(递归):节点样式同原子菜单文件夹项,子节点内容缩进 8px
  function TreeItem(props: { folder: AssetFolder; depth: number; parentKey: string }): JSX.Element {
    const nodeKey = () => (props.parentKey ? `${props.parentKey}/${props.folder.id}` : `${props.folder.id}`)
    const hasChildren = () => (props.folder.children ?? []).length > 0
    const isExpanded = () => expanded().has(nodeKey())
    const isSelected = () => selectedKey() === nodeKey()
    return (
      <>
        <div
          class={`addon-menu-item asset-tree-item ${isSelected() ? "addon-menu-item--active" : ""}`}
          style={{ "padding-left": `${8 + props.depth * 8}px` }}
          onClick={() => {
            setSelectedKey(nodeKey())
            if (hasChildren()) toggleExpand(nodeKey())
          }}
        >
          <span class="addon-menu-item-icon"><FolderIcon /></span>
          <span class="addon-menu-item-text">{props.folder.name}</span>
          <Show when={hasChildren()}>
            <Icon
              name="chevron-right"
              size="small"
              class="addon-menu-item-arrow asset-tree-arrow"
              style={isExpanded() ? "transform: rotate(90deg)" : undefined}
            />
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
