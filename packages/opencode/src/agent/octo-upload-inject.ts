import type { Plugin } from "@opencode-ai/plugin"

/**
 * octo-upload-inject —— 把上传文件的「精确 S3 URL」在 MCP 工具执行前注入工具参数,
 * 彻底绕开「弱模型把 URL 转码字符微调坏」的问题。
 *
 * 背景 / 决策见 octo-agent 文档仓 ADR(URL 注入策略)与 specs/infra/file-upload.md。
 *
 * 机制:
 *   - 上传 URL 由 insight 页以 `[已上传文件]` synthetic text part 注入 session(权威副本,模型从不改写)。
 *     行格式(与 packages/app/octoapp/pages/insight/lib/upload.ts 的 formatUploadsForPrompt 单一事实源):
 *       [已上传文件]
 *       - <文件名> [upload_1]: <url>
 *       - <文件名> [upload_2]: <url>
 *   - 模型被 prompt 约束「只写 handle(upload_N)、绝不写 URL」。
 *   - 本插件在 `tool.execute.before` 钩子里(MCP 工具真正执行前)做两件事:
 *       1) 递归遍历 args,把任意 `upload_N` 字符串替换成对应精确 URL —— 与字段名无关。
 *       2) 单桶工具额外把全量 URL 覆盖进规范字段(完整性保险,防漏列)。
 *
 * 约束:必须「就地改写」output.args(prompt.ts 的 execute 用的是同一对象引用),不能整体重新赋值。
 */

const UPLOAD_BLOCK_HEADER = "[已上传文件]"

// 单桶工具:全部上传文件都进同一个列表字段(都是访谈稿)。
// 字段名 download_links 来自 UXR MCP 开发者确认的入参(见 mcp-contract.md §工具入参)。
const SINGLE_BUCKET_URL_FIELD: Record<string, string> = {
  key_findings: "download_links",
  mindmap: "download_links",
}

// 多角色工具:download_links(访谈稿列表)+ outline_file_path(单个大纲/任务书文件)。
// 角色归属由模型决定(模型按文件名把 handle 填进对应参数),插件只把 handle 换成 URL、不碰角色映射。
const MULTI_ROLE_TOOLS = new Set(["run_guide_analysis", "run_usability_analysis"])

const HANDLE_RE = /^upload_\d+$/

// MCP 工具在 opencode 里的 tool id 带 server 前缀(实测内网 = `uxr-tool_key_findings`),
// 不是裸 `key_findings`。用「后缀 + 分隔符」匹配还原 bare 名:既命中带前缀的 MCP 名,
// 又不会让 `mindmap` 误中 `xmindmap`(要求 bare 名前一个字符是分隔符或就是开头)。
function matchBareTool(toolId: string, bareNames: Iterable<string>): string | undefined {
  for (const name of bareNames) {
    if (toolId === name) return name
    if (toolId.endsWith(name)) {
      const prefixChar = toolId[toolId.length - name.length - 1]
      if (prefixChar && /[_.\-/:]/.test(prefixChar)) return name
    }
  }
  return undefined
}

type Upload = { handle: string; filename: string; url: string }

// 解析 `[已上传文件]` 区块 → [{handle, filename, url}]。
// 与 insight upload.ts 的 parseUploadedFiles 同一格式契约(两处独立实现,改格式需同步)。
function parseUploadBlock(text: string): Upload[] {
  const out: Upload[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ")) continue
    const body = trimmed.slice(2)
    // 按第一个 ": " 切分(文件名 / URL 都可能含空格,不能用 \S+)
    const sep = body.indexOf(": ")
    if (sep < 0) continue
    const left = body.slice(0, sep).trim() // "<文件名> [upload_N]"
    const url = body.slice(sep + 2).trim()
    const m = left.match(/^(.*?)\s*\[(upload_\d+)\]$/)
    if (!m || !url) continue
    out.push({ filename: m[1].trim(), handle: m[2], url })
  }
  return out
}

// 递归就地替换:任意 string 值若是 handle 且映射存在,换成 URL。
function replaceHandles(node: unknown, map: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i]
      if (typeof v === "string" && HANDLE_RE.test(v) && map.has(v)) node[i] = map.get(v)!
      else replaceHandles(v, map)
    }
    return
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (typeof v === "string" && HANDLE_RE.test(v) && map.has(v)) obj[k] = map.get(v)!
      else replaceHandles(v, map)
    }
  }
}

export const OctoUploadInjectPlugin: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      // 按 bare 名匹配(兼容 MCP server 前缀,如 uxr-tool_key_findings)
      const singleBare = matchBareTool(tool, Object.keys(SINGLE_BUCKET_URL_FIELD))
      const multiBare = matchBareTool(tool, MULTI_ROLE_TOOLS)
      if (!singleBare && !multiBare) return // 非 insight 文件工具,放行
      const urlField = singleBare ? SINGLE_BUCKET_URL_FIELD[singleBare] : undefined

      // 拉取 session 消息,从最近一条带 [已上传文件] 区块的 user 消息解析权威 URL。
      let uploads: Upload[] = []
      try {
        const res = await client.session.messages({ path: { id: input.sessionID } })
        const msgs = (res as { data?: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }> }).data ?? []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.info?.role !== "user") continue
          const part = (m.parts ?? []).find(
            (p) => p.type === "text" && typeof p.text === "string" && p.text.includes(UPLOAD_BLOCK_HEADER),
          )
          if (part?.text) {
            uploads = parseUploadBlock(part.text)
            break
          }
        }
      } catch (err) {
        console.error("[octo:inject] failed to read session messages", { tool, sessionID: input.sessionID, err })
        return // 读取失败不强改,交回模型原值(交由现有校验/重试兜底)
      }

      if (uploads.length === 0) {
        console.warn("[octo:inject] no uploads found in session, leaving args untouched", {
          tool,
          sessionID: input.sessionID,
        })
        return
      }

      const before = JSON.stringify(output.args)
      const map = new Map(uploads.map((u) => [u.handle, u.url]))

      // 1) 与字段名无关:把模型填的所有 handle 换成精确 URL(多角色工具的角色映射靠这条)
      replaceHandles(output.args, map)

      // 2) 单桶工具完整性保险:规范字段全量覆盖(防弱模型漏列某个 handle)
      if (urlField && output.args && typeof output.args === "object") {
        ;(output.args as Record<string, unknown>)[urlField] = uploads.map((u) => u.url)
      }

      console.log("[octo:inject] args rewritten", {
        tool,
        bareTool: singleBare ?? multiBare,
        sessionID: input.sessionID,
        mode: urlField ? "inject+handle" : "handle",
        urlField: urlField ?? null,
        uploads: uploads.length,
        before,
        after: JSON.stringify(output.args),
      })
    },
  }
}
