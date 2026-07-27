import { createSignal, createMemo, For, Show, onCleanup, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { PanelSkill } from "../skill-config-types"
import type { ArtifactFile } from "../../utils/artifact-file-api"
import "./styles.css"

export type MentionTab = 'skills' | 'files'
export type MentionSelection = 
  | { type: 'skill'; name: string; label: string }
  | { type: 'file'; filename: string; path: string }

interface MentionPopoverProps {
  query: string
  sessionId: string
  onClose: () => void
  onSelect: (selection: MentionSelection) => void
  onDeselect: (selection: MentionSelection) => void
  selections: MentionSelection[]
  skillConfig: {
    panel?: {
      common?: PanelSkill[]
      octo_make?: PanelSkill[]
    }
  }
  artifactFiles: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null | undefined
}

export function MentionPopover(props: MentionPopoverProps): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<MentionTab>('skills')
  const [selectedCategory, setSelectedCategory] = createSignal<'platform' | 'custom' | 'design'>('platform')

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
    return platformSkills().filter(s => s.label.toLowerCase().includes(q))
  })

  const filteredCustomSkills = createMemo(() => {
    const q = props.query.toLowerCase()
    if (!q) return customSkills()
    return customSkills().filter(s => s.label.toLowerCase().includes(q))
  })

  const filteredFiles = createMemo(() => {
    const q = props.query.toLowerCase()
    const files = props.artifactFiles
    if (!files) return null
    
    const generated = files.generated.filter(f => f.name.toLowerCase().includes(q))
    const uploaded = files.uploaded.filter(f => f.name.toLowerCase().includes(q))
    
    return { generated, uploaded }
  })

  const isSelected = (selection: MentionSelection) => {
    return props.selections.some(s => 
      s.type === selection.type && 
      (s.type === 'skill' ? s.name === (selection as any).name : s.path === (selection as any).path)
    )
  }

  const handleSkillClick = (skill: PanelSkill) => {
    const selection: MentionSelection = { type: 'skill', name: skill.label, label: skill.label }
    if (isSelected(selection)) {
      props.onDeselect(selection)
    } else {
      props.onSelect(selection)
    }
    props.onClose()
  }

  const handleFileClick = (file: { name: string; path: string }) => {
    const selection: MentionSelection = { type: 'file', filename: file.name, path: file.path }
    if (isSelected(selection)) {
      props.onDeselect(selection)
    } else {
      props.onSelect(selection)
    }
    props.onClose()
  }

  const secondaryPanelStyle = () => {
    if (activeTab() === 'skills') {
      // 技能库：二级弹窗底部与选中项底部对齐
      // 从容器内容区底部算起：
      // "自定义技能"底部: 8px (容器padding-bottom)
      // "平台技能"底部: 52px (8px + 40px + 4px gap)
      return {
        width: '257px',
        bottom: selectedCategory() === 'platform' ? '52px' : '8px'
      }
    }
    // 文件管理：二级弹窗底部与一级弹窗底部对齐
    return {
      width: '400px',
      bottom: '8px'
    }
  }

  return (
    <div class="mention-popover-container">
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
          class={`mention-tab-btn ${activeTab() === 'files' ? 'mention-tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('files'); setSelectedCategory('design') }}
        >
          文件管理
        </button>
      </div>

      {/* Primary Panel */}
      <div class="mention-primary-panel">
        <Show when={activeTab() === 'skills'}>
          <button
            type="button"
            class={`mention-primary-item ${selectedCategory() === 'platform' ? 'mention-primary-item--selected' : ''}`}
            onClick={() => setSelectedCategory('platform')}
          >
            <Icon name="brain" size="small" />
            <span class="mention-primary-item-text">平台技能</span>
            <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
          </button>
          <button
            type="button"
            class={`mention-primary-item ${selectedCategory() === 'custom' ? 'mention-primary-item--selected' : ''}`}
            onClick={() => setSelectedCategory('custom')}
          >
            <Icon name="sliders" size="small" />
            <span class="mention-primary-item-text">自定义技能</span>
            <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
          </button>
        </Show>

        <Show when={activeTab() === 'files'}>
          <button
            type="button"
            class={`mention-primary-item ${selectedCategory() === 'design' ? 'mention-primary-item--selected' : ''}`}
            onClick={() => setSelectedCategory('design')}
          >
            <Icon name="folder" size="small" />
            <span class="mention-primary-item-text">设计资产</span>
            <Icon name="chevron-right" size="small" class="mention-primary-item-arrow" />
          </button>
        </Show>
      </div>

      {/* Secondary Panel */}
      <Show when={activeTab() === 'skills' && selectedCategory() === 'platform' && filteredPlatformSkills().length > 0}>
        <div class="mention-secondary-panel" style={secondaryPanelStyle()}>
          <div class="mention-secondary-content">
            <For each={filteredPlatformSkills()}>
              {(skill) => {
                const sel: MentionSelection = { type: 'skill', name: skill.label, label: skill.label }
                return (
                  <button
                    type="button"
                    class={`mention-secondary-item ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                    onClick={() => handleSkillClick(skill)}
                  >
                    <Show when={isSelected(sel)}>
                      <Icon name="check" size="small" style="color: #0A59F7" />
                    </Show>
                    <span class="mention-secondary-item-text">{skill.label}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      <Show when={activeTab() === 'skills' && selectedCategory() === 'custom' && filteredCustomSkills().length > 0}>
        <div class="mention-secondary-panel" style={secondaryPanelStyle()}>
          <div class="mention-secondary-content">
            <For each={filteredCustomSkills()}>
              {(skill) => {
                const sel: MentionSelection = { type: 'skill', name: skill.label, label: skill.label }
                return (
                  <button
                    type="button"
                    class={`mention-secondary-item ${isSelected(sel) ? 'mention-secondary-item--selected' : ''}`}
                    onClick={() => handleSkillClick(skill)}
                  >
                    <Show when={isSelected(sel)}>
                      <Icon name="check" size="small" style="color: #0A59F7" />
                    </Show>
                    <span class="mention-secondary-item-text">{skill.label}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      <Show when={activeTab() === 'files' && filteredFiles()}>
        {(files) => (
          <div class="mention-secondary-panel" style={secondaryPanelStyle()}>
            <div class="mention-files-header">当前会话</div>
            <div class="mention-secondary-content mention-secondary-content--files">
              <Show when={files().generated.length > 0}>
                <div class="mention-section-title">生成文件</div>
                <For each={files().generated}>
                  {(file) => {
                    const sel: MentionSelection = { type: 'file', filename: file.name, path: file.path }
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
                        <Icon name="folder" size="small" />
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
                        <Icon name="folder" size="small" />
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
    </div>
  )
}