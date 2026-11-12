import { expect, test } from "bun:test"
import { annotateElementsWithIdsBrowser } from "@opencode-ai/core/bridge-scripts"
import { applyHtmlEditMessage, prepareHtmlDeletion } from "./html-edit-source"
import { applyManualEditPatch } from "../../make/edit-mode/source-patches"

test("源码编辑保留初始化脚本，不固化脚本生成的列表", () => {
  const script = 'document.querySelector("ul").insertAdjacentHTML("beforeend", "<li>动态项</li>")'
  const source = annotateElementsWithIdsBrowser(`<html><body><h1>标题</h1><ul></ul><script>${script}</script></body></html>`)
  const original = new DOMParser().parseFromString(source, "text/html")
  const id = original.querySelector("h1")!.getAttribute("data-od-id")!
  const edited = applyHtmlEditMessage(source, { type: "od:edit-text", elementId: id, value: "新标题" })
  const styled = applyHtmlEditMessage(edited, { type: "od:edit-preview-style", id, styles: { color: "red" } })
  const saved = new DOMParser().parseFromString(styled, "text/html")
  expect(saved.querySelector("h1")!.textContent).toBe("新标题")
  expect(saved.querySelector("h1")!.style.color).toBe("red")
  expect(saved.querySelector("script")!.textContent).toBe(script)
  expect(saved.querySelectorAll("li")).toHaveLength(0)
  // 重新加载时执行原始初始化逻辑，只生成一份列表。
  new Function("document", script)(saved)
  expect(saved.querySelectorAll("li")).toHaveLength(1)
  const removed = applyManualEditPatch(styled, { id, kind: "remove-element" })
  expect(removed.ok).toBe(true)
  expect(new DOMParser().parseFromString(removed.source, "text/html").querySelector("h1")).toBeNull()
})

test("拒绝修改源码不存在的运行时元素", () => {
  const source = annotateElementsWithIdsBrowser("<h1>原始标题</h1>")
  expect(() => applyHtmlEditMessage(source, { type: "od:edit-text", elementId: "runtime-node", value: "覆盖" })).toThrow("原始 HTML")
})

function target(id: string, tagName = "div") {
  return { dataOdId: id, tagName, className: "metric", attributes: {}, styles: {}, outerHTML: "<div class=metric>指标</div>",
    rect: { x: 0, y: 0, width: 100, height: 40 }, text: "指标", selector: ".dashboard > .metric:nth-child(2)",
    htmlHint: "<div class=metric>", isLayoutContainer: false, elementKind: "text" as const, selectionKind: "native" as const }
}

test("静态删除只移除目标，保留相邻组件和初始化脚本", () => {
  const source = '<html><body><div data-od-id="metric">指标</div><aside>保留</aside><script>initCharts()</script></body></html>'
  const result = prepareHtmlDeletion(source, target("metric"), "/dashboard.html")
  expect(result.kind).toBe("source")
  if (result.kind !== "source") throw new Error("应直接修改源码")
  const doc = new DOMParser().parseFromString(result.source, "text/html")
  expect(doc.querySelector("div")).toBeNull()
  expect(doc.querySelector("aside")?.textContent).toBe("保留")
  expect(doc.querySelector("script")?.textContent).toBe("initCharts()")
})

test("动态元素生成源码删除指令，不固化运行时 DOM", () => {
  const source = '<html><body><main></main><script>initCharts()</script></body></html>'
  const result = prepareHtmlDeletion(source, target("el-runtime"), "/dashboard.html")
  expect(result.kind).toBe("agent")
  if (result.kind !== "agent") throw new Error("应交给 Agent")
  expect(result.prompt).toContain("/dashboard.html")
  expect(result.prompt).toContain(".dashboard > .metric:nth-child(2)")
  expect(result.prompt).toContain("修改生成逻辑")
  expect(result.prompt).toContain("不要把运行时 DOM 快照覆盖回源码")
})

test("根节点和最后一个元素禁止删除，不回退到 Agent", () => {
  const source = '<html><body><div data-od-id="only">唯一元素</div></body></html>'
  expect(() => prepareHtmlDeletion(source, target("only"), "/page.html")).toThrow("最后一个元素")
  for (const tag of ["html", "body", "head"]) {
    expect(() => prepareHtmlDeletion(source, target("missing", tag), "/page.html")).toThrow("根节点")
  }
  expect(() => prepareHtmlDeletion(source, target("missing"), "")).toThrow("缺少文件路径")
})
