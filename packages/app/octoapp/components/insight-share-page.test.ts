import { expect, test } from "bun:test"

const html = await Bun.file(new URL("../../public/design/agent/share/index.html", import.meta.url)).text()
const source = html.slice(html.indexOf("    function insightUserText("), html.indexOf("    function renderInsightConversation("))

function insightFns() {
  return new Function(
    "document",
    "makeSpan",
    `${source}; return {
      insightAggregateTaskCards,
      insightTaskResultCards,
      insightReadTaskInfo,
      insightReadKnowledgeSources,
      insightFindResourceLinks,
      insightResolveOutputType,
      insightIsMindmapJSON,
      insightOutputCards,
      buildInsightKbRefs,
    }`,
  )(document, (_className: string, text: string) => document.createTextNode(text))
}

const designSource = html
  .slice(html.indexOf("    function extractUserText("), html.indexOf("    function insightUserText("))
  // 剥掉顶层的分享页引导 DOM 绑定与 IIFE(访问 document 全局元素/location/fetch,测试环境不可执行)
  .replace(/    document\.getElementById\("continue-btn"\)[\s\S]*?\n    \}\)\(\)\n/, "")

function designFns() {
  return new Function(
    "document",
    "makeSpan",
    `${designSource}; return {
      buildUserBubbleContent,
      buildTurnErrorNotice,
      buildTurnMeta,
      collectSubtasks,
    }`,
  )(document, (_className: string, text: string) => document.createTextNode(text))
}

function taskPart(tool: string, taskId: string, status: string, content: unknown[] = [], structured: Record<string, unknown> = {}) {
  return {
    type: "tool",
    tool,
    state: {
      status: "completed",
      metadata: structured.task_id ? structured : { structuredContent: { task_id: taskId, status, ...structured } },
      output: JSON.stringify({ content }),
    },
  }
}

test("跨轮任务聚合:状态取最新,产物锁定首次 completed 且带链接的捕获", () => {
  const { insightAggregateTaskCards } = insightFns()
  const messages = [
    { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [] },
    { info: { id: "a1", role: "assistant", time: { created: 2 } }, parts: [taskPart("key_findings", "task-1", "processing")] },
    { info: { id: "u2", role: "user", time: { created: 3 } }, parts: [] },
    {
      info: { id: "a2", role: "assistant", time: { created: 4 } },
      parts: [taskPart("get_task_result", "task-1", "completed", [{ type: "text", text: "结果 A" }, {
        type: "resource_link", uri: "https://example.com/a.html", name: "a.html", mimeType: "text/html",
      }])],
    },
    {
      info: { id: "a3", role: "assistant", time: { created: 5 } },
      // 重复查询返回新链接:不得顶替最初那批(对齐 task-detect.ts aggregateTaskCards)
      parts: [taskPart("get_task_result", "task-1", "completed", [{ type: "resource_link", uri: "https://example.com/b.html", name: "b.html", mimeType: "text/html" }])],
    },
  ]
  const cards = insightAggregateTaskCards(messages)
  expect(cards.size).toBe(1)
  const card = cards.get("task-1")!
  expect(card.status).toBe("completed")
  expect(card.toolName).toBe("key_findings")
  expect(card.anchorUserMessageID).toBe("u1")
  expect(card.submittedAt).toBe(2)
  expect(card.resultText).toBe("结果 A")
  expect(card.resourceLinks.map((l: { uri: string }) => l.uri)).toEqual(["https://example.com/a.html"])
})

test("stop_task 返回控制文案,不污染结果;后续非空结果仍更新", () => {
  const { insightAggregateTaskCards } = insightFns()
  const messages = [
    { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [] },
    {
      info: { id: "a1", role: "assistant", time: { created: 2 } },
      parts: [taskPart("get_task_result", "task-1", "completed", [{ type: "text", text: "真实分析结果" }])],
    },
    {
      info: { id: "a2", role: "assistant", time: { created: 3 } },
      parts: [taskPart("stop_task", "task-1", "completed", [{ type: "text", text: "已完成，无需终止" }])],
    },
    {
      info: { id: "a3", role: "assistant", time: { created: 4 } },
      parts: [taskPart("get_task_result", "task-1", "completed", [])],
    },
    {
      info: { id: "a4", role: "assistant", time: { created: 5 } },
      parts: [taskPart("get_task_result", "task-1", "completed", [{ type: "text", text: "更新结果" }])],
    },
  ]
  const card = insightAggregateTaskCards(messages).get("task-1")!
  expect(card.resultText).toBe("更新结果")
})

test("未知任务状态归为 failed 并保留原始状态信息", () => {
  const { insightReadTaskInfo } = insightFns()
  const info = insightReadTaskInfo(taskPart("key_findings", "task-9", "weird_status"))
  expect(info?.status).toBe("failed")
  expect(info?.message).toBe("未知状态:weird_status")
})

