import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// insight_report_search —— 内网「研究报告库」检索工具。
// 契约 / 决策 / 验证见 octo-agent docs/specs/agents/insight-report-search.md(SPEC-INS-034)。
//
// 与 knowledge_search(SPEC-INS-030)的关系:**同一套实现形态,不同的库、不同的工具**。
//   knowledge_search 查内网 wiki 全量库(流程/规范/制度/研究方法),本工具查**独立的研究报告库**
//   (既往用户研究报告的 MD 灌进去建的库,与全量库数据不重叠)。knowledge_search 一字不改。
//   刻意不把两者抽成"带库名参数的通用检索工具"(spec §2):差异点正在增长(downloadUrl、后续的
//   下载交互与权限过滤),且"带库名参数"等于把选库交还给模型,与 SPEC-INS-030 §7 定案相反。
//
// 形态:原生 in-process 工具,直连内网 queryReportKnowledge,只网关给 insight 的 octo_insight
//      (网关在 registry.ts 的 tools() 过滤里;chip turn 另在 mcp-trigger 的 buildToolGate 关闭)。
// 职责:只做检索 + 整形,返回相关片段文本;答案由 LLM 基于片段合成(接口不含 answer 字段)。

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "用户的自然语言问题,用于检索内网研究报告库" }),
})

// 接口路径固定(beta/prod 仅 host 不同、路径相同);host 与 knowledge_search **同一个** OCTO_KB_BASE_URL
// (2026-09-24 后端确认,不新加环境变量),仅接口名不同:queryKnowledge → queryReportKnowledge。
const REPORT_PATH = "/main/rest.root/ucdAgent/thirdParty/queryReportKnowledge"
// 未配置 OCTO_KB_BASE_URL 时(典型外网调试)默认走本地 mock(见 script/kb-mock-server.ts)。
const DEFAULT_MOCK_BASE = "http://localhost:8787"
// 与环境无关的固定参数(不放 env):
const MAX_CHUNK_CHARS = 800
const DEFAULT_TIMEOUT_MS = 30_000
// 库名:**协议上没有这个字段**——接口自身绑定研究报告库(spec §3.2),故既没有常量可传、
// 也无从做成工具入参。真要支持多个报告库,做法是再加一个工具,不是加一个参数。
// 条数:后端固定返回,我方不传 topK、不截断、不排序(排序由服务端 rerank 承担)。

function env(name: string) {
  return process.env[name]
}

// 一篇去重后的来源报告(底部「引用 N 篇资料」的一条 = 一篇报告)。
type ReportDoc = {
  id: string
  title: string // chunkTitle(干净标题);兜底取正文首个 markdown 标题 / id
  url?: string
  content: string // chunkContent(供模型作答 + 行内链接)
  downloadUrl?: string // 原文档下载地址;当前真实数据恒为 null,本期只解析存储、不展示(spec §4)
}

