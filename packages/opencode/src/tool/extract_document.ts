import { Effect, Schema } from "effect"
import { basename, extname, join } from "node:path"
import { access, mkdir, open, readFile, writeFile } from "node:fs/promises"
import * as Tool from "./tool"
import * as Truncate from "./truncate"
import { InstanceState } from "@/effect/instance-state"

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

type ExtractDetail = { pages?: number; sheets?: number; slides?: number }

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
  pages?: number
  sheets?: number
  slides?: number
}

/** 解析件目录名(SPEC-INS-014 布局下 uploads/ outputs/ 的兄弟;不进文件管理)。 */
const EXTRACTED_DIR = "extracted"
/** 内联阈值 = 通用 Truncate 限额的这个比例,留出的余量给首部元信息/指引行。 */
const INLINE_RATIO = 0.8
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
    // 内联阈值取运行时限额(config `tool_output` 可覆盖),不硬编码——目标是「永远不撞那层兜底」,
    // 用户把限额调大调小都得跟着走。
    const truncate = yield* Truncate.Service
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
          // 折行先于测量与分流:落盘的和内联的必须是同一份文本,否则「模型读到的」和「盘上的」
          // 会分叉——那是比截断更难查的 bug。(折行只插换行,不影响非空白字符数。)
          const text = wrapLongLines(result.text)
          const { chars, tokenEstimate } = measure(text)

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
          const dir = join(instance.directory, ".octo", ctx.sessionID, EXTRACTED_DIR)
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

          const limits = yield* truncate.limits()
          const fits =
            text.split("\n").length <= limits.maxLines * INLINE_RATIO &&
            Buffer.byteLength(text, "utf-8") <= limits.maxBytes * INLINE_RATIO
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

          if (inlined) {
            const saved = savedPath
              ? `全文已保存到:${savedPath}`
              : `注意:全文未能保存到本地,本次仅返回以下正文。`
            return { title, output: `${measured}${saved}\n---\n${text}`, metadata }
          }

          return {
            title,
            output: [
              measured,
              `正文过长,未直接返回;全文已保存到:${savedPath}`,
              `需要定位具体内容,用 grep 搜关键词;需要通读,用 read 按 offset/limit 分段读(单次上限 2000 行 / 50KB)。`,
              `以下为开头预览:`,
              `---`,
              text.slice(0, PREVIEW_CHARS),
            ].join("\n"),
            metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
