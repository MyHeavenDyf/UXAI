import { describe, expect, test } from "bun:test"
import { EditorState, TextSelection } from "prosemirror-state"
import { history, undo, redo } from "prosemirror-history"
import { editorSchema, extractMentionsFromDoc, getDocTextWithMentions } from "../components/prosemirror-editor/schema"
import { insertAddonMentions, removeAddonMention } from "./addon-mentions"
import { buildParagraphs, queuedMentions, splitMentions } from "./mention"

const file = (path: string) => ({ type: "file" as const, filename: "访谈.txt", path, id: "asset-1" })
const initial = () => EditorState.create({ schema: editorSchema, plugins: [history()] })

describe("加号引用操作", () => {
  test("资产包只显示一个胶囊，草稿恢复和队列回填仍保留包内文件", () => {
    const files = [
      { filename: "index (asset-1).html", path: "/asset-1/index.html" },
      { filename: "images/a (asset-1).svg", path: "/asset-1/images/a.svg" },
    ]
    const selection = { type: "file" as const, filename: "产品原型", path: "/asset-1", id: "asset-1", files }
    const base = initial()
    const added = base.apply(insertAddonMentions(base, [selection]))
    expect(extractMentionsFromDoc(added.doc)).toHaveLength(1)
    expect(getDocTextWithMentions(added.doc)).toBe("@产品原型 ")
    const restored = editorSchema.nodeFromJSON(added.doc.toJSON())
    expect(extractMentionsFromDoc(restored)[0].files).toEqual(files)
    const payload = splitMentions([selection, { type: "file", ...files[0] }])
    expect(payload.files.map(file => ({ filename: file.filename, path: file.path }))).toEqual(files)
    const queued = queuedMentions({ text: "@产品原型", ...payload })
    const rebuilt = editorSchema.nodes.doc.create(null, buildParagraphs("@产品原型", queued))
    expect(extractMentionsFromDoc(rebuilt)).toEqual(extractMentionsFromDoc(added.doc))
    expect(queuedMentions({ text: "@产品原型", ...splitMentions([{ type: "file", ...files[0] }, selection]) })).toEqual(queued)
    expect(added.apply(removeAddonMention(added, selection)).doc.eq(base.doc)).toBe(true)
    let state = added
    expect(undo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(extractMentionsFromDoc(state.doc)).toHaveLength(0)
    expect(redo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(extractMentionsFromDoc(state.doc)[0].files).toEqual(files)
  })

  test("选中文字后添加文件再取消，完整保留草稿", () => {
    const base = initial()
    const typed = base.apply(base.tr.insertText("draft text"))
    const state = typed.apply(typed.tr.setSelection(TextSelection.create(typed.doc, 1, 6)))
    const added = state.apply(insertAddonMentions(state, [file("/a.txt"), file("/b.txt")]))
    expect(added.doc.textContent).toBe("draft   text")
    expect(added.selection.from).toBe(10)
    const firstRemoved = added.apply(removeAddonMention(added, file("/a.txt")))
    const cancelled = firstRemoved.apply(removeAddonMention(firstRemoved, file("/b.txt")))
    expect(cancelled.doc.eq(state.doc)).toBe(true)
  })
  test("跨段反向选区添加文件再取消，保留段落和已有引用", () => {
    const base = initial()
    const doc = editorSchema.nodes.doc.create(null, [
      editorSchema.nodes.paragraph.create(null, [editorSchema.text("前文"), editorSchema.nodes.mention.create({ type: "file", name: "已有", path: "/existing.txt" })]),
      editorSchema.nodes.paragraph.create(null, editorSchema.text("后文")),
    ])
    const typed = base.apply(base.tr.replaceWith(0, base.doc.content.size, doc.content))
    const state = typed.apply(typed.tr.setSelection(TextSelection.create(typed.doc, 7, 1)))
    const added = state.apply(insertAddonMentions(state, [file("/a.txt")]))
    expect(extractMentionsFromDoc(added.doc).map(m => m.path)).toEqual(["/existing.txt", "/a.txt"])
    expect(added.apply(removeAddonMention(added, file("/a.txt"))).doc.eq(state.doc)).toBe(true)
  })
  test("技能选择仍替换当前文字选区", () => {
    const base = initial()
    const typed = base.apply(base.tr.insertText("draft text"))
    const state = typed.apply(typed.tr.setSelection(TextSelection.create(typed.doc, 1, 6)))
    const added = state.apply(insertAddonMentions(state, [{ type: "skill", name: "research", label: "research" }]))
    expect(getDocTextWithMentions(added.doc)).toBe("@research  text")
  })
  test("批量插入按路径去重，同名文件互不混淆，按路径删除", () => {
    const state = initial().apply(insertAddonMentions(initial(), [file("/a.txt"), file("/b.txt"), file("/a.txt")]))
    expect(extractMentionsFromDoc(state.doc).map(m => m.path)).toEqual(["/a.txt", "/b.txt"])
    expect(extractMentionsFromDoc(state.apply(removeAddonMention(state, file("/a.txt"))).doc).map(m => m.path)).toEqual(["/b.txt"])
    expect(insertAddonMentions(state, [file("/b.txt")]).docChanged).toBe(false)
  })
  test("光标插入保留前后文本，不吞掉普通 @ 文字", () => {
    const base = initial()
    const typed = base.apply(base.tr.insertText("前文 @普通文字 后文"))
    const state = typed.apply(typed.tr.setSelection(TextSelection.create(typed.doc, 4)))
    const next = state.apply(insertAddonMentions(state, [{ type: "skill", name: "research", label: "research" }]))
    expect(getDocTextWithMentions(next.doc)).toContain("@research")
    expect(next.doc.textContent).toContain("@普通文字 后文")
  })
  test("一次资产多文件插入能整体撤销重做，保留资产身份", () => {
    let state = initial()
    state = state.apply(insertAddonMentions(state, [file("/a.txt"), file("/b.txt")]))
    expect(undo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(extractMentionsFromDoc(state.doc)).toHaveLength(0)
    expect(redo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(extractMentionsFromDoc(state.doc).map(m => m.id)).toEqual(["asset-1", "asset-1"])
  })
})
