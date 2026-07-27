import type { Plugin } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"

/**
 * octo-upload-inject —— 在 MCP 工具执行前,把模型填的**文件名**按需上传 S3 后换成精确 URL。
 *
 * 背景 / 决策见 octo-agent 文档仓 SPEC-INS-015(文件传参机制 ④ MCP 按需上传)、ADR-015 / ADR-014。
 *
 * 机制(SPEC-INS-015 路由 ④):
 *   - insight 页选非图片文件时只把源文件拷进 <projectDir>/.octo/tmps 或 .octo/<sessionId>/uploads
 *     (本地副本,SPEC-INS-014 v2 会话隔离),**不上传 S3**。
 *     发送时以 `[附件]` synthetic text part 注入 session(可用文件清单,模型从不改写):
 *       [附件]
 *       - <文件名>: <本地绝对路径>
 *     行格式与 packages/app/octoapp/pages/insight/lib/upload.ts 的 formatUploadsForPrompt 单一事实源。
 *   - 模型被 prompt 约束「调 MCP 工具时,文件参数只填**文件名**,绝不填路径/URL」。
 *   - 本插件在 `tool.execute.before` 钩子里:若 args 引用了清单里的某文件名,**才**读对应本地文件、
 *     POST 上传服务拿 url、把文件名就地换成 url。→ 模型真调 MCP 才触发 S3;不调则永不上传。
 *   - 进程内缓存「本地路径→url」:同一文件多轮多次调用只上传一次。
 *   - 上传失败 → 抛错让工具调用失败,错误回灌模型(让其重试/换路),不静默放行坏值。
 *
 * 为什么按文件名替换、不再用占位 handle:改完后模型自始至终**不接触 S3 URL**(清单只给文件名/路径,
 *   URL 全程由本插件生成注入),ADR-014 当初怕的"弱模型抄坏 URL"根因已消失;文件名人类可读、不漏 id 进对话。
 * 为什么是"纯解析器":不按工具名分支(不依赖 uxr-tool_ 前缀)、不依赖字段名;只替换模型明确引用的文件名。
 *
 * SPEC-INS-017 §2.1 追加(chip 声明路径,通用路径之上的确定性层;2026-07-06 修订):chip turn 的
 *   user 消息带 `[MCP声明]`(目标工具 + 是否需要大纲字段 + 用户原文)。声明命中时对该调用做
 *   **字段级校验与确定性注入**——download_links / outline_file_path 里的文件名必须精确命中清单
 *   (miss / 缺字段 / 为空 → 抛错响亮失败,错误信息带可用文件清单让模型重试),命中后替换成 URL 并
 *   注入 download_file_names / outline_file_name / user_prompt(该路径按字段名写入,mcp-contract
 *   契约字段,改名需同步)。**不覆盖文件集**:哪些文件、谁是大纲由模型决定(拿不准由它向用户确认),
 *   客户端只钉「触发」与「URL 传递」两件事。非 chip turn 无声明 → 下方通用路径行为不变。
 *
 * 约束:必须「就地改写」output.args(prompt.ts 的 execute 用的是同一对象引用),不能整体重新赋值。
 */

const UPLOAD_BLOCK_HEADER = "[附件]"
const LOG = "[octo:inject]"

// ── SPEC-INS-017 §2.1:chip 声明校验与注入(2026-07-06 修订) ────────
// chip turn 的客户端在 user 消息里注入 `[MCP声明]` synthetic part(与 [附件] 清单同机制),
// 声明目标工具 + 是否需要大纲字段 + 用户原文。本插件读到声明且 input.tool 匹配时,对文件字段做
// **精确校验**(文件名必须命中清单,否则响亮失败并回灌可用文件列表)、URL 替换与确定性注入
// (download_file_names / outline_file_name / user_prompt)。文件集与角色分桶归模型,不覆盖。
// 格式契约与客户端 pages/insight/store/mcp-trigger.ts buildChipDeclaration 同源
// (两处独立实现,改格式需同步)。
//
// MCP server 前缀:octo_insight 绑定内置 server "uxr-tool"(config/builtin-mcp.ts 固定键,
// 用户覆盖配置沿用同键),工具注册键 = `uxr-tool_<tool>`。仅对该前缀的调用做声明查找,
// 非 MCP 工具保持 hasFileRef 零开销早退。
const MCP_TOOL_PREFIX = "uxr-tool_"
const MCP_DECLARATION_HEADER = "[MCP声明]"

