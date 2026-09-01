// 上传服务客户端 + 附件清单格式：spec 见 docs/specs/infra/insight-file-passing.md、file-upload.md
//
// 2026-09 起 insight 图片改走本地路径（去 S3）：选/粘当下与 Excel 同链路导入 worktree，
// 发送时产出 vision FilePart{url:file://…}，server 端 prompt.ts resolvePart 读盘转 base64 落库。
// 非图片文件(④ 喂 MCP)的 S3 上传本就不在前端——server 端 octo-upload-inject 插件按需上传。
// 本文件的 uploadFile **只服务 make 页**（仍走 S3）；insight 侧只用客户端校验 + 分类谓词 + [附件] 清单 format/parse。
//
// 设计要点：
// - form 里只发 file 一个字段，不组 S3 路径（路径策略是服务端的事）
// - 端点从环境变量 VITE_OCTO_UPLOAD_ENDPOINT 读取，内网同学改 .env.local 即可（详见 spec §端点）
// - 全链路 console 日志统一前缀 [octo:upload]，便于内外网隔空调试

// 上传服务端地址。配置方式：packages/desktop/.env 里写 VITE_OCTO_UPLOAD_ENDPOINT=...
const UPLOAD_ENDPOINT = import.meta.env.VITE_OCTO_UPLOAD_ENDPOINT ?? ""

const LOG = "[octo:upload]"

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // Insight 当前 100MB；其他 agent 可自定
 // 入口白名单以「解析/消费能力」为源头（支持格式 SOT 见 SPEC-INS-016 §3.1）：
// - txt/md → FilePart 内联（路由 ①）；docx/xlsx/pdf/pptx → extract_document 本地抽取（②）+ MCP
//   按需上传（④）。服务端白名单现为 txt/md/docx/xlsx/pdf（见 file-upload spec），pptx 已请协作
//   团队跟进；跟进前 pptx 走 ② 正常、走 ④ 会 415 回灌。
// - 图片(png/jpg/jpeg/gif/webp)是前端单独放开的白名单项：产品要求输入框能粘贴/上传图片，
//   但服务端白名单（由 analyze_interview 可处理格式决定）暂未含图片。这是「前端先放校验、
//   后端后续跟进」的有意为之，别照 file-upload spec 把图片项删掉——删了图片就上传不了。
// UPLOAD_ACCEPT / UPLOAD_HINT / validateFile 都从本常量派生，单一事实源。
export const ALLOWED_EXT = ["txt", "md", "docx", "xlsx", "pdf", "pptx", "png", "jpg", "jpeg", "gif", "webp"] as const

export type UploadResult = {
  url: string
  fileId: string
  fileName: string
  size: number
  mime: string
}

// 服务端响应统一封装（内网约定，spec §接口合同）
type ApiResponse<T> = {
  content: T | null
  success: boolean
  errorCode: number
  errorMessage: string | null
}

export type UploadErrorCode =
  | "FILE_TOO_LARGE"
  | "EXT_NOT_ALLOWED"
  | "FILENAME_EMPTY"
  | "FILE_INVALID"
  | "RATE_LIMITED"
  | "ENDPOINT_NOT_CONFIGURED"
  | "NETWORK"
  | "INTERNAL"

export class UploadError extends Error {
  constructor(public code: UploadErrorCode, message?: string) {
    super(message ?? code)
    this.name = "UploadError"
  }
}

export function getExt(filename: string): string {
  const dot = filename.lastIndexOf(".")
  // 与 Node path.parse / Python os.path.splitext 一致：开头的点不算扩展名分隔符，
  // 即 ".txt" / ".env" 视为「没有扩展名的隐藏文件」(dot===0)，而非 "txt" 扩展名。
  // 这样真·dotfile 会落到 validateFile 的 EXT_NOT_ALLOWED，被客户端清晰拒掉。
  if (dot <= 0 || dot === filename.length - 1) return ""
  return filename.slice(dot + 1).toLowerCase()
}

