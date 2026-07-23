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
          
          if (from !== prevState.selection.from || !prevState.doc.eq(state.doc)) {
            const textBefore = state.doc.textBetween(Math.max(0, from - 50), from)
            const match = textBefore.match(/@([^\s@]*)$/)
            
            if (match) {
              const start = from - match[0].length
              const newState = { active: true, query: match[1] || "", from: start, to: from }
              
              // Update plugin state via transaction first
              const tr = view.state.tr.setMeta(mentionTriggerKey, newState)
              view.dispatch(tr)
              
              // Then notify component
              onChange(newState)
              onTrigger?.()
            } else {
              const prevTrigger = mentionTriggerKey.getState(prevState)
              if (prevTrigger?.active) {
                // Clear plugin state via transaction
                const tr = view.state.tr.setMeta(mentionTriggerKey, null)
                view.dispatch(tr)
                
                onChange(null)
              }
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