// 吃**本地路径**的内置工具:它们的 path/filePath 参数是本地磁盘目标,永远不该被换成 S3 URL
// (S3 URL 替换只服务 MCP 工具 uxr-tool_*)。extract_document 之外的项(write/edit/apply_patch/
// read/glob/grep)此前漏收,导致模型对上传文件做 write 时 filePath 被替换成 S3 URL、落点建目录崩溃。
const LOCAL_FILE_TOOLS = new Set(["extract_document", "write", "edit", "apply_patch", "read", "glob", "grep"])

type ChipDeclaration = {
  tool: string
  // 该工具是否要求 outline_file_path(多角色工具);按声明校验必填,免于按工具名硬编码
  outline_required: boolean
  // 用户当轮提示词原文(mcp-contract:原样透传不改写),有值时强制覆盖
  user_prompt?: string
}

// 「user_prompt 矫正命中」进程内计数(spec §2.1 度量):模型改写用户原文、被声明矫正的次数。
let chipCorrectionHits = 0

// 解析一段 [MCP声明] 区块文本(必须以头开始)→ ChipDeclaration。格式坏 = 客户端 bug,返回 Error 由调用方响亮失败。
function parseChipDeclaration(text: string): ChipDeclaration | Error {
  try {
    const parsed = JSON.parse(text.slice(MCP_DECLARATION_HEADER.length).trim()) as ChipDeclaration
    if (typeof parsed?.tool !== "string" || typeof parsed?.outline_required !== "boolean") {
      return new Error("[MCP声明] 缺少 tool / outline_required 字段")
    }
    return parsed
  } catch (e) {
    return new Error(`[MCP声明] JSON 解析失败:${e instanceof Error ? e.message : String(e)}`)
  }
}

// 非图片可喂 MCP 的文件扩展名(图片走 vision、不入此路)。仅作**早退预筛**:args 里没有任何
// 以这些扩展名结尾的字符串,就别去拉 session 消息(非文件工具一律零开销放行)。
// 实际是否替换以「该字符串精确等于清单里某文件名」为准。
const DOC_EXT_RE = /\.(docx|xlsx|pdf|pptx|txt|md)$/i

type ManifestFile = { filename: string; path: string }

// 进程内缓存「本地路径 → 已上传 url」。路径全局唯一(uploads 撞名加后缀),
// 同一文件多轮多次调用 MCP 只上传一次(SPEC-INS-015 §3 幂等)。
const uploadCache = new Map<string, string>()

// 解析一段 `[附件]` 区块 → [{filename, path}]。
// 与 insight upload.ts 的 parseUploadedFiles 同一格式契约(两处独立实现,改格式需同步)。
function parseManifest(text: string): ManifestFile[] {
  const out: ManifestFile[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ")) continue
    const body = trimmed.slice(2)
    // 按第一个 ": " 切分(文件名 / 本地路径都可能含空格,不能用 \S+)
    const sep = body.indexOf(": ")
    if (sep < 0) continue
    const filename = body.slice(0, sep).trim()
    const path = body.slice(sep + 2).trim()
    if (filename && path) out.push({ filename, path })
  }
  return out
}

// 递归扫描:args 里有没有任何"以文档扩展名结尾"的字符串(决定是否值得去拉 session 消息)。
function hasFileRef(node: unknown): boolean {
  if (typeof node === "string") return DOC_EXT_RE.test(node)
  if (Array.isArray(node)) return node.some(hasFileRef)
  if (node && typeof node === "object") return Object.values(node as Record<string, unknown>).some(hasFileRef)
  return false
}