test("任务结果产物卡:资源链接优先,无链接时回退 resultText 摘要卡", () => {
  const { insightTaskResultCards } = insightFns()
  const links = insightTaskResultCards({
    taskId: "t", status: "completed", toolName: "key_findings",
    resourceLinks: [{ uri: "https://e.com/r.docx", name: "报告.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
    resultText: "文本",
  })
  expect(links.map((c: { title: string; type: string }) => [c.title, c.type])).toEqual([["报告.docx", "file"]])
  const textOnly = insightTaskResultCards({
    taskId: "t", status: "completed", toolName: "mindmap", resourceLinks: [], resultText: "# 导图",
  })
  expect(textOnly[0].title).toBe("思维导图 结果")
  expect(textOnly[0].type).toBe("markdown")
  expect(insightTaskResultCards({ taskId: "t", status: "failed", toolName: "x", resourceLinks: [], resultText: undefined })).toHaveLength(0)
})

test("知识库引用:仅 http(s) 可点,javascript:/本地路径按纯文本渲染", () => {
  const { buildInsightKbRefs } = insightFns()
  const refs = buildInsightKbRefs([
    { n: 1, title: "安全引用", url: "https://example.com/report" },
    { n: 2, title: "<img onerror=alert(1)>", url: "javascript:alert(1)" },
    { n: 3, title: "本地路径", url: "file:///etc/passwd" },
  ] as never)
  const anchors = refs.querySelectorAll("a.insight-kb-link")
  expect(anchors).toHaveLength(1)
  expect(anchors[0].getAttribute("href")).toBe("https://example.com/report")
  expect(anchors[0].getAttribute("rel")).toBe("noopener noreferrer")
  expect(refs.querySelectorAll("img")).toHaveLength(0)
  expect(refs.querySelectorAll("span.insight-kb-title")).toHaveLength(2)
  expect(refs.textContent).toContain("引用 3 篇资料作为参考")
})

test("产物类型判定对齐 insight resolveOutputType 单一入口", () => {
  const { insightResolveOutputType } = insightFns()
  expect(insightResolveOutputType("报告.md")).toBe("markdown")
  expect(insightResolveOutputType("页面.html")).toBe("html")
  expect(insightResolveOutputType("data.json")).toBe("json")
  expect(insightResolveOutputType("脚本.py")).toBe("code")
  expect(insightResolveOutputType("表格.csv")).toBe("file")
  expect(insightResolveOutputType("无扩展名", "text/html")).toBe("html")
  expect(insightResolveOutputType("无扩展名", "text/csv")).toBe("file")
})

test("思维导图 shape 判定:mindmaps 容器命中,普通配置 JSON 不误判", () => {
  const { insightIsMindmapJSON } = insightFns()
  expect(insightIsMindmapJSON(JSON.stringify({ mindmaps: [{ name: "主题", children: [{ name: "子" }] }] }))).toBe(true)
  expect(insightIsMindmapJSON("```json\n" + JSON.stringify({ nodes: [{ name: "a" }] }) + "\n```")).toBe(true)
  expect(insightIsMindmapJSON(JSON.stringify({ name: "app", version: "1.0" }))).toBe(false)
  expect(insightIsMindmapJSON("不是 JSON")).toBe(false)
})

test("自由文本嗅探:html fence 出可视化卡且标题取 <title>,思维导图 JSON 出导图卡", () => {
  const { insightOutputCards } = insightFns()
  const longHtml = "<!DOCTYPE html><html><head><title>访谈洞察报告</title></head><body><p>" + "x".repeat(60) + "</p></body></html>"
  const turn = {
    user: null,
    assistants: [
      { info: { id: "a", time: { created: 1 } }, parts: [{ type: "text", text: "结果:\n```html\n" + longHtml + "\n```" }] },
      {
        info: { id: "b", time: { created: 2 } },
        parts: [{ type: "text", text: JSON.stringify({ mindmaps: [{ name: "用户画像", children: [{ name: "行为" }] }] }) }],
      },
    ],
  }
  const cards = insightOutputCards(turn, [], new Map())
  // 导图卡标题取文本内 # 标题,JSON 无标题 → 回退「思维导图」(对齐 insight-turn B-2 规则)
  expect(cards.map((c: { title: string; type: string }) => [c.title, c.type])).toEqual([
    ["访谈洞察报告", "html"],
    ["思维导图", "json"],
  ])
  // 同 turn 有任务卡时抑制产物卡(对齐 insight-turn outputCards 优先级)
  expect(insightOutputCards(turn, [{ taskId: "t" }], new Map())).toHaveLength(0)
})

test("design 用户气泡:@mention 渲染为 8px 边距 chip,其余按纯文本", () => {
  const { buildUserBubbleContent } = designFns()
  const nodes = [...buildUserBubbleContent("看下\u200B@海报A\u200B这张图").childNodes]
  expect(nodes).toHaveLength(3)
  expect(nodes[0].nodeType).toBe(3)
  expect((nodes[1] as HTMLElement).tagName).toBe("SPAN")
  expect((nodes[1] as HTMLElement).style.marginLeft).toBe("8px")
  expect((nodes[1] as HTMLElement).style.marginRight).toBe("8px")
  expect((nodes[1] as HTMLElement).textContent).toBe("@海报A")
  expect(nodes[2].textContent).toContain("这张图")

  const plain = [...buildUserBubbleContent("没有提及的普通文本").childNodes]
  expect(plain).toHaveLength(1)
  expect(plain[0].nodeType).toBe(3)
})

test("design 错误提示:标题按错误名映射,ContextOverflow 出专用文案", () => {
  const { buildTurnErrorNotice } = designFns()
  const generic = buildTurnErrorNotice({ assistants: [{ info: { error: { name: "APIError", data: { message: "请求超时" } } } }] })!
  expect(generic.querySelector(".notice-title")!.textContent).toBe("生成出错")
  expect(generic.textContent).toContain("请求超时")

  const auth = buildTurnErrorNotice({ assistants: [{ info: { error: { name: "ProviderAuthError" } } }] })!
  expect(auth.querySelector(".notice-title")!.textContent).toBe("认证失败")

  const overflow = buildTurnErrorNotice({ assistants: [{ info: { error: { name: "ContextOverflowError", data: { message: "溢出详情" } } } }] })!
  expect(overflow.querySelector(".notice-title")!.textContent).toBe("上下文超出提示")
  expect(overflow.textContent).toContain("系统的单次处理能力已满。")
  expect(overflow.textContent).toContain("请进行“上下文压缩”，或新建对话。")
  expect(overflow.textContent).not.toContain("溢出详情")

  // 中断走「已中断」divider,不进错误提示
  expect(buildTurnErrorNotice({ assistants: [{ info: { error: { name: "MessageAbortedError" } } }] })).toBeNull()
  expect(buildTurnErrorNotice({ assistants: [{ info: {} }] })).toBeNull()
})

test("design turn meta:模型名优先 manifest.models 映射,缺省回退 modelID", () => {
  const { buildTurnMeta } = designFns()
  const turn = {
    user: null,
    assistants: [
      { info: { agent: "octo_make", time: { created: 1_000, completed: 61_000 }, providerID: "zf", modelID: "deepseek-v4.1-flash" } },
    ],
  }
  expect(buildTurnMeta(turn, { "zf/deepseek-v4.1-flash": "DeepSeek V4.1 Flash" })!.querySelector(".turn-meta")!.textContent).toContain(
    "DeepSeek V4.1 Flash",
  )
  expect(buildTurnMeta(turn, {})!.querySelector(".turn-meta")!.textContent).toContain("deepseek-v4.1-flash")
  expect(buildTurnMeta(turn, undefined)!.querySelector(".turn-meta")!.textContent).toContain("Octo_Design · deepseek-v4.1-flash")
})

test("design 子任务:write 工具入参 content 为完整 HTML 时补产物卡", () => {
  const { collectSubtasks } = designFns()
  const allParts = [
    {
      part: {
        type: "tool",
        tool: "task",
        state: { status: "completed", input: { description: "做首页" }, metadata: { sessionId: "ses_child" }, output: "task_id: t1" },
      },
      msg: { info: {} },
    },
  ]
  const sessionsById = new Map([
    [
      "ses_child",
      {
        messages: [
          {
            info: { role: "assistant" },
            parts: [
              {
                type: "tool",
                tool: "write",
                state: {
                  status: "completed",
                  input: { filePath: "/a/b/hero.html", content: "<html><body>" + "x".repeat(40) + "</body></html>" },
                },
              },
            ],
          },
        ],
      },
    ],
  ])
  const tasks = collectSubtasks(allParts, sessionsById)
  expect(tasks).toHaveLength(1)
  expect(tasks[0].artifactOutputs.map((a: { identifier: string; title: string }) => [a.identifier, a.title])).toEqual([["hero", "hero"]])
  expect(tasks[0].artifactOutputs[0].content).toContain("<html>")

  // 短内容(≤20 字符)不嗅探出卡
  const short = new Map([
    ["ses_child", { messages: [{ info: { role: "assistant" }, parts: [{ type: "tool", tool: "write", state: { status: "completed", input: { filePath: "/a/b/s.html", content: "<html>x</html>" } } }] }] }],
  ])
  expect(collectSubtasks(allParts, short)[0].artifactOutputs).toHaveLength(0)
})
