import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { extToOutputType, findWriteCards } from "../../utils/write-output"
import type { OutputCardType } from "../insight-turn"

// SPEC-INS-014 §10.2 W1–W3:「删掉预览面板第四栏,单击文件行直接开 tab」的回归防线。
//
// 被删掉的 preview-pane.tsx 自带一套独立的 Switch(image/video/audio/html/markdown/code),
// **没有 default 分支** —— pdf/docx/pptx/xlsx/csv/zip/psd 全落到「无 Match」渲染成空白。
// 删掉它之后,「文件管理单击 → 打开后走哪条渲染」只剩 extToOutputType 一个判定入口
// (页面级 pages/insight/index.tsx 的 openFileFromManager 调用),与对话产物卡片同源。
// 本文件锁死这一点:没有第二套白名单、没有扩展名落到无分支。

const INSIGHT_DIR = resolve(import.meta.dir, "../..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe("W1 预览面板第四栏已彻底移除", () => {
  test("pages/insight 下无 PreviewPane / previewFile 残留", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(INSIGHT_DIR)) {
      if (file === import.meta.path) continue // 本用例自身要写出这两个词才能断言
      if (/PreviewPane|previewFile/.test(readFileSync(file, "utf8"))) {
        offenders.push(file.slice(INSIGHT_DIR.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })

  test("preview-pane.tsx 文件已删", () => {
    const names = readdirSync(join(INSIGHT_DIR, "components/file-manager"))
    expect(names).not.toContain("preview-pane.tsx")
  })
})

// result-viewer 对 source:"path" 的 tab 分流(components/result-viewer/index.tsx):
//   image → ImageRenderer;file → FileFallback 中间页;其余 → PathTabBody 读盘后应用内渲染。
// OutputCardType 的每个取值都在其中有分支,故只要 extToOutputType 的返回值落在这个集合里,
// 就不可能重现「面板 Switch 无 Match → 空白」。
const RENDERABLE: readonly OutputCardType[] = ["table", "mindmap", "markdown", "file", "json", "html", "code", "image"]

// §10.2 决定表 + W2 用例列出的扩展名。左列是文件管理里能点到的文件名,右列是打开后的落点。
const CASES: Array<[string, OutputCardType]> = [
  // 应用内渲染(产品所说的「支持本地预览」)
  ["报告.md", "markdown"],
  ["我的 报告(2).md", "markdown"],
  ["notes.markdown", "markdown"],
  ["page.html", "html"],
  ["page.htm", "html"],
  ["data.json", "json"],
  ["readme.txt", "code"],
  ["script.py", "code"],
  ["Makefile", "code"],
  // 图片:应用内 ImageRenderer(local:// 读盘)
  ["shot.png", "image"],
  ["logo.svg", "image"],
  ["photo.jpeg", "image"],
  // FileFallback 中间页:本地打开 / 文件夹打开 / 下载
  //   —— 以下七类正是原面板 Switch 缺 default 时渲染成空白的那批
  ["doc.pdf", "file"],
  ["report.docx", "file"],
  ["slides.pptx", "file"],
  ["book.xlsx", "file"],
  ["rows.csv", "file"],
  ["pack.zip", "file"],
  ["src.psd", "file"],
  //   —— 音视频本期同样走中间页(应用内播放是 §10.2 拆出的第二步,需先给 local:// 加 Range 支持)
  ["clip.mp4", "file"],
  ["voice.mp3", "file"],
  ["interview.mov", "file"],
]

describe("W2 文件管理单击 → 打开后的渲染落点", () => {
  for (const [name, expected] of CASES) {
    test(`${name} → ${expected}`, () => {
      expect(extToOutputType(name)).toBe(expected)
    })
  }

  test("没有任何扩展名落到「无分支」", () => {
    // 覆盖面比上表更宽:常见办公/媒体/代码/无扩展名/未知扩展名/大小写混合都要有落点。
    const probes = [
      "a.md", "a.MD", "a.html", "a.json", "a.txt", "a.py", "a.ts", "a.tsx", "a.go", "a.rs", "a.yaml", "a.toml",
      "a.png", "a.jpg", "a.gif", "a.webp", "a.svg", "a.heic", "a.avif", "a.bmp", "a.tiff", "a.ico",
      "a.pdf", "a.doc", "a.docx", "a.ppt", "a.pptx", "a.xls", "a.xlsx", "a.csv", "a.tsv", "a.rtf", "a.epub",
      "a.pages", "a.numbers", "a.key", "a.odt", "a.ods", "a.odp",
      "a.mp4", "a.mov", "a.mkv", "a.webm", "a.avi", "a.m4v", "a.mp3", "a.wav", "a.flac", "a.m4a", "a.aac", "a.ogg",
      "a.zip", "a.tar", "a.gz", "a.7z", "a.rar", "a.dmg", "a.iso", "a.apk",
      "a.psd", "a.ai", "a.sketch", "a.fig", "a.woff2", "a.ttf",
      "a.exe", "a.dll", "a.so", "a.wasm",
      "Dockerfile", "LICENSE", "a.unknownext", "a.", "带空格 的 名字.md", "归档(1).zip",
    ]
    for (const name of probes) {
      const type = extToOutputType(name)
      expect(RENDERABLE, `${name} 落到未知类型 ${type}`).toContain(type)
    }
  })
})

describe("W3 extToOutputType 是唯一分类依据", () => {
  test("文件管理入口与对话卡片入口对同一文件名得出相同结论", () => {
    for (const [name, expected] of CASES) {
      const filePath = `/tmp/.octo/s1/outputs/${name}`
      // 对话卡片入口:write 工具 part → findWriteCards
      const cards = findWriteCards([
        { type: "tool", tool: "write", state: { status: "completed", input: { filePath } } },
      ])
      expect(cards).toHaveLength(1)
      expect(cards[0]!.type).toBe(expected)
      // 文件管理入口:openFileFromManager 对同一文件名的判定
      expect(extToOutputType(name)).toBe(cards[0]!.type)
    }
  })

  test("openFileFromManager 不自带第二套白名单", () => {
    const src = readFileSync(join(INSIGHT_DIR, "index.tsx"), "utf8")
    const fn = src.slice(src.indexOf("function openFileFromManager"))
    const body = fn.slice(0, fn.indexOf("\n  }\n"))
    expect(body).toContain("extToOutputType(file.name)")
    // 白名单只允许存在于 write-output.ts:这里出现扩展名字面量就意味着又长出一套判定
    expect(body).not.toMatch(/["'](?:md|pdf|docx|xlsx|png|mp4)["']/)
  })
})
