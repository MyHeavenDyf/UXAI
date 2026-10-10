// 内网知识库本地 mock server —— 外网调试用。同一个进程 mock 两个接口:
//   - queryKnowledge        → wiki 全量库,给 knowledge_search       (SPEC-INS-030)
//   - queryReportKnowledge  → 独立研究报告库,给 insight_report_search(SPEC-INS-034)
//
// 用法:
//   bun run packages/opencode/script/kb-mock-server.ts            # 默认 :8787
//   PORT=9000 bun run packages/opencode/script/kb-mock-server.ts
// 然后让两个检索工具指向它(**共用同一个 OCTO_KB_BASE_URL**,仅 path 不同):
//   OCTO_KB_BASE_URL=http://localhost:8787   (desktop 内会从 VITE_OCTO_BASE_URL 桥接;
//                                              直接跑 opencode server 时手动设此环境变量)
//
// fixture 结构对齐**新接口**返回(扁平 chunk 数组,含 documentId/chunkTitle/chunkContent/documentUrl,
// 已按文档去重、按相关性降序),让 insight → 工具 → LLM 合成答案整条链在外网可验证。
// 契约见 octo-agent docs/specs/agents/insight-knowledge-search.md §4.2。
// 检索方案(Q3 定案):不传 knowledgeName = 全量库,故本 mock 不按库名分流,统一返回全量结果。

const PORT = Number(process.env.PORT) || 8787
const KB_PATH = "/main/rest.root/ucdAgent/thirdParty/queryKnowledge"
const REPORT_PATH = "/main/rest.root/ucdAgent/thirdParty/queryReportKnowledge"

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

// ── 研究报告库(queryReportKnowledge,SPEC-INS-034)────────────────────────────────
// 结构与上面同构,**多一个 downloadUrl**。真实数据里 downloadUrl 当前恒为 null(spec §4),
// 但解析要兼容三种形态,故 fixture 刻意**三种都放一条**,让 parse 的三条分支外网都能验到(V6):
//   ① 有值   → 解析出字符串
//   ② null   → 解析成 undefined
//   ③ 键缺失 → 解析成 undefined
function buildReportResponse(_query: string) {
  return [
    // ① downloadUrl 有值(真实数据目前不会出现,但解析分支要能验)。
    {
      documentId: "report_search_usability_2025",
      chunkTitle: "搜索功能可用性测试报告",
      chunkContent:
        "# 搜索功能可用性测试报告。## 结论:12 名用户中有 9 名在首次搜索无结果时直接退出,未尝试修改关键词。" +
        "## 主要发现:①空结果页缺少可操作的下一步建议;②筛选器收起后用户感知不到已生效的筛选条件;" +
        "③移动端搜索框在滚动后消失,用户需回到顶部才能修改查询。## 建议:空结果页给出联想词与热门入口。",
      documentUrl: "https://octo.hdesign.huawei.com/p/903101",
      downloadUrl: "https://octo.hdesign.huawei.com/download/report_search_usability_2025.docx",
    },
    // ② downloadUrl 为 null(= 当前真实数据的形态)。
    {
      documentId: "report_onboarding_interview_2025",
      chunkTitle: "新用户上手流程深度访谈报告",
      chunkContent:
        "# 新用户上手流程深度访谈报告。## 方法:8 名新注册用户,半结构化访谈 60 分钟。" +
        "## 结论:首次进入后的空状态是流失的主要节点——用户不知道\"第一步该做什么\"," +
        "6/8 名用户在空状态页停留超过 30 秒后关闭应用。## 建议:空状态给一条最小可完成路径,而非功能罗列。",
      documentUrl: "https://octo.hdesign.huawei.com/p/903102",
      downloadUrl: null,
    },
    // ③ 整个 downloadUrl 键缺失(后端尚未约定无值形态,spec §3.4 A1,解析要一样归到 undefined)。
    {
      documentId: "report_notification_survey_2024",
      chunkTitle: "消息通知偏好调研报告",
      chunkContent:
        "# 消息通知偏好调研报告。## 样本:问卷 412 份。## 结论:73% 的用户关闭了全部推送通知," +
        "其中 58% 的直接原因是\"与我无关的内容太多\"而非频次本身。## 建议:先做相关性分级,再谈频控。",
      documentUrl: "https://octo.hdesign.huawei.com/p/903103",
    },
    // ④ 同 documentId 再来一条,验 parse 的兜底去重(保留首次出现)。
    {
      documentId: "report_search_usability_2025",
      chunkTitle: "搜索功能可用性测试报告(同文档另一 chunk)",
      chunkContent: "## 附录:任务完成率与平均任务时长明细表。",
      documentUrl: "https://octo.hdesign.huawei.com/p/903101",
      downloadUrl: "https://octo.hdesign.huawei.com/download/report_search_usability_2025.docx",
    },
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
    if (req.method === "POST" && url.pathname === REPORT_PATH) {
      let body: any = {}
      try {
        body = await req.json()
      } catch {}
      const query = typeof body?.question === "string" ? body.question : ""
      console.log(`[kb-mock] (report) question=${JSON.stringify(query)} account=${JSON.stringify(body?.account ?? "")}`)
      return Response.json(buildReportResponse(query))
    }
    return new Response("not found", { status: 404 })
  },
})

console.log(`[kb-mock] listening on http://localhost:${PORT}${KB_PATH}`)
console.log(`[kb-mock]                    http://localhost:${PORT}${REPORT_PATH}`)
console.log(`[kb-mock] set OCTO_KB_BASE_URL=http://localhost:${PORT}`)