// 「只有扩展名、没有文件名」判定：主名（末尾扩展名之前、再去掉开头的点）为空。
// 命中：".txt" / ".env" / "..txt" / "."。
// 不命中：".index.md"（主名 ".index" 非空，合法隐藏文件）、"report"（无点，属无扩展名另一类）。
function hasEmptyBaseName(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  if (dot < 0) return false
  return filename.slice(0, dot).replace(/^\.+/, "") === ""
}

// 客户端文件名清洗已移除（2026-07-03）：原 sanitizeFileName 是防「内网上传服务把未编码的
// 原始文件名拼进返回 URL、特殊字符致 MCP 取文件失败」的防御性补丁。字符集安全改由服务端
// 合同 v2 保证（uuid key + 下载走自有域名，见 file-upload.md 顶部 2026-07-03 修订提案）。

export function validateFile(file: File): UploadError | null {
  if (file.size === 0) return new UploadError("FILE_INVALID", "文件为空")
  if (file.size > MAX_UPLOAD_SIZE) {
    return new UploadError(
      "FILE_TOO_LARGE",
      `文件超过 ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)}MB 上限`,
    )
  }
  // 空主名（只有扩展名）优先于扩展名白名单判定：给「文件名为空」的精准文案，而非笼统「无扩展名」
  if (hasEmptyBaseName(file.name)) {
    return new UploadError("FILENAME_EMPTY", "文件名为空，请重命名文件后重新上传")
  }
  const ext = getExt(file.name)
  if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
    return new UploadError("EXT_NOT_ALLOWED", `不支持的格式 .${ext || "(无扩展名)"}`)
  }
  return null
}

// 业务错误码 → 客户端语义。spec §业务错误码
function mapErrorCode(code: number, message: string | null): UploadError {
  const msg = message ?? ""
  if (code === 305) return new UploadError("FILE_INVALID", msg || "文件无效")
  if (code === 413) return new UploadError("FILE_TOO_LARGE", msg || "超过服务端大小上限")
  if (code === 415) return new UploadError("EXT_NOT_ALLOWED", msg || "服务端不支持的格式")
  if (code === 429) return new UploadError("RATE_LIMITED", msg || "上传繁忙，请稍后重试")
  if (code >= 500) return new UploadError("INTERNAL", msg || `服务端错误 (errorCode=${code})`)
  return new UploadError("INTERNAL", msg || `上传失败 (errorCode=${code})`)
}

