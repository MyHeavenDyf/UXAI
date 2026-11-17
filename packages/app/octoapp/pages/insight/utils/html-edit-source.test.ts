import { expect, test } from "bun:test"
import { annotateElementsWithIdsBrowser } from "@opencode-ai/core/bridge-scripts"
import { applyHtmlAppearanceEdit, applyHtmlEditMessage, prepareHtmlDeletion } from "./html-edit-source"
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

test("静态节点填充色直接写入原始 HTML，保留元素透明度和初始化脚本", () => {
  const source = '<html><body><div data-od-id="metric" style="opacity: 0.4">数值</div><script>initCharts()</script></body></html>'
  const result = applyHtmlAppearanceEdit(source, target("metric"), { backgroundColor: "#e8ba3080" })
  const doc = new DOMParser().parseFromString(result.source, "text/html")
  expect(doc.querySelector("div")?.style.backgroundColor).toBe("#e8ba3080")
  expect(doc.querySelector("div")?.style.opacity).toBe("0.4")
  expect(doc.querySelector("script")?.textContent).toBe("initCharts()")
})

test("动态 SVG 填充色直接写入 HTML，重新生成后只命中选中的 SVG", () => {
  const script = `document.querySelector('main').innerHTML = '<div><svg></svg></div><div><svg></svg></div>'`
  const source = `<!doctype html><html><body><main id="rings"></main><script>${script}</script></body></html>`
  const documentSelector = "main#rings > div:nth-of-type(2) > svg:nth-of-type(1)"
  const svg = { ...target("el-runtime", "svg"), documentSelector }
  const first = applyHtmlAppearanceEdit(source, svg, { backgroundColor: "#2E86DE" })
  const saved = applyHtmlAppearanceEdit(first.source, svg, { backgroundColor: "#e8ba3080" })
  const doc = new DOMParser().parseFromString(saved.source, "text/html")
  expect(saved.important).toBe(true)
  expect(doc.querySelectorAll("svg")).toHaveLength(0)
  expect(doc.querySelector("script")?.textContent).toBe(script)
  expect(doc.querySelector("style")?.textContent).toBe(`${documentSelector} { background-color: #e8ba3080 !important; }`)
  new Function("document", script)(doc)
  expect([...doc.querySelectorAll(documentSelector)]).toEqual([doc.querySelectorAll("svg")[1]])
  expect(() => applyHtmlAppearanceEdit(source, { ...svg, documentSelector: "svg, body" }, { backgroundColor: "#2E86DE" })).toThrow("无法定位")
})

test("静态描边只写入修改过的属性", () => {
  const source = '<div data-od-id="metric" style="border-top-width: 2px; border-right-width: 4px; background-color: red"></div>'
  const saved = applyHtmlAppearanceEdit(source, target("metric"), { borderTopWidth: "6px", borderStyle: "dotted" })
  const style = new DOMParser().parseFromString(saved.source, "text/html").querySelector("div")!.style
  expect(saved.important).toBe(false)
  expect(style.borderTopWidth).toBe("6px")
  expect(style.borderRightWidth).toBe("4px")
  expect(style.borderStyle).toBe("dotted")
  expect(style.backgroundColor).toBe("red")
})

test("动态描边的颜色、线型和宽度直接保存，重复修改保留其余属性及填充色", () => {
  const source = '<html><head><style data-insight-fill-overrides>svg#ring { background-color: red !important; }</style></head><body></body></html>'
  const svg = { ...target("el-runtime", "svg"), documentSelector: "svg#ring" }
  const first = applyHtmlAppearanceEdit(source, svg, { borderColor: "#2e86de80", borderStyle: "dashed", borderLeftWidth: "4px" })
  const saved = applyHtmlAppearanceEdit(first.source, svg, { borderLeftWidth: "8px" })
  const doc = new DOMParser().parseFromString(saved.source, "text/html")
  expect(first.important).toBe(true)
  expect(saved.styles).toEqual({ borderLeftWidth: "8px" })
  expect(doc.querySelector("style[data-insight-border-overrides]")?.textContent?.split("\n")).toEqual([
    "svg#ring { border-color: #2e86de80 !important; }",
    "svg#ring { border-style: dashed !important; }",
    "svg#ring { border-left-width: 8px !important; }",
  ])
  expect(doc.querySelector("style[data-insight-fill-overrides]")?.textContent).toBe("svg#ring { background-color: red !important; }")
})

test("效果、背景图、边距、宽高和布局直接写入静态和动态节点", () => {
  const source = '<html><body><div id="cards" data-od-id="cards"></div><script>renderCards()</script></body></html>'
  const styles = {
    boxShadow: "0px 2px 4px black", filter: "blur(2px)", backdropFilter: "blur(4px)",
    backgroundImage: 'url("https://example.test/background.png")', paddingTop: "12px", marginLeft: "-4px",
    width: "100%", height: "fit-content", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "space-between", gap: "8px",
  }
  const staticEdit = applyHtmlAppearanceEdit(source, target("cards"), styles)
  const inline = new DOMParser().parseFromString(staticEdit.source, "text/html").querySelector("div")!.style
  expect(inline.display).toBe("flex")
  expect(inline.paddingTop).toBe("12px")
  expect(inline.marginLeft).toBe("-4px")
  expect(inline.backgroundImage).toContain("background.png")

  const card = { ...target("el-runtime"), documentSelector: "div#cards > div:nth-of-type(1)" }
  const dynamicEdit = applyHtmlAppearanceEdit(source, card, styles)
  const saved = applyHtmlAppearanceEdit(dynamicEdit.source, card, { backgroundImage: "", filter: "none" })
  const doc = new DOMParser().parseFromString(saved.source, "text/html")
  const css = doc.querySelector("style[data-insight-style-overrides]")?.textContent ?? ""
  expect(saved.important).toBe(true)
  expect(saved.styles).toEqual({ filter: "none", backgroundImage: "none" })
  for (const property of ["box-shadow", "backdrop-filter", "padding-top", "margin-left", "width", "height", "display", "flex-direction", "align-items", "justify-content", "gap"]) {
    expect(css).toContain(`${card.documentSelector} { ${property}: `)
  }
  expect(css).toContain("background-image: none !important")
  expect(css).not.toContain("background.png")
  expect(css).not.toContain("filter: blur(2px)")
  expect(doc.querySelector("script")?.textContent).toBe("renderCards()")
})

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