type ReportSource = {
  n: number
  id: string
  title: string
  url?: string
  downloadUrl?: string
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

// 调用者工号,与 knowledge_search 完全一致(SPEC-INS-030 §5 已建成的通道,此处零新增基建):
//   renderer `localStorage.userInfo.account` → promptAsync 的 `extra` → sessionExtras → ctx.extra。
// 内网接口按 account 限流,不传会让后端兜底成单一开发者工号(全体挤一个限流桶),故拿不到就
// **显式拒答**(见 execute),不发空 account。本期不需要 userId(报告库一期不做按用户过滤)。
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

// 解析响应:**扁平 chunk 数组** `[{ documentId, chunkTitle, chunkContent, documentUrl, downloadUrl }]`。
// 与 knowledge_search 的 parseDocs 同构,只多一个 downloadUrl。
// 按 documentId 兜底去重(保留首次出现 = 相关性更高的那条),**保持返回序**(Map 按插入序),
// 不排序、不截断。
//
// downloadUrl 归一(spec §4 / §3.4 A1):后端目前没约定无值时是 `null` 还是整个键缺失,
// 两种都当"没有",一律记为 **undefined**;**不要归一成空串**——空串会让下游 `if (url)` 和
// `url != null` 两种判断给出不同答案。
export function parseDocs(payload: unknown): ReportDoc[] {
  const byId = new Map<string, ReportDoc>()
  const arr = Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : []
  for (const item of arr) {
    const content = typeof item.chunkContent === "string" ? item.chunkContent.trim() : ""
    if (!content) continue
    const url = str(item.documentUrl)
    const id = str(item.documentId) ?? url ?? `doc_${byId.size}`
    if (byId.has(id)) continue // 兜底去重:保留首次(相关性更高)出现
    const title = str(item.chunkTitle) ?? deriveTitle(content) ?? id
    byId.set(id, { id, title, url, content, downloadUrl: str(item.downloadUrl) })
  }
  return [...byId.values()]
}

// 三个问答入口的边界要在 description 里写死(spec §8):正面说覆盖什么、**反面说不覆盖什么**——
// 只写"覆盖什么"时,弱模型会把三个入口都当成"可能有答案的地方"挨个试。
// 提示词侧(agent/prompt/octo_insight.md)有对齐的一段,两处措辞保持一致。
const DESCRIPTION =
  "检索公司内网的【用户研究报告库】——既往已完成的用户研究交付物(研究报告、结论、发现、洞察)。" +
  "当用户问「以前做过哪些关于 X 的研究」「某项研究的结论 / 发现是什么」这类既往研究成果的问题时调用," +
  "传入用户问题作为 query,返回最相关的若干报告片段。" +
  "【不要用于】用户本次上传或放进工作区的访谈材料 / 逐字稿(那些用 extract_document、read、grep 去读," +
  "本工具检索不到用户的文件);也【不要用于】内网 wiki 的流程 / 规范 / 制度 / 研究方法类文档(那些用 knowledge_search)。" +
  "收到片段后请【只依据这些片段】回答用户、不要编造;片段为空则如实告知未找到。" +
  "一般闲聊、编程或与既往研究报告无关的问题不要调用。"

export const InsightReportSearchTool = Tool.define(
  "insight_report_search",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const base = env("OCTO_KB_BASE_URL") || DEFAULT_MOCK_BASE
          const account = readAccount(ctx)
          const url = `${base.replace(/\/$/, "")}${REPORT_PATH}`

          // 无工号 → 不打接口、直接如实回复(要么显式失败要么明确降级,不靠后端静默兜底)。
          if (!account) {
            console.error("[octo:report] account missing", { sessionID: ctx.sessionID, query: params.query })
            return {
              title: `研究报告检索: ${params.query}`,
              output:
                "未能获取当前登录账号,本次研究报告库检索已取消。请如实告知用户:需要重新登录后再试,不要编造检索结果。",
              metadata: { sources: [] as ReportSource[] },
            }
          }
          // 诊断:打印 base / 完整 URL(排查内网 host / env 问题)。
          console.log("[octo:report] config", {
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
                // body 只发两个字段:接口自身绑定报告库,没有库名参数(spec §3.1 / §3.2)。
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ account, question: params.query }),
                  signal: controller.signal,
                })
                const text = await res.text()
                console.log("[octo:report] response", {
                  url,
                  status: res.status,
                  ok: res.ok,
                  bodyHead: text.slice(0, 300),
                })
                if (!res.ok)
                  throw new Error(`queryReportKnowledge status=${res.status} url=${url} body=${text.slice(0, 500)}`)
                return JSON.parse(text) as unknown
              } finally {
                clearTimeout(timer)
              }
            },
            catch: (err) => {
              const msg = `[octo:report] 检索失败 url=${url}: ${err instanceof Error ? err.message : String(err)}`
              console.error(msg)
              return new Error(msg)
            },
          }).pipe(Effect.orDie)

          // 按返回序(相关性降序),服务端已去重 + rerank,不再客户端排序/截断。
          const docs = parseDocs(payload)
          // downloadUrls 与 titles 同序:本期界面上看不见 downloadUrl,它是唯一的可观测点(spec §4)。
          console.log("[octo:report] parsed", {
            totalDocs: docs.length,
            titles: docs.map((d) => d.title),
            downloadUrls: docs.map((d) => d.downloadUrl),
          })

          if (docs.length === 0) {
            return {
              title: `研究报告检索: ${params.query}`,
              output: "未在内网研究报告库检索到相关内容。请如实告知用户未找到,不要编造。",
              metadata: { sources: [] as ReportSource[] },
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

          // 注意:**不把 downloadUrl 写进 output**——本期不做下载交互,给模型看只会让它去承诺
          // 一个还不存在的能力(spec §4)。它只随 metadata.sources 存下来。
          const output =
            "以下是内网研究报告库检索到的相关报告片段(每篇前为「编号 标题 — 链接」)。请【只依据它们】用自然语言回答用户:\n" +
            "- 引用某篇来源时,在所引用那句话的句末就近写 `[[n]](该来源链接)`(例如 `…搜索功能可用性测试报告[[1]](https://...)`),让编号可点击;保持正文原有分段/分点/换行,只把编号贴到对应句末,不要为放编号改变排版;\n" +
            "- 正文里若出现 `[文件名](链接)` 形式的来源文档链接,可原样保留以便用户打开原文;\n" +
            "- 不要大段照抄无关原文,也不要编造片段之外的内容。\n\n" +
            body

          return {
            title: `研究报告检索: ${params.query}`,
            // sources 供「行内上标 + 底部引用列表」UI 使用([n] → 报告);
            // downloadUrl 本期只存不展示(UI 侧 knowledge-references 不读它)。
            metadata: {
              sources: docs.map((d, i): ReportSource => ({
                n: i + 1,
                id: d.id,
                title: d.title,
                url: d.url,
                downloadUrl: d.downloadUrl,
              })),
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