// HTTP 层失败兜底（被代理直接拒、或服务端没按封装协议返回时走这里）
function mapHttpStatus(status: number): UploadError {
  if (status === 413) return new UploadError("FILE_TOO_LARGE", "超过服务端大小上限")
  if (status === 415) return new UploadError("EXT_NOT_ALLOWED", "服务端不支持的格式")
  if (status === 429) return new UploadError("RATE_LIMITED", "上传繁忙，请稍后重试")
  if (status >= 500) return new UploadError("INTERNAL", `服务端错误 (HTTP ${status})`)
  return new UploadError("INTERNAL", `上传失败 (HTTP ${status})`)
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const meta = { filename: file.name, size: file.size, mime: file.type }
  console.log(`${LOG} 1/5 start`, meta)

  const validationErr = validateFile(file)
  if (validationErr) {
    console.warn(`${LOG} validate failed (client-side)`, {
      ...meta,
      code: validationErr.code,
      message: validationErr.message,
    })
    throw validationErr
  }

  if (!UPLOAD_ENDPOINT) {
    // 用户可见文案友好简洁;开发期排查提示(改 .env.local)只走 console,不糊给用户
    const err = new UploadError("ENDPOINT_NOT_CONFIGURED", "上传服务暂时不可用，请稍后重试")
    console.error(`${LOG} endpoint not configured`, {
      hint: "在 packages/desktop/.env 设置 VITE_OCTO_UPLOAD_ENDPOINT=<内网地址>,然后重启 dev",
    })
    throw err
  }

  console.log(`${LOG} 2/5 request`, { endpoint: UPLOAD_ENDPOINT, ...meta })

  const form = new FormData()
  form.append("file", file)

  let res: Response
  try {
    res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: form })
  } catch (e) {
    // fetch 抛出的原生 Error.message 是英文（如 "Failed to fetch"），固定用中文文案
    const err = new UploadError("NETWORK", "网络异常，请检查连接后重试")
    console.error(`${LOG} network failed`, { ...meta, nativeError: e instanceof Error ? e.message : String(e) })
    throw err
  }

  // 优先按业务封装解析；HTTP 层异常作兜底
  let body: ApiResponse<UploadResult> | null = null
  let rawText = ""
  try {
    rawText = await res.text()
    body = JSON.parse(rawText) as ApiResponse<UploadResult>
  } catch {
    // 服务端未返回 JSON 或解析失败，body 保持 null，rawText 留作排查用
  }

  console.log(`${LOG} 3/5 response`, {
    ...meta,
    httpStatus: res.status,
    httpOk: res.ok,
    body: body ?? { rawText: rawText.slice(0, 500) },
  })

  if (!body || typeof body !== "object" || typeof body.success !== "boolean") {
    // 非约定格式：用 HTTP 状态码兜底
    if (!res.ok) {
      const err = mapHttpStatus(res.status)
      console.error(`${LOG} http failed`, { ...meta, httpStatus: res.status, mappedCode: err.code })
      throw err
    }
    const err = new UploadError(
      "INTERNAL",
      "服务端响应格式不符合约定（缺少 success/errorCode 字段）",
    )
    console.error(`${LOG} bad response format`, { ...meta, body, rawText: rawText.slice(0, 500) })
    throw err
  }

  if (!body.success) {
    const err = mapErrorCode(body.errorCode, body.errorMessage)
    console.error(`${LOG} 4/5 business error`, {
      ...meta,
      errorCode: body.errorCode,
      errorMessage: body.errorMessage,
      mappedCode: err.code,
    })
    throw err
  }
  if (!body.content) {
    const err = new UploadError("INTERNAL", "服务端返回 success=true 但 content 为空")
    console.error(`${LOG} empty content`, { ...meta, body })
    throw err
  }

  console.log(`${LOG} 5/5 success`, {
    ...meta,
    url: body.content.url,
    fileId: body.content.fileId,
  })
  return body.content
}

// 图片扩展名(ALLOWED_EXT 的子集)。SPEC-INS-015 路由 ③(2026-09 起):图片与非图片同链路导入
// worktree 拿本地 path,发送时产出 vision FilePart{url:file://…},server 端读盘转 base64。
// 前端按文件名判定走哪条(图片不进 [附件] 清单、不占内联预算)。
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"])

export function isImageFile(filename: string): boolean {
  return IMAGE_EXT.has(getExt(filename))
}

// 可被 opencode 直接内联正文的文件(SPEC-INS-015 路由 ①)。这类走 FilePart(file://, text/plain),
// 组 prompt 时服务端调 `read` 把正文读进上下文(2000 行 / 50KB 上限,超出附 offset 续读提示)。
//
// **判定是反向排除,不是正向白名单**(2026-08-20 修订):上游 read 支持的是「任何非二进制文本」
// (tool/read.ts isBinaryFile = 二进制扩展名黑名单 + 内容嗅探),不是一份固定清单。此处只排掉
// **我们有专门通道的**格式,其余一律交给 read 自己判定 —— 这样上传格式放开(如 json / csv)时
// 无需再同步一次内联清单,判定口径也与 opencode 原生一致。
//   - office / pdf → `extract_document`(read 对 office 显式拒绝、对 pdf 内容嗅探判二进制)
//   - 图片        → vision FilePart{url:file://…}(路由 ③,server 端读盘转 base64)
// 排除集之外的文件若真是二进制(如 `@` 一个 .zip 产物),read 会返回 "Cannot read binary file"
// 进上下文 —— 响亮失败,模型看得懂,不做客户端预判(嗅探要读文件字节,是服务端的活)。
/** extract_document 负责的文档类(SPEC-INS-015 路由 ②)。二进制容器,发送前拿不到正文体量。 */
const EXTRACT_DOC_EXT = new Set(["docx", "xlsx", "pptx", "doc", "xls", "ppt", "pdf"])

const NON_INLINE_EXT = new Set([
  ...EXTRACT_DOC_EXT,
  // 图片走 vision(路由 ③)
  ...IMAGE_EXT,
])

