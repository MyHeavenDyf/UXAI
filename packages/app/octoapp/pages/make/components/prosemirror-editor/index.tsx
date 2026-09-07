import { createSignal, onMount, onCleanup, Show, createEffect } from "solid-js"
import { Portal } from "solid-js/web"
import { EditorState, Transaction, TextSelection, Plugin } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { baseKeymap } from "prosemirror-commands"
import { Fragment, Slice } from "prosemirror-model"
import type { Node as PMNode } from "prosemirror-model"
import { editorSchema, getDocTextWithMentions, extractMentionsFromDoc, docFromJSON, docJSONFromPlainText, type MentionAttrs } from "./schema"
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
  getMentions: () => MentionAttrs[]
  focus: () => void
  clear: () => void
  insertText: (text: string) => void
  replaceSlashCommand: (text: string) => void
  insertMention: (selection: MentionSelection) => void
  removeMention: (selection: MentionSelection) => void
  updateMentionPath: (id: string, path: string) => void
  isAlive: () => boolean
  replaceDoc: (json: any) => void
  closeMention: () => void
}

interface Props {
  sessionId: string
  skillConfig: {
    skill?: Record<string, import("../skill-config-types").SkillConfigEntry>
    panel?: { common?: PanelSkill[]; octo_make?: PanelSkill[] }
  }
  artifactFiles: { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null | undefined
  mentionSelections: MentionSelection[]
  setMentionSelections: (selections: MentionSelection[]) => void
  disabled?: boolean
  busy?: boolean
  autofocus?: boolean
  onSubmit?: () => void
  onTriggerMention?: () => void
  onContentChange?: (docJSON: any, text: string) => void
  initialDocJSON?: any
  onSlashTrigger?: (query: string) => void
  onSlashClose?: () => void
  onPreview?: (url: string) => void
  onPaste?: (e: ClipboardEvent) => void
  ref?: (el: EditorRef) => void
  onTriggerStateChange?: (active: boolean) => void
  productId?: number
  placeholder?: string
  onDownloadProductAsset?: (file: import("../addon-menu/asset-library").AssetFile, onProgress: (pct: number) => void, signal?: AbortSignal) => Promise<string>
  onUpdateMentionPath?: (filename: string, path: string) => void
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
    props.onTriggerStateChange?.(!!state?.active)
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
        return { type: "file", filename: m.name, path: m.path || "", id: m.id ?? undefined, isFolder: m.type === "folder" ? true : undefined }
      }
    })
    props.setMentionSelections(selections)
    setIsEmpty(empty)
  }, props.onContentChange)

  const connected = (v: EditorView | undefined): v is EditorView => !!v && !!v.dom?.isConnected

  function filterMentionDuplicates(fragment: Fragment, seen: Set<string>): Fragment {
    const nodes: PMNode[] = []
    fragment.forEach((node) => {
      if (node.type.name === "mention") {
        // 只有技能才去重，文件不去重
        if (node.attrs.type === "skill") {
          const key = node.attrs.name
          if (!seen.has(key)) {
            seen.add(key)
            nodes.push(node)
          }
        } else {
          nodes.push(node)
        }
      } else if (node.content && node.content.size > 0) {
        const filtered = filterMentionDuplicates(node.content, seen)
        nodes.push(node.copy(filtered))
      } else {
        nodes.push(node)
      }
    })
    return Fragment.from(nodes)
  }

  const pasteDedupPlugin = new Plugin({
    props: {
      handlePaste(view, event, slice) {
        const { from, to } = view.state.selection
        
        // 收集未被框选的技能
        const existingSkills = new Set<string>()
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === "mention" && node.attrs.type === "skill") {
            // 检查节点是否在框选范围外
            if (pos < from || pos >= to) {
              existingSkills.add(node.attrs.name)
            }
          }
        })
        
        // 过滤粘贴内容
        const filtered = filterMentionDuplicates(slice.content, existingSkills)
        const newSlice = new Slice(filtered, slice.openStart, slice.openEnd)
        
        // 应用粘贴
        const tr = view.state.tr.replaceSelection(newSlice)
        view.dispatch(tr)
        
        return true
      }
    }
  })

  onMount(() => {
    if (!containerRef) return

    const hasValidInitial = props.initialDocJSON?.content?.length > 0
    const initialDoc = hasValidInitial
      ? docFromJSON(props.initialDocJSON)
      : editorSchema.nodes.doc.create({ content: [{ type: "paragraph" }] })

    const state = EditorState.create({
      schema: editorSchema,
      doc: initialDoc,
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
        pasteDedupPlugin,
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
        replaceSlashCommand: (text: string) => {
          const v = view()
          if (!v) return
          const trigger = slashTriggerState()
          if (!trigger?.active) {
            const tr = v.state.tr.insertText(text)
            v.dispatch(tr)
            return
          }
          // trigger.from points to the position AFTER the slash (start of query).
          // Include the slash itself in the replacement range so it doesn't double up.
          const tr = v.state.tr.insertText(text, trigger.from - 1, trigger.to)
          v.dispatch(tr)
          setSlashTriggerState(null)
        },
        insertMention: (selection: MentionSelection) => {
          const v = view()
          if (!v || !v.dom?.isConnected) return
          const attrs = selection.type === "skill"
            ? { id: selection.name, name: selection.name, type: "skill" as const, label: selection.label, path: "" }
            : {
                id: selection.path,
                name: selection.filename,
                type: (selection as any).isFolder ? ("folder" as const) : ("file" as const),
                label: selection.filename,
                path: selection.path,
              }
          const node = editorSchema.nodes.mention.create(attrs)
          const { from, to } = v.state.selection
          const tr = v.state.tr.replaceWith(from, to, node)
          const newPos = from + node.nodeSize
          tr.setSelection(TextSelection.create(tr.doc, newPos))
          v.dispatch(tr)
          v.focus()
        },
        removeMention: (selection: MentionSelection) => {
          const v = view()
          if (!v || !v.dom?.isConnected) return
          // For skills, match by name; for files, match by id (= path, unique per chip)
          const matchId = selection.type === "skill" ? selection.name : selection.path
          const matchName = selection.type === "skill" ? selection.name : selection.filename
          let lastPos = -1
          v.state.doc.descendants((node, pos) => {
            if (node.type.name !== "mention") return
            // Files have id = path (unique), so match by id first; skills match by name
            if (selection.type === "file") {
              if (node.attrs.id === matchId) lastPos = pos
            } else {
              if (node.attrs.name === matchName) lastPos = pos
            }
          })
          if (lastPos === -1) return
          const size = v.state.doc.nodeAt(lastPos)!.nodeSize
          const tr = v.state.tr.delete(lastPos, lastPos + size)
          v.dispatch(tr)
        },
        updateMentionPath: (id: string, path: string) => {
          const v = view()
          if (!v || !v.dom?.isConnected) return
          const tr = v.state.tr
          v.state.doc.descendants((node, pos) => {
            if (node.type.name === "mention" && node.attrs.id === id && node.attrs.path !== path) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, path })
            }
          })
          if (tr.docChanged) v.dispatch(tr)
        },
        isAlive: () => {
          const v = view()
          return !!v && !!v.dom?.isConnected
        },
        replaceDoc: (json: any) => {
          const v = view()
          if (!v || !v.state || !v.dom?.isConnected) return
          const valid = json?.content?.length > 0
          const newDoc = valid
            ? docFromJSON(json)
            : editorSchema.nodes.doc.create({ content: [{ type: "paragraph" }] })
          const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, newDoc.content)
          tr.setSelection(TextSelection.atStart(tr.doc))
          v.dispatch(tr)
        },
        closeMention: () => {
          const v = view()
          const trigger = triggerState()
          if (v && trigger) {
            const from = Math.min(trigger.from, v.state.doc.content.size)
            const to = Math.min(trigger.to, v.state.doc.content.size)
            if (from < to) {
              const tr = v.state.tr.delete(from, to)
              v.dispatch(tr)
            }
          }
          if (v) {
            const tr = v.state.tr.setMeta(mentionTriggerKey, null)
            v.dispatch(tr)
          }
          setTriggerState(null)
          setPopoverPosition(null)
          props.onTriggerStateChange?.(false)
        },
      })
    }

    // onMount 后立即同步初始 mention selections 与 isEmpty（sync plugin 不会在初始化触发 update）
    if (props.setMentionSelections) {
      const initialMentions = extractMentionsFromDoc(initialDoc)
      props.setMentionSelections(initialMentions.map((m) =>
        m.type === "skill"
          ? { type: "skill", name: m.name, label: m.label }
          : { type: "file", filename: m.name, path: m.path || "" }
      ))
    }
    const initialText = getDocTextWithMentions(initialDoc)
    setIsEmpty(initialText.trim().length === 0)

    // 自动聚焦放到下一帧:此刻 DOM 刚插入,同帧 focus() 会被随后的布局/父级渲染抢掉
    if (props.autofocus && !props.disabled) {
      requestAnimationFrame(() => {
        if (editorView.dom?.isConnected) {
          editorView.focus()
        }
      })
    }

    onCleanup(() => {
      editorView.destroy()
      setView(undefined)
    })
  })

  createEffect(() => {
    const v = view()
    if (!v) return
    v.setProps({ ...v.props, editable: () => !props.disabled })
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
        const trigger = triggerState()
        
        if (v && trigger) {
          // Delete @abc search text
          // 确保 position 在文档范围内
          const from = Math.min(trigger.from, v.state.doc.content.size)
          const to = Math.min(trigger.to, v.state.doc.content.size)
          if (from < to) {
            const tr = v.state.tr.delete(from, to)
            v.dispatch(tr)
          }
        }
        
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

    let attrs: any
    if (selection.type === "skill") {
      attrs = { id: selection.name, name: selection.name, type: "skill" as const, label: selection.label, path: "" }
    } else {
      const id = selection.path || selection.filename
      attrs = { id, name: selection.filename, type: "file" as const, label: selection.filename, path: selection.path }
    }

    const node = editorSchema.nodes.mention.create(attrs)
    
    // 确保 position 在文档范围内
    const insertPos = Math.min(trigger.to, v.state.doc.content.size)
    
    const tr = v.state.tr.insert(insertPos, node)
    tr.setSelection(TextSelection.create(tr.doc, trigger.from + 1))
    v.dispatch(tr)
    
    v.focus()
  }

  const handleMentionDeselect = (selection: MentionSelection) => {
    const v = view()
    if (!v) return

    const name = selection.type === "skill" ? selection.name : selection.filename
    
    // Delete the last matching MentionNode
    let lastPos = -1
    let lastSize = 0
    v.state.doc.descendants((node, pos) => {
      if (node.type.name === "mention" && node.attrs.name === name) {
        lastPos = pos
        lastSize = node.nodeSize
      }
    })
    
    if (lastPos >= 0 && lastPos + lastSize <= v.state.doc.content.size) {
      const tr = v.state.tr.delete(lastPos, lastPos + lastSize)
      v.dispatch(tr)
    }
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
        <div class="pm-placeholder">{props.placeholder ?? "输入你的想法生成可交互的原型效果..."}</div>
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
              bottom: `${popoverPosition()!.bottom + 1}px`,
              "z-index": 1000,
            }}
          >
            <MentionPopover
              query={triggerState()!.query}
              sessionId={props.sessionId}
              onClose={() => {
                const v = view()
                const trigger = triggerState()
                if (v && trigger) {
                  const tr = v.state.tr.delete(trigger.from, trigger.to)
                  v.dispatch(tr)
                }
                setTriggerState(null)
              }}
              onSelect={handleMentionSelect}
              onDeselect={handleMentionDeselect}
              selections={props.mentionSelections}
              skillConfig={props.skillConfig}
              artifactFiles={props.artifactFiles}
              productId={props.productId}
              onDownloadProductAsset={props.onDownloadProductAsset}
              onUpdateMentionPath={props.onUpdateMentionPath}
            />
          </div>
        </Portal>
      </Show>
    </div>
  )
}

export { getDocTextWithMentions, extractMentionsFromDoc, docJSONFromPlainText, type MentionAttrs }