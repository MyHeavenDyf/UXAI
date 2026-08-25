import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { OctoUploadInjectPlugin } from "../../src/agent/octo-upload-inject"

// octo-upload-inject 通用路径的早退顺序回归(2026-07-11 修复):
// endpoint 检查必须在「args 确实引用了清单文件」之后——否则外网(未配 OCTO_UPLOAD_ENDPOINT)
// 任何参数里出现文档扩展名结尾字符串的工具调用(read/bash 贴 .md 路径、write 落盘 .md 产物)
// 都会被误杀成「上传服务未配置」,并遮蔽后续的 external_directory 权限询问。

type BeforeHook = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: unknown },
) => Promise<void>

function userMessage(parts: string[]) {
  return { info: { role: "user" }, parts: parts.map((text) => ({ type: "text", text })) }
}

async function beforeHook(messages: unknown[]): Promise<BeforeHook> {
  const client = { session: { messages: async () => ({ data: messages }) } }
  const hooks = await OctoUploadInjectPlugin({ client } as never)
  return hooks["tool.execute.before"] as unknown as BeforeHook
}

const input = { tool: "read", sessionID: "ses_test", callID: "call_1" }
const MANIFEST = "[附件]\n- 访谈稿.docx: /tmp/uploads/访谈稿.docx"

const savedEndpoint = process.env.OCTO_UPLOAD_ENDPOINT

beforeEach(() => {
  delete process.env.OCTO_UPLOAD_ENDPOINT
})

afterEach(() => {
  if (savedEndpoint === undefined) delete process.env.OCTO_UPLOAD_ENDPOINT
  else process.env.OCTO_UPLOAD_ENDPOINT = savedEndpoint
})

describe("octo-upload-inject 早退顺序(endpoint 未配置时不误杀无关调用)", () => {
  test("会话无 [附件] 清单:read 贴 .md 路径原值放行,不抛「上传服务未配置」", async () => {
    const hook = await beforeHook([userMessage(["帮我读 /Users/x/octo_insight.md"])])
    const args = { filePath: "/Users/x/octo_insight.md" }
    await hook(input, { args })
    expect(args.filePath).toBe("/Users/x/octo_insight.md")
  })

  test("有清单但 args 未引用清单文件(贴外部路径):原值放行", async () => {
    const hook = await beforeHook([userMessage([MANIFEST])])
    const args = { command: "cat /Users/x/别的文件.md" }
    await hook({ ...input, tool: "bash" }, { args })
    expect(args.command).toBe("cat /Users/x/别的文件.md")
  })

  test("args 确实引用了清单文件且未配 endpoint:仍响亮失败(语义保持)", async () => {
    const hook = await beforeHook([userMessage([MANIFEST])])
    const args = { download_links: ["访谈稿.docx"] }
    await expect(hook({ ...input, tool: "uxr-tool_key_findings" }, { args })).rejects.toThrow(
      "上传服务未配置",
    )
  })

  test("extract_document 显式跳过:本地路径参数不被触碰", async () => {
    const hook = await beforeHook([userMessage([MANIFEST])])
    const args = { path: "/tmp/uploads/访谈稿.docx" }
    await hook({ ...input, tool: "extract_document" }, { args })
    expect(args.path).toBe("/tmp/uploads/访谈稿.docx")
  })
})

// 本地文件工具的 path/filePath 是本地磁盘目标,永不该被换成 S3 URL(回归:内网上传 md → 让其在
// 末尾追加,write 的 filePath 命中清单被替换成 S3 URL,octo-session-workdir 再把非绝对的 https://
// 串 join 进 outputs/,建目录时因路径含 URL 成分崩溃 makeDirectory .../outputs/https:/.../...)。
// 关键点:即便 endpoint 已配置(内网),这些工具也必须原值放行——由排除集早退,而非"没配 endpoint"的兜底。
describe("本地文件工具排除(write/edit/read 等不被换成 S3 URL)", () => {
  // 清单文件名 = 落盘目标常见形态:模型对上传文件做 write 时 filePath 常照抄文件名/完整路径。
  const LOCAL_MANIFEST = "[附件]\n- report.md: /tmp/uploads/report.md"

  beforeEach(() => {
    // 显式配好 endpoint:若排除失效,插件会走到 uploadLocalFile(fetch/readFile)→ 抛错,
    // 测试即失败;排除生效时应在 fetch 之前早退,filePath 原样。
    process.env.OCTO_UPLOAD_ENDPOINT = "https://upload.example.test/api"
  })

  test("write:filePath 命中清单文件名,仍原值放行(不被换成 S3 URL)", async () => {
    const hook = await beforeHook([userMessage([LOCAL_MANIFEST])])
    const args = { filePath: "report.md", content: "…【1234】" }
    await hook({ ...input, tool: "write" }, { args })
    expect(args.filePath).toBe("report.md")
  })

  test("write:filePath 命中清单完整路径,仍原值放行", async () => {
    const hook = await beforeHook([userMessage([LOCAL_MANIFEST])])
    const args = { filePath: "/tmp/uploads/report.md", content: "…【1234】" }
    await hook({ ...input, tool: "write" }, { args })
    expect(args.filePath).toBe("/tmp/uploads/report.md")
  })

  test.each(["edit", "apply_patch", "read", "glob", "grep"])(
    "%s:引用清单文件仍原值放行",
    async (tool) => {
      const hook = await beforeHook([userMessage([LOCAL_MANIFEST])])
      const args = { filePath: "report.md" }
      await hook({ ...input, tool }, { args })
      expect(args.filePath).toBe("report.md")
    },
  )
})

