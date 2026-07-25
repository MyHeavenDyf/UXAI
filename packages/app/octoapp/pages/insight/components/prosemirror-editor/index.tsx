import { createSignal, onMount, onCleanup, Show, createEffect } from "solid-js"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { editorSchema, getDocTextWithMentions, extractMentionsFromDoc, type MentionAttrs } from "./schema"
import { createMentionTriggerPlugin, mentionTriggerKey, type MentionTriggerState } from "./plugins/mention-trigger"
import { createSyncPlugin } from "./plugins/sync"
import { atomKeymap } from "./plugins/atom-keymap"
import { createNoEmptyParagraphPlugin } from "./plugins/no-empty-paragraph"
import { MentionPopover, type MentionSelection, type MentionSkill, type MentionFiles } from "../mention-popover"
import "./styles.css"

// SPEC-INS-023 方案 B:insight 输入框换成 ProseMirror,拿到行内灰胶囊(@提及原子节点)。
// 本地化自 Design/make 的 prosemirror-editor:去掉 slash-trigger（/ 不做）与 /preview；
// 接 insight 的 MentionPopover（octo_insight 技能 + insight 会话文件）。
// 3b 注入不变：编辑器只负责「文本 + 提及」的采集,发送时的 SKILL.md / [引用文件] synthetic 注入在 index.tsx。

export interface InsightEditorRef {
  getText: () => string
  getMentions: () => Array<{ name: string; type: string; label: string; path?: string }>
  focus: () => void
  clear: () => void
  /** 覆盖式回填纯文本(排队回填等);@名 退化为纯文本,不重建胶囊 */
  setText: (text: string) => void
}

interface Props {
  platformSkills: MentionSkill[]
  customSkills: MentionSkill[]
  files: MentionFiles | null
  mentionSelections: MentionSelection[]
  setMentionSelections: (selections: MentionSelection[]) => void
  disabled?: boolean
  placeholder?: string
  onSubmit?: () => void
  onTriggerMention?: () => void
  onContentChange?: (text: string) => void
  /** 面板由关到开那一次(打点 mention-open) */
  onMentionOpen?: () => void
  /** 选中一项(打点 mention-select) */
  onMentionSelect?: (selection: MentionSelection) => void
  /** 粘贴事件透传(insight 用于拦截图片/文件粘贴进附件;文本粘贴不拦,交给编辑器) */
  onPaste?: (e: ClipboardEvent) => void
  ref?: (el: InsightEditorRef) => void
}

