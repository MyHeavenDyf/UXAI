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
    return ""
  })
}