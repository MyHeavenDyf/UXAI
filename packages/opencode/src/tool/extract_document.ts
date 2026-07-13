import { Effect, Schema } from "effect"
import { basename, extname } from "node:path"
import { access, readFile } from "node:fs/promises"
import * as Tool from "./tool"

// extract_document —— 把本地文档(docx/xlsx/pdf/pptx/txt/md)抽取成文本,供 insight 本地模型直接读。
// SPEC-INS-015 文件传参路由 ②(office → 模型读)+ SPEC-INS-021 §3(txt/md 直读,解析源统一入口):
// 参数是文件的本地绝对路径,[附件] 清单是常见来源,用户在消息里直接给出的路径同样有效(工具本就
// 不限制路径,会话目录外的路径由 external_directory 权限询问把关)。上传 txt/md 的 FilePart 内联路
// (路由 ①)不动——已在上下文里的不需要工具;这里的 txt/md 直读覆盖"用户只给了路径"的场景,
// 并让测量头(字数/token 估算)对所有解析源一致生效。
// 抽取实现属 SPEC-INS-016(本地解析能力线 Spec B):docx=mammoth / pdf=unpdf / xlsx=exceljs /
// pptx=jszip+slide XML 直抽 / txt·md=readFile 直读;lazy 解析(调用时才读盘解析,不缓存);
// 输出首行带字数/token 估算(E 护栏的测量机制),超长正文由 Tool.define 自带的 Truncate 兜底
// (截断 + 全文落盘 + 引导 Read/Grep)。
// ⚠️ 桌面端 sidecar 是 Node 子进程(非 Bun):文件 IO 用 node:fs,不要用 Bun.*。

const DESCRIPTION =
  "把本地文档(docx/xlsx/pdf/pptx/txt/md)抽取成纯文本,用于阅读其正文内容。" +
  "参数 path 填该文件的本地绝对路径:[附件] 清单(冒号后那串)是常见来源,用户在消息里直接给出的本地路径同样有效。" +
  "docx/xlsx/pdf/pptx 一律用本工具读取,不要用 read(二进制不可读);图片无需调用(可直接看)。"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({ description: "要抽取的文档本地绝对路径(取自 [附件] 清单,或用户在消息中给出的路径)" }),
})

const SUPPORTED = ["docx", "xlsx", "pdf", "pptx", "txt", "md"] as const
type Supported = (typeof SUPPORTED)[number]

type ExtractDetail = { pages?: number; sheets?: number; slides?: number }

type ExtractMetadata = {
  path: string
  format?: string
  error?: "not-found" | "unsupported" | "parse-error"
  errorMessage?: string
  chars?: number
  tokenEstimate?: number
  pages?: number
  sheets?: number
  slides?: number
}

// 非空白字符数;token 估算用业界粗算:CJK 每字 ≈1 token,其余字符 ≈4 字符/token。
// 只求量级正确(给 E 护栏做超阈值判断),不追求逐 tokenizer 精确。
function measure(text: string) {
  const nonWs = text.replace(/\s/g, "")
  const cjk = nonWs.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0
  const chars = nonWs.length
  const tokenEstimate = cjk + Math.ceil((chars - cjk) / 4)
  return { chars, tokenEstimate }
}

async function extractDocx(buf: Buffer) {
  const mammoth = await import("mammoth")
  // extractRawText 只取正文文字:表格降为按单元格分段、样式/图片丢弃,v1 够用(SPEC-INS-016 §4)。
  const result = await mammoth.extractRawText({ buffer: buf })
  return { text: result.value, detail: {} as ExtractDetail }
}

async function extractPdf(buf: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf")
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { totalPages, text } = await extractText(pdf, { mergePages: true })
  return { text, detail: { pages: totalPages } }
}

async function extractXlsx(buf: Buffer) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buf as unknown as ArrayBuffer)
  const parts: string[] = []
  for (const sheet of workbook.worksheets) {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // cell.text 已把公式结果 / 日期 / 富文本统一成显示文本;TSV 一行一记录。
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text ?? ""))
      rows.push(cells.join("\t").trimEnd())
    })
    parts.push(`# 工作表:${sheet.name}\n${rows.join("\n")}`)
  }
  return { text: parts.join("\n\n"), detail: { sheets: workbook.worksheets.length } }
}

// pptx 抽取 = zip + slide XML 直取 <a:t> 文本节点(officeparser / python-pptx / unstructured 同一套业界做法)。
// 已知局限(SPEC-INS-016 §3):文本框按 XML 插入序输出、非视觉阅读序;SmartArt(diagram XML)与
// 内嵌图表数据不收;图片上的文字无(OCR 不在范围)。演讲者备注经 slide rels 定位、以 [备注] 行附于该页。
// <a:t> 是叶子节点不嵌套,正则提取足够,不引 XML 解析器。
function decodeXmlEntities(s: string) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