export function ProseMirrorEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined
  const [view, setView] = createSignal<EditorView>()
  const [triggerState, setTriggerState] = createSignal<MentionTriggerState | null>(null)
  const [isEmpty, setIsEmpty] = createSignal(true)

  const mentionTriggerPlugin = createMentionTriggerPlugin((state) => {
    const wasActive = triggerState()?.active ?? false
    setTriggerState(state)
    if (state?.active && !wasActive) props.onMentionOpen?.()
  }, props.onTriggerMention)

  const syncPlugin = createSyncPlugin((mentions: MentionAttrs[], empty: boolean) => {
    const selections: MentionSelection[] = mentions.map((m) =>
      m.type === "skill"
        ? { type: "skill", name: m.name, label: m.label }
        : { type: "file", filename: m.name, path: m.path || "" },
    )
    props.setMentionSelections(selections)
    setIsEmpty(empty)
  }, props.onContentChange)

  const connected = (v: EditorView | undefined): v is EditorView => !!v && !!v.dom?.isConnected

  onMount(() => {
    if (!containerRef) return

    const state = EditorState.create({
      schema: editorSchema,
      plugins: [
        history(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-shift-z": redo,
          Enter: () => {
            if (props.disabled) return false
            props.onSubmit?.()
            return true
          },
          "Shift-Enter": () => false, // 换行交给 baseKeymap
        }),
        keymap(baseKeymap),
        atomKeymap,
        mentionTriggerPlugin,
        syncPlugin,
        createNoEmptyParagraphPlugin(),
      ],
    })

    const editorView = new EditorView(containerRef, {
      state,
      dispatchTransaction: (tr: Transaction) => {
        const newState = editorView.state.apply(tr)
        editorView.updateState(newState)
      },
      editable: () => !props.disabled,
    })

    setView(editorView)

    props.ref?.({
      getText: () => (connected(view()) ? getDocTextWithMentions(view()!.state.doc) : ""),
      getMentions: () => (connected(view()) ? extractMentionsFromDoc(view()!.state.doc) : []),
      focus: () => {
        if (connected(view())) view()!.focus()
      },
      clear: () => {
        const v = view()
        if (!connected(v)) return
        v.dispatch(v.state.tr.delete(0, v.state.doc.content.size))
      },
      setText: (text: string) => {
        const v = view()
        if (!connected(v)) return
        const tr = v.state.tr.delete(0, v.state.doc.content.size)
        if (text) tr.insertText(text)
        v.dispatch(tr)
      },
    })

    onCleanup(() => editorView.destroy())
  })

  // disabled 变化时同步 editable
  createEffect(() => {
    const v = view()
    if (!v) return
    const isEditable = !props.disabled
    if (v.editable !== isEditable) v.setProps({ ...v.props, editable: () => isEditable })
  })

  // 点击面板外关闭
  createEffect(() => {
    if (!triggerState()?.active) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest(".pm-editor")) return
      if (!target.closest(".ins-mention-container")) {
        const v = view()
        if (v) v.dispatch(v.state.tr.setMeta(mentionTriggerKey, null))
        setTriggerState(null)
      }
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  // 选中:把触发区间的 @query 替换成 mention 原子节点(灰胶囊);selections 由 syncPlugin 从 doc 派生
  const handleMentionSelect = (selection: MentionSelection) => {
    const v = view()
    const trigger = triggerState()
    if (!v || !trigger) return

    const attrs =
      selection.type === "skill"
        ? { id: selection.name, name: selection.name, type: "skill" as const, label: selection.label, path: "" }
        : { id: selection.filename, name: selection.filename, type: "file" as const, label: selection.filename, path: selection.path }

    const node = editorSchema.nodes.mention.create(attrs)
    const tr = v.state.tr.replaceWith(trigger.from, trigger.to, node)
    tr.setSelection(TextSelection.create(tr.doc, trigger.from + node.nodeSize))
    v.dispatch(tr)
    setTriggerState(null)
    v.focus()
    props.onMentionSelect?.(selection)
  }

  // 取消:删掉对应 mention 节点 + 光标前残留的 @query 文本
  const handleMentionDeselect = (selection: MentionSelection) => {
    const v = view()
    if (!v) return
    const name = selection.type === "skill" ? selection.name : selection.filename

    const tr1 = v.state.tr
    v.state.doc.descendants((node, pos) => {
      if (node.type.name === "mention" && node.attrs.name === name) tr1.delete(pos, pos + node.nodeSize)
    })
    if (tr1.docChanged) v.dispatch(tr1)

    const { from } = v.state.selection
    const textBefore = v.state.doc.textBetween(Math.max(0, from - 50), from)
    const match = textBefore.match(/@([^\s@]*)$/)
    if (match) v.dispatch(v.state.tr.delete(from - match[0].length, from))

    setTriggerState(null)
  }

  return (
    <div class="pm-editor-wrapper">
      <Show when={isEmpty() && !props.disabled && props.placeholder}>
        <div class="pm-placeholder">{props.placeholder}</div>
      </Show>
      <div
        ref={containerRef}
        class="pm-editor"
        classList={{ "pm-editor--disabled": props.disabled }}
        onPaste={(e) => props.onPaste?.(e)}
      />

      <Show when={triggerState()?.active}>
        <MentionPopover
          query={triggerState()!.query}
          platformSkills={props.platformSkills}
          customSkills={props.customSkills}
          files={props.files}
          selections={props.mentionSelections}
          onSelect={handleMentionSelect}
          onDeselect={handleMentionDeselect}
          onClose={() => setTriggerState(null)}
        />
      </Show>
    </div>
  )
}

export { getDocTextWithMentions, extractMentionsFromDoc }
