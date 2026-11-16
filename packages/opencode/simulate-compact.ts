// 用真实埋点数据(compact_20261116-103623_no2_before.txt)模拟新压缩实现的效果
import { conversationWithin } from "./src/session/compaction"
import { MessageID, PartID, SessionID } from "./src/session/schema"
import { Token } from "@/util/token"
import type { MessageV2 } from "./src/session/message-v2"

const dump = await Bun.file("../../analysis/octo-compact-analysis/compact_20261116-103623_no2_before.txt").text()
const idx = dump.indexOf("===== MESSAGES PREPARED FOR THE AI =====")
const uiMsgs = JSON.parse(dump.slice(idx + "===== MESSAGES PREPARED FOR THE AI =====".length).trim())

// 还原 head = [user0, assistant1, user2](压缩标记消息 3/4 是 marker,不进摘要转写)
type DumpMsg = { role?: string; content?: Array<{ type?: string; text?: string }> }
const head: MessageV2.WithParts[] = (uiMsgs as DumpMsg[]).slice(0, 3).map((m) => {
  const id = MessageID.ascending()
  const sessionID = SessionID.descending()
  const parts = (m.content ?? []).map((c) => ({
    id: PartID.ascending(),
    messageID: id,
    sessionID,
    type: "text",
    text: c.text ?? "",
  }))
  return {
    info:
      m.role === "user"
        ? { id, role: "user", sessionID, agent: "build", model: { providerID: "w3", modelID: "GLM-V5.2" }, time: { created: 0 } }
        : {
            id,
            role: "assistant",
            sessionID,
            mode: "build",
            agent: "build",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "GLM-V5.2",
            providerID: "w3",
            parentID: MessageID.ascending(),
            time: { created: 0 },
            finish: "stop",
          },
    parts,
  } as MessageV2.WithParts
})

const FULL = head.map((m) => m.parts.map((p) => (p.type === "text" ? p.text.length : 0)).reduce((a, b) => a + b, 0))
console.log("=== 埋点数据还原(head 3 条消息)===")
head.forEach((m, i) => console.log(`msg${i} ${m.info.role}: ${m.parts.length} text parts, chars=${FULL[i]}`))
const fullText = conversationWithin(head, undefined).text!
console.log(`\n全文转写(含 skill 去重): ${fullText.length} chars ≈ ${Token.estimate(fullText)} tokens`)
console.log(`(对照 dump: tokens messages = 141150 —— 去重前口径;去重后应明显下降)`)

const FIXED_ESTIMATE = 500 // buildPrompt+SUMMARY_TEMPLATE 固定开销的近似值
for (const limit of [128_000, 200_000, 64_000]) {
  const budget = limit - Math.max(16_000, Math.floor(limit * 0.15)) - FIXED_ESTIMATE
  const built = conversationWithin(head, budget)
  const tokens = built.text ? Token.estimate(built.text) : undefined
  console.log(`\n=== 模型输入上限 ${limit} → 会话预算 ${budget} tokens ===`)
  console.log(`降级: ${built.degraded ? "是(user-only 裁剪或更狠)" : "否(全文放得下)"}`)
  console.log(`转写结果: ${built.text === undefined ? "undefined(快速失败,不发请求)" : `${built.text.length} chars ≈ ${tokens} tokens`}`)
  if (built.text !== undefined) {
    const dupRef = built.text.match(/duplicate content omitted/g)?.length ?? 0
    const omittedMark = built.text.match(/characters omitted/g)?.length ?? 0
    console.log(`skill 重复注入折叠为引用行: ${dupRef} 份`)
    console.log(`被裁剪的 text part: ${omittedMark} 个`)
    if (built.degraded) console.log(`--- 转写前 1200 字符预览 ---\n${built.text.slice(0, 1200)}`)
  }
}
