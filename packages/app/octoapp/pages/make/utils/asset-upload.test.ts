/**
 * 资产库保存（下载按钮「保存到资产库(全页面/局部)」）纯逻辑测试。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/asset-upload.test.ts（在 packages/app 下）
 */
import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import { buildDefaultAssetName, encodeSelectorToBase64Url, isAssetLibraryLoggedIn, sanitizeAssetFileName, zipBlobToBase64 } from "./asset-upload"
import { createPartialAssetsZip, extractHeadStyles } from "./html-assets-zip"

describe("encodeSelectorToBase64Url", () => {
  test("已知值：a → YQ（去填充）", () => {
    expect(encodeSelectorToBase64Url("a")).toBe("YQ")
  })

  test("输出仅 base64url 字母表（无 + / =）", () => {
    const encoded = encodeSelectorToBase64Url("#folder-row-2 > td.react-directory-row-commit-cell:nth-of-type(2)")
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(encoded).not.toContain("+")
    expect(encoded).not.toContain("/")
    expect(encoded).not.toContain("=")
  })

  test("含中文 class 名（btoa 原生会抛错）可编码且可逆", () => {
    const selector = "#卡片.标题栏:nth-of-type(2) > a"
    const encoded = encodeSelectorToBase64Url(selector)
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    )
    expect(decoded).toBe(selector)
  })
})

describe("buildDefaultAssetName（Input 默认名，≤95——加 .html 后缀 ≤100）", () => {
  const decodeB64Url = (s: string) =>
    new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))

  test("短名不截断", () => {
    expect(buildDefaultAssetName("p", "#a > span")).toBe(`p-${encodeSelectorToBase64Url("#a > span")}`)
  })

  test("超长 selector：保页面名，丢头部段保留元素尾段", () => {
    const selector = `${"div." + "a".repeat(60)} > span.card`
    const result = buildDefaultAssetName("p", selector)
    expect(result.length).toBeLessThanOrEqual(95)
    expect(result.startsWith("p-")).toBe(true)
    // 编码部分解码后 = 丢弃头部段后的尾段（元素身份保留）
    expect(decodeB64Url(result.slice(2))).toBe("span.card")
  })

  test("页面名自身超 95：截页面名，无 selector 部分", () => {
    expect(buildDefaultAssetName("x".repeat(120), "#a > b")).toBe("x".repeat(95))
  })

  test("页面名 94：预算不足，只返回页面名", () => {
    expect(buildDefaultAssetName("y".repeat(94), "#a")).toBe("y".repeat(94))
  })

  test("空 selector：只返回页面名", () => {
    expect(buildDefaultAssetName("p", "")).toBe("p")
  })
})

describe("zipBlobToBase64", () => {
  test("Blob → 纯 base64（剥 data: 前缀）", async () => {
    const blob = new Blob([new Uint8Array([72, 101, 108, 108, 111])]) // "Hello"
    expect(await zipBlobToBase64(blob)).toBe("SGVsbG8=")
  })

  test("空 Blob → 空字符串", async () => {
    expect(await zipBlobToBase64(new Blob([]))).toBe("")
  })
})

describe("isAssetLibraryLoggedIn", () => {
  test("uiplusToken 存在性", () => {
    localStorage.removeItem("uiplusToken")
    expect(isAssetLibraryLoggedIn()).toBe(false)
    localStorage.setItem("uiplusToken", "x")
    expect(isAssetLibraryLoggedIn()).toBe(true)
    localStorage.removeItem("uiplusToken")
  })
})

