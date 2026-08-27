import { createSignal, createMemo, createEffect, createRenderEffect, For, Show, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import type { PanelSkill, SkillConfigEntry } from "../skill-config-types"
import { lookupDisplayName } from "../skill-config-types"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import { PlatformSkillIcon, CustomSkillIcon, DesignAssetIcon, ProductAssetIcon } from "./icons"
import { getFileIcon } from "../../icons/file-type-icons"
import emptyPng from "../../icons/empty.png"
import {
  fetchTeamTree,
  fetchAssetFiles,
  joinUrl,
  inferKindFromUrl,
  type AssetFolder,
  type AssetFile,
} from "../addon-menu/asset-library"
import "./styles.css"

export type MentionTab = 'skills' | 'product-assets' | 'files'

export type MentionSelection =
  | { type: 'skill'; name: string; label: string }
  | { type: 'file'; filename: string; path: string }
  | { type: 'product-asset'; filename: string; path: string; s3BaseUrl: string; convertHtmlUrl: string; snapshot: string }

interface MentionPopoverProps {
  query: string
  sessionId: string
  onClose: () => void
  onSelect: (selection: MentionSelection) => void
  onDeselect: (selection: MentionSelection) => void
  selections: MentionSelection[]
  skillConfig: {
    skill?: Record<string, SkillConfigEntry>
    panel?: {
      common?: PanelSkill[]
      octo_make?: PanelSkill[]
    }
  }
  artifactFiles: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null | undefined
  productId?: number
  onDownloadProductAsset?: (file: AssetFile, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<string>
  onUpdateMentionPath?: (filename: string, path: string) => void
}

export function MentionPopover(props: MentionPopoverProps): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<MentionTab>('skills')
  const [selectedCategory, setSelectedCategory] = createSignal<'platform' | 'custom' | 'design'>('platform')
  const [positionLeft, setPositionLeft] = createSignal(false)
  
  // 产品资产库状态
  const [assetTopFolders, setAssetTopFolders] = createSignal<AssetFolder[]>([])
  const [selectedTopFolderId, setSelectedTopFolderId] = createSignal<string | null>(null)
  const [assetSubStack, setAssetSubStack] = createSignal<Array<{
    folder: AssetFolder
    children: AssetFolder[]
    files: AssetFile[]
    loadingFiles: boolean
    selectedFolderId: string | null
  }>>([])
  const [selectedAssetFiles, setSelectedAssetFiles] = createSignal<AssetFile[]>([])
  const [assetLoading, setAssetLoading] = createSignal(false)
  const [assetError, setAssetError] = createSignal<string | null>(null)
  const [assetPreview, setAssetPreview] = createSignal<AssetFile | null>(null)
  const [assetPreviewLevel, setAssetPreviewLevel] = createSignal<number | null>(null)
  const [assetPreviewLeft, setAssetPreviewLeft] = createSignal<number>(0)
  const [assetPreviewBottom, setAssetPreviewBottom] = createSignal<number | null>(null)
  const [assetPreviewTop, setAssetPreviewTop] = createSignal<number | null>(null)
  const [assetDownloadOpen, setAssetDownloadOpen] = createSignal(false)
  const [assetDownloadCancelled, setAssetDownloadCancelled] = createSignal(false)
  const [assetDownloadCurrent, setAssetDownloadCurrent] = createSignal<string>("")
  
  let containerRef: HTMLDivElement | undefined
  let assetSecondaryRef: HTMLDivElement | undefined

  const updateSecondaryPosition = () => {
    if (!containerRef) return
    const selectedEl = containerRef.querySelector('.mention-primary-item--selected') as HTMLElement | null
    const secondaryPanel = containerRef.querySelector('.mention-secondary-panel') as HTMLElement | null
    if (!selectedEl || !secondaryPanel) return
    const primaryItems = containerRef.querySelectorAll('.mention-primary-item')
    const isLast = primaryItems.length > 0 && primaryItems[primaryItems.length - 1] === selectedEl
    if (isLast) {
      secondaryPanel.style.bottom = '0px'
      return
    }
    const containerRect = containerRef.getBoundingClientRect()
    const itemRect = selectedEl.getBoundingClientRect()
    secondaryPanel.style.bottom = `${containerRect.bottom - itemRect.bottom}px`
  }

  const checkPosition = () => {
    if (!containerRef) return
    const rect = containerRef.getBoundingClientRect()
    const spaceRight = window.innerWidth - rect.right
    const panelWidth = activeTab() === 'skills' ? 257 : activeTab() === 'product-assets' ? 248 : 400
    setPositionLeft(spaceRight < panelWidth + 16)
  }

  createEffect(() => {
    activeTab()
    selectedCategory()
    checkPosition()
    updateSecondaryPosition()
  })

  const platformSkills = createMemo(() => {
    const panel = props.skillConfig.panel
    if (!panel) return []
    
    const commonLabels = new Set((panel.common ?? []).map(s => s.label))
    return (panel.octo_make ?? []).filter(s => !commonLabels.has(s.label))
  })

  const customSkills = createMemo(() => {
    return props.skillConfig.panel?.common ?? []
  })

  const filteredPlatformSkills = createMemo(() => {
    const q = props.query.toLowerCase()
    if (!q) return platformSkills()
    return platformSkills().filter(s => {
      const display = lookupDisplayName(props.skillConfig.skill, s.label) ?? s.label
      return s.label.toLowerCase().includes(q) || display.toLowerCase().includes(q)
    })
  })

  const filteredCustomSkills = createMemo(() => {
    const q = props.query.toLowerCase()
    if (!q) return customSkills()
    return customSkills().filter(s => {
      const display = lookupDisplayName(props.skillConfig.skill, s.label) ?? s.label
      return s.label.toLowerCase().includes(q) || display.toLowerCase().includes(q)
    })
  })

  const filteredFiles = createMemo(() => {
    const q = props.query.toLowerCase()
    const files = props.artifactFiles
    if (!files) return { generated: [], uploaded: [] }
    
    const generated = files.generated.filter(f => f.name.toLowerCase().includes(q))
    const uploaded = files.uploaded.filter(f => f.name.toLowerCase().includes(q))
    
    return { generated, uploaded }
  })

  // 产品资产库数据加载
  createEffect(() => {
    if (activeTab() !== 'product-assets') return
    if (assetTopFolders().length > 0) return // 已加载
    
    setAssetLoading(true)
    setAssetError(null)
    
    fetchTeamTree(props.productId)
      .then((folders) => {
        setAssetTopFolders(folders)
      })
      .catch((err) => {
        setAssetError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setAssetLoading(false)
      })
  })

  // 产品资源库: 子菜单定位和翻转逻辑
  createRenderEffect(() => {
    const stack = assetSubStack()
    if (stack.length <= 1) return
    if (!assetSecondaryRef) return
    const containerRect = assetSecondaryRef.getBoundingClientRect()
    const levelEls = assetSecondaryRef.querySelectorAll(':scope > div')
    
    let prevRightEdge = containerRect.right
    let prevLeftEdge = containerRect.left
    
    for (let i = 1; i < stack.length; i++) {
      const prevLevelEl = levelEls[i - 1] as HTMLElement | null
      const curLevelEl = levelEls[i] as HTMLElement | null
      if (!prevLevelEl || !curLevelEl) continue
      
      const activeItem = prevLevelEl.querySelector('.mention-asset-folder--selected') as HTMLElement | null
      if (!activeItem) continue
      
      // 垂直定位
      const itemRect = activeItem.getBoundingClientRect()
      const bottomOffset = containerRect.bottom - itemRect.bottom
      const panelMaxHeight = 420
      const panelTopIfBottom = itemRect.bottom - panelMaxHeight
      if (panelTopIfBottom < 8) {
        curLevelEl.style.top = `${itemRect.top - containerRect.top}px`
        curLevelEl.style.bottom = 'auto'
      } else {
        curLevelEl.style.bottom = `${bottomOffset}px`
        curLevelEl.style.top = 'auto'
      }
      
      // 水平定位
      const rightPos = prevRightEdge + 4
      const rightEdgeIfRight = rightPos + 248
      if (rightEdgeIfRight > window.innerWidth - 16) {
        // 翻转到左侧
        const leftPos = prevLeftEdge - 4 - 248
        curLevelEl.style.left = `${leftPos - containerRect.left}px`
        prevLeftEdge = leftPos
        prevRightEdge = leftPos + 248
      } else {
        curLevelEl.style.left = `${rightPos - containerRect.left}px`
        prevLeftEdge = rightPos
        prevRightEdge = rightPos + 248
      }
    }
  })

  // 点击顶级文件夹（一级菜单项）
  const handleTopFolderClick = async (folder: AssetFolder) => {
    if (selectedTopFolderId() === folder.id.toString()) {
      // 已选中，无操作
      return
    }
    
    setSelectedTopFolderId(folder.id.toString())
    setAssetSubStack([])
    
    // 加载子文件夹和文件
    try {
      const files = await fetchAssetFiles(folder.id)
      setAssetSubStack([{
        folder,
        children: folder.children ?? [],
        files,
        loadingFiles: false,
        selectedFolderId: null,
      }])
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : String(err))
    }
  }

  // 点击子文件夹（二级及以下面板）
  const handleSubFolderClick = async (levelIndex: number, folder: AssetFolder) => {
    const stack = assetSubStack()
    if (levelIndex >= stack.length) return
    
    const level = stack[levelIndex]
    if (level.selectedFolderId === folder.id.toString()) {
      return
    }
    
    // 截断更深层级，并更新当前层的选中状态
    setAssetSubStack(prev => {
      if (levelIndex >= prev.length) return prev
      const next = prev.slice(0, levelIndex + 1)
      next[levelIndex] = { ...next[levelIndex], selectedFolderId: folder.id.toString() }
      return next
    })
    
    // 添加新层（先显示 loading）
    setAssetSubStack(prev => [...prev, {
      folder,
      children: folder.children ?? [],
      files: [],
      loadingFiles: true,
      selectedFolderId: null,
    }])
    
    // 加载文件
    try {
      const files = await fetchAssetFiles(folder.id)
      setAssetSubStack(prev => {
        const next = [...prev]
        if (next.length > 0) {
          next[next.length - 1] = { ...next[next.length - 1], files, loadingFiles: false }
        }
        return next
      })
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : String(err))
    }
  }

  // 产品资产文件点击
  const handleProductAssetClick = (file: AssetFile) => {
    const selection: MentionSelection = {
      type: 'file',
      filename: file.fileName,
      path: '',
    }
    if (isSelected(selection)) {
      props.onDeselect(selection)
      setSelectedAssetFiles(prev => prev.filter(f => f.fileName !== file.fileName))
    } else {
      props.onSelect(selection)
      setSelectedAssetFiles(prev => [...prev, file])
    }
  }

  // 收集选中的产品资产库文件（从 selectedAssetFiles 中获取）
  const collectSelectedAssetFiles = (): AssetFile[] => {
    return selectedAssetFiles().filter(file => 
      props.selections.some(s => s.type === 'file' && !s.path && s.filename === file.fileName)
    )
  }

  // 批量下载选中的产品资产库文件
  let assetDownloadAbortController: AbortController | undefined
  const downloadSelectedAssetFiles = async (selected: AssetFile[]) => {
    if (selected.length === 0) return
    setAssetDownloadCancelled(false)
    assetDownloadAbortController = new AbortController()
    setAssetDownloadOpen(true)
    try {
      for (const file of selected) {
        if (assetDownloadCancelled()) break
        setAssetDownloadCurrent(file.fileName)
        const localPath = await props.onDownloadProductAsset?.(file, () => {}, assetDownloadAbortController.signal)
        if (assetDownloadCancelled()) break
        if (localPath) {
          props.onUpdateMentionPath?.(file.fileName, localPath)
        }
      }
      setAssetDownloadOpen(false)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setAssetDownloadOpen(false)
        return
      }
      setAssetError(err instanceof Error ? err.message : String(err))
      setAssetDownloadOpen(false)
    } finally {
      assetDownloadAbortController = undefined
    }
  }

  // 关闭下载弹窗
  const closeAssetDownload = () => {
    setAssetDownloadCancelled(true)
    assetDownloadAbortController?.abort()
    setAssetDownloadOpen(false)
    // 移除 path 为空的 chip
    for (const sel of props.selections) {
      if (sel.type === 'file' && !sel.path) {
        props.onDeselect(sel)
      }
    }
  }

  // 关闭面板（先触发下载，再关闭）
  const closePopover = () => {
    const selectedFiles = collectSelectedAssetFiles()
    if (selectedFiles.length > 0) {
      void downloadSelectedAssetFiles(selectedFiles)
    }
    props.onClose()
  }

  // 组件卸载时触发下载
  onCleanup(() => {
    const selectedFiles = collectSelectedAssetFiles()
    if (selectedFiles.length > 0) {
      void downloadSelectedAssetFiles(selectedFiles)
    }
  })

  // 产品资产文件搜索（递归搜索所有层级）
  const filteredProductAssets = createMemo(() => {
    const q = props.query.toLowerCase()
    if (!q) return null
    
    const results: Array<{ file: AssetFile; levelIndex: number }> = []
    
    const stack = assetSubStack()
    stack.forEach((level, levelIndex) => {
      level.files.forEach((file) => {
        if (file.fileName.toLowerCase().includes(q)) {
          results.push({ file, levelIndex })
        }
      })
    })
    
    return results.length > 0 ? results : null
  })

  // 取消下载
  const cancelAssetDownload = () => {
    setAssetDownloadCancelled(true)
  }

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        if (activeTab() === 'skills') {
          if (selectedCategory() === 'platform') {
            setSelectedCategory('custom')
          } else if (selectedCategory() === 'custom') {
            setSelectedCategory('platform')
          }
        }
      }
      if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        if (activeTab() === 'skills') {
          const skills = selectedCategory() === 'platform' ? filteredPlatformSkills() : filteredCustomSkills()
          if (skills.length > 0) {
            handleSkillClick(skills[0])
          }
        } else if (activeTab() === 'files') {
          const files = filteredFiles()
          if (files.generated.length > 0 || files.uploaded.length > 0) {
            const firstFile = files.generated[0] || files.uploaded[0]
            handleFileClick({ name: firstFile.name, path: firstFile.path })
          }
        }
      }
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        closePopover()
      }
    }
    document.addEventListener("keydown", handler, true)
    onCleanup(() => document.removeEventListener("keydown", handler, true))
  })

  const isSelected = (selection: MentionSelection) => {
    return props.selections.some(s => 
      s.type === selection.type && 
      (s.type === 'skill' ? s.name === (selection as any).name : s.filename === (selection as any).filename)
    )
  }

  const handleSkillClick = (skill: PanelSkill) => {
    const displayName = lookupDisplayName(props.skillConfig.skill, skill.label) ?? skill.label
    const selection: MentionSelection = { type: 'skill', name: skill.label, label: displayName }
    if (isSelected(selection)) {
      props.onDeselect(selection)
    } else {
      props.onSelect(selection)
    }
  }

  const handleFileClick = (file: { name: string; path: string }) => {
    const selection: MentionSelection = { type: 'file', filename: file.name, path: file.path }
    if (isSelected(selection)) {
      props.onDeselect(selection)
    } else {
      props.onSelect(selection)
    }
  }

  const secondaryPanelStyle = () => {
    const left = positionLeft()
    const bottom = '0'
    const sideStyle = left
      ? { right: '100%', marginRight: '4px' }
      : { left: '100%', marginLeft: '4px' }
    if (activeTab() === 'skills') {
      return { width: '257px', bottom, ...sideStyle }
    }
    if (activeTab() === 'product-assets') {
      return { width: '248px', bottom, ...sideStyle }
    }
    return { width: '400px', bottom, ...sideStyle }
  }

  return (
    <>
    <div class="mention-popover-container" ref={containerRef}>
      {/* Tab Switch */}
      <div class="mention-tab-container">
        <button
          type="button"
          class={`mention-tab-btn ${activeTab() === 'skills' ? 'mention-tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('skills'); setSelectedCategory('platform') }}
        >
          技能库
        </button>
        <button
          type="button"
          class={`mention-tab-btn ${activeTab() === 'product-assets' ? 'mention-tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('product-assets') }}
        >
          产品资产库
        </button>
        <button
          type="button"
          class={`mention-tab-btn ${activeTab() === 'files' ? 'mention-tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('files'); setSelectedCategory('design') }}
        >
          设计文件
        </button>
      </div>

      {/* Primary Panel */}
      <div class="mention-primary-panel">
        <Show when={activeTab() === 'skills'}>
          <button
            type="button"
            class={`mention-primary-item ${selectedCategory() === 'platform' ? 'mention-primary-item--selected' : ''}`}
            onClick={() => { setSelectedCategory('platform') }}
          >
            <PlatformSkillIcon />
            <span class="mention-primary-item-text">平台技能</span>
            <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
          </button>
          <button
            type="button"
            class={`mention-primary-item ${selectedCategory() === 'custom' ? 'mention-primary-item--selected' : ''}`}
            onClick={() => { setSelectedCategory('custom') }}
          >
            <CustomSkillIcon />
            <span class="mention-primary-item-text">自定义技能</span>
            <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
          </button>
        </Show>

        <Show when={activeTab() === 'files'}>
          <button
            type="button"
            class={`mention-primary-item ${selectedCategory() === 'design' ? 'mention-primary-item--selected' : ''}`}
            onClick={() => { setSelectedCategory('design') }}
          >
            <DesignAssetIcon />
            <span class="mention-primary-item-text">设计资产</span>
            <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
          </button>
        </Show>

        <Show when={activeTab() === 'product-assets'}>
          <Show when={assetLoading()}>
            <div class="mention-loading-state" style={{ padding: '16px' }}>
              加载中...
            </div>
          </Show>
          <Show when={assetError()}>
            <div class="mention-error-state" style={{ padding: '16px' }}>
              {assetError()}
            </div>
          </Show>
          <Show when={!assetLoading() && !assetError()}>
            <For each={assetTopFolders()}>
              {(folder) => (
                <button
                  type="button"
                  class={`mention-primary-item ${selectedTopFolderId() === folder.id.toString() ? 'mention-primary-item--selected' : ''}`}
                  onClick={() => handleTopFolderClick(folder)}
                >
                  <Icon name="folder" size="small" />
                  <span class="mention-primary-item-text">{folder.name}</span>
                  <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>

      {/* Secondary Panel - Skills */}
      <Show when={activeTab() === 'skills' && selectedCategory() === 'platform'}>
        <div class="mention-secondary-panel" style={secondaryPanelStyle()}>
          <div class="mention-secondary-content">
            <Show when={filteredPlatformSkills().length === 0}>
              <div class="mention-empty-state">
                <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                <span class="mention-empty-state-text">暂无内容</span>
              </div>
            </Show>
            <For each={filteredPlatformSkills()}>
              {(skill, i) => {
                const displayName = lookupDisplayName(props.skillConfig.skill, skill.label) ?? skill.label
                const sel: MentionSelection = { type: 'skill', name: skill.label, label: displayName }
                return (
                  <button
                    type="button"
                    class={`mention-secondary-item ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                    onClick={() => handleSkillClick(skill)}
                  >
                    <Show when={isSelected(sel)}>
                      <Icon name="check" size="small" style="color: #0A59F7" />
                    </Show>
                    <span class="mention-secondary-item-text">{displayName}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      <Show when={activeTab() === 'skills' && selectedCategory() === 'custom'}>
        <div class="mention-secondary-panel" style={secondaryPanelStyle()}>
          <div class="mention-secondary-content">
            <Show when={filteredCustomSkills().length === 0}>
              <div class="mention-empty-state">
                <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                <span class="mention-empty-state-text">暂无内容</span>
              </div>
            </Show>
            <For each={filteredCustomSkills()}>
              {(skill, i) => {
                const displayName = lookupDisplayName(props.skillConfig.skill, skill.label) ?? skill.label
                const sel: MentionSelection = { type: 'skill', name: skill.label, label: displayName }
                return (
                  <button
                    type="button"
                    class={`mention-secondary-item ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                    onClick={() => handleSkillClick(skill)}
                  >
                    <Show when={isSelected(sel)}>
                      <Icon name="check" size="small" style="color: #0A59F7" />
                    </Show>
                    <span class="mention-secondary-item-text">{displayName}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Secondary Panel - Files */}
      <Show when={activeTab() === 'files' && filteredFiles()}>
        {(files) => (
          <div class="mention-secondary-panel" style={secondaryPanelStyle()}>
            <div class="mention-files-header">当前会话</div>
            <div class="mention-secondary-content mention-secondary-content--files">
              <Show when={files().generated.length === 0 && files().uploaded.length === 0}>
                <div class="mention-empty-state">
                  <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                  <span class="mention-empty-state-text">暂无内容</span>
                </div>
              </Show>
              <Show when={files().generated.length > 0}>
                <div class="mention-section-title">生成文件</div>
                <For each={files().generated}>
                  {(file) => {
                    const sel: MentionSelection = { type: 'file', filename: file.name, path: file.path }
                    const FileIcon = getFileIcon(file.kind, file.name)
                    return (
                      <button
                        type="button"
                        class={`mention-secondary-item ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                        onClick={() => handleFileClick(file)}
                      >
                        <div class={`mention-checkbox ${isSelected(sel) ? 'mention-checkbox--checked' : ''}`}>
                          <Show when={isSelected(sel)}>
                            <Icon name="check" size="small" style="color: white" />
                          </Show>
                        </div>
                        <FileIcon size={20} />
                        <span class="mention-secondary-item-text" title={file.name}>{file.name}</span>
                        <span class="mention-secondary-item-path" title={file.path}>{file.path}</span>
                      </button>
                    )
                  }}
                </For>
              </Show>
              <Show when={files().uploaded.length > 0}>
                <div class="mention-section-title">上传文件</div>
                <For each={files().uploaded}>
                  {(file) => {
                    const sel: MentionSelection = { type: 'file', filename: file.name, path: file.path }
                    const FileIcon = getFileIcon(file.kind, file.name)
                    return (
                      <button
                        type="button"
                        class={`mention-secondary-item ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                        onClick={() => handleFileClick(file)}
                      >
                        <div class={`mention-checkbox ${isSelected(sel) ? 'mention-checkbox--checked' : ''}`}>
                          <Show when={isSelected(sel)}>
                            <Icon name="check" size="small" style="color: white" />
                          </Show>
                        </div>
                        <FileIcon size={20} />
                        <span class="mention-secondary-item-text" title={file.name}>{file.name}</span>
                        <span class="mention-secondary-item-path" title={file.path}>{file.path}</span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        )}
      </Show>

      {/* Product Assets Secondary Panel */}
      <Show when={activeTab() === 'product-assets' && selectedTopFolderId()}>
        <div class="mention-secondary-panel" ref={assetSecondaryRef} style={{ ...secondaryPanelStyle(), overflow: 'visible' }}>
          <For each={assetSubStack()}>
            {(level, levelIndex) => (
              <div 
                class={levelIndex() === 0 ? 'mention-asset-root' : 'mention-asset-level'}
                style={{
                  position: levelIndex() === 0 ? 'static' : 'absolute',
                  left: levelIndex() === 0 ? undefined : `${levelIndex() * 252}px`,
                  top: levelIndex() === 0 ? undefined : 0,
                  width: levelIndex() === 0 ? undefined : '248px',
                  maxHeight: levelIndex() === 0 ? undefined : '420px',
                  overflowY: levelIndex() === 0 ? undefined : 'auto',
                  overflowX: levelIndex() === 0 ? undefined : 'hidden',
                }}
              >
                {/* 子文件夹列表 */}
                <For each={level.children}>
                  {(folder) => (
                    <button
                      type="button"
                      class={`mention-asset-folder ${level.selectedFolderId === folder.id.toString() ? 'mention-asset-folder--selected' : ''}`}
                      onClick={() => handleSubFolderClick(levelIndex(), folder)}
                    >
                      <Icon name="folder" size="small" />
                      <span class="mention-asset-folder-name">{folder.name}</span>
                      <Icon name="chevron-right" size="small" />
                    </button>
                  )}
                </For>
                
                {/* 文件列表 */}
                <Show when={level.files.length > 0}>
                  <For each={level.files}>
                    {(file) => {
                      const sel: MentionSelection = {
                        type: 'file',
                        filename: file.fileName,
                        path: '',
                      }
                      const FileIcon = getFileIcon(inferKindFromUrl(file.convertHtmlUrl), file.fileName)
                      return (
                        <button
                          type="button"
                          class={`mention-secondary-item mention-secondary-item--asset ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                          onClick={() => handleProductAssetClick(file)}
                          onMouseEnter={(e) => {
                            const itemRect = e.currentTarget.getBoundingClientRect()
                            
                            setAssetPreview(file)
                            setAssetPreviewLevel(levelIndex())
                            
                            // hover 弹窗使用 Portal，使用视口坐标
                            const previewWidth = 256
                            const previewHeight = 330
                            
                            // 默认：文件项右侧
                            const defaultLeft = itemRect.right + 12
                            const rightEdge = defaultLeft + previewWidth
                            let left: number
                            
                            if (rightEdge > window.innerWidth - 16) {
                              // 溢出右侧 → 定位在文件项左侧
                              left = itemRect.left - previewWidth - 12
                              if (left < 16) {
                                left = 16
                              }
                            } else {
                              left = defaultLeft
                            }
                            
                            // 垂直定位：下边对齐
                            const bottom = window.innerHeight - itemRect.bottom
                            const popupTopInViewport = itemRect.bottom - previewHeight
                            
                            let top: number | null = null
                            
                            if (popupTopInViewport < 16) {
                              top = itemRect.top
                            }
                            
                            setAssetPreviewLeft(Math.max(16, left))
                            setAssetPreviewBottom(top ? null : bottom)
                            setAssetPreviewTop(top)
                          }}
                          onMouseLeave={() => setAssetPreview(null)}
                        >
                          <div class={`mention-checkbox ${isSelected(sel) ? 'mention-checkbox--checked' : ''}`}>
                            <Show when={isSelected(sel)}>
                              <Icon name="check" size="small" style="color: white" />
                            </Show>
                          </div>
                          <FileIcon size={20} />
                          <span class="mention-secondary-item-text" title={file.fileName}>{file.fileName}</span>
                        </button>
                      )
                    }}
                  </For>
                </Show>
                
                {/* 加载中 */}
                <Show when={level.loadingFiles}>
                  <div class="mention-loading-state">
                    加载中...
                  </div>
                </Show>
                
                {/* 空状态 */}
                <Show when={level.children.length === 0 && level.files.length === 0 && !level.loadingFiles}>
                  <div class="mention-loading-state">
                    暂无内容
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
    
    {/* hover 预览弹窗 */}
    <Portal>
      <Show when={assetPreview()}>
        <div 
          class="mention-asset-preview"
          style={{
            position: 'fixed',
            left: `${assetPreviewLeft()}px`,
            bottom: assetPreviewBottom() !== null ? `${assetPreviewBottom()}px` : undefined,
            top: assetPreviewTop() !== null ? `${assetPreviewTop()}px` : undefined,
          }}
          onMouseEnter={() => {
            // 可以添加逻辑让用户可以移动到弹窗上
          }}
          onMouseLeave={() => {
            setAssetPreview(null)
            setAssetPreviewLevel(null)
            setAssetPreviewBottom(null)
          }}
        >
          <div class="mention-asset-preview-header">{assetPreview()!.fileName}</div>
          <div class="mention-asset-preview-image">
            <img 
              src={joinUrl(assetPreview()!.s3BaseUrl, assetPreview()!.snapshot)} 
              alt={assetPreview()!.fileName}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
        </div>
      </Show>
    </Portal>
    
    {/* 下载弹窗 */}
    <Portal>
      <Show when={assetDownloadOpen()}>
        <div class="mention-download-overlay" onClick={cancelAssetDownload}>
          <div class="mention-download-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="mention-download-header">
              <span class="mention-download-title">从产品资产库接收</span>
              <button type="button" class="mention-download-close" onClick={cancelAssetDownload}>
                <Icon name="x" size="small" />
              </button>
            </div>
            <div class="mention-download-body">
              <div class="mention-download-text">资源下载中</div>
              <Show when={assetDownloadCurrent()}>
                <div class="mention-download-current">{assetDownloadCurrent()}</div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </Portal>
  </>
  )
}
