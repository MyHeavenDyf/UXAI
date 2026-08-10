import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instruction } from "../../src/session/instruction"
import { SessionID, MessageID } from "../../src/session/schema"
import { ExtractDocumentTool } from "../../src/tool/extract_document"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const FIXTURES = path.join(import.meta.dir, "fixtures", "extract-document")

afterEach(async () => {
  await disposeAllInstances()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} as unknown as Tool.Context

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const runIn = Effect.fn("ExtractDocumentTest.runIn")(function* (dir: string, file: string) {
  const info = yield* ExtractDocumentTool
  const tool = yield* info.init()
  return yield* provideInstance(dir)(tool.execute({ path: file }, ctx))
})

const run = Effect.fn("ExtractDocumentTest.run")(function* (file: string) {
  const dir = yield* tmpdirScoped()
  return yield* runIn(dir, file)
})

/** 解析件落点(SPEC-INS-016 §4.2):<projectDir>/.octo/<sessionID>/extracted/ */
const extractedDir = (dir: string) => path.join(dir, ".octo", "ses_test", "extracted")

/** 在 dir 下写一个源文件,返回绝对路径。 */
async function seed(dir: string, name: string, content: string) {
  const file = path.join(dir, name)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content, "utf8")
  return file
}

describe("extract_document", () => {
  it.live("docx: 抽出正文并带字数/token 首行", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.docx"))
      expect(result.output).toContain("访谈纪要:用户反馈搜索入口太深。")
      expect(result.output).toContain("Second paragraph in English.")
      expect(result.output.split("\n")[0]).toMatch(/《sample\.docx》抽取完成:共 .+ 字.+约 .+ tokens/)
      expect(result.metadata.chars as number).toBeGreaterThan(0)
      expect(result.metadata.tokenEstimate as number).toBeGreaterThan(0)
    }),
  )

  it.live("pdf: 抽出文本并带页数", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.pdf"))
      expect(result.output).toContain("Interview note: search entry is too deep.")
      expect(result.metadata.pages).toBe(1)
    }),
  )

  it.live("xlsx: 按工作表输出 TSV,数字/文本有显示值", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.xlsx"))
      expect(result.output).toContain("# 工作表:访谈记录")
      expect(result.output).toContain("问题\tseverity")
      expect(result.output).toContain("搜索入口太深\t3")
      expect(result.metadata.sheets).toBe(1)
    }),
  )

  it.live("pptx: 按页分节,含备注与 XML 实体解码", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.pptx"))
      expect(result.output).toContain("# 第 1 页")
      expect(result.output).toContain("# 第 2 页")
      expect(result.output).toContain("搜索 & 推荐:入口太深")
      expect(result.output).toContain("[备注] 备注:重点跟进搜索问题")
      expect(result.output).toContain("下一步计划")
      expect(result.metadata.slides).toBe(2)
    }),
  )

  it.live("txt: 直读并带字数/token 首行(SPEC-INS-021 §3 统一入口)", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.txt"))
      expect(result.output).toContain("访谈纪要:用户反馈搜索入口太深。")
      expect(result.output).toContain("Second line in English.")
      expect(result.output.split("\n")[0]).toMatch(/《sample\.txt》抽取完成:共 .+ 字.+约 .+ tokens/)
      expect(result.title).toBe("提取文档正文:sample.txt")
    }),
  )

  it.live("md: 直读原文(不渲染不转换)", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.md"))
      expect(result.output).toContain("# 访谈纪要")
      expect(result.output).toContain("- Second bullet in English.")
    }),
  )

  it.live("文件不存在: 返回清晰指引而非抛错", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "nope.docx"))
      expect(result.output).toContain("未找到文件")
      expect(result.metadata.error).toBe("not-found")
    }),
  )

  it.live("不支持格式: 提示支持列表 + MCP 兜底", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(import.meta.dir, "extract_document.test.ts"))
      expect(result.output).toContain("不支持的格式")
      expect(result.output).toContain(".docx / .xlsx / .pdf")
      expect(result.metadata.error).toBe("unsupported")
    }),
  )

  // ——— SPEC-INS-016 v2.2:docx 两级抽取 ———

  it.live("结构不规范的 docx(<w:t> 套 <w:r>): 降级抽出正文,不再整份失败", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "nested-wt.docx"))

      expect(result.metadata.error).toBeUndefined()
      expect(result.metadata.fallback).toBe(true)
      // 正常段落与**畸形段落**都要抽到,实体也要解码
      expect(result.output).toContain("访谈纪要:用户反馈搜索入口太深。")
      expect(result.output).toContain("嵌套段落:这段被 w:r 包住了 & 实体也要解码。")
      expect(result.output).toContain("Second paragraph in English.")
      expect(result.output).toContain("该文档结构不规范,已用兼容方式提取正文")
    }),
  )

  it.live("规范 docx: 不置 fallback(证明主路径 mammoth 没被兜底顶替)", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "sample.docx"))
      expect(result.metadata.fallback).toBeUndefined()
      expect(result.output).not.toContain("已用兼容方式提取")
    }),
  )

  it.live("损坏文件: 解析失败回灌错误信息", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "broken.docx"))
      expect(result.output).toContain("解析「broken.docx」失败")
      expect(result.metadata.error).toBe("parse-error")
    }),
  )

  // ——— SPEC-INS-016 v2:全量落盘 ———

  it.live("小文件: 内联全文**且**落盘(一式两份,不是二选一)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* runIn(dir, path.join(FIXTURES, "sample.docx"))

      expect(result.output).toContain("访谈纪要:用户反馈搜索入口太深。")
      expect(result.metadata.inlined).toBe(true)

      const saved = result.metadata.savedPath as string
      expect(saved).toBe(path.join(extractedDir(dir), "sample.md"))
      const onDisk = yield* Effect.promise(() => fs.readFile(saved, "utf8"))
      expect(onDisk).toContain("访谈纪要:用户反馈搜索入口太深。")
      expect(onDisk.split("\n")[0]).toMatch(/^<!-- source: .+sample\.docx \| chars: \d+ \| extracted: .+ -->$/)
    }),
  )

  it.live("大文件: 不回灌全文,只给路径 + 预览;落盘的是完整正文", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // 22,000 汉字 ≈ 66KB > 内联阈值(50KB * 0.8)
      const body = "用户反馈搜索入口太深。".repeat(2000)
      const src = yield* Effect.promise(() => seed(dir, "src/长访谈.txt", body))
      const result = yield* runIn(dir, src)

      expect(result.metadata.inlined).toBe(false)
      expect(result.output).toContain("正文过长,未直接返回")
      expect(result.output).toContain("用 grep 搜关键词")
      // 回灌里只有预览,不是全文
      expect(result.output.length).toBeLessThan(body.length / 2)

      const onDisk = yield* Effect.promise(() => fs.readFile(result.metadata.savedPath as string, "utf8"))
      // 落盘的是完整正文(折行只插换行,去掉后应与原文逐字相同)
      expect(onDisk.split("\n").slice(2).join("").trim()).toBe(body)
    }),
  )

  it.live("阈值边界: 45KB 正文仍内联(限额 50KB − 1KB 首部预算,不是旧的 ×0.8)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // 15,000 汉字 ≈ 45KB:落在旧阈值(40KB)与新阈值(49KB)之间——旧实现会把它推去落盘分支。
      const body = "用户反馈搜索入口太深。".repeat(1364)
      const src = yield* Effect.promise(() => seed(dir, "中等访谈.txt", body))
      const result = yield* runIn(dir, src)

      expect(result.metadata.inlined).toBe(true)
      expect(result.output).toContain(body.slice(-200))
      // 内联后总输出仍须低于通用兜底(50KB / 2000 行),否则等于又被盲切一刀
      expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(50 * 1024)
      expect(result.output.split("\n").length).toBeLessThanOrEqual(2000)
    }),
  )

  it.live("行数维度: 短行多的表格(xlsx 式 TSV)按行数走落盘,不看字节", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // 2500 行短记录 ≈ 30KB:字节远没超 50KB,行数已经越过 2000 − 8
      const body = Array.from({ length: 2500 }, (_, i) => `行${i}\t${i}`).join("\n")
      expect(Buffer.byteLength(body, "utf-8")).toBeLessThan(50 * 1024)
      const src = yield* Effect.promise(() => seed(dir, "表格.txt", body))
      const result = yield* runIn(dir, src)

      expect(result.metadata.inlined).toBe(false)
      expect(result.metadata.savedPath).toBeDefined()
    }),
  )

  it.live("落盘正文每行 ≤500 字符,优先切在句末标点后(read 的 2000 字符行截断会永久丢内容)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const withPunct = "用户反馈搜索入口太深。".repeat(2000)
      const noPunct = "甲".repeat(5000)
      const src = yield* Effect.promise(() => seed(dir, "wrap.txt", `${withPunct}\n${noPunct}`))
      const result = yield* runIn(dir, src)

      const onDisk = yield* Effect.promise(() => fs.readFile(result.metadata.savedPath as string, "utf8"))
      const lines = onDisk.split("\n").slice(2).filter(Boolean)
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(500)
      // 有标点的那半:切点落在句号之后
      expect(lines[0].endsWith("。")).toBe(true)
      // 无标点的那半:退化为硬切,正好 500
      expect(lines.some((l) => l.length === 500 && !l.includes("。"))).toBe(true)
    }),
  )

  it.live("同名不同源: 各留一份,不互相覆盖(否则模型会静默读到别的文件)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const a = yield* Effect.promise(() => seed(dir, "a/报告.txt", "甲方的访谈内容"))
      const b = yield* Effect.promise(() => seed(dir, "b/报告.txt", "乙方的访谈内容"))

      const first = yield* runIn(dir, a)
      const second = yield* runIn(dir, b)

      expect(first.metadata.savedPath).toBe(path.join(extractedDir(dir), "报告.md"))
      expect(second.metadata.savedPath).toBe(path.join(extractedDir(dir), "报告-2.md"))
      const kept = yield* Effect.promise(() => fs.readFile(first.metadata.savedPath as string, "utf8"))
      expect(kept).toContain("甲方的访谈内容")

      // 同源重复抽取则覆盖自己,不再堆新文件
      const again = yield* runIn(dir, a)
      expect(again.metadata.savedPath).toBe(first.metadata.savedPath)
    }),
  )

  it.live("落盘失败: 降级为整篇返回,不抛错、不丢功能", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // 把 extracted 落点占成**文件**,mkdir 必然失败
      const blocked = extractedDir(dir)
      yield* Effect.promise(() => fs.mkdir(path.dirname(blocked), { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(blocked, "occupied", "utf8"))

      const result = yield* runIn(dir, path.join(FIXTURES, "sample.docx"))
      expect(result.metadata.savedPath).toBeUndefined()
      expect(result.metadata.inlined).toBe(true)
      expect(result.output).toContain("全文未能保存到本地")
      expect(result.output).toContain("访谈纪要:用户反馈搜索入口太深。")
    }),
  )
})