// 按段落(<a:p>)聚合文本 run(<a:t>),一段一行;空段丢弃。
function drawingMLParagraphs(xml: string): string[] {
  const out: string[] = []
  for (const p of xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]))
    const line = runs.join("").trim()
    if (line) out.push(line)
  }
  return out
}

async function extractPptx(buf: Buffer) {
  const { default: JSZip } = await import("jszip")
  const zip = await JSZip.loadAsync(buf)
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
  const parts: string[] = []
  for (const [i, slideName] of slideNames.entries()) {
    const lines = drawingMLParagraphs(await zip.file(slideName)!.async("string"))
    // 备注不能按「同编号」猜(notesSlide 编号与 slide 不保证一致),经该页 rels 定位。
    const rels = await zip
      .file(slideName.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels")
      ?.async("string")
    const notesRef = rels?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1]
    if (notesRef) {
      const notesXml = await zip.file(`ppt/notesSlides/${notesRef}`)?.async("string")
      if (notesXml) for (const line of drawingMLParagraphs(notesXml)) lines.push(`[备注] ${line}`)
    }
    parts.push(`# 第 ${i + 1} 页\n${lines.join("\n")}`)
  }
  return { text: parts.join("\n\n"), detail: { slides: slideNames.length } }
}

// txt/md 直读(SPEC-INS-021 §3):readFile 即得,统一走本工具是为了测量头/后续段落锚点全格式一致。
async function extractPlainText(buf: Buffer) {
  return { text: buf.toString("utf8"), detail: {} as ExtractDetail }
}

const EXTRACTORS: Record<Supported, (buf: Buffer) => Promise<{ text: string; detail: ExtractDetail }>> = {
  docx: extractDocx,
  pdf: extractPdf,
  xlsx: extractXlsx,
  pptx: extractPptx,
  txt: extractPlainText,
  md: extractPlainText,
}

export const ExtractDocumentTool = Tool.define(
  "extract_document",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const path = params.path
          const name = basename(path)
          // title 是过程展示的用户可见文字(SPEC-INS-021 §4):自研工具直接给中文
          const title = `提取文档正文:${name}`
          const started = Date.now()

          // ⚠️ 用 node:fs 判存在、不用 Bun.file:桌面端 sidecar 是 Node 子进程,Bun.* 不存在。
          const exists = yield* Effect.tryPromise(() => access(path)).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
          if (!exists) {
            console.log("[octo:extract] failed", { path, reason: "not-found" })
            return {
              title,
              output: `未找到文件:${path}。请核对路径是否完整正确([附件] 清单里冒号后那串,或向用户确认其给出的路径)。`,
              metadata: { path, error: "not-found" } as ExtractMetadata,
            }
          }

          const format = extname(path).slice(1).toLowerCase()
          if (!(SUPPORTED as readonly string[]).includes(format)) {
            console.log("[octo:extract] failed", { path, reason: "unsupported", format })
            return {
              title,
              output:
                `不支持的格式「.${format}」,本工具仅支持 ${SUPPORTED.map((s) => "." + s).join(" / ")}。` +
                `请建议用户把文件转换为支持的格式(如用 Office / WPS 另存为 docx / xlsx / pdf)后重新上传。`,
              metadata: { path, format, error: "unsupported" } as ExtractMetadata,
            }
          }

          const parsed = yield* Effect.tryPromise({
            try: async () => {
              const buf = await readFile(path)
              return EXTRACTORS[format as Supported](buf)
            },
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          }).pipe(Effect.catch((err) => Effect.succeed({ failed: err.message || String(err) })))

          if ("failed" in parsed) {
            console.log("[octo:extract] failed", { path, reason: "parse-error", format, err: parsed.failed })
            return {
              title,
              output:
                `解析「${name}」失败:${parsed.failed}。` +
                `文件可能已损坏、被加密或格式不规范;如需分析该文件,请建议用户点击输入框的 MCP 按钮转交内网解析。`,
              metadata: { path, format, error: "parse-error", errorMessage: parsed.failed } as ExtractMetadata,
            }
          }

          const result = parsed
          const { chars, tokenEstimate } = measure(result.text)
          const ms = Date.now() - started
          console.log("[octo:extract] ok", { path, format, chars, tokenEstimate, ms, ...result.detail })

          if (chars === 0) {
            return {
              title,
              output:
                `「${name}」解析成功但未抽取到文本(可能是扫描件 / 纯图片文档)。` +
                `如需分析该文件,请建议用户点击输入框的 MCP 按钮转交内网解析。`,
              metadata: { path, format, chars, tokenEstimate, ...result.detail } as ExtractMetadata,
            }
          }

          // 首行放测量结果:Truncate 兜底是 head 方向截断,保证字数/token 估算永远可见。
          const header = `《${name}》抽取完成:共 ${chars.toLocaleString("en-US")} 字(非空白字符),估算约 ${tokenEstimate.toLocaleString("en-US")} tokens。`
          return {
            title,
            output: `${header}\n---\n${result.text}`,
            metadata: { path, format, chars, tokenEstimate, ...result.detail } as ExtractMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
