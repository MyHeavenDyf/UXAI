import { Effect, Schema } from "effect"
import { basename } from "node:path"
import { access } from "node:fs/promises"
import * as Tool from "./tool"

// extract_document —— 把本地 office 文档(docx/xlsx/pdf)抽取成文本,供 insight 本地模型直接读。
// SPEC-INS-015 文件传参路由 ②(office → 模型读):模型按提示词在需要读 office 正文时调本工具、
// 参数填 [附件] 清单里的**本地路径**;txt/md 不走此路(① 由 opencode 组 prompt 时自动内联)。
//
// ⚠️ 当前为**接线占位**:整体路由 / agent / 提示词已按"本工具已存在"接好(SPEC-INS-015 D1),
//   但 office→文本的**抽取实现属 Spec B**,尚未落地。本工具暂返回明确占位说明,让链路可端到端跑通、
//   不至于因"工具不存在"硬报错;Spec B 落地后只替换下方 execute 内的抽取逻辑,接线无需再动。

const DESCRIPTION =
  "把本地 office 文档(docx/xlsx/pdf)抽取成纯文本,用于阅读其正文内容。" +
  "参数 path 填 [附件] 清单里该文件的本地路径(冒号后那串)。" +
  "txt / md 无需调用本工具(正文已自动内联);图片也无需(可直接看)。"

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({ description: "要抽取的本地文档绝对路径(取自 [附件] 清单冒号后那串)" }),
})

export const ExtractDocumentTool = Tool.define(
  "extract_document",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const path = params.path
          // ⚠️ 用 node:fs 判存在、不用 Bun.file:桌面端 sidecar 是 Node 子进程,Bun.* 不存在。
          const exists = yield* Effect.tryPromise(() => access(path)).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
          console.log("[octo:extract] called (stub, 抽取待 Spec B)", { path, exists })
          // TODO(Spec B):此处接 office→文本抽取(docx/xlsx/pdf),返回正文(顺带字数)。
          const note = exists
            ? `文档抽取能力尚未实现(Spec B),暂时无法读取「${basename(path)}」的正文。` +
              `如需对该文件做用研分析,请改用 MCP 分析工具(文件参数填文件名,系统会按需上传)。`
            : `未找到文件:${path}。请确认路径取自 [附件] 清单冒号后那串。`
          return {
            title: `extract_document: ${basename(path)}`,
            output: note,
            metadata: { path, exists, implemented: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