export function isTextInlineFile(filename: string): boolean {
  return !NON_INLINE_EXT.has(getExt(filename))
}

/**
 * 是否走 `extract_document` 的文档类。与 isTextInlineFile 不是简单互补 —— 图片两边都不算
 * (它走 vision,既不占内联预算,也不进分治判定的份数)。
 * 用途:SPEC-INS-032 §2.6 的**份数口径**——这类文件发送前只有二进制大小、拿不到正文字节,
 * 无法并入 INLINE_BUDGET 的字节预算,故按份数判分治。
 */
export function isExtractableDocFile(filename: string): boolean {
  return EXTRACT_DOC_EXT.has(getExt(filename))
}

// 按 SPEC-INS-015 §2 拼「附件清单」段落:每行 `- <文件名>: <本地绝对路径>`。
//
// 该段落作为**独立的 synthetic text part** 发送(不进用户可见文本):
//   - server 的 toModelMessages 对 user 消息只过滤 ignored,synthetic 照样喂给模型 → 模型拿到文件清单
//   - 上游 UserMessageDisplay 只渲染非 synthetic text part → 气泡不暴露裸路径;文件卡片由 InsightTurn
//     解析本段落渲染(parseAttachmentManifest)
//
// 清单只给「文件名 + 本地路径」,**不触发任何上传**:
//   - 本地读(① txt/md 另走 FilePart 内联、② office 由模型调 extract_document 拿路径读)
//   - 喂 MCP(④):模型被 prompt 约束「文件参数只填文件名」,server 端 octo-upload-inject 插件在工具
//     执行前按文件名找到本地路径、**按需**上传 S3、把文件名换成精确 URL。模型全程不接触 URL。
//   格式契约与该插件 parseManifest 同源,改格式需两处同步。
// 注:图片不进本清单(走 ③ FilePart{url:file://…},由非图片的 isImageFile 过滤天然保证)。
export function formatUploadsForPrompt(files: Array<{ filename: string; path: string }>): string {
  if (files.length === 0) return ""
  const lines = files.map((f) => `- ${f.filename}: ${f.path}`)
  return `[附件]\n${lines.join("\n")}`
}

// SPEC-INS-032 §2.3.2 / §2.4:超内联预算时的体量说明,作为**独立 synthetic 块**发送。
//
// 为什么不附在 `[附件]` 块尾:内联判定覆盖 `[附件]` 与 `[引用文件]` **两条**来源(SPEC-INS-023 §7.2
// 起两者一致),而 formatUploadsForPrompt 在无附件时返回空串——只 `@` 引用大文件的那轮说明就丢了。
// 独立块两条来源都覆盖,也不必动 `[附件]` 的行格式契约(它有三个消费方)。
//
// 文案面向**模型**,只陈述事实 + 给出该做什么,不写 UI 概念;两句话都必须在,缺一句弱模型就会走偏:
// 少了「正文未进上下文」它会直接凭文件名编;少了「逐份派」它会试图一次读完。
export const DISPATCH_NOTE_HEADER = "[材料体量]"

export function formatDispatchNote(input: {
  count: number
  totalBytes: number
  docCount: number
  oversized: Array<{ filename: string; bytes: number }>
}): string {
  const kb = (b: number) => `${Math.round(b / 1024)} KB`
  // 两类材料的说法要分开：文本类给得出确切体量（字节就是进上下文的量），
  // 文档类只给份数（发送前拿不到正文体量，见 SPEC-INS-032 §2.6）。说不知道的数会把模型带偏。
  const parts: string[] = []
  if (input.count > 0) parts.push(`${input.count} 份文本材料（合计约 ${kb(input.totalBytes)}）`)
  if (input.docCount > 0) parts.push(`${input.docCount} 份文档（docx / pdf / xlsx / pptx）`)

  const paragraphs = [
    `${DISPATCH_NOTE_HEADER} 本轮共有 ${parts.join("、")}（含 [附件] 与 [引用文件]）。` +
      `这批材料的正文**未**随本条消息进入你的上下文——你现在只有文件名和路径，材料内容一个字都没有。`,
    `请**逐份**派 insight_reader 子代理通读：每份材料单独发一个 task，把该文件的绝对路径和这次要提炼什么写进去，` +
      `**一份回来了再派下一份**，收齐所有结论后再写报告。不要试图自己一次性读完这些材料——那正是会撞上下文上限的做法。`,
  ]
  if (input.oversized.length > 0) {
    const names = input.oversized.map((f) => `「${f.filename}」(${kb(f.bytes)})`).join("、")
    paragraphs.push(
      // 只给正面指令：这轮的说明就贴在材料旁边，写「不要让用户拆分文件」反而是把那个词递到它眼前。
      // 明确的禁止留在常驻提示词里（那是针对已发生过的错误行为的长期约束）。
      `其中 ${names} 单份就超出了子代理一次能通读的量。**照样派子代理**——` +
        `子代理调 extract_document 时会拿到一份切段清单，按段分几次派完即可，每段一个 task。`,
    )
  }
  return paragraphs.join("\n")
}

