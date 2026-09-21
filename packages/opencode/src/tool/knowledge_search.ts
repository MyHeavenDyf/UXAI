import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// knowledge_search —— 内网知识库检索工具(RAG 的「检索」段)。
// 合并/归属/接口契约见 octo-agent docs/specs/agents/insight-knowledge-search.md(SPEC-INS-030),
// 心智模型见 docs/learning/rag-mental-model.md。
//
// 形态:原生 in-process 工具(仿 internel_image_generate),直连内网 queryKnowledge,
//       只网关给 insight 的 octo_insight(网关在 registry.ts 的 tools() 过滤里)。
// 职责:只做检索 + 整形,返回相关片段文本;答案由 LLM 基于片段合成(接口不含 answer 字段)。
//
// 检索方案(Q3 定案 2026-08-22,spec §7):**只查「全量库」**——IT 已把一期 15 个模块库并成
//   单一合并索引、在其上统一 rerank。故**不传 knowledgeName**(后端不传即走全量库),我方不做
//   多库路由、不做客户端合并重排。响应**返回顺序即相关性降序**、无 _score,parse 按序直接用。

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "用户的自然语言问题,用于检索内网知识库" }),
})

// 接口路径固定(beta/prod 仅 host 不同、路径相同);host 走 OCTO_KB_BASE_URL。
// 新接口 queryKnowledge(spec §4.2):不传 knowledgeName = 全量库;body {question, account};扁平数组响应。
const KB_PATH = "/main/rest.root/ucdAgent/thirdParty/queryKnowledge"
// 未配置 OCTO_KB_BASE_URL 时(典型外网调试)默认走本地 mock(见 script/kb-mock-server.ts)。
// 真实构建里 OCTO_KB_BASE_URL 由 VITE_OCTO_BASE_URL 桥接注入,不会用到这个默认值。
const DEFAULT_MOCK_BASE = "http://localhost:8787"
// 以下是与环境无关的固定参数(不放 env):
const MAX_CHUNK_CHARS = 800
const DEFAULT_TIMEOUT_MS = 30_000
// 条数:后端固定返回、已按文档去重(当前 5,spec §4.2),我方不截断、不排序,按返回序全部用。

function env(name: string) {
  return process.env[name]
}

// 一篇去重后的来源文档(底部「参考资料」的一条 = 一篇文档)。
type KbDoc = {
  id: string
  title: string // chunkTitle(干净标题);兜底取正文首个 markdown 标题 / id
  url?: string
  content: string // chunkContent(供模型作答 + 行内链接)
}

