import { expect, test } from "bun:test"

const html = await Bun.file(new URL("../../public/design/agent/share/index.html", import.meta.url)).text()
const source = html.slice(html.indexOf("    function collectInsightTasks("), html.indexOf("    function renderConversation("))

function taskPart(tool: string, status: string, text = "", id = "task-1") {
  return { type: "tool", tool, state: { status: "completed", output: JSON.stringify({
    structuredContent: { task_id: id, status }, content: [{ type: "text", text }],
  }) } }
}

test("跨轮任务展示最终快照，但不把其他任务插入当前轮", () => {
  const { collectInsightTasks, buildInsightDetails } = new Function("document", "makeSpan", `${source}; return { collectInsightTasks, buildInsightDetails }`)(document, (_className: string, text: string) => document.createTextNode(text))
  const first = [taskPart("key_findings", "processing")]
  const second = [taskPart("get_task_result", "completed", "真实分析结果")]
  const snapshots = collectInsightTasks([...first, ...second, taskPart("key_findings", "pending", "", "task-2")])
  for (const parts of [first, second]) {
    const result = buildInsightDetails(parts, snapshots)
    expect(result.textContent).toContain("任务 task-1 · 分享时状态：已完成")
    expect(result.textContent).toContain("真实分析结果")
    expect(result.textContent).not.toContain("处理中")
    expect(result.textContent).not.toContain("task-2")
  }
  expect(buildInsightDetails([], snapshots).children).toHaveLength(0)
})

test("终止调用或空结果不覆盖之前取得的结果，后续非空结果仍更新", () => {
  const render = new Function("document", "makeSpan", `${source}; return buildInsightDetails`)(document, (_className: string, text: string) => document.createTextNode(text))
  const parts = [
    taskPart("uxr-tool_get_task_result", "completed", "真实分析结果"),
    taskPart("uxr-tool_stop_task", "completed", "已完成，无需终止"),
    taskPart("uxr-tool_get_task_result", "completed"),
  ]
  expect(render(parts).querySelector("pre")?.textContent).toBe("真实分析结果")
  expect(render([...parts, taskPart("get_task_result", "completed", "更新结果")]).querySelector("pre")?.textContent).toBe("更新结果")
})

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
