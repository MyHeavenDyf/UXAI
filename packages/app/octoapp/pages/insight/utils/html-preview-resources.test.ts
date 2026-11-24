import { afterAll, beforeAll, expect, test } from "bun:test"
import { resolvePreviewStyles } from "./html-preview-resources"

const settings = (window as unknown as { happyDOM: { settings: { disableCSSFileLoading: boolean; handleDisabledFileLoadingAsSuccess: boolean } } }).happyDOM.settings
const loading = settings.disableCSSFileLoading
const success = settings.handleDisabledFileLoadingAsSuccess
beforeAll(() => { settings.disableCSSFileLoading = true; settings.handleDisabledFileLoadingAsSuccess = true })
afterAll(() => { settings.disableCSSFileLoading = loading; settings.handleDisabledFileLoadingAsSuccess = success })

test.each([
  ["", "local:///D:/project/main.css"],
  ['<base href="https://cdn.example.com/theme/">', "https://cdn.example.com/theme/main.css"],
  ['<base href="../theme/">', "local:///D:/theme/main.css"],
  ['<base href="">', "local:///D:/project/main.css"],
  ['<base href="http://[invalid">', "local:///D:/project/main.css"],
  ['<base target="_blank"><base href="https://cdn.example.com/first/"><base href="https://cdn.example.com/second/">', "https://cdn.example.com/first/main.css"],
])("样式地址遵循首个 base[href]，无有效 base 时使用本地路径：%s", (base, expected) => {
  const html = `<html><head>${base}<link rel="stylesheet" href="main.css"></head><body><a href="#section">跳转</a></body></html>`
  const result = new DOMParser().parseFromString(resolvePreviewStyles(html, "D:/project/page.html"), "text/html")
  expect(result.querySelector("link")?.getAttribute("href")).toBe(expected)
  expect(result.querySelector("a")?.getAttribute("href")).toBe("#section")
  expect(result.querySelector("base[href]")?.getAttribute("href")).toBe(new DOMParser().parseFromString(html, "text/html").querySelector("base[href]")?.getAttribute("href"))
})

test("没有本地路径时保留原文", () => {
  const html = '<base href="https://cdn.example.com/"><link rel="stylesheet" href="main.css">'
  expect(resolvePreviewStyles(html)).toBe(html)
})
