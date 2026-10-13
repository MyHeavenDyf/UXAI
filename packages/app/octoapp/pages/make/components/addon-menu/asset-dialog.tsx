import { createSignal, createEffect, For, Show, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { tracker } from "@/utils/tracker"
import type { MentionSelection } from "../mention-popover"
import {
  fetchTeamTree,
  fetchAssetFiles,
  encodeAssetUrl,
  joinUrl,
  assetFileId,
  getAssetThumb,
  getAssetThumbKind,
  isAssetThumbImage,
  getAssetIconByExtension,
  type AssetFolder,
  type AssetFile,
} from "./asset-library"
import { FolderIcon } from "./icons"
import emptyPng from "../../icons/empty.png"

interface AssetDialogProps {
  trackerModule?: string
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
  // 左侧宽度 200-400 / 右侧宽度 202-802(拖拽,不持久化; +12 补偿 ScrollView 浮动滚动条)
  const [leftWidth, setLeftWidth] = createSignal(200)
  const [rightWidth, setRightWidth] = createSignal(412)

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
    setRightWidth(412)
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

  // 跨文件夹的全局选中缓存:id → AssetFile。已选列表与确认下载都从这里取,
  // 解决"确认时只反查当前文件夹 files()"导致的跨文件夹选中文件不会被下载的问题
  const [selectedAssets, setSelectedAssets] = createSignal<Map<string, AssetFile>>(new Map())
  const [selectedListOpen, setSelectedListOpen] = createSignal(false)
  let selectedListRef: HTMLDivElement | undefined
  let selectedTriggerRef: HTMLButtonElement | undefined

  // 打开弹窗时与 props.selections 对账:移除 chip 已不存在的缓存项
  createEffect(() => {
    if (!props.open) return
    setSelectedAssets(prev => {
      const next = new Map<string, AssetFile>()
      for (const [id, file] of prev) {
        const still = props.selections.some(s => s.type === "file" && (s as any).id === id)
        if (still) next.set(id, file)
      }
      return next
    })
    setSelectedListOpen(false)
  })

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
      setSelectedAssets(prev => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    } else {
      props.onSelect(selection)
      setSelectedAssets(prev => new Map(prev).set(id, file))
      tracker.interaction({ module: props.trackerModule ?? "design", name: "addon-select-product-asset", extend: JSON.stringify({ fileName: file.fileName }) })
    }
  }

  // 已选列表:移除单个选中项
  const removeSelectedAsset = (file: AssetFile) => {
    const id = assetFileId(file)
    const selection: MentionSelection = {
      type: "file",
      filename: file.fileName,
      path: id,
    }
    props.onDeselect(selection)
    setSelectedAssets(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  // 已选列表:清空全部选中
  const clearSelectedAssets = () => {
    for (const [, file] of selectedAssets()) {
      removeSelectedAsset(file)
    }
  }

  // 已选列表点击外部关闭
  createEffect(() => {
    if (!selectedListOpen()) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(".asset-selected-popover")) return
      if (target.closest(".asset-selected-trigger")) return
      setSelectedListOpen(false)
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

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
      const next = Math.min(802, Math.max(202, startWidth + (ev.clientX - startX)))
      setRightWidth(next)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // ── hover 预览(预览窗左上角对展示区右上角,4px 间距)──
  const handleStageEnter = (e: MouseEvent, file: AssetFile) => {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = undefined }
    const stageRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dialogRect = dialogRef?.getBoundingClientRect()
    if (!dialogRect) return
    let left = stageRect.right - dialogRect.left + 4
    const top = stageRect.top - dialogRect.top
    const previewWidth = 256
    // 超出弹窗右缘则放到展示区左侧(同样留 4px 间距)
    if (left + previewWidth > dialogRect.width) {
      left = stageRect.left - dialogRect.left - previewWidth - 4
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
  // 数据源 = 全局选中缓存 selectedAssets(跨文件夹可用,含已选列表展示的同一份)
  // "未下载"判据:path === id(插入时 path 即 assetFileId;下载后 path 被补成本地路径 ≠ id)
  const collectSelected = (): AssetFile[] => {
    const result: AssetFile[] = []
    for (const [id, file] of selectedAssets()) {
      const sel = props.selections.find(s => s.type === "file" && (s as any).id === id)
      if (!sel) continue
      if ((sel as any).path !== id) continue // 已下载(本地路径)的跳过
      result.push(file)
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
              <ScrollView class="asset-dialog-left" style={{ width: `${leftWidth()}px`, "flex": "1 1 auto", "min-height": "0" }}>
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
              </ScrollView>

              <div
                class="asset-dialog-split"
                onMouseDown={startLeftDrag}
              />

              <ScrollView class="asset-dialog-right" style={{ width: `${rightWidth()}px`, "flex": "1 1 auto", "min-height": "0" }}>
                <Show when={filesLoading()}>
                  <div class="asset-dialog-empty">加载中...</div>
                </Show>
                <Show when={!filesLoading() && files().length === 0}>
                  <div class="addon-menu-empty-state">
                    <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                    <span class="addon-menu-empty-state-text">暂无内容</span>
                  </div>
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
                            <Show when={file.type === 40} fallback={
                              <Show when={file.snapshot}>
                                <img
                                  class="asset-grid-thumb"
                                  src={encodeAssetUrl(joinUrl(file.s3BaseUrl, file.snapshot))}
                                  alt=""
                                  draggable={false}
                                />
                              </Show>
                            }>
                              {/* type 40:png/jpeg/jpg/svg 显示下载路径图片,其他后缀(html/txt/xlsx 等)显示对应图标 */}
                              <Show when={getAssetThumbKind(file) === "image"}>
                                <img
                                  class="asset-grid-thumb"
                                  src={getAssetThumb(file)}
                                  alt=""
                                  draggable={false}
                                />
                              </Show>
                              <Show when={getAssetThumbKind(file) === "icon"}>
                                <img
                                  class="asset-grid-icon"
                                  src={getAssetThumb(file)}
                                  alt=""
                                  draggable={false}
                                />
                              </Show>
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
              </ScrollView>
            </div>

            {/* 下方按钮区:左侧已选触发按钮 + 右侧取消/确认 */}
            <div class="asset-dialog-footer">
              <button
                ref={selectedTriggerRef}
                type="button"
                class={`asset-selected-trigger ${selectedListOpen() ? "asset-selected-trigger--active" : ""}`}
                onClick={() => setSelectedListOpen(v => !v)}
              >
                已选{selectedAssets().size}项
                <Icon
                  name="chevron-down"
                  size="small"
                  class="asset-selected-trigger-arrow"
                  style={selectedListOpen() ? "transform: rotate(180deg)" : undefined}
                />
              </button>
              <div class="asset-dialog-footer-actions">
                <button type="button" class="asset-dialog-btn" onClick={props.onCancel}>取消</button>
                <button
                  type="button"
                  class="asset-dialog-btn asset-dialog-btn-primary"
                  onClick={() => {
                    const selected = collectSelected()
                    tracker.interaction({ module: props.trackerModule ?? "design", name: "addon-confirm-product-asset", extend: JSON.stringify({ count: selected.length }) })
                    props.onConfirm(selected)
                  }}
                >
                  确认
                </button>
              </div>
            </div>

            {/* 已选项管理弹窗(激活时出现在触发按钮上方) */}
            <Show when={selectedListOpen()}>
              <div class="asset-selected-popover" ref={selectedListRef}>
                <div class="asset-selected-popover-header">
                  <span class="asset-selected-popover-count">已选{selectedAssets().size}项</span>
                  <button type="button" class="asset-selected-clear" onClick={clearSelectedAssets}>清空</button>
                </div>
                <div class="asset-selected-list">
                  <Show
                    when={selectedAssets().size > 0}
                    fallback={<div class="asset-selected-empty">暂无内容</div>}
                  >
                    <For each={[...selectedAssets().entries()]}>
                      {([id, file]) => (
                        <div class="asset-selected-item">
                          <div class="asset-selected-thumb">
                            <Show when={file.type === 40} fallback={
                              <Show when={file.snapshot}>
                                <img
                                  src={encodeAssetUrl(joinUrl(file.s3BaseUrl, file.snapshot))}
                                  alt=""
                                  draggable={false}
                                />
                              </Show>
                            }>
                              {/* type 40:图片类真图;其他后缀(html/txt/xlsx 等)图标 */}
                              <Show when={getAssetThumb(file)}>
                                <img
                                  class={isAssetThumbImage(file) ? "asset-selected-full" : "asset-grid-icon"}
                                  src={getAssetThumb(file)}
                                  alt=""
                                  draggable={false}
                                />
                              </Show>
                            </Show>
                          </div>
                          <span class="asset-selected-name" title={file.fileName}>{file.fileName}</span>
                          <button
                            type="button"
                            class="asset-selected-remove"
                            onClick={() => removeSelectedAsset(file)}
                            aria-label="移除"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>

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
                    when={previewFile()!.type === 40}
                    fallback={
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
                    }
                  >
                    {/* type 40:png/jpeg/jpg/svg 显示下载路径图片,其他后缀显示对应图标 */}
                    <Show when={getAssetThumbKind(previewFile()!) === "image"}>
                      <img
                        class="addon-menu-asset-preview-img"
                        src={getAssetThumb(previewFile()!)}
                        alt=""
                        draggable={false}
                      />
                    </Show>
                    <Show when={getAssetThumbKind(previewFile()!) === "icon"}>
                      <img
                        class="asset-grid-icon"
                        src={getAssetThumb(previewFile()!)}
                        alt=""
                        draggable={false}
                      />
                    </Show>
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
          <span class="addon-menu-item-text" title={props.folder.name}>{props.folder.name}</span>
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
