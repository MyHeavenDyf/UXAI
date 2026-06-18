// 内网知识库(getKnowledgeVector)本地 mock server —— 外网调试用。
//
// 用法:
//   bun run packages/opencode/script/kb-mock-server.ts            # 默认 :8787
//   PORT=9000 bun run packages/opencode/script/kb-mock-server.ts
// 然后让 knowledge_search 工具指向它:
//   OCTO_KB_BASE_URL=http://localhost:8787   (desktop 内会从 VITE_OCTO_BASE_URL 桥接;
//                                              直接跑 opencode server 时手动设此环境变量)
//
// fixture 结构对齐真实返回(data[].data[].chunk_list[],含 TOPIC_CONTENT / 数字 _score),
// 让 chat → 工具 → LLM 合成答案整条链在外网可验证。契约见
// octo-agent docs/specs/agents/chat-knowledge-search.md。

const PORT = Number(process.env.PORT) || 8787
const KB_PATH = "/main/rest.root/ucdAgent/ucdAgent/getKnowledgeVector"

// 一篇文档(对齐真实结构:文档级 projectModuleName/url/unique_id,chunk 级 TOPIC_CONTENT/_score;
// 正文内嵌 [文件名](链接) —— 用于验证「按文档去重 + 行内文件链接」)。
function doc(input: {
  uniqueId: string
  title: string
  url: string
  markdown: string
  chunks: Array<{ content: string; score: number }>
}) {
  return {
    ClassificationL1: "用户研究",
    ClassificationL2: "方法与工具",
    ClassificationL3: "",
    ClassificationL4: "",
    ClassificationL5: "",
    _score: String(Math.max(...input.chunks.map((c) => c.score))),
    author: "李白 l00123456",
    markdown_content: input.markdown,
    projectModuleName: input.title,
    unique_id: input.uniqueId,
    url: input.url,
    highlight: { markdown_content: [input.title], projectModuleName: [input.title] },
    chunk_list: input.chunks.map((c, i) => ({
      DOC_ID: input.uniqueId,
      TOPIC_CONTENT: c.content,
      TOPIC_TITLE: c.content, // 真实数据里 TOPIC_TITLE ≈ 正文(不可当标题)
      _id: `${input.uniqueId}_${i}`,
      _score: c.score,
      TOPIC_FEATURE: {
        CHAPTER_ID: "",
        CONTENT_ID: `${input.uniqueId}_content_${i}`,
        EXTRACT_VERSION: "v1",
        IMAGE_URL: "",
        IMAGE_URL_LIST: [],
        PAGE_START_END: [0, 1],
        TIME_STAMP: new Date().toISOString(),
        TOPIC_CONTENT_END: c.content.length,
        TOPIC_CONTENT_START: 0,
        VERSION: "v1",
      },
    })),
  }
}

function buildResponse(query: string) {
  return {
    contextual_rewrite_query: [],
    data: [
      {
        answer: "",
        corr_info: { search_text: query },
        cost_time: 0.25,
        data: [
          // 文档 A:酬金申请流程(正文含内嵌 [模板.docx](链接))。两个 chunk 模拟「同文档重复」。
          doc({
            uniqueId: "ucdResearch_xlsx_8",
            title: "普通用户申请酬金",
            url: "https://octo.hdesign.huawei.com/p/103904",
            markdown: "# 普通用户酬金申请流程详解\n\n(整篇 markdown,mock 略)",
            chunks: [
              {
                content:
                  "# 普通用户酬金申请流程详解。## 1. 用户分类:按渗透率分为高渗透率(主流用户)与低渗透率(特殊/高级用户),低渗透率招募更严格。## 2. 申请步骤:Step 1 邮件申请礼金,需包含调研名称、用户类型与渗透率评估、用户人数、单笔金额及总金额、调研方式,模板参考:**用户酬金申请&发放.docx**:[链接](https://octo.hdesign.huawei.com/main/p.html?D=103904);Step 2 按审批通过的方案执行,变更调研方式/时长/金额需重新审批。审批由业务归属的四级部门主管负责,无四级主管则由三级主管审批。",
                score: 11.79,
              },
              {
                content: "# 普通用户酬金申请流程详解。(同文档另一 chunk,内容重复,应被按文档去重折叠)",
                score: 9.2,
              },
            ],
          }),
          // 文档 B:用研工具文档(catalog,正文是一串 [文件名](链接))。
          doc({
            uniqueId: "octo_research_121159101101",
            title: "用户研究工具文档",
            url: "https://octo.hdesign.huawei.com/main/p.html?D=137755",
            markdown: "# 用户研究工具文档\n\n(整篇 markdown,mock 略)",
            chunks: [
              {
                content:
                  "# 用户研究工具文档:集合用户研究方法的工具和模板。常用模板:**用户访谈现场记录表.xlsx**:用于访谈过程中的实时记录,[链接](https://octo.hdesign.huawei.com/main/p.html?D=96342);**访谈后内容整理表.xlsx**:[链接](https://octo.hdesign.huawei.com/main/p.html?D=96340&isBackend=1);**用户访谈知情同意书.docx**:需求分析/洞察类通用,[链接](https://octo.hdesign.huawei.com/main/p.html?D=96335&isBackend=1)。",
                score: 13.51,
              },
            ],
          }),
        ],
      },
    ],
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === "POST" && url.pathname === KB_PATH) {
      let body: any = {}
      try {
        body = await req.json()
      } catch {}
      const query = typeof body?.context === "string" ? body.context : ""
      console.log(`[kb-mock] query=${JSON.stringify(query)} account=${JSON.stringify(body?.account ?? "")}`)
      return Response.json(buildResponse(query))
    }
    return new Response("not found", { status: 404 })
  },
})

console.log(`[kb-mock] listening on http://localhost:${PORT}${KB_PATH}`)
console.log(`[kb-mock] set OCTO_KB_BASE_URL=http://localhost:${PORT}`)
