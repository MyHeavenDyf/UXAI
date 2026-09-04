import { Effect, Schema } from "effect"
import { basename, extname, join } from "node:path"
import { access, mkdir, open, readFile, writeFile } from "node:fs/promises"
import * as Tool from "./tool"
import * as Truncate from "./truncate"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import SPREADSHEETS_SKILL_RAW from "@/agent/skills/octo_insight/spreadsheets/SKILL.md"

// extract_document —— 把本地文档(docx/xlsx/pdf/pptx/txt/md)抽取成文本,供 insight 本地模型直接读。
// SPEC-INS-015 文件传参路由 ②(office → 模型读)+ SPEC-INS-021 §3(txt/md 直读,解析源统一入口):
// 参数是文件的本地绝对路径,[附件] 清单是常见来源,用户在消息里直接给出的路径同样有效(工具本就
// 不限制路径,会话目录外的路径由 external_directory 权限询问把关)。上传 txt/md 的 FilePart 内联路
// (路由 ①)不动——已在上下文里的不需要工具;这里的 txt/md 直读覆盖"用户只给了路径"的场景,
// 并让测量头(字数/token 估算)对所有解析源一致生效。
// 抽取实现属 SPEC-INS-016(本地解析能力线 Spec B):docx=mammoth / pdf=unpdf / xlsx=exceljs /
// pptx=jszip+slide XML 直抽 / txt·md=readFile 直读;lazy 解析(调用时才读盘解析,不缓存);
// 输出首行带字数/token 估算(E 护栏的测量机制)。
//
// SPEC-INS-016 v2「全量落盘」——工具的职责是把全文完整交付出来,「上下文塞不塞得下」是上层的事,
// 工具无权代为丢弃。v1 靠 Tool.define 自带的 Truncate 兜底(50KB **字节** ≈ 1.7 万汉字)盲切正文,
// 三四万字的 docx 直接腰斩。v2 改为:正文一律落盘到 .octo/<sessionID>/extracted/,再按体积分流
// (小文件额外内联全文;大文件只回元信息 + 路径 + 预览,由模型 grep/read 取用),工具自己保证
// **永远不触发那层通用兜底**。
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

const XLSX_SKILL_AGENTS = new Set(["octo_insight", "insight_reader"])
const SPREADSHEETS_SKILL = SPREADSHEETS_SKILL_RAW.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/, "").trim()

type ExtractDetail = {
  pages?: number
  sheets?: number
  slides?: number
  fallback?: boolean
  worksheetRows?: Array<{ name: string; nonEmptyRows: number }>
}

type ExtractMetadata = {
  path: string
  format?: string
  error?: "not-found" | "unsupported" | "parse-error"
  errorMessage?: string
  chars?: number
  tokenEstimate?: number
  /** 落盘的解析件绝对路径;落盘失败时缺省(已降级为整篇返回)。 */
  savedPath?: string
  /** 本次是否把全文一并内联进了 output。 */
  inlined?: boolean
  /** docx 走了二级抽取(结构不规范,mammoth 读不了)——正文质量降级,表格摊平、版式丢失。 */
  fallback?: boolean
  /** 超出单次通读量时切成了几段(SPEC-INS-032 §2.4 v3);未切段时缺省。 */
  segments?: number
  pages?: number
  sheets?: number
  slides?: number
  worksheetRows?: Array<{ name: string; nonEmptyRows: number }>
}

function xlsxGuidance(format: string, detail: ExtractDetail, agent: string) {
  if (format !== "xlsx") return ""
  const rows = detail.worksheetRows ?? []
  const summary = [
    "工作表行数（解析器按源工作簿统计，Markdown 自动折行不会增加行数）：",
    ...rows.map((sheet) => `- ${sheet.name}: ${sheet.nonEmptyRows} 个非空行（包含可能存在的表头）`),
    "回答数据行数时，先判断每张工作表的第一行是否为表头；若是，每张表分别减 1。",
  ].join("\n")
  if (!XLSX_SKILL_AGENTS.has(agent)) return summary
  return [
    summary,
    "",
    '<skill_content name="spreadsheets" auto_injected="true">',
    "# Skill: spreadsheets",
    "",
    SPREADSHEETS_SKILL,
    "</skill_content>",
  ].join("\n")
}

/** 解析件目录名(SPEC-INS-014 布局下 uploads/ outputs/ 的兄弟;不进文件管理)。 */
const EXTRACTED_DIR = "extracted"

