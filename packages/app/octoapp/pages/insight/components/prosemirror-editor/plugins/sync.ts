import { Plugin, PluginKey } from "prosemirror-state"
import type { Node as PMNode } from "prosemirror-model"
import type { MentionAttrs } from "../schema"
import { extractMentionsFromDoc, getDocTextWithMentions } from "../schema"

export const syncPluginKey = new PluginKey("sync")

export function createSyncPlugin(
  onChange: (mentions: MentionAttrs[], isEmpty: boolean) => void,
  onContentChange?: (docJSON: ReturnType<PMNode["toJSON"]>, text: string) => void
) {
  return new Plugin({
    key: syncPluginKey,
    view(editorView) {
      let mentions = extractMentionsFromDoc(editorView.state.doc)
      let empty = getDocTextWithMentions(editorView.state.doc).trim().length === 0
      return {
        update(view, prevState) {
          if (prevState.doc.eq(view.state.doc)) return
          const next = extractMentionsFromDoc(view.state.doc)
          const text = getDocTextWithMentions(view.state.doc)
          const isEmpty = text.trim().length === 0
          // 普通打字不重置整份选择，避免大量资产引用触发菜单及文件列表重复计算。
          if (empty !== isEmpty || next.length !== mentions.length || next.some((mention, index) => {
            const prev = mentions[index]
            return mention.id !== prev.id || mention.type !== prev.type || mention.name !== prev.name
              || mention.label !== prev.label || mention.path !== prev.path || mention.isFolder !== prev.isFolder
          })) {
            mentions = next
            empty = isEmpty
            onChange(mentions, empty)
          }
          onContentChange?.(view.state.doc.toJSON(), text)
        },
      }
    },
  })
}
