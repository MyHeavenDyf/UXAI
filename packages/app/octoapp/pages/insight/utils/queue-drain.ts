import type { TextPartInput } from "@opencode-ai/sdk/v2/client"
import { INSIGHT_AGENT } from "@/constants/agent"
import { Identifier } from "@/utils/id"
import type { useGlobalSDK } from "@/context/global-sdk"
import { buildChipDeclaration, buildChipTemplate, buildToolGate } from "../store/mcp-trigger"
import { getDesktopApi } from "../lib/electron-api"
import type { QueuedSend } from "./send-queue"

type GlobalSDK = ReturnType<typeof useGlobalSDK>

/**
 * 页面无关的排队项发送（SPEC-INS-027 §3.4）
 *
 * 全局 runner 在 insight 页面**可能已卸载**时调用它 drain 队列，故这里不碰任何页面态：
 * - 目录级 scoped client 由 `globalSDK.createClient({ directory })` 现建（directory 入队时已固化）；
 *   绝不能用不带 directory 的 client，否则 promptAsync 跑在 home 实例、事件落错 store（见 index.tsx 注释）。
 * - 只组 flush 需要的 parts 子集：干净文本 + chip 模板/声明 + @技能/@文件 synthetic；
 *   **不含附件/图片/optimistic**（排队项本就不带附件；optimistic 写的是 insight-scoped sync，
 *   页面没挂就没有——真实消息经全局 SSE 落库，用户切回 insight 时正常显示）。
 *
 * parts 顺序与 index.tsx doSendPrompt 对齐（cleanText → chip 模板 → chip 声明 → 技能块 → 文件块），
 * 使服务端 / InsightTurn 解析与手动发送同构。
 */
export async function sendQueuedItem(globalSDK: GlobalSDK, sessionID: string, item: QueuedSend): Promise<void> {
  const directory = item.directory
  if (!directory) {
    // 入队时未固化 directory（理论不该发生）——无法建 scoped client，跳过本次 drain，保留队列可见。
    console.warn("[octo:queue] drain skipped: missing directory", { sessionID })
    return
  }

  const client = globalSDK.createClient({ directory, throwOnError: true })
  const parts: TextPartInput[] = [{ type: "text", text: item.text }]

  // SPEC-INS-017 chip：模板 + 机器可读声明，均 synthetic（气泡不显、模型可见）
  if (item.chip) {
    parts.push({ type: "text", text: buildChipTemplate(item.chip.selection, item.text), synthetic: true })
    parts.push({ type: "text", text: buildChipDeclaration(item.chip.selection, item.text), synthetic: true })
  }

  // SPEC-INS-023 @技能：自读 SKILL.md 作 synthetic 注入；读不到只 console.warn（后台发送不弹 toast，
  // 避免用户在别的 tab 时收到无来由提示——与页面态 doSendPrompt 的 toast 分工）。
  if (item.skills?.length) {
    const api = getDesktopApi()
    for (const name of item.skills) {
      try {
        const res = await api?.getSkillContent?.(name)
        if (res?.success && res.content) {
          parts.push({ type: "text", text: `<skill_content name="${name}">\n${res.content}\n</skill_content>`, synthetic: true })
        } else {
          console.warn("[octo:queue] drain skill content missing, skip inject", { name, ok: res?.success })
        }
      } catch (err) {
        console.warn("[octo:queue] drain getSkillContent failed, skip inject", { name, err })
      }
    }
  }

  // SPEC-INS-023 @文件：引用清单 synthetic（与 doSendPrompt 同款文案，供模型按路径 extract_document 读取）
  if (item.files?.length) {
    parts.push({
      type: "text",
      synthetic: true,
      text: [
        "[引用文件] 用户本轮引用了以下已存在的会话文件,需要时用 extract_document 按路径读取:",
        ...item.files.map((f) => `- ${f.filename}: ${f.path}`),
      ].join("\n"),
    })
  }

  const messageID = Identifier.ascending("message")
  const tools = buildToolGate(item.chip?.selection.preset.expectedTool)
  console.log("[octo:queue] drain-send", {
    sessionID,
    directory,
    messageID,
    model: item.model,
    skills: item.skills?.length ?? 0,
    files: item.files?.length ?? 0,
    chip: item.chip?.selection.preset.id,
  })

  await client.session.promptAsync({
    sessionID,
    agent: INSIGHT_AGENT,
    model: item.model,
    parts,
    messageID,
    tools,
  })
}