// 递归收集 args 里出现、且在 known 集合中的文件名(要替换的那几个)。
// 只做**精确匹配**(2026-07-03 复审决定):不做去空白等启发式归一化修补——归一化可能把引用
// 误配到"仅空白不同"的另一个文件(静默换错文件比失败更糟,历史会话清单里构造得出来);且
// "模型改写引用"是无界类(今天加空格,明天换全角/删字),启发式追不完。模型抄错 → 精确 miss →
// 不替换 → 工具失败、错误回灌(响亮失败);根治是 SPEC-INS-017 §2.1 chip 声明强制覆盖
// (文件参数由客户端钉死,不经模型)。
function collectRefs(node: unknown, known: Set<string>, found: Set<string>): void {
  if (typeof node === "string") {
    if (known.has(node)) found.add(node)
    return
  }
  if (Array.isArray(node)) {
    for (const v of node) collectRefs(v, known, found)
    return
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) collectRefs(v, known, found)
  }
}

// 递归就地替换:任意 string 值若命中映射(文件名→url),换成 URL。
function replaceRefs(node: unknown, map: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i]
      if (typeof v === "string" && map.has(v)) node[i] = map.get(v)!
      else replaceRefs(v, map)
    }
    return
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (typeof v === "string" && map.has(v)) obj[k] = map.get(v)!
      else replaceRefs(v, map)
    }
  }
}

// 服务端响应统一封装(内网约定,与 file-upload.md §接口合同 / 原 lib/upload.ts 同源)。
type UploadApiResponse = {
  content: { url?: string } | null
  success: boolean
  errorCode: number
  errorMessage: string | null
}

// 跨平台 basename:sidecar 与桌面端同机,但清单里是 Windows 反斜杠路径时 node:path(posix 语义)
// 切不开 —— 统一按两种分隔符切,别依赖运行平台。
function baseNameOf(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

// 把本地文件上传到内网上传服务,返回精确 URL。带进程内缓存(同路径只传一次)。
// 失败抛错(由 tool.execute.before 上抛 → 工具调用失败 → 错误回灌模型)。
async function uploadLocalFile(localPath: string, endpoint: string): Promise<string> {
  const cached = uploadCache.get(localPath)
  if (cached) return cached

  // ⚠️ 用 node:fs 读文件、不用 Bun.file:opencode 在桌面端是 Electron utilityProcess.fork 起的
  // **Node 子进程**(非 Bun),Bun.* 全局不存在,用了会抛 "Bun is not defined" 让整个工具调用崩。
  let ab: ArrayBuffer
  try {
    const buf = await readFile(localPath)
    // 拷进一块**明确的 ArrayBuffer**:Node Buffer 底层是 ArrayBufferLike(可能 SharedArrayBuffer),
    // 直接塞 Blob 过不了 BlobPart 类型;这里显式复制成 ArrayBuffer,无需 as 断言。
    ab = new ArrayBuffer(buf.byteLength)
    new Uint8Array(ab).set(buf)
  } catch (e) {
    throw new Error(`本地文件读取失败,无法上传:${localPath}(${e instanceof Error ? e.message : String(e)})`)
  }

  const form = new FormData()
  // 只发 file 一个字段(路径策略是服务端的事);multipart 文件名 = 原样 basename。
  // 特殊字符的 URL 安全由服务端合同 v2 保证(uuid key + 下载走自有域名,file-upload.md 顶部提案);
  // v2 落地前,含白名单外字符的文件名在 MCP 下载链路仍可能失败(已知窗口,不再做客户端清洗)。
  // Node/Bun 均有全局 Blob/FormData/fetch(Node 18+)。
  form.append("file", new Blob([ab]), baseNameOf(localPath))

  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(endpoint, { method: "POST", body: form })
  } catch (e) {
    throw new Error(`上传服务网络异常:${e instanceof Error ? e.message : String(e)}`)
  }

  let body: UploadApiResponse | null = null
  let rawText = ""
  try {
    rawText = await res.text()
    body = JSON.parse(rawText) as UploadApiResponse
  } catch {
    // 非 JSON 响应,body 留 null,下方按 HTTP 状态兜底报错
  }

  if (!body || typeof body.success !== "boolean") {
    throw new Error(`上传服务响应异常 (HTTP ${res.status}): ${rawText.slice(0, 200)}`)
  }
  if (!body.success) {
    throw new Error(`上传失败 (errorCode=${body.errorCode}): ${body.errorMessage ?? ""}`)
  }
  if (!body.content?.url) {
    throw new Error("上传服务返回 success=true 但缺少 content.url")
  }

  const url = body.content.url
  uploadCache.set(localPath, url)
  console.log(`${LOG} lazy-upload ok`, { localPath, url, ms: Date.now() - t0, cacheSize: uploadCache.size })
  return url
}