// 上溯到会话树根的深度上限(SPEC-INS-032 §6)。正常只有 1 层(父 → task 子会话),留足余量;
// 超过即认定数据异常(成环 / 脏数据),退化为按当前会话落盘而不是无限爬。
const MAX_PARENT_DEPTH = 8

// ── 单份超量时的确定性切段(SPEC-INS-032 §2.4 v3)────────────────────────────
//
// 一份材料的正文超过子代理一次能通读的量时,**不拒绝、不让用户拆文件**——本工具精确知道字数、
// 落盘正文又是折行的(≤500 字符/行),按行切段是纯算术。工具只负责算出段落边界并如实列出,
// 派活仍归父代理、读仍归子代理,不新增任何机制。
//
// ⚠️ 两处常量同源不同仓:前端 `build-prompt-parts.ts` 的 SINGLE_DOC_LIMIT 是同一个数
// (它在发送前按源文件字节预判、决定文案怎么写),这里按**抽取后的真实字节**判。改一处要同步另一处。
const SINGLE_READTHROUGH_BYTES = 150 * 1024
// 每段目标体量。取 100KB 而不是贴着上界:子代理读完还要产出结论,留出余量;
// 且 read 单次上限 50KB,一段 = 2 次 read,段数不会被切得太碎(段越多,父代理二次汇总的损失越大)。
const SEGMENT_BYTES = 100 * 1024

// 落盘正文前面有几行不是正文:persist() 写的是 `<!-- source… -->` + 空行 + 正文。
// 段落 offset 必须把它算进去 —— 模型 read 的是**落盘文件**,不是内存里的 text。
// 差这 2 行的后果是每段都往前偏、最后一段读不到结尾(静默丢尾巴,正是本 spec 要消灭的那类 bug)。
const PERSIST_HEADER_LINES = 2

/** 按行把正文切成 ≤SEGMENT_BYTES 的段,返回每段的 read 参数(offset 为 1 基,与 read.ts 一致)。 */
function planSegments(text: string): Array<{ offset: number; limit: number; bytes: number }> {
  const lines = text.split("\n")
  const segments: Array<{ offset: number; limit: number; bytes: number }> = []
  let startLine = 0
  let bytes = 0
  for (let i = 0; i < lines.length; i++) {
    bytes += Buffer.byteLength(lines[i], "utf-8") + 1
    // 满一段就切;最后一行无论如何都要收口
    if (bytes >= SEGMENT_BYTES || i === lines.length - 1) {
      segments.push({ offset: PERSIST_HEADER_LINES + startLine + 1, limit: i - startLine + 1, bytes })
      startLine = i + 1
      bytes = 0
    }
  }
  return segments
}
// 内联阈值 = 通用 Truncate 限额 − 首部预算。目标只有一个:**加上我们自己拼的首部之后,总输出
// 仍不触发那层兜底**——所以扣的应该是首部的实际大小,不是一个拍出来的百分比。
// 首部是我们自己生成的、长度可控:元信息一行(文件名 + 字数 + token + 落盘路径,最坏几百字节)
// + 分隔线,仅落盘分支再多两行指引。1KB / 8 行绰绰有余。
// (旧实现是限额 × 0.8,在默认 50KB 下白留 10KB 余量,把 1.3–1.6 万字的文档——正好是一份普通
// 访谈稿——推去了落盘分支,平白多一次 read 往返。)
const HEADER_BUDGET_BYTES = 1024
const HEADER_BUDGET_LINES = 8
/** 仅落盘分支回灌的开头预览长度(字符)。给弱模型一个内容锚点,只给路径它容易直接编。 */
const PREVIEW_CHARS = 2000
/** 落盘正文的最大行长(字符)。见 wrapLongLines 的两条理由。 */
const WRAP_WIDTH = 500
/** 折行时优先在此位置之后找句末标点,避免把行切得过碎。 */
const WRAP_MIN = 300

// 非空白字符数;token 估算用业界粗算:CJK 每字 ≈1 token,其余字符 ≈4 字符/token。
// 只求量级正确(给 E 护栏做超阈值判断),不追求逐 tokenizer 精确。
function measure(text: string) {
  const nonWs = text.replace(/\s/g, "")
  const cjk = nonWs.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0
  const chars = nonWs.length
  const tokenEstimate = cjk + Math.ceil((chars - cjk) / 4)
  return { chars, tokenEstimate }
}

