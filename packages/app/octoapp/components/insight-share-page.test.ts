import { expect, test } from "bun:test"

const html = await Bun.file(new URL("../../public/design/agent/share/index.html", import.meta.url)).text()
const source = html.slice(html.indexOf("    function buildInsightDetails("), html.indexOf("    function renderConversation("))

test("Insight share renders snapshot tasks, references and safe result links", () => {
  const render = new Function("document", "makeSpan", `${source}; return buildInsightDetails`)(
    document,
    (_className: string, text: string) => document.createTextNode(text),
  )
  const result = render([
    { type: "tool", tool: "knowledge_search", state: { metadata: { sources: [
      { title: "<img onerror=alert(1)>", url: "javascript:alert(1)" },
      { title: "研究报告", url: "https://example.com/report" },
    ] } } },
    { type: "tool", tool: "key_findings", state: { status: "completed", output: JSON.stringify({
      structuredContent: { task_id: "task-1", status: "processing" },
    }) } },
    { type: "tool", tool: "get_task_result", state: { status: "completed", output: JSON.stringify({
      structuredContent: { task_id: "task-1", status: "completed" },
      content: [{ type: "resource_link", name: "分析结果", uri: "https://example.com/result" }],
    }) } },
    { type: "tool", tool: "read", state: { status: "completed", output: "not JSON" } },
  ])
  expect(result.textContent).toContain("引用 2 篇资料")
  expect(result.textContent).toContain("任务 task-1 · 分享时状态：已完成")
  expect(result.textContent).not.toContain("处理中")
  expect(result.querySelectorAll("a")).toHaveLength(2)
  expect(result.querySelector("img")).toBeNull()
  expect(result.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(result.querySelector('a[href="https://example.com/result"]').rel).toBe("noopener noreferrer")
})