// chip 声明校验与注入(SPEC-INS-017 §2.1,2026-07-06 修订):
//   - 文件集与角色分桶归模型(声明不再携带文件映射),本函数只保证「URL 传递固定」:
//     download_links / outline_file_path 里模型填的每个引用必须**精确命中**清单(三键之一),
//     命中后按需上传、就地替换成 URL;任何 miss / 缺字段 / 空列表 → 抛错响亮失败,
//     错误信息附可用文件清单,回灌模型让其重填或向用户索取材料。
//   - 确定性注入:download_file_names / outline_file_name(= 命中文件的磁盘落地名,与 URL 下标对齐)、
//     user_prompt(声明携带的用户原文,模型转述一律矫正)。
async function enforceChipDeclaration(
  decl: ChipDeclaration,
  input: { tool: string; sessionID: string },
  output: { args: unknown },
  refToPath: Map<string, string>,
  manifestNames: string[],
): Promise<void> {
  const available = manifestNames.length > 0 ? `当前可用文件:${manifestNames.join("、")}` : "当前会话没有任何可用附件"
  // 必须「就地改写」:prompt.ts 的 execute 持有的是同一 args 对象引用,整体重赋值不生效
  if (!output.args || typeof output.args !== "object" || Array.isArray(output.args)) {
    throw new Error(`工具参数不是有效对象,请按参数说明重新调用(args=${JSON.stringify(output.args)})`)
  }
  const args = output.args as Record<string, unknown>

  const dl = args["download_links"]
  if (!Array.isArray(dl) || dl.length === 0 || dl.some((v) => typeof v !== "string")) {
    throw new Error(
      `download_links 必须是非空的文件名字符串数组。${available}。没有可用附件时不要调用本工具,请先让用户上传材料。`,
    )
  }
  const outline = args["outline_file_path"]
  if (decl.outline_required && typeof outline !== "string") {
    throw new Error(`本工具要求 outline_file_path 填一个大纲/任务书的文件名。${available}。无法判断哪个是大纲时请先向用户确认。`)
  }

  // 每个引用必须精确命中清单(文件名/完整路径/磁盘 basename 三键;不做任何模糊匹配)
  const resolvePath = (ref: string): string => {
    const p = refToPath.get(ref)
    if (!p) {
      throw new Error(`文件引用「${ref}」不在 [附件] 清单中(需一字不差照抄清单里的文件名)。${available}`)
    }
    return p
  }
  const dlPaths = (dl as string[]).map(resolvePath)
  const outlinePath = typeof outline === "string" ? resolvePath(outline) : undefined

  const endpoint = process.env.OCTO_UPLOAD_ENDPOINT
  if (!endpoint) {
    console.error(`${LOG} OCTO_UPLOAD_ENDPOINT 未配置,无法按需上传`, { tool: input.tool })
    throw new Error("上传服务未配置 (OCTO_UPLOAD_ENDPOINT)，无法处理文件参数")
  }

  const before = JSON.stringify(args)
  // 替换成 URL;file_names = 磁盘落地名(basename,与展示名/清单名一致),与 URL 数组下标对齐
  const dlUrls: string[] = []
  for (const p of dlPaths) dlUrls.push(await uploadLocalFile(p, endpoint))
  args["download_links"] = dlUrls
  args["download_file_names"] = dlPaths.map(baseNameOf)
  if (outlinePath) {
    args["outline_file_path"] = await uploadLocalFile(outlinePath, endpoint)
    args["outline_file_name"] = baseNameOf(outlinePath)
  }

  // user_prompt 原文透传(mcp-contract):模型转述/裁剪一律矫正回原文;声明无该字段时不动模型的值
  const userPromptCorrected = typeof decl.user_prompt === "string" && args["user_prompt"] !== decl.user_prompt
  if (typeof decl.user_prompt === "string") args["user_prompt"] = decl.user_prompt
  if (userPromptCorrected) chipCorrectionHits += 1

  console.log(`${LOG} chip-declaration enforced`, {
    tool: input.tool,
    sessionID: input.sessionID,
    files: dlUrls.length + (outlinePath ? 1 : 0),
    userPromptCorrected, // true = 模型改写了用户原文、被矫正(spec §2.1 度量)
    correctionHits: chipCorrectionHits, // 进程内累计
    before,
    after: JSON.stringify(args),
  })
}

