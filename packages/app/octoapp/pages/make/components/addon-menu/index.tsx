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
import { DesignStrategyIcon, LinkUrlIcon, AttachmentIcon } from "./icons"
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
  onAddAttachmentFromUrl?: (url: string, onProgress: (pct: number) => void) => Promise<void>
  onEnterDesignStrategy?: () => void
  planActive?: boolean
  onOpen?: () => void
  disabled: boolean
}

export function AddonMenu(props: AddonMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [activeSecondary, setActiveSecondary] = createSignal<'skills' | 'files' | null>(null)
  const [skillsCategory, setSkillsCategory] = createSignal<'platform' | 'custom'>('platform')
  const [urlDialogOpen, setUrlDialogOpen] = createSignal(false)
  const [urlValue, setUrlValue] = createSignal("")
  const [urlDialogBOpen, setUrlDialogBOpen] = createSignal(false)
  const [urlProgress, setUrlProgress] = createSignal(0)
  const [urlStepText, setUrlStepText] = createSignal("Step 1 - 接收数据")
  const [urlError, setUrlError] = createSignal<string | null>(null)
  const [menuPosition, setMenuPosition] = createSignal<{ left: number; bottom: number } | null>(null)
  const [localFileSelections, setLocalFileSelections] = createSignal<MentionSelection[]>([])

  let triggerRef: HTMLButtonElement | undefined
  let menuRef: HTMLDivElement | undefined
  let skillsSecondaryRef: HTMLDivElement | undefined
  let filesSecondaryRef: HTMLDivElement | undefined

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
      s.type === 'file' && s.path === (selection as any).path
    )
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
    setOpen(false)
    setActiveSecondary(null)
    setSkillsCategory('platform')
    setLocalFileSelections([])
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
      setLocalFileSelections(prev => prev.filter(s => !(s.type === 'file' && s.path === file.path)))
      props.onDeselect(selection)
    } else {
      setLocalFileSelections(prev => [...prev, selection])
      props.onSelect(selection)
    }
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
    const itemClass = activeSecondary() === 'skills' ? '.addon-menu-item--skills' : '.addon-menu-item--files'
    const itemEl = menuRef.querySelector(itemClass) as HTMLElement | null
    const secondaryRef = activeSecondary() === 'skills' ? skillsSecondaryRef : filesSecondaryRef
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

  // Check viewport collision for secondary panel (flip to left if overflow)
  createEffect(() => {
    if (!open() || !activeSecondary() || !menuRef) return
    const rect = menuRef.getBoundingClientRect()
    // secondary panel width: skills=200, files=200 (files tertiary is 400 but positioned relative to secondary)
    const panelWidth = 200
    const spaceRight = window.innerWidth - rect.right
    const secondaryRef = activeSecondary() === 'skills' ? skillsSecondaryRef : filesSecondaryRef
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
    setUrlDialogBOpen(true)

    try {
      await props.onAddAttachmentFromUrl?.(value, (pct) => {
        setUrlProgress(pct)
        if (pct >= 60) {
          setUrlStepText("Step 3 - 文件置入到对话框内")
        }
      })
      setUrlDialogBOpen(false)
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "下载失败")
      setUrlDialogBOpen(false)
      // Reopen dialog A so the user can see the error and retry
      setUrlDialogOpen(true)
      setUrlValue(value)
    }
  }

  const closeUrlDialogB = () => {
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
            <div class="addon-menu-url-dialog" onClick={(e) => e.stopPropagation()}>
              <div class="addon-menu-url-header">
                <h3 class="addon-menu-url-title">接收设计资产链接URL</h3>
              </div>
              <div class="addon-menu-url-loading">
                <div class="addon-menu-spinner">
                  <For each={Array.from({ length: 8 }, (_, i) => i)}>
                    {(i) => (
                      <span
                        class="addon-menu-spinner-dot"
                        style={{
                          transform: `rotate(${i * 45}deg)`,
                        }}
                      />
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
    </>
  )
}
