// 内网知识库(queryKnowledge)本地 mock server —— 外网调试用。
//
// 用法:
//   bun run packages/opencode/script/kb-mock-server.ts            # 默认 :8787
//   PORT=9000 bun run packages/opencode/script/kb-mock-server.ts
// 然后让 knowledge_search 工具指向它:
//   OCTO_KB_BASE_URL=http://localhost:8787   (desktop 内会从 VITE_OCTO_BASE_URL 桥接;
//                                              直接跑 opencode server 时手动设此环境变量)
//
// fixture 结构对齐**新接口**返回(扁平 chunk 数组,含 documentId/chunkTitle/chunkContent/documentUrl,
// 已按文档去重、按相关性降序),让 insight → 工具 → LLM 合成答案整条链在外网可验证。
// 契约见 octo-agent docs/specs/agents/insight-knowledge-search.md §4.2。
// 检索方案(Q3 定案):不传 knowledgeName = 全量库,故本 mock 不按库名分流,统一返回全量结果。

const PORT = Number(process.env.PORT) || 8787
const KB_PATH = "/main/rest.root/ucdAgent/thirdParty/queryKnowledge"

// 一条 chunk(对齐新接口:documentId 去重键 / chunkTitle 干净标题 / chunkContent 正文 / documentUrl 链接;
// 正文内嵌 [文件名](链接) —— 用于验证「行内文件链接原样保留」)。
function chunk(input: { documentId: string; chunkTitle: string; chunkContent: string; documentUrl: string }) {
  return {
    documentId: input.documentId,
    chunkTitle: input.chunkTitle,
    chunkContent: input.chunkContent,
    documentUrl: input.documentUrl,
  }
}

// 后端已去重 + rerank,返回顺序即相关性降序;这里按分数从高到低手排(B 更相关排前)。
function buildResponse(_query: string) {
  return [
    // 文档 B:用研工具文档(catalog,正文是一串 [文件名](链接))。
    chunk({
      documentId: "octo_research_121159101101",
      chunkTitle: "用户研究工具文档",
      chunkContent:
        "# 用户研究工具文档:集合用户研究方法的工具和模板。常用模板:**用户访谈现场记录表.xlsx**:用于访谈过程中的实时记录,[链接](https://octo.hdesign.huawei.com/main/p.html?D=96342);**访谈后内容整理表.xlsx**:[链接](https://octo.hdesign.huawei.com/main/p.html?D=96340&isBackend=1);**用户访谈知情同意书.docx**:需求分析/洞察类通用,[链接](https://octo.hdesign.huawei.com/main/p.html?D=96335&isBackend=1)。",
      documentUrl: "https://octo.hdesign.huawei.com/main/p.html?D=137755",
    }),
    // 文档 A:酬金申请流程(正文含内嵌 [模板.docx](链接))。
    chunk({
      documentId: "ucdResearch_xlsx_8",
      chunkTitle: "普通用户申请酬金",
      chunkContent:
        "# 普通用户酬金申请流程详解。## 1. 用户分类:按渗透率分为高渗透率(主流用户)与低渗透率(特殊/高级用户),低渗透率招募更严格。## 2. 申请步骤:Step 1 邮件申请礼金,需包含调研名称、用户类型与渗透率评估、用户人数、单笔金额及总金额、调研方式,模板参考:**用户酬金申请&发放.docx**:[链接](https://octo.hdesign.huawei.com/main/p.html?D=103904);Step 2 按审批通过的方案执行,变更调研方式/时长/金额需重新审批。审批由业务归属的四级部门主管负责,无四级主管则由三级主管审批。",
      documentUrl: "https://octo.hdesign.huawei.com/p/103904",
    }),
  ]
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
      const query = typeof body?.question === "string" ? body.question : ""
      console.log(
        `[kb-mock] question=${JSON.stringify(query)} account=${JSON.stringify(body?.account ?? "")}` +
          ` knowledgeName=${JSON.stringify(body?.knowledgeName ?? "(全量库)")}`,
      )
      return Response.json(buildResponse(query))
    }
    return new Response("not found", { status: 404 })
  },
})

console.log(`[kb-mock] listening on http://localhost:${PORT}${KB_PATH}`)
console.log(`[kb-mock] set OCTO_KB_BASE_URL=http://localhost:${PORT}`)
