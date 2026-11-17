import { expect, test } from "bun:test"
import { injectInsightEditBridge } from "./html-edit-preview"

test("取消局部预览恢复文字和样式，保留运行时节点和监听器", () => {
  const doc = new DOMParser().parseFromString('<div data-od-id="el-1" style="color: red">甲<button>运行时状态</button>乙</div>', "text/html")
  const element = doc.querySelector("div")!
  const button = doc.querySelector("button")!
  let clicks = 0
  button.addEventListener("click", () => clicks++)
  const frame = new EventTarget()
  const parent = window
  const injected = new DOMParser().parseFromString(injectInsightEditBridge("<body></body>"), "text/html")
  const script = injected.querySelector("script[data-od-custom-bridge]")!.textContent!
  new Function("window", "document", script)(Object.assign(frame, { parent }), doc)
  const post = (data: object) => frame.dispatchEvent(new MessageEvent("message", { data, source: parent }))
  post({ type: "od:edit-text", elementId: "el-1" })
  element.firstChild!.nodeValue = "新文字"
  element.lastChild!.remove()
  post({ type: "od:edit-preview-style", id: "el-1" })
  element.style.color = "blue"
  post({ type: "od:insight-reset-edit" })
  expect(element.textContent).toBe("甲运行时状态乙")
  expect(element.style.color).toBe("red")
  expect(element.querySelector("button")).toBe(button)
  button.click()
  expect(clicks).toBe(1)

  post({ type: "od:edit-preview-style", id: "el-1" })
  element.style.color = "green"
  post({ type: "od:insight-commit-edit" })
  post({ type: "od:insight-reset-edit" })
  expect(element.style.color).toBe("green")
})

test("保存删除、链接和动态样式只修改现有预览节点", () => {
  const doc = new DOMParser().parseFromString('<div data-od-id="removed">删除</div><a data-od-id="link" href="/old">链接</a><p data-od-id="dynamic" style="opacity: .5">动态元素</p>', "text/html")
  const link = doc.querySelector("a")!
  const element = doc.querySelector("p")!
  const replies: object[] = []
  const parent = { postMessage: (data: object) => replies.push(data) }
  const frame = Object.assign(new EventTarget(), { parent })
  const injected = new DOMParser().parseFromString(injectInsightEditBridge("<body></body>"), "text/html")
  new Function("window", "document", injected.querySelector("script[data-od-custom-bridge]")!.textContent!)(frame, doc)
  const post = (data: object) => frame.dispatchEvent(Object.assign(new Event("message"), { data, source: parent }))
  post({ type: "od:edit-preview-style", id: "dynamic" })
  element.style.color = "blue"
  const commit = { requestId: "saved", links: [["link", "/new"]], dynamicIds: ["dynamic"], overrides: [["data-insight-style-overrides", "p { color: blue !important; }"]] }
  post({ type: "od:insight-commit-edit", commit: { ...commit, removeId: "missing" } })
  expect(replies.pop()).toMatchObject({ requestId: "saved", ok: false })
  expect(link.getAttribute("href")).toBe("/old")
  expect(doc.head.querySelector("style")).toBeNull()
  post({ type: "od:insight-commit-edit", commit: { ...commit, removeId: "removed" } })
  post({ type: "od:insight-reset-edit" })
  expect(replies.pop()).toMatchObject({ requestId: "saved", ok: true })
  expect(doc.querySelector("div")).toBeNull()
  expect(doc.querySelector("a")).toBe(link)
  expect(link.getAttribute("href")).toBe("/new")
  expect(element.getAttribute("style")).toBe("opacity: .5")
  expect(doc.head.querySelector("style[data-insight-style-overrides]")?.textContent).toBe("p { color: blue !important; }")
})
