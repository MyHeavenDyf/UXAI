import { Show } from "solid-js"
import type { JSX } from "solid-js"
import { fileTypeIconUrl } from "../icons/illustrations"
import { materializeStateOf } from "../utils/local-resource"
import type { OutputCard, OutputCardType } from "./insight-turn"

/**
 * 文件结果卡片(紧凑预览入口) — 2026-06 设计稿改版。
 * spec: docs/specs/ui/output-renderers.md §6.B + memory insight-card-redesign-decisions
 *
 * 抽成独立组件,供 InsightTurn(真实对话流)与 _dev/cards-preview(预览页)共用,
 * 保证 dev 预览与线上完全同源("结合项目,不脱离项目")。
 *
 * 设计稿决策:
 * - 图标按文件类型走(fileTypeIconUrl,与 FileFallback 同源):DOCX/XLSX/PPT/
 *   PDF/HTML/MD/思维导图/视频/图片/代码各不同,其余落「其他文件」图标
 * - 副文案改"创建时间: …",去掉右侧"预览 →"(整卡可点)
 */

// inline 卡(自由文本嗅探)无 fileName/mimeType,按 card.type 合成一个能被
// fileTypeIconUrl 命中的扩展名/mime;uri 卡(MCP resource_link)直接用真实文件名。
const TYPE_SYNTH: Partial<Record<OutputCardType, { name?: string; mime?: string }>> = {
  html: { name: "x.html" },
  markdown: { name: "x.md" },
  mindmap: { name: "x.json", mime: "application/json+mindmap" },
  json: { name: "x.json" },
}

function cardIconUrl(card: OutputCard): string {
  if (card.fileName || card.mimeType) return fileTypeIconUrl(card.fileName, card.mimeType)
  const synth = TYPE_SYNTH[card.type]
  return fileTypeIconUrl(synth?.name, synth?.mime)
}

/**
 * 入口卡三态(2026-07 新增,见 spec output-renderers.md §6.B「产物落盘状态」):
 *
 * uri 产物是**先出卡、后台再下载**——卡片出现那一刻磁盘上还没有文件。这段窗口过去零反馈:
 * 下载中点开只看到转圈,下载失败只有 console 知道,用户完全不知道有一份产物没拿到。故显式呈现:
 *   - pending(准备中):副文案换成「准备中…」,卡片降饱和;**仍可点击**(点开后 tab 内继续等)
 *   - failed(失败) :副文案换成失败原因摘要 + 右侧「重试」;整卡点击 = 重试
 *   - ready(就绪)  :维持原样(创建时间)
 * inline / path 源卡不走落盘,`materializeStateOf` 返回 undefined,按 ready 呈现。
 */
export function OutputEntryCard(props: {
  card: OutputCard
  onClick: () => void
  /** 失败态重试(重新触发 eager 落盘);不传则失败态只展示、不可重试 */
  onRetry?: () => void
}): JSX.Element {
  const state = () => materializeStateOf(props.card.id)?.state ?? "ready"
  const label = () => previewEntryLabel(props.card)
  const handleClick = () => {
    if (state() === "failed") {
      props.onRetry?.()
      return
    }
    props.onClick()
  }
  return (
    <button
      type="button"
      class="octo-preview-entry"
      classList={{
        "octo-preview-entry--pending": state() === "pending",
        "octo-preview-entry--failed": state() === "failed",
      }}
      onClick={handleClick}
    >
      <span class="octo-preview-entry__icon">
        <img src={cardIconUrl(props.card)} width={28} height={28} alt="" aria-hidden="true" />
      </span>
      <span class="octo-preview-entry__body">
        {/* 文件名过长会 truncate,title 让 hover 看到全名 */}
        <span class="octo-preview-entry__title" title={label()}>{label()}</span>
        <span class="octo-preview-entry__desc">{descText(props.card, state())}</span>
      </span>
      <Show when={state() === "failed" && props.onRetry}>
        <span class="octo-preview-entry__action">重试</span>
      </Show>
    </button>
  )
}

function descText(card: OutputCard, state: "pending" | "ready" | "failed"): string {
  if (state === "pending") return "准备中…"
  if (state === "failed") return "获取失败，点击重试"
  return `创建时间: ${formatCreatedTime(card.createdAt)}`
}

/**
 * 入口卡标题文案。优先用 card.title(来自 resource_link.name / heading);
 * 缺省时按类型给默认词,贴近用户语言("可视化页面"而非"HTML")。
 */
function previewEntryLabel(card: OutputCard): string {
  if (card.title && card.title.length > 0 && card.title !== "分析结果") return card.title
  switch (card.type) {
    case "html": return "可视化页面"
    case "mindmap": return "思维导图"
    case "table": return "分析表格"
    case "markdown": return "Markdown 文档"
    case "json": return "JSON 数据"
    case "code": return card.fileName || "代码文件"
    case "file": return card.fileName || "文件"
    case "image": return card.fileName || "图片"
  }
}

function formatCreatedTime(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
