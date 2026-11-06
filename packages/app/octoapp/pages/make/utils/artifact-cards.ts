import type { ArtifactExportKind, OutputCard } from "../components/insight-turn"
import { createArtifactParser, type ArtifactEvent } from "./artifact-parser"
import { extractSubtypeFromTitle } from "./subtype-extractor"
import { parseFastuiPreview } from "./fastui-export"

export const ARTIFACT_TYPE_MAP: Record<string, OutputCard["type"]> = {
  html: "html",
  "text/html": "html",
  "text/html+deck": "deck",
  deck: "deck",
  svg: "svg",
  "image/svg+xml": "svg",
  "markdown-document": "markdown-document",
  "code-snippet": "code-snippet",
  "react-component": "react-component",
  diagram: "diagram",
  "text/design-plan": "design-plan",
  "text/link": "link",
}

// 从 link artifact 的 content(URL 或磁盘路径)提取卡片标题
// URL:        提取最后的文件名(含扩展名),无路径时回退到 host
//             "https://a.com/path/file.html" → "file.html"
//             "https://a.com/"               → "a.com"
// 磁盘路径:   取最后一段并去掉格式后缀,保留 subtype
//             "D:\\dir\\a.shadcn.html" → "a.shadcn"
//             "D:\\dir\\report.pdf"    → "report"
export function extractLinkTitle(content: string): string {
  const trimmed = (content ?? "").trim()
  if (!trimmed) return ""

  // fastui 预览卡片 fastui://<产物名>(SPEC-DES-004):标题就是产物名
  const fastuiName = parseFastuiPreview(trimmed)
  if (fastuiName !== null) return fastuiName || "本地预览"

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      const segments = u.pathname.split("/").filter(Boolean)
      if (segments.length > 0) {
        const last = segments[segments.length - 1]
        try { return decodeURIComponent(last) } catch { return last }
      }
      return u.host
    } catch {
      // fall through to path handling
    }
  }

  const parts = trimmed.split(/[/\\]/).filter(Boolean)
  const filename = parts.length > 0 ? parts[parts.length - 1] : trimmed
  const lastDot = filename.lastIndexOf(".")
  if (lastDot > 0) return filename.slice(0, lastDot)
  return filename
}

export function parseAllArtifactsFromText(text: string): Omit<OutputCard, "id" | "createdAt">[] {
  if (!/<artifact/i.test(text)) return []
  const results: Omit<OutputCard, "id" | "createdAt">[] = []

  try {
    const parser = createArtifactParser()
    let startEvent: Extract<ArtifactEvent, { type: "artifact:start" }> | null = null
    let fullContent = ""
    function handleEvent(ev: ArtifactEvent) {
      if (ev.type === "artifact:start") {
        startEvent = ev
        fullContent = ""
      } else if (ev.type === "artifact:chunk") {
        fullContent += ev.delta
      } else if (ev.type === "artifact:end") {
        fullContent = ev.fullContent
        if (!startEvent) return
        const mappedType = ARTIFACT_TYPE_MAP[startEvent.artifactType]
        // design-plan 或 identifier 以 "plan-" 开头的 artifact 不在消息流中显示卡片。
        // 它们是方案阶段产物,只通过输入框上方的 plan banner 入口进入 ResultViewer。
        // 双重兜底:type 正确时 mappedType === "design-plan";agent 把 type 写错时
        // (例如写成 markdown-document) identifier 前缀仍然能识别出来。
        const isPlanArtifact =
          mappedType === "design-plan" ||
          (startEvent.identifier || "").startsWith("plan-")
        if (isPlanArtifact) {
          startEvent = null
          return
        }
        if (!mappedType) return
        const explicitExports = startEvent.exports
          ? startEvent.exports.split(",").map((s) => s.trim() as ArtifactExportKind)
          : undefined
        // link 类型:始终从 content(URL 或磁盘路径)派生标题,忽略 artifact 标签的 title 属性
        // 原因:content 是路径,标题应为文件名(磁盘路径去格式后缀保留 subtype,URL 取文件名含扩展名)
        // 模型声明的 title 可能带后缀或含异常字符,不可靠
        let resolvedTitle = startEvent.title
        if (mappedType === "link") {
          const fromContent = extractLinkTitle(fullContent)
          if (fromContent) resolvedTitle = fromContent
        }
        results.push({
          title: resolvedTitle || mappedType,
          type: mappedType,
          subtype: extractSubtypeFromTitle(resolvedTitle),
          content: fullContent,
          artifactKind: startEvent.artifactType,
          artifactIdentifier: startEvent.identifier || undefined,
          exports: explicitExports,
          designSystemId: startEvent.designSystemId || null,
        })
        startEvent = null
      }
    }
    for (const ev of parser.feed(text)) handleEvent(ev)
    // 不调用 flush() — 未闭合的 artifact 不应该被输出，避免中断时生成混乱卡片
  } catch {
    // ignore parse errors
  }
  return results
}