type KbSource = {
  n: number
  id: string
  title: string
  url?: string
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

// 调用者工号(SPEC-INS-030 §5)。内网接口**按 account 限流**,不传会让后端兜底成单一开发者工号 ——
// 全体用户挤同一个限流桶,一个人用满全员被限。故工号是必需项:
//   来源 renderer 的 `localStorage.userInfo.account`(纯工号,不拼姓名),经 promptAsync 的 `extra` 透传,
//   服务端 session/prompt.ts 按 sessionID 存进 sessionExtras、再原样铺进本工具的 `ctx.extra`。
// 拿不到就**显式拒答**(见 execute),不发空 account 让后端静默兜底。
function readAccount(ctx: Tool.Context): string | undefined {
  const raw = ctx.extra?.["account"]
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

// 从正文里抽第一个 markdown 标题做兜底标题(chunkTitle 缺失时)。
function deriveTitle(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (m) return m[1].trim()
  }
  return undefined
}

// 解析新接口响应:**扁平 chunk 数组** `[{ documentId, chunkTitle, chunkContent, documentUrl }]`。
// 后端已按文档(documentId)去重、并按相关性降序返回;此处按 documentId 兜底去重(保留首次出现=
// 相关性更高的那条),**保持返回序**(Map 按插入序),不再自己排序/截断(排序已由服务端 rerank 承担)。
export function parseDocs(payload: unknown): KbDoc[] {
  const byId = new Map<string, KbDoc>()
  const arr = Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : []
  for (const item of arr) {
    const content = typeof item.chunkContent === "string" ? item.chunkContent.trim() : ""
    if (!content) continue
    const url = str(item.documentUrl)
    const id = str(item.documentId) ?? url ?? `doc_${byId.size}`
    if (byId.has(id)) continue // 兜底去重:保留首次(相关性更高)出现
    const title = str(item.chunkTitle) ?? deriveTitle(content) ?? id
    byId.set(id, { id, title, url, content })
  }
  return [...byId.values()]
}

const DESCRIPTION =
  "检索公司内网知识库(内网网站 / 产品 / 流程 / 规范 / 制度 / 用户研究等文档)。" +
  "当用户的问题可能在内网文档里有答案时调用,传入用户问题作为 query,返回最相关的若干文档片段。" +
  "收到片段后请【只依据这些片段】回答用户、不要编造;片段为空则如实告知未找到。" +
  "一般闲聊、编程或与内网内容无关的问题不要调用。"

export const KnowledgeSearchTool = Tool.define(
  "knowledge_search",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const base = env("OCTO_KB_BASE_URL") || DEFAULT_MOCK_BASE
          const account = readAccount(ctx)
          const url = `${base.replace(/\/$/, "")}${KB_PATH}`

          // 无工号 → 不打接口、直接如实回复(§5:要么显式失败要么明确降级,不靠后端静默兜底)。
          if (!account) {
            console.error("[octo:kb] account missing", { sessionID: ctx.sessionID, query: params.query })
            return {
              title: `知识库检索: ${params.query}`,
              output:
                "未能获取当前登录账号,本次内网知识库检索已取消。请如实告知用户:需要重新登录后再试,不要编造检索结果。",
              metadata: { sources: [] as KbSource[] },
            }
          }
          // 诊断:打印 base / 完整 URL(排查内网 host / env 问题)。
          console.log("[octo:kb] config", {
            envBaseUrl: env("OCTO_KB_BASE_URL"),
            usingMockDefault: !env("OCTO_KB_BASE_URL"),
            resolvedBase: base,
            url,
            account,
            query: params.query,
          })

          const payload = yield* Effect.tryPromise({
            try: async () => {
              const controller = new AbortController()
              const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
              try {
                // 不传 knowledgeName = 走全量库(Q3 定案,spec §4.2 / §7)。
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ account, question: params.query }),
                  signal: controller.signal,
                })
                const text = await res.text()
                console.log("[octo:kb] response", { url, status: res.status, ok: res.ok, bodyHead: text.slice(0, 300) })
                if (!res.ok) throw new Error(`queryKnowledge status=${res.status} url=${url} body=${text.slice(0, 500)}`)
                return JSON.parse(text) as unknown
              } finally {
                clearTimeout(timer)
              }
            },
            catch: (err) => {
              const msg = `[octo:kb] 检索失败 url=${url}: ${err instanceof Error ? err.message : String(err)}`
              console.error(msg)
              return new Error(msg)
            },
          }).pipe(Effect.orDie)

          // 按返回序(相关性降序),服务端已去重 + rerank,不再客户端排序/截断。
          const docs = parseDocs(payload)
          console.log("[octo:kb] parsed", { totalDocs: docs.length, titles: docs.map((d) => d.title) })

          if (docs.length === 0) {
            return {
              title: `知识库检索: ${params.query}`,
              output: "未在内网知识库检索到相关内容。请如实告知用户未找到,不要编造。",
              metadata: { sources: [] as KbSource[] },
            }
          }

          const body = docs
            .map((d, i) => {
              const link = d.url ? ` — 链接:${d.url}` : ""
              const head = `[${i + 1}] ${d.title}${link}`
              const content = d.content.length > MAX_CHUNK_CHARS ? d.content.slice(0, MAX_CHUNK_CHARS) + "…" : d.content
              return `${head}\n${content}`
            })
            .join("\n\n")

          const output =
            "以下是内网知识库检索到的相关文档(每篇前为「编号 标题 — 链接」)。请【只依据它们】用自然语言回答用户:\n" +
            "- 引用某篇来源时,在所引用那句话的句末就近写 `[[n]](该来源链接)`(例如 `…用户酬金申请&发放.docx[[1]](https://...)`),让编号可点击;保持正文原有分段/分点/换行,只把编号贴到对应句末,不要为放编号改变排版;\n" +
            "- 正文里若出现 `[文件名](链接)` 形式的来源文档链接,可原样保留以便用户打开原文;\n" +
            "- 不要大段照抄无关原文,也不要编造片段之外的内容。\n\n" +
            body

          return {
            title: `知识库检索: ${params.query}`,
            // sources 供后续「行内上标 + 底部参考列表」UI 使用([n] → 文档)。
            metadata: {
              sources: docs.map((d, i): KbSource => ({
                n: i + 1,
                id: d.id,
                title: d.title,
                url: d.url,
              })),
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
