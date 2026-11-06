import { expect, test } from "bun:test"
import { annotateElementsWithIdsBrowser } from "@opencode-ai/core/bridge-scripts"
import { applyHtmlEditMessage } from "./html-edit-source"
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