export const OctoUploadInjectPlugin: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // 本地文件工具收**本地路径**,绝不能被替换成 S3 url —— 显式跳过。只有 MCP 工具(uxr-tool_*)填的
      // 文件名才需要按需上传换 URL。write/edit/apply_patch 的 filePath 是落盘目标:若被换成 S3 URL,
      // 后续 octo-outputs-redirect 会把非绝对的 https:// 串 join 进 outputs/,建目录时因路径含 URL 成分
      // 崩溃(内网实测:上传 md → 让其在末尾追加,write 报 makeDirectory .../outputs/https:/.../... 失败)。
      // read/glob/grep 同理(读/搜本地文件)。extract_document 原就是这个道理,一并收进本集合。
      // (input.tool 对 MCP 是带 server 前缀的 uxr-tool_*,对本地工具是裸工具名 / <task>_extract_document。)
      if (LOCAL_FILE_TOOLS.has(input.tool) || input.tool.endsWith("_extract_document")) return

      // 早退:args 里没有任何"以文档扩展名结尾"的串,就别去拉消息(非文件工具一律零开销放行)。
      // 例外:MCP 工具(uxr-tool_*)不能靠 args 早退——chip 声明路径(SPEC-INS-017 §2.1)要接管的
      // 正是"模型漏填/写坏文件参数"的情况,此时 args 里可能根本没有文件名形态串。
      const isMcpTool = input.tool.startsWith(MCP_TOOL_PREFIX)
      if (!isMcpTool && !hasFileRef(output.args)) return

      // 聚合**整个 session** 所有 user 消息里的 [附件] 区块,建「引用 → 本地路径」总表。
      // 引用收录**文件名 / 完整路径 / 路径 basename** 三种键:提示词要模型填文件名,但内网弱模型
      // 可能照抄清单里的完整路径、或从 extract_document 的路径参数里抄磁盘 basename(撞名后缀名,
      // 与清单文件名可能不同)—— 三种都认,避免"引用了文件却没上传、把裸文件名/本地路径丢给 MCP"。
      // 同一次拉取顺带取**当前 turn(最后一条 user 消息)**的 [MCP声明](仅 chip turn 存在)。
      const refToPath = new Map<string, string>()
      const manifestNames: string[] = [] // 清单文件名(去重),用于 chip 校验失败时回灌"可用文件"提示
      let declarationText: string | undefined
      try {
        const res = await client.session.messages({ path: { id: input.sessionID } })
        const msgs =
          (res as { data?: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }> })
            .data ?? []
        let lastUser: (typeof msgs)[number] | undefined
        for (const m of msgs) {
          if (m.info?.role !== "user") continue
          lastUser = m
          for (const p of m.parts ?? []) {
            // 必须按「头在第 0 位」锚定,不能用 includes:chip 模板正文里会**提及** [附件] / [MCP声明]
            // 字面量(如调用纪律"[MCP声明] 段落是给系统读取的…"),includes 会把模板误当区块解析
            // ——2026-07-08 内网事故:声明定位命中模板,JSON.parse 到中文句子,所有 chip 调用响亮失败。
            // 清单/声明 part 由客户端构造,头恒在开头(formatUploadsForPrompt / buildChipDeclaration)。
            if (p.type !== "text" || typeof p.text !== "string" || !p.text.startsWith(UPLOAD_BLOCK_HEADER)) continue
            for (const f of parseManifest(p.text)) {
              if (!refToPath.has(f.filename)) manifestNames.push(f.filename)
              refToPath.set(f.filename, f.path)
              refToPath.set(f.path, f.path)
              refToPath.set(baseNameOf(f.path), f.path)
            }
          }
        }
        // 声明只认**当前 turn**(最后一条 user 消息);同样按 startsWith 锚定,见上
        if (isMcpTool && lastUser) {
          declarationText = (lastUser.parts ?? []).find(
            (p) => p.type === "text" && typeof p.text === "string" && p.text.startsWith(MCP_DECLARATION_HEADER),
          )?.text
        }
      } catch (err) {
        console.error(`${LOG} failed to read session messages`, { tool: input.tool, sessionID: input.sessionID, err })
        return // 读取失败不强改,交回模型原值
      }

      // ── chip 声明强制对齐(SPEC-INS-017 §2.1)──────────────────
      if (declarationText) {
        const decl = parseChipDeclaration(declarationText)
        if (decl instanceof Error) {
          // 声明格式坏 = 客户端 bug:响亮失败,不静默降级到"信模型抄写"的旧路径
          console.error(`${LOG} chip-declaration parse failed`, { tool: input.tool, sessionID: input.sessionID, err: decl.message })
          throw decl
        }
        if (decl.tool === input.tool) {
          await enforceChipDeclaration(decl, input, output, refToPath, manifestNames)
          return // 声明路径已完成校验/替换/注入,不再走下方通用替换
        }
        // 声明存在但目标工具不同(如 chip turn 里模型违规调了 get_task_result):按无声明处理
        console.warn(`${LOG} chip-declaration tool mismatch, fallthrough`, {
          tool: input.tool,
          declaredTool: decl.tool,
          sessionID: input.sessionID,
        })
      }

      // ── 以下为原按需上传路径(非 chip turn / 声明工具不匹配),机制不变 ──
      if (!hasFileRef(output.args)) return

      if (refToPath.size === 0) {
        console.warn(`${LOG} args 含文件名形态串但 session 无 [附件] 区块,保持原值`, {
          tool: input.tool,
          sessionID: input.sessionID,
        })
        return
      }

      // 只对 args 里真正引用到的(文件名/路径/basename,精确匹配)做按需上传(不预传"全部文件")。
      const referenced = new Set<string>()
      collectRefs(output.args, new Set(refToPath.keys()), referenced)
      if (referenced.size === 0) return

      // endpoint 检查必须在「确认真有要上传的引用」之后:此前它排在 hasFileRef 预筛之后的最前面,
      // 外网(未配置 OCTO_UPLOAD_ENDPOINT)任何参数里出现文档扩展名结尾字符串的工具调用——
      // read/bash 贴 .md 路径、write 落盘 .md 产物——都被误杀在这里,根本走不到下面两个
      // "无需上传就放行"的早退(2026-07-11 外网复现:贴 .md 路径,read/bash 连环失败「上传服务未配置」,
      // 也遮蔽了 external_directory 权限询问)。语义不变:真要上传而没配 endpoint,仍响亮失败。
      const endpoint = process.env.OCTO_UPLOAD_ENDPOINT
      if (!endpoint) {
        // 没配端点 → 无法按需上传。抛错让工具失败、错误回灌模型,而非把本地路径喂给 MCP(必 404)。
        console.error(`${LOG} OCTO_UPLOAD_ENDPOINT 未配置,无法按需上传`, { tool: input.tool })
        throw new Error("上传服务未配置 (OCTO_UPLOAD_ENDPOINT)，无法处理文件参数")
      }

      // 逐个按需上传(缓存按本地路径命中,文件名/路径指向同一文件只传一次),建「引用 → url」表。
      // 任一失败即上抛 → 工具调用失败、错误回灌模型。
      const refToUrl = new Map<string, string>()
      for (const ref of referenced) {
        const localPath = refToPath.get(ref)!
        const url = await uploadLocalFile(localPath, endpoint)
        refToUrl.set(ref, url)
      }

      const before = JSON.stringify(output.args)
      replaceRefs(output.args, refToUrl)
      const after = JSON.stringify(output.args)

      console.log(`${LOG} args rewritten`, {
        tool: input.tool,
        sessionID: input.sessionID,
        knownRefs: refToPath.size, // 已知引用键数(文件名 + 路径 + basename,约为文件数 ×3)
        uploaded: refToUrl.size, // 本次按需上传/命中缓存的引用数
        changed: before !== after,
        before,
        after,
      })
    },
  }
}
