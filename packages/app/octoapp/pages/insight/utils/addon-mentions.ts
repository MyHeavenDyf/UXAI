import { Fragment } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"
import { TextSelection } from "prosemirror-state"
import type { MentionSelection } from "../components/mention-popover"

/** 外部菜单操作不使用 @query 的位置，所有选择始终由文档派生。 */
export function insertAddonMentions(state: EditorState, selections: MentionSelection[]) {
  const existing = new Set<string>()
  state.doc.descendants(node => {
    if (node.type.name === "mention") existing.add(`${node.attrs.type}:${node.attrs.type === "skill" ? node.attrs.name : node.attrs.path}`)
  })
  const nodes = selections.flatMap(selection => {
    const key = `${selection.type}:${selection.type === "skill" ? selection.name : selection.path}`
    if (existing.has(key)) return []
    existing.add(key)
    const attrs = selection.type === "skill"
      ? { id: selection.name, name: selection.name, type: "skill", label: selection.label, path: "" }
      : { id: selection.id ?? selection.path, name: selection.filename, type: "file", label: selection.filename, path: selection.path, files: selection.files ?? null }
    return [state.schema.nodes.mention.create(attrs), state.schema.text(" ")]
  })
  if (!nodes.length) return state.tr
  const tr = state.tr
  // 文件是附加引用，不替换草稿选区；取消勾选仅删除引用也能保留原文。
  if (selections.every(selection => selection.type === "file")) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to)))
  }
  const from = tr.selection.from
  tr.replaceSelectionWith(nodes[0])
  if (nodes.length > 1) tr.insert(tr.selection.from, Fragment.from(nodes.slice(1)))
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, from + nodes.reduce((n, node) => n + node.nodeSize, 0)))))
  return tr
}

export function removeAddonMention(state: EditorState, selection: MentionSelection) {
  const hits: { from: number; to: number }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "mention" || node.attrs.type !== selection.type) return
    if (selection.type === "skill" ? node.attrs.name !== selection.name : node.attrs.path !== selection.path) return
    const end = pos + node.nodeSize
    const after = state.doc.resolve(end).nodeAfter
    hits.push({ from: pos, to: end + (after?.isText && after.text?.startsWith(" ") ? 1 : 0) })
  })
  return hits.reverse().reduce((tr, hit) => tr.delete(hit.from, hit.to), state.tr)
}
