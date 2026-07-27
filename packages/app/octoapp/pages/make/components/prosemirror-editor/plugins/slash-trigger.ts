import { Plugin, PluginKey } from "prosemirror-state"

export interface SlashTriggerState {
  active: boolean
  query: string
  from: number
  to: number
}

export const slashTriggerKey = new PluginKey("slashTrigger")

export function createSlashTriggerPlugin(
  onChange: (state: SlashTriggerState | null) => void,
  onTrigger?: () => void
) {
  return new Plugin({
    key: slashTriggerKey,
    state: {
      init() {
        return null as SlashTriggerState | null
      },
      apply(tr, prev) {
        const meta = tr.getMeta(slashTriggerKey)
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
            // Match / at line start: /^\/([^\s/]*)$/
            const match = textBefore.match(/(?:^|\n)\/([^\s/]*)$/)
            
            if (match) {
              const start = from - match[0].length + (match[0].indexOf('/') + 1)
              const newState = { active: true, query: match[1] || "", from: start, to: from }
              
              const tr = view.state.tr.setMeta(slashTriggerKey, newState)
              view.dispatch(tr)
              
              onChange(newState)
              onTrigger?.()
            } else {
              const prevTrigger = slashTriggerKey.getState(prevState)
              if (prevTrigger?.active) {
                const tr = view.state.tr.setMeta(slashTriggerKey, null)
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