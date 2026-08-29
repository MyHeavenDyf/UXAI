import { Schema, Node as PMNode } from "prosemirror-model"

export interface MentionAttrs {
  id: string | null
  name: string
  type: "skill" | "file"
  label: string
  path?: string
}

export const mentionNodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    id: { default: null },
    name: { default: "" },
    type: { default: "skill" },
    label: { default: "" },
    path: { default: "" },
  },
  toDOM: (node: PMNode): readonly [string, ...any[]] => {
    const attrs = node.attrs as MentionAttrs
    const typeClass = `pm-mention--${attrs.type}`
    return [
      "span",
      {
        class: `pm-mention ${typeClass}`,
        contenteditable: "false",
        "data-mention": "true",
        "data-id": attrs.id || "",
        "data-name": attrs.name,
        "data-type": attrs.type,
        "data-label": attrs.label,
        "data-path": attrs.path || "",
      },
      `   @${attrs.label || attrs.name}   `,
    ] as const
  },
  parseDOM: [
    {
      tag: "span[data-mention]",
      getAttrs: (dom: HTMLElement) => ({
        id: dom.getAttribute("data-id"),
        name: dom.getAttribute("data-name") || "",
        type: (dom.getAttribute("data-type") as "skill" | "file") || "skill",
        label: dom.getAttribute("data-label") || "",
        path: dom.getAttribute("data-path") || "",
      }),
    },
  ],
}

export const editorSchema = new Schema({
  nodes: {
    doc: {
      content: "block+",
    },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0]
      },
    },
    text: {
      group: "inline",
    },
    mention: mentionNodeSpec,
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      toDOM() {
        return ["br"]
      },
      parseDOM: [{ tag: "br" }],
    },
  },
  marks: {},
})

export function extractMentionsFromDoc(doc: PMNode): MentionAttrs[] {
  const mentions: MentionAttrs[] = []
  doc.descendants((node: PMNode) => {
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
  return mentions
}

export function getDocTextWithMentions(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, "\n", (node) => {
    if (node.type.name === "mention") {
      // 用零宽空格 (​) 作为 chip 边界,而不是普通空格。
      // 普通 \s 不匹配 ​,所以 chip 名内的普通空格不会被 renderMentionText 的正则截断。
      // ​ 视觉上不可见,显示侧靠 renderMentionText 的 margin 提供间距。
      // 发送给模型前需在 index.tsx 里 replace(/​/g, "") 剥离。
      return `​@${node.attrs.name}​`
    }
    return ""
  })
}

export function docToJSON(doc: PMNode): any {
  return doc.toJSON()
}

export function docFromJSON(json: any): PMNode {
  return editorSchema.nodeFromJSON(json)
}

// 旧字符串格式 prompt → 纯文本 doc JSON（迁移用）
// 按 \n 切段，空行产出空段落；chip 信息不可恢复（旧字符串只编码了 @name）
export function docJSONFromPlainText(text: string): any {
  const lines = text.split("\n")
  const paragraphs = lines.map((line) =>
    line.length === 0
      ? { type: "paragraph" }
      : { type: "paragraph", content: [{ type: "text", text: line }] }
  )
  return { type: "doc", content: paragraphs }
}