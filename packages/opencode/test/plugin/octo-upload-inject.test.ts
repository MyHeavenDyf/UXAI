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
