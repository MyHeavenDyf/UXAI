import { expect, test } from "bun:test"
import { composerHTML, composerText, createRecommendationInput } from "./studio-recommendation-input"

test("recommendation decorates the same paragraph without entering text or restored HTML", () => {
  const element = document.createElement("div")
  document.body.append(element)
  let enabled = true
  const editor = createRecommendationInput(element, {
    enabled: () => enabled,
    exit: () => {
      enabled = false
    },
  })
  try {
    expect(element.firstElementChild?.getAttribute("contenteditable")).toBe("false")
    expect(element.querySelector("[data-studio-recommendation-placeholder]")?.textContent).toBe("描述你想生成的图片")
    expect(composerText(element)).toBe("")
    expect(composerHTML(element)).toBe("")
    element.append(document.createTextNode("城市夜景"))
    editor.sync()
    expect(composerText(element)).toBe("城市夜景")
    expect(element.querySelector("[data-studio-recommendation-placeholder]")).toBeNull()
    expect(composerHTML(element)).toBe("城市夜景")
    let submitted = false
    element.addEventListener("keydown", () => {
      submitted = true
    })
    element
      .querySelector<HTMLButtonElement>("button")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(submitted).toBe(false)
    element.querySelector<HTMLButtonElement>("button")!.click()
    editor.sync()
    expect(element.querySelector("[data-studio-recommendation-chip]")).toBeNull()
    expect(composerText(element)).toBe("城市夜景")
  } finally {
    editor.dispose()
    element.remove()
  }
})

test("clearing, pasting and restoring preserve one mode chip and flatten existing mentions", async () => {
  const element = document.createElement("div")
  const editor = createRecommendationInput(element, { enabled: () => true, exit: () => {} })
  try {
    element.innerHTML = ""
    await Bun.sleep(0)
    expect(element.querySelectorAll("[data-studio-recommendation-chip]")).toHaveLength(1)
    element.innerHTML =
      '<span class="studio-composer-at-chip" contenteditable="false" data-mention="主体">主体</span><div>窗外雨夜</div>'
    editor.sync()
    editor.sync()
    expect(element.querySelectorAll("[data-studio-recommendation-chip]")).toHaveLength(1)
    expect(element.querySelector(".studio-composer-at-chip")).toBeNull()
    expect(composerText(element)).toBe("主体\n窗外雨夜")
    expect(composerHTML(element)).not.toContain("AI推荐")
    expect(composerHTML(element)).not.toContain("data-mention")
    expect(composerHTML(element)).toContain("主体")
  } finally {
    editor.dispose()
  }
})

test("ordinary mode retains mentions while recommendation mode turns them into plain text", () => {
  const element = document.createElement("div")
  element.innerHTML =
    '<span class="studio-composer-at-chip" contenteditable="false" data-mention="主体"><img src="reference.png"><span>主体</span></span>\u200B 在雨中，联系 a@b.com'
  let enabled = false
  const editor = createRecommendationInput(element, { enabled: () => enabled, exit: () => {} })
  try {
    expect(element.querySelector("[data-mention]")).not.toBeNull()
    enabled = true
    editor.sync()
    expect(element.querySelector("[data-mention]")).toBeNull()
    expect(element.querySelector('img[src="reference.png"]')).toBeNull()
    expect(composerText(element)).toBe("主体 在雨中，联系 a@b.com")
    enabled = false
    editor.sync()
    expect(composerText(element)).toBe("主体 在雨中，联系 a@b.com")
    expect(element.querySelector("[data-mention]")).toBeNull()
  } finally {
    editor.dispose()
  }
})

test("copy and cut exclude the mode and cut restores it without exiting", () => {
  const element = document.createElement("div")
  element.contentEditable = "true"
  document.body.append(element)
  const editor = createRecommendationInput(element, {
    enabled: () => true,
    exit: () => {
      throw new Error("must not exit")
    },
  })
  try {
    element.append(document.createTextNode("晚霞"))
    editor.sync()
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    const data = new DataTransfer()
    element.dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, cancelable: true }))
    expect(data.getData("text/plain")).toBe("晚霞")
    expect(composerText(element)).toBe("")
    expect(element.querySelectorAll("[data-studio-recommendation-chip]")).toHaveLength(1)
  } finally {
    editor.dispose()
    window.getSelection()?.removeAllRanges()
    element.remove()
  }
})
