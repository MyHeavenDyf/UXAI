import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// knowledge_search —— chat 内网知识库检索工具(RAG 的「检索」段)。
// 设计/契约见 octo-agent docs/specs/agents/chat-knowledge-search.md,心智模型见 docs/learning/rag-mental-model.md。
//
// 形态:原生 in-process 工具(仿 internel_image_generate),直连内网 getKnowledgeVector,
//       只网关给 chat 的 octo_ai(网关在 registry.ts 的 tools() 过滤里)。
// 职责:只做检索 + 整形,返回 top-k 片段文本;答案由 LLM 基于片段合成(接口 answer 字段为空)。

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "用户的自然语言问题,用于检索内网知识库" }),
})

const KB_PATH = "/main/rest.root/ucdAgent/ucdAgent/getKnowledgeVector"
// 未配置 OCTO_KB_BASE_URL 时(典型外网调试)默认走本地 mock(见 script/kb-mock-server.ts)。
// 真实构建里 OCTO_KB_BASE_URL 由 VITE_OCTO_BASE_URL 桥接注入,不会用到这个默认值。
const DEFAULT_MOCK_BASE = "http://localhost:8787"
const DEFAULT_TOP_K = 6
const MAX_CHUNK_CHARS = 800
const DEFAULT_TIMEOUT_MS = 30_000

function env(name: string) {
  return process.env[name]
}

// 一篇去重后的来源文档(图二底部"参考资料"的一条 = 一篇文档)。
type KbDoc = {
  id: string
  title: string // projectModuleName(文档级干净标题,真实数据确认),兜底取正文首个 markdown 标题 / id
  url?: string
  classification?: string
  score: number // 该文档最佳 chunk 的数字 _score
  content: string // 最佳 chunk 的 TOPIC_CONTENT(含内嵌 [文件名](链接),供模型作答 + 行内链接)
}

type KbSource = {
  n: number
  id: string
  title: string
  url?: string
  classification?: string
  score: number
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

// 从正文里抽第一个 markdown 标题做兜底标题(projectModuleName 缺失时)。
function deriveTitle(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (m) return m[1].trim()
  }
  return undefined
}

// 解析为「文档」列表:data[] → .data[](= 文档)。
// 关键:真实数据里同一文档会有多个 chunk、且 TOPIC_CONTENT 高度重复(你看到的"很多重复")——
// 故按文档(unique_id)聚合、每篇只取最佳 chunk、跨 block 同 id 取高分,避免噪音与重复。
// 文档级字段:projectModuleName(标题) / url / unique_id / ClassificationL*;chunk 级:TOPIC_CONTENT / _score。
function parseDocs(payload: unknown): KbDoc[] {
  const byId = new Map<string, KbDoc>()
  const root = payload as { data?: Array<{ data?: Array<Record<string, unknown>> }> }
  for (const block of root?.data ?? []) {
    for (const doc of block?.data ?? []) {
      const url = str(doc.url)
      const classification = ["ClassificationL1", "ClassificationL2", "ClassificationL3", "ClassificationL4", "ClassificationL5"]
        .map((k) => doc[k])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(" / ")
      const chunks = Array.isArray(doc.chunk_list) ? (doc.chunk_list as Array<Record<string, unknown>>) : []
      // 最佳 chunk
      let bestContent = ""
      let bestScore = -Infinity
      for (const ch of chunks) {
        const content = typeof ch.TOPIC_CONTENT === "string" ? ch.TOPIC_CONTENT.trim() : ""
        if (!content) continue
        const rawScore = ch._score
        const score = typeof rawScore === "number" ? rawScore : Number(rawScore) || 0
        if (score > bestScore) {
          bestScore = score
          bestContent = content
        }
      }
      if (!bestContent) continue
      const id = str(doc.unique_id) ?? url ?? `doc_${byId.size}`
      const title = str(doc.projectModuleName) ?? deriveTitle(bestContent) ?? id
      const prev = byId.get(id)
      if (!prev || bestScore > prev.score) {
        byId.set(id, { id, title, url, classification: classification || undefined, score: bestScore, content: bestContent })
      }
    }
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
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const base = env("OCTO_KB_BASE_URL") || DEFAULT_MOCK_BASE
          const topKEnv = Number(env("OCTO_KB_TOP_K"))
          const topK = Number.isFinite(topKEnv) && topKEnv > 0 ? topKEnv : DEFAULT_TOP_K
          // account 非必传:缺省发空串(服务端容忍,仅用于记录/限流)。
          const account = env("OCTO_KB_ACCOUNT") ?? ""
          const url = `${base.replace(/\/$/, "")}${KB_PATH}`

          const payload = yield* Effect.tryPromise({
            try: async () => {
              const controller = new AbortController()
              const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
              try {
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ account, context: params.query }),
                  signal: controller.signal,
                })
                const text = await res.text()
                if (!res.ok) throw new Error(`getKnowledgeVector status=${res.status} body=${text.slice(0, 500)}`)
                return JSON.parse(text) as unknown
              } finally {
                clearTimeout(timer)
              }
            },
            catch: (err) => new Error(`[octo:kb] 检索失败: ${err instanceof Error ? err.message : String(err)}`),
          }).pipe(Effect.orDie)

          const docs = parseDocs(payload)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)

          if (docs.length === 0) {
            return {
              title: `知识库检索: ${params.query}`,
              output: "未在内网知识库检索到相关内容。请如实告知用户未找到,不要编造。",
              metadata: { sources: [] as KbSource[] },
            }
          }

          const body = docs
            .map((d, i) => {
              const cls = d.classification ? `(${d.classification})` : ""
              const link = d.url ? ` — 链接:${d.url}` : ""
              const head = `[${i + 1}] ${d.title}${cls}${link}`
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
                classification: d.classification,
                score: d.score,
              })),
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