// 软折行(SPEC-INS-016 §4.3)——把落盘正文的每一行折到 WRAP_WIDTH 字符以内。
// 理由一(硬性):read 的 MAX_LINE_LENGTH=2000 会砍掉超长行的尾巴、且**没有任何续读手段**,那部分
//   内容永久丢失;而 mammoth.extractRawText 的输出正是「一段一行」,访谈稿一段几千字很常见——
//   不折行的话落盘等于白落。
// 理由二:grep 命中时返回整行,行太长会把大段无关内容灌进上下文,grep 的定位价值就废了。
// 纯机械处理:不识别 heading、不重排段落,只在句末标点(找不到就硬切)处断开。
const SENTENCE_END = /[。！？；.!?;]/
function wrapLongLines(text: string) {
  const out: string[] = []
  for (const line of text.split("\n")) {
    let rest = line
    while (rest.length > WRAP_WIDTH) {
      let cut = -1
      // 在 [WRAP_MIN, WRAP_WIDTH] 里找最后一个句末标点,切在它**之后**。
      for (let i = WRAP_WIDTH - 1; i >= WRAP_MIN; i--) {
        if (SENTENCE_END.test(rest[i])) {
          cut = i + 1
          break
        }
      }
      if (cut === -1) cut = WRAP_WIDTH
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    out.push(rest)
  }
  return out.join("\n")
}

/** 解析件首行标记:记录来源,供撞名判定(见 persist)。md 注释不参与渲染。 */
function sourceMarker(source: string, chars: number) {
  return `<!-- source: ${source} | chars: ${chars} | extracted: ${new Date().toISOString()} -->`
}

/**
 * 探查落点:文件在不在、若在则首行标记指向哪个源。
 * 「不存在」与「存在但没有我们的标记」必须分开 —— 后者是别人的文件(用户手放的同名 md),
 * 不能当成空位覆盖掉。
 */
async function probe(file: string): Promise<{ exists: boolean; source?: string }> {
  const fh = await open(file, "r").catch(() => undefined)
  if (!fh) return { exists: false }
  try {
    const buf = Buffer.alloc(1024)
    const { bytesRead } = await fh.read(buf, 0, 1024, 0)
    const head = buf.subarray(0, bytesRead).toString("utf8").split("\n")[0]
    return { exists: true, source: head.match(/^<!-- source: (.*?) \| chars:/)?.[1] }
  } catch {
    return { exists: true }
  } finally {
    await fh.close().catch(() => {})
  }
}

// 落盘(SPEC-INS-016 §4.2)。撞名时退到 `<主名>-2.md`——`/a/报告.docx` 与 `/b/报告.docx` 抽成同一个
// `报告.md` 会**静默串数据**(模型拿前者路径 read 到后者内容),这在一份「不丢数据」的实现里不可接受。
// 同源重复抽取则覆盖同一份(v1 起就不缓存,重复调用重复解析)。
async function persist(dir: string, source: string, text: string, chars: number) {
  await mkdir(dir, { recursive: true })
  const stem = basename(source).replace(/\.[^.]+$/, "")
  const body = `${sourceMarker(source, chars)}\n\n${text}\n`
  for (let n = 1; n <= 50; n++) {
    const file = join(dir, n === 1 ? `${stem}.md` : `${stem}-${n}.md`)
    const found = await probe(file)
    // 空位,或这份解析件本就是同一个源产出的(重复抽取覆盖自己) → 写。
    if (!found.exists || found.source === source) {
      await writeFile(file, body, "utf8")
      return file
    }
  }
  throw new Error(`解析件命名冲突未能解决:${stem}`)
}

// docx 二级抽取(SPEC-INS-016 §3.4 v2.2):mammoth 严格按 OOXML 规范解析,遇到结构不规范的 docx
// 会**整份**失败。内网实例:某文档生成工具写出的 docx 里 <w:t> 套了 <w:r> 又套 <w:t>(规范里 w:t
// 是叶子节点、只能装纯文本),mammoth 的 Element.text() 直接 throw "Not implemented"。
//
// 这里先取 <w:t> 区间的内容、**再无差别剥掉里面可能嵌着的任何标签** —— 不依赖任何结构假设,
// 因此对畸形嵌套天然免疫。质量比 mammoth 差(表格摊平、版式全丢),所以只作兜底、由调用方标注。
function extractDocxFromXml(xml: string) {
  const paras: string[] = []
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((m) => decodeXmlEntities(m[1].replace(/<[^>]*>/g, "")))
      .join("")
      .trim()
    if (text) paras.push(text)
  }
  return paras.join("\n")
}