// `@` 引用的会话文件(SPEC-INS-023 `[引用文件]` 区块)与 `[附件]` 同属「可喂 MCP 的文件白名单」。
// 2026-08-20 内网回归:此前插件只认 `[附件]`,「先对话生成 md → `@` 它 → 选研究工具」必死。
// 判据用「抛的是哪个错」区分两种失败:
//   - "不在本会话的文件清单中" = 白名单没收录(本次要修的 bug)
//   - "上传服务未配置"        = 已收录、走到了上传步骤(测试环境没配 endpoint,属预期)
describe("[引用文件] 清单(@ 引用的会话文件)同样是 MCP 白名单", () => {
  // `@` 清单头行尾带中文说明(formatMentionedFilesForPrompt),parseManifest 只吃 "- " 开头的行 → 应被跳过
  const MENTION_MANIFEST =
    "[引用文件] 用户本轮 @ 引用了以下已存在的会话文件(与 [附件] 同属本会话可用文件;区别:正文未随内联):\n" +
    "- 用户问题需求记录.md: /tmp/ses_x/outputs/用户问题需求记录.md"
  const DECLARATION = '[MCP声明]\n{"tool":"uxr-tool_key_findings","outline_required":false,"user_prompt":"生成观点解析"}'

  test("通用路径:MCP 工具引用 @ 来的产物文件,已被收录(走到上传步骤而非判「不在清单」)", async () => {
    const hook = await beforeHook([userMessage([MENTION_MANIFEST])])
    const args = { download_links: ["用户问题需求记录.md"] }
    await expect(hook({ ...input, tool: "uxr-tool_key_findings" }, { args })).rejects.toThrow("上传服务未配置")
  })

  test("chip 声明路径:download_links 填 @ 来的产物文件名,resolvePath 命中", async () => {
    const hook = await beforeHook([userMessage([MENTION_MANIFEST, DECLARATION])])
    const args = { download_links: ["用户问题需求记录.md"] }
    await expect(hook({ ...input, tool: "uxr-tool_key_findings" }, { args })).rejects.toThrow("上传服务未配置")
  })

  test("chip 声明路径:清单外的文件名仍响亮失败(白名单语义不变)", async () => {
    const hook = await beforeHook([userMessage([MENTION_MANIFEST, DECLARATION])])
    const args = { download_links: ["不存在的文件.md"] }
    await expect(hook({ ...input, tool: "uxr-tool_key_findings" }, { args })).rejects.toThrow(
      "不在本会话的文件清单中",
    )
  })

  test("[附件] 与 [引用文件] 混用:两个区块的文件都进同一张白名单", async () => {
    const hook = await beforeHook([userMessage([MANIFEST]), userMessage([MENTION_MANIFEST, DECLARATION])])
    const args = { download_links: ["访谈稿.docx", "用户问题需求记录.md"] }
    await expect(hook({ ...input, tool: "uxr-tool_key_findings" }, { args })).rejects.toThrow("上传服务未配置")
  })

  test("清单头行尾的中文说明不被误解析成文件", async () => {
    const hook = await beforeHook([userMessage([MENTION_MANIFEST, DECLARATION])])
    // 说明行里含 "[附件]" 等字样,若被当成条目会污染白名单 → 用一个明显来自说明文案的串验证仍 miss
    const args = { download_links: ["正文未随内联"] }
    await expect(hook({ ...input, tool: "uxr-tool_key_findings" }, { args })).rejects.toThrow(
      "不在本会话的文件清单中",
    )
  })
})