// SPEC-INS-023 @ 引用清单(`@文件` 引用已存在的会话文件:outputs 产物 + uploads 上传)。
//
// 与 `[附件]` **行格式完全一致**(`- <文件名>: <本地绝对路径>`)、同为 synthetic,两点区别:
//   ① InsightTurn 不按本头渲染文件卡片(气泡里已有 @ 胶囊,再渲染卡片是重复) —— 这也是当初
//      另起一个头而非复用 `[附件]` 的**唯一**理由(spec §7.2);
//   ② 正文**未随消息内联**(`[附件]` 的 txt/md 走 FilePart(file://) 由 server 端 read 进上下文,
//      本清单不走) —— 故本清单里的 txt/md 要读正文仍需 extract_document,与 `[附件]` 的硬规则相反。
//
// 但对 server 端 octo-upload-inject 而言两者**完全等价**:都是「本会话可喂 MCP 的文件白名单」。
// 插件的 MANIFEST_HEADERS 必须同时认这两个头(2026-08-20 内网修复:此前只认 `[附件]`,`@` 来的
// 产物文件在研究工具轮被判「不在清单」→ 模型自我阻断 / 插件 resolvePath 抛错,两条路都死)。
// 改格式或增删头需与插件两处同步。
//
// 文案只陈述**事实**、不含工具指令:chip turn 会禁用 extract_document(mcp-trigger buildToolGate),
// 清单里若写死「用 extract_document 读取」会与 chip 模板的「本轮不要读正文」直接冲突。
// 怎么读由常驻提示词按场景区分(octo_insight.md「怎么读文件」)。
export const MENTION_BLOCK_HEADER = "[引用文件]"

export function formatMentionedFilesForPrompt(files: Array<{ filename: string; path: string }>): string {
  if (files.length === 0) return ""
  const lines = files.map((f) => `- ${f.filename}: ${f.path}`)
  // 2026-08-20:`@` 的文件与附件走同一条内联路径(isTextInlineFile 判定),故两个清单对模型而言
  // 行为已经一致 —— 文案不再区分"正文有没有内联"。
  return `${MENTION_BLOCK_HEADER} 用户本轮 @ 引用了以下已存在的会话文件(与 [附件] 同属本会话可用文件):\n${lines.join("\n")}`
}

// formatUploadsForPrompt 的逆操作:从 synthetic text part 解析出 { filename, path } 列表,
// 供 InsightTurn 渲染输入文件卡片。两者共用同一格式,是单一事实源。
// (`[引用文件]` 块行格式相同,故本函数同样可解析它 —— 首行说明不以 "- " 开头,自然跳过。)
export function parseUploadedFiles(block: string): Array<{ filename: string; path: string }> {
  const out: Array<{ filename: string; path: string }> = []
  for (const line of block.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ")) continue
    // 按第一个 ": " 切分,不用正则 \S+:文件名 / 本地路径都可能含空格,\S+ 会截断 → 整行丢弃。
    const body = trimmed.slice(2)
    const sep = body.indexOf(": ")
    if (sep < 0) continue
    const filename = body.slice(0, sep).trim()
    const path = body.slice(sep + 2).trim()
    if (filename && path) out.push({ filename, path })
  }
  return out
}
