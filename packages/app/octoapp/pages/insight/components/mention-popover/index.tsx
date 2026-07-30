import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show, type JSX } from "solid-js"
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
  /** 技能惰性加载中(首次 @ 唤起时才拉);为 true 时空列表按「加载中」显示,不显示「暂无」 */
  skillsLoading?: boolean
  /** 会话文件拉取中;同上,避免把未到达的数据说成不存在 */
  filesLoading?: boolean
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

  // ── 键盘导航 ────────────────────────────────────────────────────────────
  // 当前二级面板里可选项的扁平序列(文件 tab 下 生成 + 上传 连续编号),↑↓ 在其中移动。
  type Row = { kind: "skill"; skill: MentionSkill } | { kind: "file"; file: InsightFileEntry }
  const rows = createMemo<Row[]>(() => {
    if (activeTab() === "skills") {
      const list = category() === "custom" ? filteredCustom() : filteredPlatform()
      return list.map((skill) => ({ kind: "skill", skill }) as Row)
    }
    const f = filteredFiles()
    if (!f) return []
    return [...f.generated, ...f.uploaded].map((file) => ({ kind: "file", file }) as Row)
  })

  const [activeIndex, setActiveIndex] = createSignal(0)
  // 列表内容一变(改 query / 切 tab / 切分类)高亮回到首项,避免停在已不存在的下标上
  createEffect(() => {
    props.query
    activeTab()
    category()
    setActiveIndex(0)
  })

  let listRef: HTMLDivElement | undefined
  // 高亮项滚进可视区:二级面板有 max-height,靠键盘走到列表下方时不跟随就等于看不见
  createEffect(() => {
    const i = activeIndex()
    listRef?.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: "nearest" })
  })

  const activate = (row: Row | undefined) => {
    if (!row) return
    row.kind === "skill" ? handleSkillClick(row.skill) : handleFileClick(row.file)
  }

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入法合成期间(拼音待选)的 Enter / 方向键属于候选词操作,不能当成面板操作。
      // 三重判定与旧 textarea 版一致:isComposing(标准)/ keyCode 229(部分 Chromium 漏报 isComposing)。
      if (e.isComposing || e.keyCode === 229) return

      const list = rows()
      switch (e.key) {
        case "ArrowDown":
          if (list.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex((i) => (i + 1) % list.length)
          return
        case "ArrowUp":
          if (list.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex((i) => (i - 1 + list.length) % list.length)
          return
        case "Enter": {
          const row = list[activeIndex()]
          if (!row) return // 列表为空时不拦 Enter,交回编辑器(否则面板一开就没法发消息)
          e.preventDefault()
          e.stopPropagation()
          activate(row)
          return
        }
        case "Escape":
          e.preventDefault()
          e.stopPropagation()
          props.onClose()
          return
      }
    }
    // capture:↑↓ 与 Enter 必须抢在 ProseMirror 的 keymap 之前,否则会被当成光标移动 / 发送
    document.addEventListener("keydown", handler, true)
    onCleanup(() => document.removeEventListener("keydown", handler, true))
  })

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
            <span class="ins-mention-primary-text">用研资产</span>
            <Icon name="chevron-right" size="small" class="ins-mention-primary-arrow" />
          </button>
        </Show>
      </div>

      {/* 二级面板：平台技能 */}
      <Show when={activeTab() === "skills" && category() === "platform"}>
        <div class="ins-mention-secondary" style={{ bottom: "52px" }}>
          <Show
            when={filteredPlatform().length > 0}
            fallback={<div class="ins-mention-empty">{props.skillsLoading ? "正在加载技能…" : "暂无平台技能"}</div>}
          >
            <div class="ins-mention-secondary-content" ref={listRef}>
              <For each={filteredPlatform()}>
                {(skill, i) => {
                  const sel: MentionSelection = { type: "skill", name: skill.label, label: skill.label }
                  return (
                    <button
                      type="button"
                      data-row={i()}
                      class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""} ${activeIndex() === i() ? "ins-mention-item--active" : ""}`}
                      onClick={() => handleSkillClick(skill)}
                      onMouseEnter={() => setActiveIndex(i())}
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
            fallback={<div class="ins-mention-empty">{props.skillsLoading ? "正在加载技能…" : "暂无自定义技能"}</div>}
          >
            <div class="ins-mention-secondary-content" ref={listRef}>
              <For each={filteredCustom()}>
                {(skill, i) => {
                  const sel: MentionSelection = { type: "skill", name: skill.label, label: skill.label }
                  return (
                    <button
                      type="button"
                      data-row={i()}
                      class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""} ${activeIndex() === i() ? "ins-mention-item--active" : ""}`}
                      onClick={() => handleSkillClick(skill)}
                      onMouseEnter={() => setActiveIndex(i())}
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
            fallback={<div class="ins-mention-empty">{props.filesLoading ? "正在加载用研资产…" : "暂无用研资产"}</div>}
          >
            <div class="ins-mention-secondary-content ins-mention-secondary-content--files" ref={listRef}>
              <Show when={filteredFiles()!.generated.length > 0}>
                <div class="ins-mention-section-title">生成文件</div>
                <For each={filteredFiles()!.generated}>
                  {(file, i) => {
                    const sel: MentionSelection = { type: "file", filename: file.name, path: file.path }
                    return (
                      <button
                        type="button"
                        data-row={i()}
                        class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""} ${activeIndex() === i() ? "ins-mention-item--active" : ""}`}
                        onClick={() => handleFileClick(file)}
                        onMouseEnter={() => setActiveIndex(i())}
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
                  {(file, i) => {
                    const sel: MentionSelection = { type: "file", filename: file.name, path: file.path }
                    // 上传段接在生成段之后编号,与 rows() 的扁平顺序对齐
                    const row = () => filteredFiles()!.generated.length + i()
                    return (
                      <button
                        type="button"
                        data-row={row()}
                        class={`ins-mention-item ${isSelected(sel) ? "ins-mention-item--selected" : ""} ${activeIndex() === row() ? "ins-mention-item--active" : ""}`}
                        onClick={() => handleFileClick(file)}
                        onMouseEnter={() => setActiveIndex(row())}
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
