import { describe, expect, test } from "bun:test"
import { EditorState, TextSelection } from "prosemirror-state"
import { history, undo, redo } from "prosemirror-history"
import { editorSchema, extractMentionsFromDoc, getDocTextWithMentions } from "../components/prosemirror-editor/schema"
import { insertAddonMentions, removeAddonMention } from "./addon-mentions"

const file = (path: string) => ({ type: "file" as const, filename: "访谈.txt", path, id: "asset-1" })
const initial = () => EditorState.create({ schema: editorSchema, plugins: [history()] })

describe("加号引用操作", () => {
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
