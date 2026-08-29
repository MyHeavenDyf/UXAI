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
    // 类名带 ins- 前缀:make/Design 的同源编辑器用的是无前缀 pm-mention,同名会跨模块串样式
    const typeClass = `ins-pm-mention--${attrs.type}`
    return [
      "span",
      {
        class: `ins-pm-mention ${typeClass}`,
        contenteditable: "false",
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
      return `@${node.attrs.name}`
    }
    // hard_break 也是 leaf,会走这个回调;不显式返回 "\n" 的话 Shift+Enter 敲出来的换行
    // 只存在于编辑器里,取文本时被吞成空串 —— 发给模型的仍是连排一行。
    if (node.type.name === "hard_break") {
      return "\n"
    }
    return ""
  })
}