import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
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

const run = Effect.fn("ExtractDocumentTest.run")(function* (file: string) {
  const dir = yield* tmpdirScoped()
  const info = yield* ExtractDocumentTool
  const tool = yield* info.init()
  return yield* provideInstance(dir)(tool.execute({ path: file }, ctx))
})

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

  it.live("损坏文件: 解析失败回灌错误信息", () =>
    Effect.gen(function* () {
      const result = yield* run(path.join(FIXTURES, "broken.docx"))
      expect(result.output).toContain("解析「broken.docx」失败")
      expect(result.metadata.error).toBe("parse-error")
    }),
  )
})
