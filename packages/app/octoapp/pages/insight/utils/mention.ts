import type { Node as PMNode } from "prosemirror-model"
import type { MentionSelection } from "../components/mention-popover"
import { editorSchema, type MentionAttrs } from "../components/prosemirror-editor/schema"
import type { QueuedSend } from "./send-queue"

/**
 * @ 引用的纯数据变换(SPEC-INS-023)。
 *
 * 从 index.tsx 抽出来的原因不只是整洁:index.tsx 是整页组件,测试里 import 它会连带拉起
 * 整棵 Solid 依赖树;这两个函数是发送 / 回填链路上的关键分叉,值得单测锁住。
 */

/**
 * 把选中项拆成技能名 / 文件引用两桶,供发送时注入 synthetic part。
 * 可见文本保持 @名 原样(气泡显示用户所引用,不暴露路径);skills/files 只驱动 synthetic 注入。
 * 技能按名去重、文件按路径去重(同名不同目录的文件是两个引用,不能并成一个)。
 */
export function splitMentions(selections: MentionSelection[]): {
  skills: string[]
  files: Array<{ filename: string; path: string }>
} {
  const skills: string[] = []
  const files: Array<{ filename: string; path: string }> = []
  for (const s of selections) {
    if (s.type === "skill") {
      if (!skills.includes(s.name)) skills.push(s.name)
    } else if (!files.some((f) => f.path === s.path)) {
      files.push({ filename: s.filename, path: s.path })
    }
  }
  return { skills, files }
}

/**
 * 队列项存的 skills/files → 编辑器 mention 节点属性(排队回填时重建胶囊用)。
 * 构造口径与编辑器 handleMentionSelect 保持一致:技能的 name/label 同为技能名、path 空;
 * 文件的 name/label 同为文件名、path 为绝对路径。
 */
export function queuedMentions(item: QueuedSend): MentionAttrs[] {
  return [
    ...(item.skills ?? []).map((name) => ({ id: name, name, type: "skill" as const, label: name, path: "" })),
    ...(item.files ?? []).map((f) => ({
      id: f.filename,
      name: f.filename,
      type: "file" as const,
      label: f.filename,
      path: f.path,
    })),
  ]
}

/**
 * 把「文本 + 引用清单」还原成段落节点(排队回填用)。
 * 按 @名 做最长优先匹配,避免前缀互吞(同时引用 @分析 与 @分析报告 时,短名先命中会把长名切成
 * 「胶囊 + 报告」两截)。只还原清单里确实存在的引用,文本里其余 @xx 保持纯文本原样,不臆测成胶囊。
 */
export function buildParagraphs(text: string, mentions: MentionAttrs[]): PMNode[] {
  const tokens = mentions
    .map((m) => ({ token: `@${m.name}`, attrs: m }))
    .sort((a, b) => b.token.length - a.token.length)

  // 按 CRLF / CR / LF 三种换行拆:粘贴路径也走这里,Windows 剪贴板是 CRLF,
  // 只 split("\n") 会在行尾留下 \r(渲染成不可见字符,还会一起发给模型)。
  return text.split(/\r\n?|\n/).map((line) => {
    const inline: PMNode[] = []
    let buf = ""
    let i = 0
    while (i < line.length) {
      const hit = tokens.find((t) => line.startsWith(t.token, i))
      if (hit) {
        if (buf) {
          inline.push(editorSchema.text(buf))
          buf = ""
        }
        inline.push(editorSchema.nodes.mention.create(hit.attrs))
        i += hit.token.length
      } else {
        buf += line[i]
        i += 1
      }
    }
    if (buf) inline.push(editorSchema.text(buf))
    return editorSchema.nodes.paragraph.create(null, inline)
  })
}
