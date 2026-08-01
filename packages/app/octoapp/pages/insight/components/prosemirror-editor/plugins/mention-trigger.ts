import { Plugin, PluginKey } from "prosemirror-state"

export interface MentionTriggerState {
  active: boolean
  query: string
  from: number
  to: number
}

export const mentionTriggerKey = new PluginKey("mentionTrigger")

export function createMentionTriggerPlugin(
  onChange: (state: MentionTriggerState | null) => void,
  onTrigger?: () => void
) {
  return new Plugin({
    key: mentionTriggerKey,
    state: {
      init() {
        return null as MentionTriggerState | null
      },
      apply(tr, prev) {
        const meta = tr.getMeta(mentionTriggerKey)
        if (meta !== undefined) {
          return meta
        }
        return prev
      },
    },
    view(editorView) {
      return {
        update(view, prevState) {
          const { state } = view
          const { from } = state.selection
          
          const prevTrigger = mentionTriggerKey.getState(prevState)
          
          const textBefore = state.doc.textBetween(Math.max(0, from - 50), from)
          const match = textBefore.match(/(?:^|\s)@([^\s@]*)$/)
          
          if (match) {
            // Only update if state changed (avoid infinite loop)
            if (!prevTrigger?.active || prevTrigger.query !== match[1]) {
              // match[0] includes leading space, adjust start position
              const start = from - match[1].length - 1  // -1 for @
              const newState = { active: true, query: match[1] || "", from: start, to: from }
              
              const tr = view.state.tr.setMeta(mentionTriggerKey, newState)
              view.dispatch(tr)
              
              onChange(newState)
              onTrigger?.()
            }
          } else {
            if (prevTrigger?.active) {
              const tr = view.state.tr.setMeta(mentionTriggerKey, null)
              view.dispatch(tr)
              
              onChange(null)
            }
          }
        },
      }
    },
  })
}

export function closeMentionTrigger(view: { state: { tr: any }; dispatch: (tr: any) => void }) {
  const tr = view.state.tr.setMeta(mentionTriggerKey, null)
  view.dispatch(tr)
}