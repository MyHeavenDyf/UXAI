import { afterEach, describe, expect, test } from "bun:test"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { history, redo, undo } from "prosemirror-history"
import { editorSchema, type MentionAttrs } from "../schema"
import { createSyncPlugin } from "./sync"

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach(view => { view.destroy(); view.dom.parentElement?.remove() }))

function editor(count = 0) {
  const changes: { mentions: MentionAttrs[]; empty: boolean }[] = []
  const contents: { text: string; doc: ReturnType<EditorState["doc"]["toJSON"]> }[] = []
  const mount = document.body.appendChild(document.createElement("div"))
  const view = new EditorView(mount, {
    state: EditorState.create({
      schema: editorSchema,
      doc: editorSchema.nodes.doc.create(null, editorSchema.nodes.paragraph.create(null,
        Array.from({ length: count }, (_, index) => editorSchema.nodes.mention.create({
          id: `asset-${Math.floor(index / 200)}`, type: "file", name: `${index}.txt`, label: `${index}.txt`, path: `/uploads/${index}.txt`,
        })),
      )),
      plugins: [history(), createSyncPlugin(
        (mentions, empty) => changes.push({ mentions, empty }),
        (doc, text) => contents.push({ doc, text }),
      )],
    }),
  })
  views.push(view)
  return { view, changes, contents }
}

describe("Insight 编辑器引用同步", () => {
  test("1000 个资产文件引用下连续输入 100 次，不重复通知选择列表，正文仍实时更新", () => {
    const result = editor(1000)
    for (const index of Array.from({ length: 100 }, (_, index) => index)) {
      result.view.dispatch(result.view.state.tr.insertText("a", result.view.state.doc.content.size - 1))
      expect(result.contents.at(-1)?.text.endsWith("a".repeat(index + 1))).toBe(true)
    }
    expect(result.changes).toHaveLength(0)
    expect(result.contents).toHaveLength(100)
    expect(result.contents.at(-1)?.doc.content[0].content).toHaveLength(1001)
    result.view.dispatch(result.view.state.tr.setSelection(TextSelection.create(result.view.state.doc, 1)))
    expect(result.contents).toHaveLength(100)
  })

  test("引用属性变化、删除、撤销和重做仍同步", () => {
    const result = editor(2)
    const attrs = { ...result.view.state.doc.nodeAt(1)!.attrs, type: "file" as const, id: "new-id", name: "new.txt", label: "new", path: "/new.txt", isFolder: true }
    result.view.dispatch(result.view.state.tr.setNodeMarkup(1, undefined, attrs))
    expect(result.changes.at(-1)?.mentions[0]).toEqual(attrs)
    result.view.dispatch(result.view.state.tr.delete(1, 2))
    expect(result.changes.at(-1)?.mentions).toHaveLength(1)
    expect(undo(result.view.state, tr => result.view.dispatch(tr))).toBe(true)
    expect(result.changes.at(-1)?.mentions).toHaveLength(2)
    expect(redo(result.view.state, tr => result.view.dispatch(tr))).toBe(true)
    expect(result.changes.at(-1)?.mentions).toHaveLength(1)
  })

  test("同数目引用换序及单独修改任一属性不会漏同步", () => {
    const result = editor(2)
    const nodes = [result.view.state.doc.nodeAt(2)!, result.view.state.doc.nodeAt(1)!]
    result.view.dispatch(result.view.state.tr.replaceWith(1, 3, nodes))
    expect(result.changes.at(-1)?.mentions.map(item => item.name)).toEqual(["1.txt", "0.txt"])
    for (const [key, value] of Object.entries({ id: "new-id", name: "new.txt", label: "new label", path: "/new.txt", type: "skill", isFolder: true })) {
      result.view.dispatch(result.view.state.tr.setNodeMarkup(1, undefined, { ...result.view.state.doc.nodeAt(1)!.attrs, [key]: value }))
      expect(result.changes.at(-1)?.mentions[0][key as keyof MentionAttrs]).toBe(value)
    }
    expect(result.changes).toHaveLength(7)
  })

  test("空白状态仅在变化时通知，清空文档不漏同步", () => {
    const result = editor()
    result.view.dispatch(result.view.state.tr.insertText("text", 1))
    expect(result.changes).toEqual([{ mentions: [], empty: false }])
    result.view.dispatch(result.view.state.tr.insertText(" more"))
    expect(result.changes).toHaveLength(1)
    result.view.dispatch(result.view.state.tr.delete(0, result.view.state.doc.content.size))
    expect(result.changes.at(-1)).toEqual({ mentions: [], empty: true })
    expect(result.contents.at(-1)?.text).toBe("")
  })
})
