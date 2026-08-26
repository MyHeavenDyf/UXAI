import { createSignal, createMemo, createEffect, For, Show, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { PanelSkill, SkillConfigEntry } from "../skill-config-types"
import { lookupDisplayName } from "../skill-config-types"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import { PlatformSkillIcon, CustomSkillIcon, DesignAssetIcon } from "../mention-popover/icons"
import { getFileIcon } from "../../icons/file-type-icons"
import emptyPng from "../../icons/empty.png"
import { DesignStrategyIcon, LinkUrlIcon, AttachmentIcon, ProductAssetIcon } from "./icons"
import { fetchTeamTree, fetchAssetFiles, encodeAssetUrl, type AssetFolder, type AssetFile, type AssetNode } from "./asset-library"
import type { MentionSelection } from "../mention-popover"
import "./styles.css"

interface AddonMenuProps {
  skillConfig: {
    skill?: Record<string, SkillConfigEntry>
    panel?: {
      common?: PanelSkill[]
      octo_make?: PanelSkill[]
    }
  }
  artifactFiles: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null | undefined
  selections: MentionSelection[]
  onSelect: (selection: MentionSelection) => void
  onDeselect: (selection: MentionSelection) => void
  onAddAttachment: () => void
  onAddAttachmentFromUrl?: (url: string, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<void>
  onDownloadProductAsset?: (file: AssetFile, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<string>
  onUpdateMentionPath?: (filename: string, path: string) => void
  productId?: number
  onEnterDesignStrategy?: () => void
  planActive?: boolean
  onOpen?: () => void
  disabled: boolean
}

export function AddonMenu(props: AddonMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [activeSecondary, setActiveSecondary] = createSignal<'skills' | 'files' | 'assets' | null>(null)
  const [skillsCategory, setSkillsCategory] = createSignal<'platform' | 'custom'>('platform')
  const [urlDialogOpen, setUrlDialogOpen] = createSignal(false)
  const [urlValue, setUrlValue] = createSignal("")
  const [urlDialogBOpen, setUrlDialogBOpen] = createSignal(false)
  const [urlProgress, setUrlProgress] = createSignal(0)
  const [urlStepText, setUrlStepText] = createSignal("Step 1 - 接收数据")
  const [urlError, setUrlError] = createSignal<string | null>(null)
  const [urlCancelled, setUrlCancelled] = createSignal(false)
  const [assetDownloadOpen, setAssetDownloadOpen] = createSignal(false)
  const [assetDownloadCancelled, setAssetDownloadCancelled] = createSignal(false)
  let assetDownloadAbortController: AbortController | undefined
  const [assetPreview, setAssetPreview] = createSignal<AssetFile | null>(null)
  const [assetPreviewLevel, setAssetPreviewLevel] = createSignal<number | null>(null)
  // Bottom offset (px) of the hovered item relative to the secondary panel's bottom edge.
  // Preview popup's bottom aligns to this.
  const [assetPreviewBottom, setAssetPreviewBottom] = createSignal<number | null>(null)
  let assetPreviewEl: HTMLDivElement | undefined
  let assetPreviewTimer: ReturnType<typeof setTimeout> | undefined
  const [menuPosition, setMenuPosition] = createSignal<{ left: number; bottom: number } | null>(null)
  const [localFileSelections, setLocalFileSelections] = createSignal<MentionSelection[]>([])
  // 产品资源库:导航栈,每项是 { folder, children, files, loadingFiles }
  const [assetStack, setAssetStack] = createSignal<{ folder: AssetFolder | null; children: AssetFolder[]; files: AssetFile[]; loadingFiles: boolean; selectedFolderId?: number | null }[]>([])
  const [assetLoading, setAssetLoading] = createSignal(false)
  const [assetError, setAssetError] = createSignal<string | null>(null)

  let triggerRef: HTMLButtonElement | undefined
  let menuRef: HTMLDivElement | undefined
  let skillsSecondaryRef: HTMLDivElement | undefined
  let filesSecondaryRef: HTMLDivElement | undefined
  let assetSecondaryRef: HTMLDivElement | undefined

  const platformSkills = createMemo(() => {
    const panel = props.skillConfig.panel
    if (!panel) return []
    const commonLabels = new Set((panel.common ?? []).map(s => s.label))
    return (panel.octo_make ?? []).filter(s => !commonLabels.has(s.label))
  })

  const customSkills = createMemo(() => {
    return props.skillConfig.panel?.common ?? []
  })

  const isSelected = (selection: MentionSelection) => {
    return props.selections.some(s =>
      s.type === selection.type &&
      (s.type === 'skill' ? s.name === (selection as any).name : s.path === (selection as any).path)
    )
  }

  const isFileSelectedLocal = (selection: MentionSelection) => {
    return localFileSelections().some(s =>
      s.type === 'file' && s.filename === (selection as any).filename
    )
  }

  // 产品资源库文件选中态:基于 props.selections(doc 里的 chip),按 filename 匹配
  const isAssetFileSelected = (fileName: string) => {
    return props.selections.some(s => s.type === 'file' && s.filename === fileName)
  }

  const handleTriggerClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!open()) {
      const rect = triggerRef?.getBoundingClientRect()
      if (rect) {
        setMenuPosition({ left: rect.left, bottom: window.innerHeight - rect.top })
      }
      setLocalFileSelections([])
      setOpen(true)
      setActiveSecondary(null)
      setSkillsCategory('platform')
      props.onOpen?.()
    } else {
      setOpen(false)
    }
  }

  const closeMenu = () => {
    // Collect selected asset files BEFORE clearing the stack (findAssetFileInStack needs the stack)
    const selectedFiles = collectSelectedAssetFiles()
    setOpen(false)
    setActiveSecondary(null)
    setSkillsCategory('platform')
    setLocalFileSelections([])
    setAssetStack([])
    setAssetError(null)
    // Trigger batch download of product-asset files whose chips have empty path (not yet downloaded)
    if (selectedFiles.length > 0) {
      void downloadSelectedAssetFiles(selectedFiles)
    }
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
    if (isFileSelectedLocal(selection)) {
      setLocalFileSelections(prev => prev.filter(s => !(s.type === 'file' && s.filename === file.name)))
      props.onDeselect(selection)
    } else {
      setLocalFileSelections(prev => [...prev, selection])
      props.onSelect(selection)
    }
  }

  // 产品资源库文件点击:只插入 chip(path 暂空,关闭面板时批量下载补充),不下载
  const handleAssetFileClick = (file: AssetFile) => {
    const selection: MentionSelection = {
      type: 'file',
      filename: file.fileName,
      path: '',
    }
    if (isAssetFileSelected(file.fileName)) {
      props.onDeselect(selection)
    } else {
      props.onSelect(selection)
    }
  }

  // 批量下载所有选中的产品资源库文件(关闭面板时触发)
  const downloadSelectedAssetFiles = async (selected: AssetFile[]) => {
    if (selected.length === 0) return
    setAssetDownloadCancelled(false)
    assetDownloadAbortController = new AbortController()
    setAssetDownloadOpen(true)
    try {
      for (const file of selected) {
        if (assetDownloadCancelled()) break
        const localPath = await props.onDownloadProductAsset?.(file, () => {}, assetDownloadAbortController.signal)
        if (assetDownloadCancelled()) break
        // Fill chip path with the local saved path
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
      setAssetError(err instanceof Error ? err.message : "下载失败")
      setAssetDownloadOpen(false)
    } finally {
      assetDownloadAbortController = undefined
    }
  }

  // Collect all AssetFile objects currently selected (chip in doc, path still empty = not yet downloaded)
  const collectSelectedAssetFiles = (): AssetFile[] => {
    const result: AssetFile[] = []
    const seen = new Set<string>()
    for (const sel of props.selections) {
      if (sel.type !== 'file') continue
      const filename = (sel as any).filename as string
      if (seen.has(filename)) continue
      seen.add(filename)
      const found = findAssetFileInStack(filename)
      if (found) result.push(found)
    }
    return result
  }

  const findAssetFileInStack = (fileName: string): AssetFile | undefined => {
    for (const level of assetStack()) {
      const f = level.files.find(file => file.fileName === fileName)
      if (f) return f
    }
    return undefined
  }

  const closeAssetDownload = () => {
    setAssetDownloadCancelled(true)
    assetDownloadAbortController?.abort()
    setAssetDownloadOpen(false)
    // Remove chips whose path is still empty (= not yet downloaded this session)
    for (const sel of props.selections) {
      if (sel.type === 'file' && !(sel as any).path) {
        props.onDeselect(sel)
      }
    }
    // TODO: delete already-downloaded local files (need to track downloaded paths)
  }

  const handleAddAttachment = () => {
    closeMenu()
    props.onAddAttachment()
  }

  // Click-outside handling
  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(".addon-menu-container")) return
      if (target.closest(".addon-menu-trigger")) return
      if (target.closest(".addon-menu-url-overlay")) return
      closeMenu()
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  // Update secondary panel positioning (bottom-aligned with clicked item)
  createEffect(() => {
    if (!open() || !activeSecondary() || !menuRef) return
    const cls = activeSecondary() === 'skills' ? '.addon-menu-item--skills'
      : activeSecondary() === 'assets' ? '.addon-menu-item--assets'
      : '.addon-menu-item--files'
    const itemEl = menuRef.querySelector(cls) as HTMLElement | null
    const secondaryRef = activeSecondary() === 'skills' ? skillsSecondaryRef
      : activeSecondary() === 'assets' ? assetSecondaryRef
      : filesSecondaryRef
    if (!itemEl || !secondaryRef) return
    const containerRect = menuRef.getBoundingClientRect()
    const itemRect = itemEl.getBoundingClientRect()
    secondaryRef.style.bottom = `${containerRect.bottom - itemRect.bottom}px`
  })

  // Update tertiary panel positioning (bottom-aligned with category item)
  createEffect(() => {
    if (!open() || !activeSecondary()) return
    const secondaryRef = activeSecondary() === 'skills' ? skillsSecondaryRef : filesSecondaryRef
    if (!secondaryRef) return
    // skills: find the active category item; files: find the 设计资产 item (always active)
    const itemEl = activeSecondary() === 'skills'
      ? secondaryRef.querySelector(skillsCategory() === 'platform' ? '.addon-menu-category--platform' : '.addon-menu-category--custom') as HTMLElement | null
      : secondaryRef.querySelector('.addon-menu-item--active') as HTMLElement | null
    const tertiaryEl = secondaryRef.querySelector('.addon-menu-tertiary') as HTMLElement | null
    if (!itemEl || !tertiaryEl) return
    const containerRect = secondaryRef.getBoundingClientRect()
    const itemRect = itemEl.getBoundingClientRect()
    tertiaryEl.style.bottom = `${containerRect.bottom - itemRect.bottom}px`
  })

  // 产品资源库:每个后续 level(index>0)的 bottom 对齐到上一 level 中选中文件夹项的底边
  createEffect(() => {
    if (!open() || activeSecondary() !== 'assets' || !assetSecondaryRef) return
    const stack = assetStack()
    if (stack.length <= 1) return
    const containerRect = assetSecondaryRef.getBoundingClientRect()
    // Each level is a direct child div of assetSecondaryRef (root is .addon-menu-asset-root, others .addon-menu-secondary)
    const levelEls = assetSecondaryRef.querySelectorAll(':scope > div')
    for (let i = 1; i < stack.length; i++) {
      const prevLevelEl = levelEls[i - 1] as HTMLElement | null
      const curLevelEl = levelEls[i] as HTMLElement | null
      if (!prevLevelEl || !curLevelEl) continue
      // Find the active folder item in the previous level
      const activeItem = prevLevelEl.querySelector('.addon-menu-item--active') as HTMLElement | null
      if (!activeItem) continue
      const itemRect = activeItem.getBoundingClientRect()
      const bottomOffset = containerRect.bottom - itemRect.bottom
      curLevelEl.style.bottom = `${bottomOffset}px`
    }
  })

  // Check viewport collision for secondary panel (flip to left if overflow)
  createEffect(() => {
    if (!open() || !activeSecondary() || !menuRef) return
    const rect = menuRef.getBoundingClientRect()
    // secondary panel width: skills=200, files=200 (files tertiary is 400 but positioned relative to secondary)
    const panelWidth = 200
    const spaceRight = window.innerWidth - rect.right
    const secondaryRef = activeSecondary() === 'skills' ? skillsSecondaryRef
      : activeSecondary() === 'assets' ? assetSecondaryRef
      : filesSecondaryRef
    if (!secondaryRef) return
    if (spaceRight < panelWidth + 16) {
      secondaryRef.style.left = 'auto'
      secondaryRef.style.right = '100%'
      secondaryRef.style.marginRight = '4px'
      secondaryRef.style.marginLeft = ''
    } else {
      secondaryRef.style.right = 'auto'
      secondaryRef.style.left = '100%'
      secondaryRef.style.marginLeft = '4px'
      secondaryRef.style.marginRight = ''
    }
  })

  const menuStyle = () => {
    const pos = menuPosition()
    if (!pos) return {}
    return {
      left: `${pos.left}px`,
      bottom: `${pos.bottom}px`,
    }
  }

  const closeUrlDialog = () => {
    setUrlDialogOpen(false)
    setUrlValue("")
  }

  const isValidHref = (value: string): boolean => {
    try {
      const u = new URL(value)
      return u.protocol === "http:" || u.protocol === "https:"
    } catch {
      return false
    }
  }

  let urlAbortController: AbortController | undefined

  const handleUrlConfirm = async () => {
    const value = urlValue().trim()
    if (!isValidHref(value)) {
      setUrlError("请输入有效的 URL")
      return
    }
    setUrlError(null)
    setUrlDialogOpen(false)
    setUrlValue("")
    setUrlProgress(0)
    setUrlStepText("Step 1 - 接收数据")
    setUrlCancelled(false)
    urlAbortController = new AbortController()
    setUrlDialogBOpen(true)

    try {
      await props.onAddAttachmentFromUrl?.(value, (pct) => {
        if (urlCancelled()) throw new DOMException("Aborted", "AbortError")
        setUrlProgress(pct)
        if (pct >= 60) {
          setUrlStepText("Step 3 - 文件置入到对话框内")
        }
      }, urlAbortController.signal)
      if (!urlCancelled()) {
        setUrlDialogBOpen(false)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — just close dialog B, no error display
        setUrlDialogBOpen(false)
        return
      }
      setUrlError(err instanceof Error ? err.message : "下载失败")
      setUrlDialogBOpen(false)
      // Reopen dialog A so the user can see the error and retry
      setUrlDialogOpen(true)
      setUrlValue(value)
    } finally {
      urlAbortController = undefined
    }
  }

  const closeUrlDialogB = () => {
    setUrlCancelled(true)
    urlAbortController?.abort()
    setUrlDialogBOpen(false)
  }

  return (
    <>
      <Tooltip placement="top" value="添加附件">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          class="size-8 p-0 addon-menu-trigger"
          onClick={handleTriggerClick}
        >
          <Icon name="plus" class="size-5" />
        </Button>
      </Tooltip>

      <Show when={open() && menuPosition()}>
        <Portal>
          <div class="addon-menu-container" ref={menuRef} style={menuStyle()}>
            {/* 技能库 */}
            <button
              type="button"
              class={`addon-menu-item addon-menu-item--skills ${activeSecondary() === 'skills' ? 'addon-menu-item--active' : ''}`}
              onClick={() => {
                if (activeSecondary() === 'skills') {
                  setActiveSecondary(null)
                } else {
                  setActiveSecondary('skills')
                  setSkillsCategory('platform')
                }
              }}
            >
              <span class="addon-menu-item-icon"><PlatformSkillIcon /></span>
              <span class="addon-menu-item-text">技能库</span>
              <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
            </button>

            {/* 产品资源库 */}
            <button
              type="button"
              class={`addon-menu-item addon-menu-item--assets ${activeSecondary() === 'assets' ? 'addon-menu-item--active' : ''}`}
              onClick={async () => {
                if (activeSecondary() === 'assets') {
                  setActiveSecondary(null)
                  return
                }
                setActiveSecondary('assets')
                setAssetStack([])
                setAssetError(null)
                setAssetLoading(true)
                try {
                  const folders = await fetchTeamTree(props.productId)
                  setAssetStack([{ folder: null, children: folders, files: [], loadingFiles: false }])
                } catch (err) {
                  setAssetError(err instanceof Error ? err.message : "加载失败")
                } finally {
                  setAssetLoading(false)
                }
              }}
            >
              <span class="addon-menu-item-icon"><ProductAssetIcon /></span>
              <span class="addon-menu-item-text">产品资源库</span>
              <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
            </button>

            {/* 设计文件 */}
            <button
              type="button"
              class={`addon-menu-item addon-menu-item--files ${activeSecondary() === 'files' ? 'addon-menu-item--active' : ''}`}
              onClick={() => {
                if (activeSecondary() === 'files') {
                  setActiveSecondary(null)
                } else {
                  setActiveSecondary('files')
                }
              }}
            >
              <span class="addon-menu-item-icon"><DesignAssetIcon /></span>
              <span class="addon-menu-item-text">设计文件</span>
              <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
            </button>

            {/* 进入设计策略模式 */}
            <button
              type="button"
              class="addon-menu-item"
              disabled={props.planActive}
              onClick={() => {
                closeMenu()
                props.onEnterDesignStrategy?.()
              }}
            >
              <span class="addon-menu-item-icon"><DesignStrategyIcon /></span>
              <span class="addon-menu-item-text">进入设计策略模式</span>
            </button>

            {/* 接收设计资产链接URL */}
            <button
              type="button"
              class="addon-menu-item"
              onClick={() => {
                setUrlDialogOpen(true)
                closeMenu()
              }}
            >
              <span class="addon-menu-item-icon"><LinkUrlIcon /></span>
              <span class="addon-menu-item-text">接收设计资产链接URL</span>
            </button>

            {/* 添加附件 */}
            <button
              type="button"
              class="addon-menu-item"
              disabled={props.disabled}
              onClick={handleAddAttachment}
            >
              <span class="addon-menu-item-icon"><AttachmentIcon /></span>
              <span class="addon-menu-item-text">添加附件</span>
            </button>

            {/* Secondary panel for 技能库 (categories + tertiary skills list) */}
            <Show when={activeSecondary() === 'skills'}>
              <div class="addon-menu-secondary" ref={skillsSecondaryRef} style={{ width: '200px' }}>
                <button
                  type="button"
                  class={`addon-menu-item addon-menu-category addon-menu-category--platform ${skillsCategory() === 'platform' ? 'addon-menu-item--active' : ''}`}
                  onClick={() => setSkillsCategory('platform')}
                >
                  <span class="addon-menu-item-icon"><PlatformSkillIcon /></span>
                  <span class="addon-menu-item-text">平台技能</span>
                  <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
                </button>
                <button
                  type="button"
                  class={`addon-menu-item addon-menu-category addon-menu-category--custom ${skillsCategory() === 'custom' ? 'addon-menu-item--active' : ''}`}
                  onClick={() => setSkillsCategory('custom')}
                >
                  <span class="addon-menu-item-icon"><CustomSkillIcon /></span>
                  <span class="addon-menu-item-text">自定义技能</span>
                  <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
                </button>

                {/* Tertiary panel: platform skills list */}
                <Show when={skillsCategory() === 'platform'}>
                  <div class="addon-menu-tertiary" style={{ width: '257px' }}>
                    <div class="addon-menu-tertiary-content">
                      <Show when={platformSkills().length === 0}>
                        <div class="addon-menu-empty-state">
                          <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                          <span class="addon-menu-empty-state-text">暂无内容</span>
                        </div>
                      </Show>
                      <For each={platformSkills()}>
                        {(skill) => {
                          const displayName = lookupDisplayName(props.skillConfig.skill, skill.label) ?? skill.label
                          const sel: MentionSelection = { type: 'skill', name: skill.label, label: displayName }
                          return (
                            <button
                              type="button"
                              class={`addon-menu-tertiary-item ${isSelected(sel) ? 'addon-menu-tertiary-item--selected' : ''}`}
                              onClick={() => handleSkillClick(skill)}
                            >
                              <Show when={isSelected(sel)}>
                                <Icon name="check" size="small" style="color: #0A59F7" />
                              </Show>
                              <span class="addon-menu-tertiary-item-text">{displayName}</span>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* Tertiary panel: custom skills list */}
                <Show when={skillsCategory() === 'custom'}>
                  <div class="addon-menu-tertiary" style={{ width: '257px' }}>
                    <div class="addon-menu-tertiary-content">
                      <Show when={customSkills().length === 0}>
                        <div class="addon-menu-empty-state">
                          <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                          <span class="addon-menu-empty-state-text">暂无内容</span>
                        </div>
                      </Show>
                      <For each={customSkills()}>
                        {(skill) => {
                          const displayName = lookupDisplayName(props.skillConfig.skill, skill.label) ?? skill.label
                          const sel: MentionSelection = { type: 'skill', name: skill.label, label: displayName }
                          return (
                            <button
                              type="button"
                              class={`addon-menu-tertiary-item ${isSelected(sel) ? 'addon-menu-tertiary-item--selected' : ''}`}
                              onClick={() => handleSkillClick(skill)}
                            >
                              <Show when={isSelected(sel)}>
                                <Icon name="check" size="small" style="color: #0A59F7" />
                              </Show>
                              <span class="addon-menu-tertiary-item-text">{displayName}</span>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Secondary panel for 产品资源库 — multi-level folder navigation */}
            <Show when={activeSecondary() === 'assets'}>
              <div class="addon-menu-secondary addon-menu-secondary--assets" ref={assetSecondaryRef} style={{ width: '200px' }}>
                <Show when={assetLoading()}>
                  <div class="addon-menu-empty-state">
                    <div class="octo-spinner" />
                    <span class="addon-menu-empty-state-text">加载中...</span>
                  </div>
                </Show>
                <Show when={assetError()}>
                  <div class="addon-menu-empty-state">
                    <span class="addon-menu-empty-state-text">{assetError()}</span>
                  </div>
                </Show>
                <For each={assetStack()}>
                  {(level, index) => (
                    <div
                      classList={{
                        "addon-menu-asset-root": index() === 0,
                        "addon-menu-secondary": index() !== 0,
                      }}
                      style={{
                        width: index() === 0 ? '100%' : '200px',
                        'max-width': '200px',
                        overflow: 'hidden',
                        position: index() === 0 ? 'static' : 'absolute',
                        // top/bottom set by positioning effect (bottom-aligned to selected folder item in prev level)
                        left: index() === 0 ? undefined : `${index() * 204}px`,
                      }}
                    >
                      <Show when={level.files.length === 0 && level.children.length === 0 && !level.loadingFiles}>
                        <div class="addon-menu-empty-state">
                          <span class="addon-menu-empty-state-text">暂无内容</span>
                        </div>
                      </Show>
                      {/* Folders first */}
                      <For each={level.children}>
                        {(folder) => (
                          <button
                            type="button"
                            class={`addon-menu-item addon-menu-asset-folder ${level.selectedFolderId === folder.id ? 'addon-menu-item--active' : ''}`}
                            onClick={async () => {
                              const curIdx = index()
                              // Already selected → no effect (matches 技能库 behavior)
                              if (level.selectedFolderId === folder.id) return
                              // Expand: mark selected on current level (closes sibling expansions implicitly
                              // because only one selectedFolderId per level), truncate deeper levels, push next
                              setAssetStack(prev => {
                                if (curIdx >= prev.length) return prev
                                const next = prev.slice(0, curIdx + 1)
                                next[curIdx] = { ...next[curIdx], selectedFolderId: folder.id }
                                return next
                              })
                              setAssetStack(prev => [...prev, {
                                folder,
                                children: folder.children ?? [],
                                files: [],
                                loadingFiles: true,
                                selectedFolderId: null,
                              }])
                              try {
                                const files = await fetchAssetFiles(folder.id)
                                setAssetStack(prev => {
                                  const next = [...prev]
                                  if (next.length > 0) {
                                    next[next.length - 1] = { ...next[next.length - 1], files, loadingFiles: false }
                                  }
                                  return next
                                })
                              } catch (err) {
                                setAssetError(err instanceof Error ? err.message : "加载文件失败")
                              }
                            }}
                          >
                            <span class="addon-menu-item-icon"><ProductAssetIcon /></span>
                            <span class="addon-menu-item-text">{folder.name}</span>
                            <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
                          </button>
                        )}
                      </For>
                      {/* Files after folders */}
                      <For each={level.files}>
                        {(file) => {
                          const selected = () => isAssetFileSelected(file.fileName)
                          return (
                            <button
                              type="button"
                              class={`addon-menu-tertiary-item ${selected() ? 'addon-menu-tertiary-item--selected' : ''}`}
                              onClick={() => handleAssetFileClick(file)}
                              onMouseEnter={(e) => {
                                if (assetPreviewTimer) { clearTimeout(assetPreviewTimer); assetPreviewTimer = undefined }
                                const itemRect = e.currentTarget.getBoundingClientRect()
                                const containerRect = assetSecondaryRef!.getBoundingClientRect()
                                setAssetPreview(file)
                                setAssetPreviewLevel(index())
                                setAssetPreviewBottom(containerRect.bottom - itemRect.bottom)
                              }}
                              onMouseLeave={() => {
                                // Delay close so the pointer can cross the 4px gap to the preview popup
                                assetPreviewTimer = setTimeout(() => {
                                  setAssetPreview(null)
                                  setAssetPreviewLevel(null)
                                  setAssetPreviewBottom(null)
                                }, 100)
                              }}
                            >
                              <div class={`mention-checkbox ${selected() ? 'mention-checkbox--checked' : ''}`}>
                                <Show when={selected()}>
                                  <Icon name="check" size="small" style="color: white" />
                                </Show>
                              </div>
                              <span class="addon-menu-tertiary-item-text" title={file.fileName}>{file.fileName}</span>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  )}
                </For>
                {/* Hover preview popup — positioned at next-level location (right of the hovered file's level) */}
                <Show when={assetPreview() && assetPreviewLevel() !== null}>
                  <div
                    ref={assetPreviewEl}
                    class="addon-menu-asset-preview"
                    style={{
                      left: `${(assetPreviewLevel()! + 1) * 204}px`,
                      bottom: assetPreviewBottom() !== null ? `${assetPreviewBottom()}px` : '0px',
                    }}
                    onMouseEnter={() => {
                      if (assetPreviewTimer) { clearTimeout(assetPreviewTimer); assetPreviewTimer = undefined }
                    }}
                    onMouseLeave={() => {
                      setAssetPreview(null)
                      setAssetPreviewLevel(null)
                      setAssetPreviewBottom(null)
                    }}
                  >
                    <div class="addon-menu-asset-preview-name">{assetPreview()!.fileName}</div>
                    <div class="addon-menu-asset-preview-stage">
                      <Show
                        when={assetPreview()!.snapshot}
                        fallback={<span class="addon-menu-empty-state-text">无预览</span>}
                      >
                        <img
                          src={encodeAssetUrl(assetPreview()!.s3BaseUrl + assetPreview()!.snapshot)}
                          alt=""
                          class="addon-menu-asset-preview-img"
                          draggable={false}
                        />
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Secondary panel for 设计文件 — shows 设计资产 category, with tertiary files list */}
            <Show when={activeSecondary() === 'files'}>
              <div class="addon-menu-secondary" ref={filesSecondaryRef} style={{ width: '200px' }}>
                <button
                  type="button"
                  class="addon-menu-item addon-menu-item--active"
                >
                  <span class="addon-menu-item-icon"><DesignAssetIcon /></span>
                  <span class="addon-menu-item-text">设计资产</span>
                  <Icon name="chevron-right" size="small" class="addon-menu-item-arrow" />
                </button>

                {/* Tertiary panel: files list */}
                <div class="addon-menu-tertiary" style={{ width: '400px', padding: '12px 8px' }}>
                  <div class="addon-menu-files-header">当前会话</div>
                  <div class="addon-menu-tertiary-content" style={{ 'max-height': '364px' }}>
                    <Show when={!props.artifactFiles || (props.artifactFiles.generated.length === 0 && props.artifactFiles.uploaded.length === 0)}>
                      <div class="addon-menu-empty-state">
                        <img src={emptyPng} style={{ width: "80px", height: "80px", "user-select": "none", "-webkit-user-drag": "none" }} alt="" draggable={false} />
                        <span class="addon-menu-empty-state-text">暂无内容</span>
                      </div>
                    </Show>
                    <Show when={props.artifactFiles && props.artifactFiles.generated.length > 0}>
                      <div class="addon-menu-section-title">生成文件</div>
                      <For each={props.artifactFiles?.generated ?? []}>
                        {(file) => {
                          const sel: MentionSelection = { type: 'file', filename: file.name, path: file.path }
                          const FileIcon = getFileIcon(file.kind, file.name)
                          return (
                            <button
                              type="button"
                              class={`addon-menu-tertiary-item ${isFileSelectedLocal(sel) ? 'addon-menu-tertiary-item--selected' : ''}`}
                              onClick={() => handleFileClick(file)}
                            >
                              <div class={`mention-checkbox ${isFileSelectedLocal(sel) ? 'mention-checkbox--checked' : ''}`}>
                                <Show when={isFileSelectedLocal(sel)}>
                                  <Icon name="check" size="small" style="color: white" />
                                </Show>
                              </div>
                              <FileIcon size={20} />
                              <span class="addon-menu-tertiary-item-text" title={file.name}>{file.name}</span>
                              <span class="addon-menu-item-path" title={file.path}>{file.path}</span>
                            </button>
                          )
                        }}
                      </For>
                    </Show>
                    <Show when={props.artifactFiles && props.artifactFiles.uploaded.length > 0}>
                      <div class="addon-menu-section-title">上传文件</div>
                      <For each={props.artifactFiles?.uploaded ?? []}>
                        {(file) => {
                          const sel: MentionSelection = { type: 'file', filename: file.name, path: file.path }
                          const FileIcon = getFileIcon(file.kind, file.name)
                          return (
                            <button
                              type="button"
                              class={`addon-menu-tertiary-item ${isFileSelectedLocal(sel) ? 'addon-menu-tertiary-item--selected' : ''}`}
                              onClick={() => handleFileClick(file)}
                            >
                              <div class={`mention-checkbox ${isFileSelectedLocal(sel) ? 'mention-checkbox--checked' : ''}`}>
                                <Show when={isFileSelectedLocal(sel)}>
                                  <Icon name="check" size="small" style="color: white" />
                                </Show>
                              </div>
                              <FileIcon size={20} />
                              <span class="addon-menu-tertiary-item-text" title={file.name}>{file.name}</span>
                              <span class="addon-menu-item-path" title={file.path}>{file.path}</span>
                            </button>
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>

      {/* URL Dialog */}
      <Show when={urlDialogOpen()}>
        <Portal>
          <div class="addon-menu-url-overlay" onClick={closeUrlDialog}>
            <div class="addon-menu-url-dialog" onClick={(e) => e.stopPropagation()}>
              <div class="addon-menu-url-header">
                <h3 class="addon-menu-url-title">接收设计资产链接URL</h3>
                <button type="button" class="addon-menu-url-close" onClick={closeUrlDialog} aria-label="关闭">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
              <input
                type="text"
                class="addon-menu-url-input"
                placeholder="粘贴设计资产链接URL在此处"
                value={urlValue()}
                onInput={(e) => setUrlValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeUrlDialog()
                  if (e.key === "Enter") void handleUrlConfirm()
                }}
              />
              <Show when={urlError()}>
                <div class="addon-menu-url-error">{urlError()}</div>
              </Show>
              <div class="addon-menu-url-footer">
                <button type="button" class="addon-menu-url-cancel" onClick={closeUrlDialog}>取消</button>
                <button type="button" class="addon-menu-url-confirm" onClick={() => void handleUrlConfirm()}>确认</button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      {/* URL Dialog B — loading + progress + step text */}
      <Show when={urlDialogBOpen()}>
        <Portal>
          <div class="addon-menu-url-overlay">
            <div class="addon-menu-url-dialog addon-menu-url-dialog--b" onClick={(e) => e.stopPropagation()}>
              <div class="addon-menu-url-header">
                <h3 class="addon-menu-url-title">接收设计资产链接URL</h3>
                <button type="button" class="addon-menu-url-close" onClick={closeUrlDialogB} aria-label="关闭">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
              <div class="addon-menu-url-loading">
                <div class="addon-menu-spinner">
                  <For each={Array.from({ length: 8 }, (_, i) => i)}>
                    {() => (
                      <span class="addon-menu-spinner-dot" />
                    )}
                  </For>
                  <span class="addon-menu-spinner-arc" />
                </div>
                <div class="addon-menu-progress-bar">
                  <div class="addon-menu-progress-fill" style={{ width: `${urlProgress()}%` }} />
                </div>
                <div class="addon-menu-step-text">{urlStepText()}</div>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      {/* 产品资源库下载弹窗 — 标题"从产品资产库接收", 无进度条, 说明"资源下载中" */}
      <Show when={assetDownloadOpen()}>
        <Portal>
          <div class="addon-menu-url-overlay">
            <div class="addon-menu-url-dialog addon-menu-url-dialog--b" onClick={(e) => e.stopPropagation()}>
              <div class="addon-menu-url-header">
                <h3 class="addon-menu-url-title">从产品资产库接收</h3>
                <button type="button" class="addon-menu-url-close" onClick={closeAssetDownload} aria-label="关闭">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
              <div class="addon-menu-url-loading">
                <div class="addon-menu-spinner">
                  <For each={Array.from({ length: 8 }, (_, i) => i)}>
                    {() => <span class="addon-menu-spinner-dot" />}
                  </For>
                  <span class="addon-menu-spinner-arc" />
                </div>
                <div class="addon-menu-step-text">资源下载中</div>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  )
}
