import type { Plugin } from "@opencode-ai/plugin"

/**
 * octo-upload-inject —— 把上传文件的「精确 S3 URL」在 MCP 工具执行前注入工具参数,
 * 彻底绕开「弱模型把 URL 转码字符微调坏」的问题。
 *
 * 背景 / 决策见 octo-agent 文档仓 ADR-014 与 specs/infra/file-upload.md。
 *
 * 机制(纯 handle→URL 解析器):
 *   - 上传 URL 由 insight 页以 `[已上传文件]` synthetic text part 注入 session(权威副本,模型从不改写)。
 *     行格式(与 packages/app/octoapp/pages/insight/lib/upload.ts 的 formatUploadsForPrompt 单一事实源):
 *       [已上传文件]
 *       - <文件名> [upload_<8位hex>]: <url>
 *     handle 从文件 URL 派生、**全局唯一且稳定**(同一文件永远同一 handle,跨 turn 不撞、刷新不变)。
 *   - 模型被 prompt 约束「文件参数只写 handle、绝不写 URL」。
 *   - 本插件在 `tool.execute.before` 钩子里(任何工具执行前)递归遍历 args,把出现的 handle
 *     就地替换成对应精确 URL。**只替换模型明确引用的 handle,不自作主张注入"全部文件"**
 *     —— 谁是哪类文件(任务书/逐字稿…)的角色归属完全由模型按文件名决定,插件不越权。
 *
 * 为什么是"纯解析器"(对比早期版本):
 *   - 不按工具名分支 → 不依赖 MCP 的 server 前缀(uxr-tool_*),也不依赖具体字段名(download_links)。
 *   - 不做"单桶工具全量覆盖" → 多轮上传 / 一个 session 多次分析等场景不会错注他轮文件。
 *   - 聚合**整个 session** 的所有 `[已上传文件]` 区块建表 → 文件分多个 turn 上传也能解析。
 *
 * 约束:必须「就地改写」output.args(prompt.ts 的 execute 用的是同一对象引用),不能整体重新赋值。
 */

const UPLOAD_BLOCK_HEADER = "[已上传文件]"

// handle 形态:upload_ + 文件 URL 派生的 token(当前 8 位 hex)。宽松匹配即可,
// 实际是否替换以 map.has(handle) 为准(只有真在 session 区块里出现过的才会被换)。
const HANDLE_RE = /^upload_\w+$/

type Upload = { handle: string; filename: string; url: string }

// 解析一段 `[已上传文件]` 区块 → [{handle, filename, url}]。
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
    const left = body.slice(0, sep).trim() // "<文件名> [upload_xxxx]"
    const url = body.slice(sep + 2).trim()
    const m = left.match(/^(.*?)\s*\[(upload_\w+)\]$/)
    if (!m || !url) continue
    out.push({ filename: m[1].trim(), handle: m[2], url })
  }
  return out
}

// 递归扫描:args 里有没有任何"长得像 handle"的字符串(决定是否值得去拉 session 消息)。
function hasHandle(node: unknown): boolean {
  if (typeof node === "string") return HANDLE_RE.test(node)
  if (Array.isArray(node)) return node.some(hasHandle)
  if (node && typeof node === "object") return Object.values(node as Record<string, unknown>).some(hasHandle)
  return false
}

// 递归就地替换:任意 string 值若是 handle 且映射存在,换成 URL。
function replaceHandles(node: unknown, map: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i]
      if (typeof v === "string" && map.has(v)) node[i] = map.get(v)!
      else replaceHandles(v, map)
    }
    return
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (typeof v === "string" && map.has(v)) obj[k] = map.get(v)!
      else replaceHandles(v, map)
    }
  }
}

export const OctoUploadInjectPlugin: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // 早退:args 里没有任何 handle 形态的串,就别去拉消息(非文件工具一律零开销放行)。
      if (!hasHandle(output.args)) return

      // 聚合**整个 session** 所有 user 消息里的 [已上传文件] 区块,建 handle→url 总表。
      // handle 全局唯一,所以分多个 turn 上传的文件都能在这张表里找到。
      const map = new Map<string, string>()
      try {
        const res = await client.session.messages({ path: { id: input.sessionID } })
        const msgs =
          (res as { data?: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }> })
            .data ?? []
        for (const m of msgs) {
          if (m.info?.role !== "user") continue
          for (const p of m.parts ?? []) {
            if (p.type !== "text" || typeof p.text !== "string" || !p.text.includes(UPLOAD_BLOCK_HEADER)) continue
            for (const u of parseUploadBlock(p.text)) map.set(u.handle, u.url)
          }
        }
      } catch (err) {
        console.error("[octo:inject] failed to read session messages", { tool: input.tool, sessionID: input.sessionID, err })
        return // 读取失败不强改,交回模型原值
      }

      if (map.size === 0) {
        console.warn("[octo:inject] args 含 handle 但 session 无上传区块,保持原值", {
          tool: input.tool,
          sessionID: input.sessionID,
        })
        return
      }

      const before = JSON.stringify(output.args)
      replaceHandles(output.args, map)
      const after = JSON.stringify(output.args)

      console.log("[octo:inject] args rewritten", {
        tool: input.tool,
        sessionID: input.sessionID,
        knownHandles: map.size, // 整个 session 已知文件数
        changed: before !== after,
        before,
        after,
      })
    },
  }
}
