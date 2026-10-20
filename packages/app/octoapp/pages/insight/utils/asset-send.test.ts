import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "typescript"
import { INSIGHT_AGENT } from "@/constants/agent"
import { Identifier } from "@/utils/id"
import { buildChipDeclaration, buildChipTemplate, buildToolGate } from "../store/mcp-trigger"
import { PRESET_PROMPTS } from "../store/preset-prompts"
import { formatUploadsForPrompt, formatMentionedFilesForPrompt, formatDispatchNote, parseUploadedFiles } from "../lib/upload"
import { assembleInsightParts, decideInlineStrategy, INLINE_BUDGET, SINGLE_DOC_LIMIT } from "./build-prompt-parts"
import { artifactTrackingExtra } from "./artifact-tracking"
import { currentAccount, currentUserId } from "./account"
import { formatPromptLocalDocuments, resolvePromptLocalDocuments } from "./prompt-local-files"
import { containsProductAssetPath, prepareAssetReferences } from "./asset-references"
import type { sendQueuedItem } from "./queue-drain"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// 执行真实发送函数，仅替换桌面和网络边界；避免导入整页 UI/Toast 的 JSX 运行环境。
function sender(api: { readFileBuffer: (path: string) => Promise<ArrayBuffer> }) {
  const toasts: unknown[] = []
  const dependencies = {
    INSIGHT_AGENT, Identifier, buildChipDeclaration, buildChipTemplate, buildToolGate,
    formatUploadsForPrompt, formatMentionedFilesForPrompt, formatDispatchNote,
    assembleInsightParts, decideInlineStrategy, INLINE_BUDGET, SINGLE_DOC_LIMIT,
    artifactTrackingExtra, currentAccount, currentUserId, formatPromptLocalDocuments, resolvePromptLocalDocuments,
    containsProductAssetPath, prepareAssetReferences, getDesktopApi: () => api, showToast: (toast: unknown) => toasts.push(toast),
  }
  const source = ts.createSourceFile("queue-drain.ts", readFileSync(new URL("./queue-drain.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "sendQueuedItem")!
  const code = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const send = new Function(...Object.keys(dependencies), `${code}; return sendQueuedItem`)(...Object.values(dependencies)) as typeof sendQueuedItem
  const sent: { sessionID: string; parts: ReturnType<typeof assembleInsightParts>["parts"]; tools?: Record<string, boolean> }[] = []
  const sdk = { createClient: () => ({ session: { promptAsync: async (input: typeof sent[number]) => { sent.push(input) } } }) } as unknown as Parameters<typeof sendQueuedItem>[0]
  return { dependencies, toasts, sent, send: (item: Parameters<typeof sendQueuedItem>[2]) => send(sdk, "asset-session", item) }
}

async function asset() {
  const directory = await mkdtemp(join(tmpdir(), "insight-asset-send-"))
  roots.push(directory)
  const token = "87654321-1234-4234-8234-123456789abc"
  const path = join(directory, ".octo", "asset-session", "uploads", `insight-asset-${token}`)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, "a.txt"), "interview")
  await writeFile(join(path, "b.txt"), "research")
  const reads: string[] = []
  const api = { readFileBuffer: async (path: string) => { reads.push(path); return Uint8Array.from(await readFile(path)).buffer } }
  return { directory, reads, api, reference: { filename: "interviews.zip", path, id: "asset-1", isFolder: true } }
}

describe("产品资产按地址发送", () => {
  test("普通发送与排队发送采用相同路径指令和显示元数据", async () => {
    const source = await asset()
    const queued = sender(source.api)
    const item = { directory: source.directory, text: "@interviews.zip 分析这份资产", files: [source.reference] }
    await queued.send(item)
    const input = ts.createSourceFile("index.tsx", readFileSync(new URL("../index.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let declaration: ts.FunctionDeclaration | undefined
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "doSendPrompt") declaration = node
      ts.forEachChild(node, visit)
    }
    visit(input)
    const parts: ReturnType<typeof assembleInsightParts>["parts"][] = []
    const stop = new Error("stop before optimistic UI and network")
    const dependencies = {
      ...queued.dependencies,
      projectDir: () => source.directory,
      globalSync: { data: { path: { home: undefined } } },
      assembleInsightParts: (value: Parameters<typeof assembleInsightParts>[0]) => { parts.push(assembleInsightParts(value).parts); throw stop },
    }
    const code = ts.transpileModule(declaration!.getText(input), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    const send = new Function(...Object.keys(dependencies), `${code}; return doSendPrompt`)(...Object.values(dependencies)) as (id: string, text: string, options: unknown) => Promise<void>
    await expect(send("asset-session", item.text, { consumeAttachments: false, source: "test", mentions: { skills: [], files: item.files } })).rejects.toBe(stop)
    expect(parts[0]).toEqual(queued.sent[0].parts)
    expect(source.reads).toHaveLength(0)
  })

  test("目录仅传地址，不读磁盘、不展开、不产生正文 FilePart", async () => {
    const source = await asset()
    const result = sender(source.api)
    await result.send({ directory: source.directory, text: "@interviews.zip 分析这份资产", files: [source.reference] })
    expect(result.sent).toHaveLength(1)
    const parts = result.sent[0].parts
    expect(parts).toEqual([{ type: "text", text: `读取${source.reference.path} 这个文件夹 分析这份资产`, metadata: { displayText: "@interviews.zip 分析这份资产", insightProductAssets: [source.reference] } }])
    expect(source.reads).toHaveLength(0)
  })

  test("大文本资产也只传文件地址，不自动内联或触发前端体量分治", async () => {
    const source = await asset()
    await writeFile(join(source.reference.path, "a.txt"), "a".repeat(INLINE_BUDGET + 1))
    const result = sender(source.api)
    const file = { filename: "a.txt", path: join(source.reference.path, "a.txt") }
    await result.send({ directory: source.directory, text: "@a.txt 分析", files: [file] })
    expect(result.sent[0].parts.filter(part => part.type === "file")).toHaveLength(0)
    expect(result.sent[0].parts.some(part => part.type === "text" && part.text.startsWith("[材料体量]"))).toBe(false)
    expect(source.reads).toHaveLength(0)
  })

  test("研究工具保留地址引用，提示目录先列文件再传绝对路径", async () => {
    const source = await asset()
    const result = sender(source.api)
    await result.send({ directory: source.directory, text: "@interviews.zip 分析这份资产", files: [source.reference], chip: { selection: { preset: PRESET_PROMPTS[0] } } })
    const request = result.sent[0]
    expect(request.tools?.["uxr-tool_key_findings"]).toBe(true)
    expect(request.parts.some(part => part.type === "text" && part.text.startsWith("[MCP声明]"))).toBe(true)
    expect(request.parts.some(part => part.type === "text" && part.text.includes("实际文件的完整绝对路径"))).toBe(true)
    expect(request.parts.some(part => part.type === "file")).toBe(false)
    expect(source.reads).toHaveLength(0)
  })

  test("只引用资产地址，发送不再依赖本地清单；普通文件引用照常内联", async () => {
    const source = await asset()
    const normal = { filename: "normal.txt", path: join(source.directory, "normal.txt") }
    await writeFile(normal.path, "ordinary reference")
    const result = sender(source.api)
    await result.send({ directory: source.directory, text: "@interviews.zip @normal.txt", files: [source.reference, normal] })
    expect(result.sent).toHaveLength(1)
    expect(source.reads).toEqual([normal.path])
    expect(result.sent[0].parts.filter(part => part.type === "file")).toHaveLength(1)
    const manifest = result.sent[0].parts.find(part => part.type === "text" && part.text.startsWith("[引用文件]"))
    expect(parseUploadedFiles(manifest?.type === "text" ? manifest.text : "")).toEqual([normal])
  })

  test("后续轮次不重新选择资产，研究工具仍允许历史资产绝对路径", async () => {
    const source = await asset()
    const result = sender(source.api)
    await result.send({ directory: source.directory, text: "@interviews.zip", files: [source.reference] })
    await result.send({ directory: source.directory, text: "分析刚才的资产", chip: { selection: { preset: PRESET_PROMPTS[0] } } })
    const template = result.sent[1].parts.find(part => part.type === "text" && part.text.startsWith("[MCP解析模式]"))
    expect(template?.type).toBe("text")
    if (template?.type !== "text") return
    expect(template.text).toContain("历史资产无需重新选择")
    expect(template.text).toContain("产品资产填实际文件的完整绝对路径")
    expect(template.text).toContain("普通附件和引用文件仍照抄清单文件名")
    expect(source.reads).toHaveLength(0)
  })
})
