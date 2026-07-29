import { describe, expect, test } from "bun:test"
import { splitMentions, queuedMentions, buildParagraphs } from "./mention"
import { getDocTextWithMentions, editorSchema, type MentionAttrs } from "../components/prosemirror-editor/schema"
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
})
