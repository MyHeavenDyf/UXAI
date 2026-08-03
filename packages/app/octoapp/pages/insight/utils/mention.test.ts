import { describe, expect, test } from "bun:test"
import { splitMentions, queuedMentions, buildParagraphs, validTrigger, nextInsertPos } from "./mention"
import { getDocTextWithMentions, editorSchema, type MentionAttrs } from "../components/prosemirror-editor/schema"
import type { MentionTriggerState } from "../components/prosemirror-editor/plugins/mention-trigger"
import type { MentionSelection } from "../components/mention-popover"

const skill = (name: string): MentionSelection => ({ type: "skill", name, label: name })
const file = (filename: string, path: string): MentionSelection => ({ type: "file", filename, path })

describe("splitMentions", () => {
  test("按类型拆两桶", () => {
    const { skills, files } = splitMentions([
      skill("访谈分析"),
      file("访谈稿.docx", "/proj/.octo/ses_1/uploads/访谈稿.docx"),
    ])
    expect(skills).toEqual(["访谈分析"])
    expect(files).toEqual([{ filename: "访谈稿.docx", path: "/proj/.octo/ses_1/uploads/访谈稿.docx" }])
  })

  test("技能按名去重", () => {
    const { skills } = splitMentions([skill("访谈分析"), skill("访谈分析"), skill("问卷设计")])
    expect(skills).toEqual(["访谈分析", "问卷设计"])
  })

  // 去重键必须是 path 而非 filename:不同目录下的同名文件是两个引用,合并会漏读其中一个。
  test("文件按路径去重,同名不同目录各算一个", () => {
    const { files } = splitMentions([
      file("访谈稿.docx", "/proj/.octo/ses_1/uploads/访谈稿.docx"),
      file("访谈稿.docx", "/proj/.octo/ses_1/outputs/访谈稿.docx"),
      file("访谈稿.docx", "/proj/.octo/ses_1/uploads/访谈稿.docx"),
    ])
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.path)).toEqual([
      "/proj/.octo/ses_1/uploads/访谈稿.docx",
      "/proj/.octo/ses_1/outputs/访谈稿.docx",
    ])
  })

  test("空选择返回空桶", () => {
    expect(splitMentions([])).toEqual({ skills: [], files: [] })
  })
})

describe("queuedMentions", () => {
  test("技能 → mention 属性(path 空)", () => {
    expect(queuedMentions({ text: "@访谈分析 帮我看看", skills: ["访谈分析"] })).toEqual([
      { id: "访谈分析", name: "访谈分析", type: "skill", label: "访谈分析", path: "" },
    ])
  })

  test("文件 → mention 属性(带绝对路径)", () => {
    expect(
      queuedMentions({ text: "@访谈稿.docx", files: [{ filename: "访谈稿.docx", path: "/proj/a/访谈稿.docx" }] }),
    ).toEqual([
      { id: "访谈稿.docx", name: "访谈稿.docx", type: "file", label: "访谈稿.docx", path: "/proj/a/访谈稿.docx" },
    ])
  })

  test("无引用的队列项还原成空清单", () => {
    expect(queuedMentions({ text: "纯文本" })).toEqual([])
  })

  // 发送 → 入队 → 回填 的往返:拆桶存进队列,再还原成胶囊属性,name 必须能对上文本里的 @名
  test("与 splitMentions 往返一致", () => {
    const selections = [skill("访谈分析"), file("访谈稿.docx", "/proj/a/访谈稿.docx")]
    const { skills, files } = splitMentions(selections)
    const attrs = queuedMentions({ text: "@访谈分析 @访谈稿.docx", skills, files })
    expect(attrs.map((a) => a.name)).toEqual(["访谈分析", "访谈稿.docx"])
    expect(attrs.map((a) => a.type)).toEqual(["skill", "file"])
  })
})

