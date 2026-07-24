import { Plugin, PluginKey } from "prosemirror-state"
import type { MentionAttrs } from "../schema"
import { getDocTextWithMentions } from "../schema"

export const syncPluginKey = new PluginKey("sync")

export function createSyncPlugin(
  onChange: (mentions: MentionAttrs[], isEmpty: boolean) => void,
  onContentChange?: (text: string) => void
) {
  return new Plugin({
    key: syncPluginKey,
    view(editorView) {
      return {
        update(view, prevState) {
          const { state } = view
          
          if (!prevState.doc.eq(state.doc)) {
            const mentions: MentionAttrs[] = []
            state.doc.descendants((node) => {
              if (node.type.name === "mention") {
                mentions.push({
                  id: node.attrs.id,
                  name: node.attrs.name,
                  type: node.attrs.type,
                  label: node.attrs.label,
                  path: node.attrs.path,
                })
              }
            })
            
            const text = getDocTextWithMentions(state.doc)
            const isEmpty = text.trim().length === 0
            onChange(mentions, isEmpty)
            
            if (onContentChange) {
              onContentChange(text)
            }
          }
        },
      }
    },
  })
}