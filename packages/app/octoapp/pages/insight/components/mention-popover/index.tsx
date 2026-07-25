import { createSignal, createMemo, For, Show, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import type { InsightFileEntry } from "../../utils/insight-file-api"
import "./styles.css"

// insight 自包含：面板技能只用到 label/description，本地定义一个最小结构，
// 与 @/utils/skill-config 的 PanelSkill 结构兼容（loadSkillsFromPanel 的返回可直接传入）。
export type MentionSkill = { label: string; description?: string }

export type MentionTab = "skills" | "files"

export type MentionSelection =
  | { type: "skill"; name: string; label: string }
  | { type: "file"; filename: string; path: string }

export interface MentionFiles {
  generated: InsightFileEntry[]
  uploaded: InsightFileEntry[]
}

interface MentionPopoverProps {
  query: string
  platformSkills: MentionSkill[]
  customSkills: MentionSkill[]
  files: MentionFiles | null
  selections: MentionSelection[]
  onSelect: (selection: MentionSelection) => void
  onDeselect: (selection: MentionSelection) => void
  onClose: () => void
}

/**
 * Insight 版 @ 引用面板（SPEC-INS-023，本地化自 Design/make 的 mention-popover）。
 * 只做两件事：技能库（平台 octo_insight + 自定义 common）、文件管理（会话文件）。
 * 与 make 版差异：技能面板 key = octo_insight；文件数据源 = insight 会话文件；文案「会话文件」。
 */
export function MentionPopover(props: MentionPopoverProps): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<MentionTab>("skills")
  const [category, setCategory] = createSignal<"platform" | "custom" | "session">("platform")

  const q = () => props.query.toLowerCase()

  const filteredPlatform = createMemo(() => {
    const k = q()
    return k ? props.platformSkills.filter((s) => s.label.toLowerCase().includes(k)) : props.platformSkills
  })
  const filteredCustom = createMemo(() => {
    const k = q()
    return k ? props.customSkills.filter((s) => s.label.toLowerCase().includes(k)) : props.customSkills
  })
  const filteredFiles = createMemo(() => {
    const files = props.files
    if (!files) return null
    const k = q()
    const generated = files.generated.filter((f) => !f.isFolder && f.name.toLowerCase().includes(k))
    const uploaded = files.uploaded.filter((f) => !f.isFolder && f.name.toLowerCase().includes(k))
    return { generated, uploaded }
  })

  const isSelected = (sel: MentionSelection) =>
    props.selections.some((s) =>
      s.type !== sel.type
        ? false
        : s.type === "skill"
          ? s.name === (sel as { name: string }).name
          : s.path === (sel as { path: string }).path,
    )

  const handleSkillClick = (skill: MentionSkill) => {
    const sel: MentionSelection = { type: "skill", name: skill.label, label: skill.label }
    isSelected(sel) ? props.onDeselect(sel) : props.onSelect(sel)
    props.onClose()
  }

  const handleFileClick = (file: InsightFileEntry) => {
    const sel: MentionSelection = { type: "file", filename: file.name, path: file.path }
    isSelected(sel) ? props.onDeselect(sel) : props.onSelect(sel)
    props.onClose()
  }

  return (
    <div class="ins-mention-container">
      {/* Tab 切换 */}
      <div class="ins-mention-tabs">
        <button
          type="button"
          class={`ins-mention-tab ${activeTab() === "skills" ? "ins-mention-tab--active" : ""}`}
          onClick={() => {
            setActiveTab("skills")
            setCategory("platform")
          }}
        >
          技能库
        </button>
        <button
          type="button"
          class={`ins-mention-tab ${activeTab() === "files" ? "ins-mention-tab--active" : ""}`}
          onClick={() => {
            setActiveTab("files")
            setCategory("session")
          }}
        >
          文件管理
        </button>
      </div>

      {/* 一级面板 */}
      <div class="ins-mention-primary">
        <Show when={activeTab() === "skills"}>
          <button
            type="button"
            class={`ins-mention-primary-item ${category() === "platform" ? "ins-mention-primary-item--selected" : ""}`}
            onClick={() => setCategory("platform")}
          >
            <Icon name="brain" size="small" />
            <span class="ins-mention-primary-text">平台技能</span>
            <Icon name="chevron-right" size="small" class="ins-mention-primary-arrow" />
          </button>
          <button
            type="button"
            class={`ins-mention-primary-item ${category() === "custom" ? "ins-mention-primary-item--selected" : ""}`}
            onClick={() => setCategory("custom")}
          >
            <Icon name="sliders" size="small" />
            <span class="ins-mention-primary-text">自定义技能</span>
            <Icon name="chevron-right" size="small" class="ins-mention-primary-arrow" />
          </button>
        </Show>
        <Show when={activeTab() === "files"}>
          <button
            type="button"
            class={`ins-mention-primary-item ${category() === "session" ? "ins-mention-primary-item--selected" : ""}`}
            onClick={() => setCategory("session")}
          >
            <Icon name="folder" size="small" />
            <span class="ins-mention-primary-text">会话文件</span>
            <Icon name="chevron-right" size="small" class="ins-mention-primary-arrow" />
          </button>
        </Show>
      </div>

      {/* 二级面板：平台技能 */}
      <Show when={activeTab() === "skills" && category() === "platform"}>
        <div class="ins-mention-secondary" style={{ bottom: "52px" }}>
          <Show
            when={filteredPlatform().length > 0}
            fallback={<div class="ins-mention-empty">暂无平台技能</div>}
          >
            <div class="ins-mention-secondary-content">
              <For each={filteredPlatform()}>
                {(skill) => {
                  const sel: MentionSelection = { type: "skill", name: skill.label, label: skill.label }
                  return (
                    <button
                      type="button"
                      class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""}`}
                      onClick={() => handleSkillClick(skill)}
                      title={skill.description}
                    >
                      <Show when={isSelected(sel)}>
                        <Icon name="check" size="small" class="ins-mention-check" />
                      </Show>
                      <span class="ins-mention-item-text">{skill.label}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      {/* 二级面板：自定义技能 */}
      <Show when={activeTab() === "skills" && category() === "custom"}>
        <div class="ins-mention-secondary" style={{ bottom: "8px" }}>
          <Show
            when={filteredCustom().length > 0}
            fallback={<div class="ins-mention-empty">暂无自定义技能</div>}
          >
            <div class="ins-mention-secondary-content">
              <For each={filteredCustom()}>
                {(skill) => {
                  const sel: MentionSelection = { type: "skill", name: skill.label, label: skill.label }
                  return (
                    <button
                      type="button"
                      class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""}`}
                      onClick={() => handleSkillClick(skill)}
                      title={skill.description}
                    >
                      <Show when={isSelected(sel)}>
                        <Icon name="check" size="small" class="ins-mention-check" />
                      </Show>
                      <span class="ins-mention-item-text">{skill.label}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      {/* 二级面板：会话文件 */}
      <Show when={activeTab() === "files"}>
        <div class="ins-mention-secondary ins-mention-secondary--files" style={{ bottom: "8px" }}>
          <div class="ins-mention-files-header">当前会话</div>
          <Show
            when={filteredFiles() && (filteredFiles()!.generated.length > 0 || filteredFiles()!.uploaded.length > 0)}
            fallback={<div class="ins-mention-empty">暂无会话文件</div>}
          >
            <div class="ins-mention-secondary-content ins-mention-secondary-content--files">
              <Show when={filteredFiles()!.generated.length > 0}>
                <div class="ins-mention-section-title">生成文件</div>
                <For each={filteredFiles()!.generated}>
                  {(file) => {
                    const sel: MentionSelection = { type: "file", filename: file.name, path: file.path }
                    return (
                      <button
                        type="button"
                        class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""}`}
                        onClick={() => handleFileClick(file)}
                      >
                        <div class={`ins-mention-checkbox ${isSelected(sel) ? "ins-mention-checkbox--checked" : ""}`}>
                          <Show when={isSelected(sel)}>
                            <Icon name="check" size="small" class="ins-mention-checkbox-icon" />
                          </Show>
                        </div>
                        <Icon name="folder" size="small" />
                        <span class="ins-mention-item-text" title={file.name}>{file.name}</span>
                      </button>
                    )
                  }}
                </For>
              </Show>
              <Show when={filteredFiles()!.uploaded.length > 0}>
                <div class="ins-mention-section-title">上传文件</div>
                <For each={filteredFiles()!.uploaded}>
                  {(file) => {
                    const sel: MentionSelection = { type: "file", filename: file.name, path: file.path }
                    return (
                      <button
                        type="button"
                        class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""}`}
                        onClick={() => handleFileClick(file)}
                      >
                        <div class={`ins-mention-checkbox ${isSelected(sel) ? "ins-mention-checkbox--checked" : ""}`}>
                          <Show when={isSelected(sel)}>
                            <Icon name="check" size="small" class="ins-mention-checkbox-icon" />
                          </Show>
                        </div>
                        <Icon name="folder" size="small" />
                        <span class="ins-mention-item-text" title={file.name}>{file.name}</span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
