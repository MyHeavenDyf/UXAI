import { Plugin, PluginKey } from "prosemirror-state"

export const noEmptyParagraphKey = new PluginKey("noEmptyParagraph")

export function createNoEmptyParagraphPlugin() {
  return new Plugin({
    key: noEmptyParagraphKey,
    appendTransaction(transactions, oldState, newState) {
      const doc = newState.doc
      const tr = newState.tr
      
      let modified = false
      const positionsToDelete: number[] = []
      
      doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.content.size === 0) {
          positionsToDelete.push(pos)
        }
      })
      
      if (positionsToDelete.length > 1) {
        for (let i = positionsToDelete.length - 1; i >= 1; i--) {
          const pos = positionsToDelete[i]
          const $pos = doc.resolve(pos)
          tr.delete(pos, pos + 1)
          modified = true
        }
      }
      
      if (modified) {
        return tr
      }
      
      return null
    },
  })
}