async function extractDocx(buf: Buffer, path: string) {
  const mammoth = await import("mammoth")
  try {
    // 一级(主):extractRawText 只取正文文字,表格降为按单元格分段、样式/图片丢弃(§4.5)。
    const result = await mammoth.extractRawText({ buffer: buf })
    return { text: result.value, detail: {} as ExtractDetail }
  } catch (err) {
    // 二级(兜底):任何 mammoth 失败都值得试一次直抽——文件真的不是 zip 时它同样会抛,
    // 那就落回 parse-error,语义不变。
    const { default: JSZip } = await import("jszip")
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file("word/document.xml")?.async("string")
    if (!xml) throw err
    const text = extractDocxFromXml(xml)
    if (!text) throw err
    console.log("[octo:extract] docx-fallback", {
      path,
      err: err instanceof Error ? err.message : String(err),
    })
    return { text, detail: { fallback: true } as ExtractDetail }
  }
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
  const worksheetRows: Array<{ name: string; nonEmptyRows: number }> = []
  for (const sheet of workbook.worksheets) {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // cell.text 已把公式结果 / 日期 / 富文本统一成显示文本;TSV 一行一记录。
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text ?? ""))
      rows.push(cells.join("\t").trimEnd())
    })
    parts.push(`# 工作表:${sheet.name}\n<!-- non_empty_rows: ${rows.length} -->\n${rows.join("\n")}`)
    worksheetRows.push({ name: sheet.name, nonEmptyRows: rows.length })
  }
  return {
    text: parts.join("\n\n"),
    detail: {
      sheets: workbook.worksheets.length,
      worksheetRows,
    },
  }
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

// 第二参 path 只有 docx 用得上(二级抽取的日志要带它);其余 extractor 声明时忽略即可。
const EXTRACTORS: Record<
  Supported,
  (buf: Buffer, path: string) => Promise<{ text: string; detail: ExtractDetail }>
