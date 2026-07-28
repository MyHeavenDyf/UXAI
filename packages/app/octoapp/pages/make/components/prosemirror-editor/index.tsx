import { createSignal, onMount, onCleanup, Show, createEffect } from "solid-js"
import { Portal } from "solid-js/web"
import { EditorState, Transaction, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { editorSchema, getDocTextWithMentions, extractMentionsFromDoc, type MentionAttrs } from "./schema"
import { createMentionTriggerPlugin, mentionTriggerKey, closeMentionTrigger, type MentionTriggerState } from "./plugins/mention-trigger"
import { createSyncPlugin } from "./plugins/sync"
import { atomKeymap } from "./plugins/atom-keymap"
import { createSlashTriggerPlugin, slashTriggerKey, type SlashTriggerState } from "./plugins/slash-trigger"
import { MentionPopover, type MentionSelection } from "../mention-popover"
import type { PanelSkill } from "../skill-config-types"
import type { ArtifactFile } from "@/pages/make/utils/artifact-file-api"
import "./styles.css"

interface EditorRef {
  getText: () => string
  getMentions: () => Array<{ name: string; type: string; label: string; path?: string }>
  focus: () => void
  clear: () => void
  insertText: (text: string) => void
}

interface Props {
  sessionId: string
  skillConfig: { panel?: { common?: PanelSkill[]; octo_make?: PanelSkill[] } }
  artifactFiles: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null | undefined
  mentionSelections: MentionSelection[]
  setMentionSelections: (selections: MentionSelection[]) => void
  disabled?: boolean
  onSubmit?: () => void
  onTriggerMention?: () => void
  onContentChange?: (text: string) => void
  onSlashTrigger?: (query: string) => void
  onSlashClose?: () => void
  onPreview?: (url: string) => void
  onPaste?: (e: ClipboardEvent) => void
  ref?: (el: EditorRef) => void
}

export const ProseMirrorEditor = (props: Props) => {
  let containerRef: HTMLDivElement | undefined
  const [view, setView] = createSignal<EditorView>()
  const [triggerState, setTriggerState] = createSignal<MentionTriggerState | null>(null)
  const [slashTriggerState, setSlashTriggerState] = createSignal<SlashTriggerState | null>(null)
  const [focused, setFocused] = createSignal(false)
  const [isEmpty, setIsEmpty] = createSignal(true)
  const [popoverPosition, setPopoverPosition] = createSignal<{ left: number; bottom: number } | null>(null)

  const mentionTriggerPlugin = createMentionTriggerPlugin((state) => {
    setTriggerState(state)
    if (state?.active && containerRef) {
      const rect = containerRef.getBoundingClientRect()
      setPopoverPosition({ left: rect.left, bottom: window.innerHeight - rect.top })
    } else {
      setPopoverPosition(null)
    }
  }, props.onTriggerMention)

  const slashTriggerPlugin = createSlashTriggerPlugin((state) => {
    setSlashTriggerState(state)
    if (state?.active) {
      props.onSlashTrigger?.(state.query)
    } else if (state === null) {
      props.onSlashClose?.()
    }
  })

  const syncPlugin = createSyncPlugin((mentions: MentionAttrs[], empty: boolean) => {
    const selections: MentionSelection[] = mentions.map((m) => {
      if (m.type === "skill") {
        return { type: "skill", name: m.name, label: m.label }
      } else {
        return { type: "file", filename: m.name, path: m.path || "" }
      }
    })
    props.setMentionSelections(selections)
    setIsEmpty(empty)
  }, props.onContentChange)

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
          "Enter": (state, dispatch, view) => {
            if (props.disabled) return false
            
            // If mention popover is open, don't send message
            const mentionTrigger = mentionTriggerKey.getState(state)
            if (mentionTrigger?.active) {
              return false
            }
            
            // If slash popover is open, don't send message
            const slashTrigger = slashTriggerKey.getState(state)
            if (slashTrigger?.active) {
              return false
            }
            
            // Check for /preview command
            const text = getDocTextWithMentions(state.doc).trim()
            const previewMatch = text.match(/^\/preview\s+(.+)$/)
            if (previewMatch) {
              props.onPreview?.(previewMatch[1])
              return true
            }
            
            // Otherwise send message
            props.onSubmit?.()
            return true
          },
          "Shift-Enter": (state, dispatch) => {
            if (props.disabled) return false
            const hardBreak = state.schema.nodes.hard_break
            if (dispatch) {
              dispatch(state.tr.replaceSelectionWith(hardBreak.create()))
            }
            return true
          },
          "ArrowUp": (state, dispatch) => {
            const mentionTrigger = mentionTriggerKey.getState(state)
            if (mentionTrigger?.active) {
              return false  // Let MentionPopover handle it
            }
            return false
          },
          "ArrowDown": (state, dispatch) => {
            const mentionTrigger = mentionTriggerKey.getState(state)
            if (mentionTrigger?.active) {
              return false  // Let MentionPopover handle it
            }
            return false
          },
        }),
        keymap(baseKeymap),
        atomKeymap,
        mentionTriggerPlugin,
        slashTriggerPlugin,
        syncPlugin,
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
    
    // Expose ref methods
    if (props.ref) {
      props.ref({
        getText: () => {
          const v = view()
          if (!v) return ""
          return getDocTextWithMentions(v.state.doc)
        },
        getMentions: () => {
          const v = view()
          if (!v) return []
          return extractMentionsFromDoc(v.state.doc)
        },
        focus: () => {
          const v = view()
          if (v) v.focus()
        },
        clear: () => {
          const v = view()
          if (!v || !v.state || !v.state.doc || !v.dom?.isConnected) return
          const tr = v.state.tr.delete(0, v.state.doc.content.size)
          v.dispatch(tr)
        },
        insertText: (text: string) => {
          const v = view()
          if (!v) return
          const tr = v.state.tr.insertText(text)
          v.dispatch(tr)
        },
      })
    }

    onCleanup(() => editorView.destroy())
  })

  createEffect(() => {
    const v = view()
    if (!v) return
    
    const isEditable = !props.disabled
    if (v.editable !== isEditable) {
      v.setProps({ ...v.props, editable: () => isEditable })
    }
  })

  // Close popover when clicking outside
  createEffect(() => {
    const state = triggerState()
    if (!state?.active) return
    
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      
      // Don't close if clicking on editor (let ProseMirror handle it)
      if (target.closest(".pm-editor")) return
      
      if (!target.closest(".mention-popover-container")) {
        console.log("[click-outside] closing popover")
        const v = view()
        
        if (v) {
          const tr = v.state.tr.setMeta(mentionTriggerKey, null)
          v.dispatch(tr)
        }
        
        setTriggerState(null)
      }
    }
    
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  // Close slash popover when clicking outside
  createEffect(() => {
    const state = slashTriggerState()
    if (!state?.active) return
    
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      
      // Don't close if clicking on editor or slash popover
      if (target.closest(".pm-editor")) return
      if (target.closest(".slash-popover")) return
      
      // Clear plugin state first
      const v = view()
      if (v) {
        const tr = v.state.tr.setMeta(slashTriggerKey, null)
        v.dispatch(tr)
      }
      // Then clear component state
      setSlashTriggerState(null)
      // Notify parent
      props.onSlashClose?.()
    }
    
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  const handleMentionSelect = (selection: MentionSelection) => {
    const v = view()
    const trigger = triggerState()
    if (!v || !trigger) return

    const attrs = selection.type === "skill"
      ? { id: selection.name, name: selection.name, type: "skill" as const, label: selection.label, path: "" }
      : { id: selection.filename, name: selection.filename, type: "file" as const, label: selection.filename, path: selection.path }

    const node = editorSchema.nodes.mention.create(attrs)
    const pos = trigger.from
    const tr = v.state.tr.replaceWith(trigger.from, trigger.to, node)
    
    const newPos = pos + node.nodeSize
    tr.setSelection(TextSelection.create(tr.doc, newPos))
    
    v.dispatch(tr)
    setTriggerState(null)
    v.focus()
  }

  const handleMentionDeselect = (selection: MentionSelection) => {
    const v = view()
    if (!v) return

    const name = selection.type === "skill" ? selection.name : selection.filename
    
    // First, delete existing MentionNode
    const tr1 = v.state.tr
    v.state.doc.descendants((node, pos) => {
      if (node.type.name === "mention" && node.attrs.name === name) {
        tr1.delete(pos, pos + node.nodeSize)
      }
    })
    
    if (tr1.docChanged) {
      v.dispatch(tr1)
    }
    
    // Then, delete @ text at current cursor position (after MentionNode is removed)
    const state2 = v.state
    const { from } = state2.selection
    const textBefore = state2.doc.textBetween(Math.max(0, from - 50), from)
    const match = textBefore.match(/@([^\s@]*)$/)
    
    if (match) {
      const start = from - match[0].length
      const tr2 = state2.tr.delete(start, from)
      v.dispatch(tr2)
    }
    
    setTriggerState(null)
  }

  const getText = () => {
    const v = view()
    if (!v) return ""
    return getDocTextWithMentions(v.state.doc)
  }

  const focus = () => {
    const v = view()
    if (v) v.focus()
  }

  const clear = () => {
    const v = view()
    if (!v) return
    
    const tr = v.state.tr
    tr.delete(0, v.state.doc.content.size)
    v.dispatch(tr)
  }

  const insertText = (text: string) => {
    const v = view()
    if (!v) return

    const tr = v.state.tr.insertText(text)
    v.dispatch(tr)
  }

  return (
    <div class="pm-editor-wrapper">
      <Show when={isEmpty() && !props.disabled}>
        <div class="pm-placeholder">输入你的想法生成可交互的原型效果...</div>
      </Show>
      <div 
        ref={containerRef} 
        class="pm-editor"
        classList={{ "pm-editor--disabled": props.disabled }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={(e) => props.onPaste?.(e as ClipboardEvent)}
      />
      
      <Show when={triggerState()?.active && popoverPosition()}>
        <Portal>
          <div 
            style={{
              position: "fixed",
              left: `${popoverPosition()!.left}px`,
              bottom: `${popoverPosition()!.bottom + 12}px`,
              "z-index": 1000,
            }}
          >
            <MentionPopover
              query={triggerState()!.query}
              sessionId={props.sessionId}
              onClose={() => setTriggerState(null)}
              onSelect={handleMentionSelect}
              onDeselect={handleMentionDeselect}
              selections={props.mentionSelections}
              skillConfig={props.skillConfig}
              artifactFiles={props.artifactFiles}
            />
          </div>
        </Portal>
      </Show>
    </div>
  )
}

export { getDocTextWithMentions, extractMentionsFromDoc }