describe("createPartialAssetsZip（无桌面 API 分支）", () => {
  test("仅片段单文件，内容为最小 HTML 文档包裹 outerHTML", async () => {
    const blob = await createPartialAssetsZip({
      fragmentHtml: '<div class="card"><img src="./logo.png" alt="logo"></div>',
      htmlFilePath: "D:/site/html/index.html",
      fileNameInZip: "my-section.html",
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(["my-section.html"])
    const content = await zip.file("my-section.html")!.async("string")
    expect(content).toContain("<!DOCTYPE html>")
    expect(content).toContain('<div class="card"><img src="./logo.png" alt="logo"></div>')
  })

  test("css selector 默认名 sanitize：非法字符→~ / 合并~ / 去前导~", async () => {
    const blob = await createPartialAssetsZip({
      fragmentHtml: "<span>hi</span>",
      htmlFilePath: "D:/site/html/index.html",
      fileNameInZip: '//*[@id="row-2"]/td[3].html',
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(["[@id=~row-2~]~td[3].html"])
  })

  test("URL 结构字符 # / % → ~", async () => {
    const blob = await createPartialAssetsZip({
      fragmentHtml: "<span>hi</span>",
      htmlFilePath: "D:/site/html/index.html",
      fileNameInZip: "页#a%b.html",
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(["页~a~b.html"])
  })

  test("文件名全非法字符 → untitled.html 兜底", async () => {
    const blob = await createPartialAssetsZip({
      fragmentHtml: "<span>hi</span>",
      htmlFilePath: "D:/site/html/index.html",
      fileNameInZip: "???",
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(["untitled.html"])
  })

  test("无 htmlFilePath：同样仅片段单文件", async () => {
    const blob = await createPartialAssetsZip({
      fragmentHtml: "<span>hi</span>",
      htmlFilePath: "",
      fileNameInZip: "frag.html",
    })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(["frag.html"])
  })

  test("页面 head 样式随片段打包，CSS 及其二级引用收集为资源", async () => {
    // mock window.api（getDesktopUrl 运行时读取 window.api）验证资源收集分支
    const files: Record<string, string> = {
      "D:/site/html/style.css": `.card { font-family: "X"; }\n@font-face { src: url(font.woff2); }`,
      "D:/site/html/font.woff2": "binary-font",
    }
    const w = window as unknown as { api?: unknown }
    const prevApi = w.api
    w.api = {
      readFileBuffer: async (p: string) =>
        p in files ? new TextEncoder().encode(files[p]).buffer as ArrayBuffer : null,
    }
    try {
      const blob = await createPartialAssetsZip({
        fragmentHtml: '<div class="card" data-od-id="el-3">hi</div>',
        pageHtml:
          "<html><head>" +
          "<title>页面</title>" +
          '<style data-od-edit-bridge-style>html[data-od-edit-mode]{}</style>' +
          "<style>.card { font-family: \"X\" }</style>" +
          '<link rel="stylesheet" href="./style.css">' +
          '<script>console.log("no")</script>' +
          "</head><body><div class=card></div></body></html>",
        htmlFilePath: "D:/site/html/index.html",
        fileNameInZip: "frag.html",
      })
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      const names = Object.keys(zip.files).sort()
      expect(names).toEqual(["font.woff2", "frag.html", "style.css"])
      const content = await zip.file("frag.html")!.async("string")
      expect(content).toContain("<style>.card")
      expect(content).not.toContain("data-od-edit-bridge-style")
      expect(content).not.toContain("<script>")
      expect(content).not.toContain("<title>")
      expect(content).not.toContain("data-od-id")
    } finally {
      w.api = prevApi
      if (prevApi === undefined) delete w.api
    }
  })
})

describe("extractHeadStyles", () => {
  test("只取 style 块与 link[stylesheet]，排除 script/title/importmap", () => {
    const html =
      "<html><head>" +
      "<title>t</title>" +
      '<style>.a{color:red}</style>' +
      '<link rel="stylesheet" href="./s.css">' +
      '<link rel="icon" href="i.png">' +
      '<script type="importmap">{"imports":{}}</script>' +
      '<script src="./x.js"></script>' +
      "</head><body></body></html>"
    const out = extractHeadStyles(html)
    expect(out).toContain('<style>.a{color:red}</style>')
    expect(out).toContain('<link rel="stylesheet" href="./s.css">')
    expect(out).not.toContain("<title>")
    expect(out).not.toContain("importmap")
    expect(out).not.toContain("./x.js")
  })

  test("空输入返回空串", () => {
    expect(extractHeadStyles("")).toBe("")
  })
})

describe("sanitizeAssetFileName（files.name 上传兜底）", () => {
  test("Windows 非法字符 → ~", () => {
    expect(sanitizeAssetFileName('a:b*c?d"e<f>g|h\\i')).toBe("a~b~c~d~e~f~g~h~i")
  })

  test("URL 结构字符 # / % → ~（# 截断 fragment、% 炸 decodeURIComponent）", () => {
    expect(sanitizeAssetFileName("a#b%c")).toBe("a~b~c")
  })

  test("前导 # 清洁后剥前导 ~", () => {
    expect(sanitizeAssetFileName("#x")).toBe("x")
  })

  test("连续非法字符合并为单个 ~", () => {
    expect(sanitizeAssetFileName("a//b")).toBe("a~b")
  })

  test("剥尾部点 / 空格", () => {
    expect(sanitizeAssetFileName("name. ")).toBe("name")
  })

  test("长度截断 200", () => {
    expect(sanitizeAssetFileName("x".repeat(250))).toBe("x".repeat(200))
  })

  test("全非法字符 → untitled 兜底", () => {
    expect(sanitizeAssetFileName("???")).toBe("untitled")
  })
})
