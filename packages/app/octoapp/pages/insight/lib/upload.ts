// 上传服务客户端 + 附件清单格式：spec 见 docs/specs/infra/insight-file-passing.md、file-upload.md
//
// SPEC-INS-015 路由后,前端的 uploadFile 只服务 **③ 图片**（change 即传 S3 → vision FilePart{url}）：
//   - 图片必然要上传(模型无法理解本地路径的图),故选/粘当下就传,与"是否调 MCP"无关。
//   - 非图片文件(④ 喂 MCP)的 S3 上传**不在前端**——下沉到 server 端 octo-upload-inject 插件,
//     模型真调 MCP 工具时才按需上传(见 insight-file-passing.md §3)。
// 本文件保留:客户端校验 + 文件名清洗 + 图片 uploadFile + [附件] 清单 format/parse。
//
// 设计要点：
// - form 里只发 file 一个字段，不组 S3 路径（路径策略是服务端的事）
// - 端点从环境变量 VITE_OCTO_UPLOAD_ENDPOINT 读取，内网同学改 .env.local 即可（详见 spec §端点）
// - 全链路 console 日志统一前缀 [octo:upload]，便于内外网隔空调试

// 上传服务端地址。配置方式：packages/desktop/.env 里写 VITE_OCTO_UPLOAD_ENDPOINT=...
const UPLOAD_ENDPOINT = import.meta.env.VITE_OCTO_UPLOAD_ENDPOINT ?? ""

const LOG = "[octo:upload]"

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // Insight 当前 100MB；其他 agent 可自定
// 图片(png/jpg/jpeg/gif/webp)是前端单独放开的白名单项：产品要求输入框能粘贴/上传图片，
// 但 file-upload spec 里服务端白名单（由 analyze_interview 可处理格式决定）暂未含图片。
// 这是「前端先放校验、后端后续跟进」的有意为之，别照 spec 把图片项删掉——删了图片就上传不了。
// UPLOAD_ACCEPT / UPLOAD_HINT / validateFile 都从本常量派生，单一事实源。
export const ALLOWED_EXT = ["txt", "md", "docx", "xlsx", "png", "jpg", "jpeg", "gif", "webp"] as const

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

function getExt(filename: string): string {
  const dot = filename.lastIndexOf(".")
  // 与 Node path.parse / Python os.path.splitext 一致：开头的点不算扩展名分隔符，
  // 即 ".txt" / ".env" 视为「没有扩展名的隐藏文件」(dot===0)，而非 "txt" 扩展名。
  // 这样真·dotfile 会落到 validateFile 的 EXT_NOT_ALLOWED，被客户端清晰拒掉。
  if (dot <= 0 || dot === filename.length - 1) return ""
  return filename.slice(dot + 1).toLowerCase()
}

// 「只有扩展名、没有文件名」判定：主名（末尾扩展名之前、再去掉开头的点）为空。
// 命中：".txt" / ".env" / 清洗后塌成 ".txt" 的 "***.txt" / "..txt" / "."。
// 不命中：".index.md"（主名 ".index" 非空，合法隐藏文件）、"report"（无点，属无扩展名另一类）。
function hasEmptyBaseName(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  if (dot < 0) return false
  return filename.slice(0, dot).replace(/^\.+/, "") === ""
}

// 文件名清洗：内网上传服务把**未编码的原始文件名**直接拼进返回 URL，URL 再交给 MCP 取文件。
// 文件名里出现允许集之外的特殊字符（如 ()（）、&、%、+、@、！、，、各种全角标点，以及
// 路径/通配相关的 \ : * ? < > |）会让 MCP 端解析/取文件失败。这里在上传前把这类字符整段去掉。
//
// 允许保留：字母 / 数字 / 各类文字（含中文等 Unicode 字母）+ 以下特殊字符与空格：
//   # - . / [ ] ^ _ ` { } 和空格
// 其余字符一律删除。删空后兜底为 "file"（极端情况下整名都是非法字符）。
//
// 本函数只去非法字符、不造主名：形如 ".txt"、或清洗后塌成 ".txt" 的 "***.txt"，属
// 「无扩展名的隐藏文件」(见 getExt：开头的点不算扩展名)，交由 validateFile 以
// EXT_NOT_ALLOWED 清晰拒掉，而非偷偷改名成 file.txt 再上传。
const FILENAME_DISALLOWED = /[^\p{L}\p{N} #./[\]^_`{}-]/gu

export function sanitizeFileName(name: string): string {
  return name.replace(FILENAME_DISALLOWED, "").trim() || "file"
}

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

// 图片扩展名(ALLOWED_EXT 的子集)。SPEC-INS-015 路由 ③:图片走 vision FilePart{url:S3},
// 与非图片文件(进 [附件] 清单 + 本地读 / MCP)分流。前端按文件名判定走哪条。
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"])

export function isImageFile(filename: string): boolean {
  return IMAGE_EXT.has(getExt(filename))
}

// 可被 opencode 直接内联正文的纯文本类(SPEC-INS-015 路由 ①)。这类走 FilePart(file://, text/plain),
// 组 prompt 时 opencode 自动 Read 内联;office(docx/xlsx)是二进制,走 FilePart 会被 base64,不在此列
// (② 由模型调 extract_document 读)。
const TEXT_INLINE_EXT = new Set(["txt", "md"])

export function isTextInlineFile(filename: string): boolean {
  return TEXT_INLINE_EXT.has(getExt(filename))
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
// 注:图片不进本清单(走 ③ FilePart{url})。
export function formatUploadsForPrompt(files: Array<{ filename: string; path: string }>): string {
  if (files.length === 0) return ""
  const lines = files.map((f) => `- ${f.filename}: ${f.path}`)
  return `[附件]\n${lines.join("\n")}`
}

// formatUploadsForPrompt 的逆操作:从 synthetic text part 解析出 { filename, path } 列表,
// 供 InsightTurn 渲染输入文件卡片。两者共用同一格式,是单一事实源。
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