> = {
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
    // 内联阈值取运行时限额(config `tool_output` 可覆盖),不硬编码——目标是「永远不撞那层兜底」,
    // 用户把限额调大调小都得跟着走。
    const truncate = yield* Truncate.Service
    const sessions = yield* Session.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
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
              return EXTRACTORS[format as Supported](buf, path)
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
          // 折行先于测量与分流:落盘的和内联的必须是同一份文本,否则「模型读到的」和「盘上的」
          // 会分叉——那是比截断更难查的 bug。(折行只插换行,不影响非空白字符数。)
          const text = wrapLongLines(result.text)
          const { chars, tokenEstimate } = measure(text)
          const guidance = xlsxGuidance(format, result.detail, ctx.agent)

          if (chars === 0) {
            console.log("[octo:extract] ok", { path, format, chars, tokenEstimate, ms: Date.now() - started })
            return {
              title,
              output:
                `「${name}」解析成功但未抽取到文本(可能是扫描件 / 纯图片文档)。` +
                `如需分析该文件,请建议用户点击输入框的 MCP 按钮转交内网解析。`,
              metadata: { path, format, chars, tokenEstimate, ...result.detail } as ExtractMetadata,
            }
          }

          // 全量落盘(SPEC-INS-016 §4.2)。失败降级为整篇返回:写盘是交付通道的优化、不是解析能力
          // 本身,盘写不了就退回 v1 那条路(内联 + 通用兜底),别把小故障放大成功能不可用。
          const instance = yield* InstanceState.context
          // 落盘目录归**会话树根会话**(SPEC-INS-032 §6):task 子代理跑在 parentID 指向父会话的
          // 子 session 里,按 ctx.sessionID 落会让 N 份解析件散在 N 个子会话目录 —— 父代理事后
          // 想跨文档 grep 原话就找不着。失败(session 读不到 / 超深 / 成环)退化为按当前会话落盘
          // (= 032 之前的行为),不阻断抽取。
          const rootSessionID = yield* Effect.gen(function* () {
            let currentID = ctx.sessionID
            const seen = new Set<string>([currentID])
            for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
              const info = yield* sessions.get(currentID)
              const parentID = info.parentID
              if (!parentID) return currentID
              if (seen.has(parentID)) break
              seen.add(parentID)
              currentID = parentID
            }
            console.log("[octo:extract] root-session-unresolved", { sessionID: ctx.sessionID })
            return ctx.sessionID
          }).pipe(Effect.catchCause(() => Effect.succeed(ctx.sessionID)))
          const dir = join(instance.directory, ".octo", rootSessionID, EXTRACTED_DIR)
          const savedPath = yield* Effect.tryPromise({
            try: () => persist(dir, path, text, chars),
            // 保留解析器/文件系统的原始错误(ENOTDIR / EACCES / EDQUOT…),否则日志只剩 UnknownError,排障没用。
            catch: (err) => (err instanceof Error ? err : new Error(String(err))),
          }).pipe(
            Effect.catch((err) =>
              Effect.sync(() => {
                console.log("[octo:extract] persist-failed", { path, dir, err: err.message })
                return undefined
              }),
            ),
          )

          // 两个维度都要判:中文正文折行后行数很少(50KB ≈ 34 行),字节先到;但 xlsx 的 TSV 是
          // 一行一记录,几千行的表格可能字节还没超、行数已经爆了。Math.max 兜住用户把 config
          // 里的 tool_output 设得比首部预算还小的情况(算出负阈值会让一切都走落盘)。
          const limits = yield* truncate.limits()
          const guidanceLines = guidance === "" ? 0 : guidance.split("\n").length
          const guidanceBytes = Buffer.byteLength(guidance, "utf-8")
          const fits =
            text.split("\n").length <= Math.max(1, limits.maxLines - HEADER_BUDGET_LINES - guidanceLines) &&
            Buffer.byteLength(text, "utf-8") <=
              Math.max(1, limits.maxBytes - HEADER_BUDGET_BYTES - guidanceBytes)
          // 落盘失败时无论多大都只能内联(退回 v1 行为,交给通用 Truncate 兜底)。
          const inlined = savedPath === undefined || fits

          const ms = Date.now() - started
          console.log("[octo:extract] ok", {
            path,
            format,
            chars,
            tokenEstimate,
            ms,
            saved: savedPath ?? "",
            inlined,
            ...result.detail,
          })

          // 首行永远是测量结果:即便将来又撞上什么 head 方向的截断,字数/token 估算也还看得见。
          const measured = `《${name}》抽取完成:共 ${chars.toLocaleString("en-US")} 字(非空白字符),估算约 ${tokenEstimate.toLocaleString("en-US")} tokens。`
          const metadata = {
            path,
            format,
            chars,
            tokenEstimate,
            ...(savedPath ? { savedPath } : {}),
            inlined,
            ...result.detail,
          } as ExtractMetadata

          // 降级抽取要如实告知(SPEC-INS-016 §3.4):表格摊平、版式丢失是真实的质量损失,
          // 不标注的话模型会把兼容提取的结果当作完整版式来用。
          const degraded = result.detail.fallback
            ? `\n该文档结构不规范,已用兼容方式提取正文;表格等结构可能丢失,如需完整版式请让用户另存为规范 docx 或转 PDF 后重传。`
            : ""

          if (inlined) {
            const saved = savedPath
              ? `全文已保存到:${savedPath}`
              : `注意:全文未能保存到本地,本次仅返回以下正文。`
            return {
              title,
              output: [measured + saved + degraded, guidance, "---", text].filter(Boolean).join("\n"),
              metadata,
            }
          }

          // 超出单次通读量时给出**确定性的切段清单**(SPEC-INS-032 §2.4 v3)。
          // 这是本工具唯一"越过读取、指导编排"的输出,理由:段落边界是算术,交给模型估必然出错;
          // 而不给清单的话,它要么半读硬答(静默丢数据),要么把问题甩回给用户(让人去拆文件)。
          const textBytes = Buffer.byteLength(text, "utf-8")
          const segments = savedPath && textBytes > SINGLE_READTHROUGH_BYTES ? planSegments(text) : []
          const segmentNote =
            segments.length > 1
              ? [
                  ``,
                  `本文超出一次通读的量,已按行切成 ${segments.length} 段(每段约 ${Math.round(SEGMENT_BYTES / 1024)} KB):`,
                  ...segments.map(
                    (seg, i) => `- 第 ${i + 1}/${segments.length} 段:read offset=${seg.offset} limit=${seg.limit}`,
                  ),
                  `若你被指派了某一段,只读该段并只就该段作结论;若没被指派,把这份切段清单原样回传给发起方,由它按段派活。`,
                  `按段读完即可 —— 每一段都会读到,不会漏。`,
                ].join("\n")
              : ""

          return {
            title,
            output: [
              measured + degraded,
              guidance,
              `正文过长,未直接返回;全文已保存到:${savedPath}`,
              `需要定位具体内容,用 grep 搜关键词;需要通读,用 read 按 offset/limit 分段读(单次上限 2000 行 / 50KB)。`,
              segmentNote,
              `以下为开头预览:`,
              `---`,
              text.slice(0, PREVIEW_CHARS),
            ]
              .filter((line) => line !== "")
              .join("\n"),
            metadata: segments.length > 1 ? { ...metadata, segments: segments.length } : metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
