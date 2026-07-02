import type { Plugin } from "@opencode-ai/plugin"
import { basename } from "node:path"
import { readFile } from "node:fs/promises"

/**
 * octo-upload-inject —— 在 MCP 工具执行前,把模型填的**文件名**按需上传 S3 后换成精确 URL。
 *
 * 背景 / 决策见 octo-agent 文档仓 SPEC-INS-015(文件传参机制 ④ MCP 按需上传)、ADR-015 / ADR-014。
 *
 * 机制(SPEC-INS-015 路由 ④):
 *   - insight 页选非图片文件时只把源文件拷进 <projectDir>/insight/sources(本地副本),**不上传 S3**。
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
 * 约束:必须「就地改写」output.args(prompt.ts 的 execute 用的是同一对象引用),不能整体重新赋值。
 */

const UPLOAD_BLOCK_HEADER = "[附件]"
const LOG = "[octo:inject]"

// 非图片可喂 MCP 的文件扩展名(图片走 vision、不入此路)。仅作**早退预筛**:args 里没有任何
// 以这些扩展名结尾的字符串,就别去拉 session 消息(非文件工具一律零开销放行)。
// 实际是否替换以「该字符串精确等于清单里某文件名」为准。
const DOC_EXT_RE = /\.(docx|xlsx|pdf|txt|md)$/i

type ManifestFile = { filename: string; path: string }

// 进程内缓存「本地路径 → 已上传 url」。路径全局唯一(sources 撞名加后缀),
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
  // 只发 file 一个字段(路径策略是服务端的事);显式带 basename 作 multipart 文件名。
  // Node/Bun 均有全局 Blob/FormData/fetch(Node 18+)。
  form.append("file", new Blob([ab]), basename(localPath))

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

export const OctoUploadInjectPlugin: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // 早退:args 里没有任何"以文档扩展名结尾"的串,就别去拉消息(非文件工具一律零开销放行)。
      if (!hasFileRef(output.args)) return

      const endpoint = process.env.OCTO_UPLOAD_ENDPOINT
      if (!endpoint) {
        // 没配端点 → 无法按需上传。抛错让工具失败、错误回灌模型,而非把本地路径喂给 MCP(必 404)。
        console.error(`${LOG} OCTO_UPLOAD_ENDPOINT 未配置,无法按需上传`, { tool: input.tool })
        throw new Error("上传服务未配置 (OCTO_UPLOAD_ENDPOINT)，无法处理文件参数")
      }

      // 聚合**整个 session** 所有 user 消息里的 [附件] 区块,建 文件名→本地路径总表。
      // 文件分多个 turn 添加也能在这张表里找到。
      const nameToPath = new Map<string, string>()
      try {
        const res = await client.session.messages({ path: { id: input.sessionID } })
        const msgs =
          (res as { data?: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }> })
            .data ?? []
        for (const m of msgs) {
          if (m.info?.role !== "user") continue
          for (const p of m.parts ?? []) {
            if (p.type !== "text" || typeof p.text !== "string" || !p.text.includes(UPLOAD_BLOCK_HEADER)) continue
            for (const f of parseManifest(p.text)) nameToPath.set(f.filename, f.path)
          }
        }
      } catch (err) {
        console.error(`${LOG} failed to read session messages`, { tool: input.tool, sessionID: input.sessionID, err })
        return // 读取失败不强改,交回模型原值
      }

      if (nameToPath.size === 0) {
        console.warn(`${LOG} args 含文件名形态串但 session 无 [附件] 区块,保持原值`, {
          tool: input.tool,
          sessionID: input.sessionID,
        })
        return
      }

      // 只对 args 里真正引用的文件名做按需上传(不预传"全部文件")。
      const referenced = new Set<string>()
      collectRefs(output.args, new Set(nameToPath.keys()), referenced)
      if (referenced.size === 0) return

      // 逐个按需上传(缓存命中则不重复传),建 文件名→url 表。任一失败即上抛 → 工具调用失败。
      const nameToUrl = new Map<string, string>()
      for (const filename of referenced) {
        const localPath = nameToPath.get(filename)!
        const url = await uploadLocalFile(localPath, endpoint)
        nameToUrl.set(filename, url)
      }

      const before = JSON.stringify(output.args)
      replaceRefs(output.args, nameToUrl)
      const after = JSON.stringify(output.args)

      console.log(`${LOG} args rewritten`, {
        tool: input.tool,
        sessionID: input.sessionID,
        knownFiles: nameToPath.size, // 整个 session 已知文件数
        uploaded: nameToUrl.size, // 本次按需上传/命中缓存的文件数
        changed: before !== after,
        before,
        after,
      })
    },
  }
}