// 取文本时换行必须保留:丢了的话编辑器里看着是多行、发给模型的却是连排一行(内容失真且无从察觉)
describe("getDocTextWithMentions 换行", () => {
  const t = (s: string) => editorSchema.text(s)
  const p = (...content: ReturnType<typeof t>[]) => editorSchema.node("paragraph", null, content)

  test("段落之间产出 \\n", () => {
    const doc = editorSchema.node("doc", null, [p(t("第一段")), p(t("第二段"))])
    expect(getDocTextWithMentions(doc)).toBe("第一段\n第二段")
  })

  // hard_break 是 leaf,会走 textBetween 的 leafText 回调;不显式返回 "\n" 就会被吞成空串
  test("Shift+Enter 的 hard_break 产出 \\n", () => {
    const br = editorSchema.nodes.hard_break.create()
    const doc = editorSchema.node("doc", null, [editorSchema.node("paragraph", null, [t("第一行"), br, t("第二行")])])
    expect(getDocTextWithMentions(doc)).toBe("第一行\n第二行")
  })

  test("换行与 mention 混排", () => {
    const br = editorSchema.nodes.hard_break.create()
    const m = editorSchema.nodes.mention.create({ id: "x", name: "访谈分析", type: "skill", label: "访谈分析", path: "" })
    const doc = editorSchema.node("doc", null, [editorSchema.node("paragraph", null, [m, t(" 看这个"), br, t("再看那个")])])
    expect(getDocTextWithMentions(doc)).toBe("@访谈分析 看这个\n再看那个")
  })
})

// 排队回填:@名 要重新变回胶囊,否则文本里留着失效的 @名、引用却已丢失,用户无从察觉
describe("buildParagraphs", () => {
  const attrs = (name: string, type: "skill" | "file" = "skill"): MentionAttrs => ({
    id: name,
    name,
    type,
    label: name,
    path: type === "file" ? `/proj/${name}` : "",
  })
  /** 段落里逐个节点的类型名,用来断言胶囊有没有真的建出来 */
  const shape = (nodes: ReturnType<typeof buildParagraphs>) =>
    nodes.map((p) => {
      const out: string[] = []
      p.forEach((child) => out.push(child.type.name))
      return out
    })

  test("@名 还原成 mention 节点", () => {
    const nodes = buildParagraphs("@访谈分析 帮我看看", [attrs("访谈分析")])
    expect(shape(nodes)).toEqual([["mention", "text"]])
  })

  // 最长优先:短名先命中会把 @分析报告 切成「@分析 胶囊 + 报告 文本」
  test("前缀互吞:同时引用 @分析 与 @分析报告", () => {
    const nodes = buildParagraphs("@分析报告 对比 @分析", [attrs("分析"), attrs("分析报告")])
    expect(shape(nodes)).toEqual([["mention", "text", "mention"]])
    const doc = editorSchema.node("doc", null, nodes)
    expect(getDocTextWithMentions(doc)).toBe("@分析报告 对比 @分析")
  })

  test("清单外的 @xx 保持纯文本,不臆测成胶囊", () => {
    const nodes = buildParagraphs("@访谈分析 联系 a@b.com", [attrs("访谈分析")])
    expect(shape(nodes)).toEqual([["mention", "text"]])
  })

  test("文件引用带回绝对路径", () => {
    const nodes = buildParagraphs("@访谈稿.docx", [attrs("访谈稿.docx", "file")])
    const mention = nodes[0]!.child(0)
    expect(mention.type.name).toBe("mention")
    expect(mention.attrs.path).toBe("/proj/访谈稿.docx")
  })

  test("空文本给出单个空段落(doc 的 block+ 要求至少一个块)", () => {
    const nodes = buildParagraphs("", [])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.content.size).toBe(0)
  })

  // 粘贴路径也复用这个函数(handlePaste 一律按 text/plain 拆段落),换行数必须原样保留
  test("多行文本按行拆成段落,空行保留", () => {
    const nodes = buildParagraphs("第一行\n\n第三行", [])
    expect(nodes).toHaveLength(3)
    expect(nodes[1]!.content.size).toBe(0)
    const doc = editorSchema.node("doc", null, nodes)
    expect(getDocTextWithMentions(doc)).toBe("第一行\n\n第三行")
  })

  test("CRLF 与 CR 也按行拆", () => {
    expect(buildParagraphs("a\r\nb", [])).toHaveLength(2)
    expect(buildParagraphs("a\rb", [])).toHaveLength(2)
  })
})

// trigger 的 from/to 不随文档位移 map(@query 之前有删除/插入时坐标会失效),
// 所有拿这对坐标做 delete/insert 的路径都靠 validTrigger 守卫,防越界与误删
describe("validTrigger", () => {
  const t = (s: string) => editorSchema.text(s)
  const p = (...c: ReturnType<typeof t>[]) => editorSchema.node("paragraph", null, c)
  const trig = (from: number, to: number, query: string): MentionTriggerState => ({ active: true, from, to, query })

  test("区间文本仍是 @query 时通过", () => {
    const doc = editorSchema.node("doc", null, [p(t("@访谈"))])
    expect(validTrigger(doc, trig(1, 4, "访谈"))).toEqual(trig(1, 4, "访谈"))
  })

  test("to 越界返回 null", () => {
    const doc = editorSchema.node("doc", null, [p(t("@访谈"))])
    expect(validTrigger(doc, trig(1, 99, "访谈"))).toBeNull()
  })

  test("区间被 mention 胶囊占据(textBetween 为空)返回 null", () => {
    const m = editorSchema.nodes.mention.create({ id: "x", name: "访谈", type: "skill", label: "访谈", path: "" })
    const doc = editorSchema.node("doc", null, [p(m)])
    expect(validTrigger(doc, trig(1, 2, "访谈"))).toBeNull()
  })

  test("@query 之前插入文本致坐标漂移,区间不再是 @query 返回 null", () => {
    const doc = editorSchema.node("doc", null, [p(t("前缀@访谈"))])
    expect(validTrigger(doc, trig(1, 4, "访谈"))).toBeNull()
  })

  test("null trigger 返回 null", () => {
    const doc = editorSchema.node("doc", null, [p(t("@访谈"))])
    expect(validTrigger(doc, null)).toBeNull()
  })
})

// 多选插入位点:扫描法从 @query 末尾起跳过连续 mention + 配对空格,落在序列末尾。
// 不维护可变计数器 —— 对 query 变化 / deselect / undo 全免疫,这是倒序 bug 的根治点
describe("nextInsertPos", () => {
  const t = (s: string) => editorSchema.text(s)
  const m = (name: string) =>
    editorSchema.nodes.mention.create({ id: name, name, type: "file", label: name, path: `/p/${name}` })
  const p = (...c: ReturnType<typeof t>[]) => editorSchema.node("paragraph", null, c)
  const trig = (to: number): MentionTriggerState => ({ active: true, from: 1, to, query: "" })

  // para: @, mA, " ", mB, " " → pos:1=@,2=mA,3=space,4=mB,5=space,6=para content end;to=2
  test("同 query 连选:跳过已有 mention+空格到序列末尾(正序)", () => {
    const doc = editorSchema.node("doc", null, [p(t("@"), m("A"), t(" "), m("B"), t(" "))])
    expect(nextInsertPos(doc, trig(2))).toBe(6)
  })

  // para: @xy, mA, " " → pos:1=@,2=x,3=y,4=mA,5=space,6=end;to=4(改 query 补字后,mA 仍在 to 之后)
  test("改 query 后再选:to 已前移,仍跳过已有胶囊到末尾(不退回 to 致倒序)", () => {
    const doc = editorSchema.node("doc", null, [p(t("@xy"), m("A"), t(" "))])
    expect(nextInsertPos(doc, trig(4))).toBe(6)
  })

  // para: @, mB, " " → pos:1=@,2=mB,3=space,4=end;to=2(deselect 删掉 mA 后只剩 mB)
  test("deselect 后再选:跳过剩余胶囊到末尾,不受残留影响", () => {
    const doc = editorSchema.node("doc", null, [p(t("@"), m("B"), t(" "))])
    expect(nextInsertPos(doc, trig(2))).toBe(4)
  })

  test("无已选胶囊:返回 trigger.to 本身", () => {
    const doc = editorSchema.node("doc", null, [p(t("@"))])
    expect(nextInsertPos(doc, trig(2))).toBe(2)
  })
})
