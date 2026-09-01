import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk/v2/client"
import { encodeFilePath } from "../../../context/file/path"
import { isExtractableDocFile, isTextInlineFile } from "../lib/upload"

/**
 * insight prompt parts 组装骨架（SPEC-INS-027 / SPEC-INS-032 v2）
 *
 * 把「文本 → synthetic 文本块 → txt/md FilePart → 图片 vision FilePart」这段**顺序 + FilePart 映射**
 * 抽成页面无关的纯函数，由正常发送（doSendPrompt）与排队 drain（sendQueuedItem）共用，避免两套漂移。
 *
 * 只负责**组装**：synthetic 文本串（[附件]清单 / chip 模板声明 / @技能 / @文件引用）由调用方各自算好按序传入
 * （技能内容读取的错误处理正常/后台不同，故留在调用方）；本函数只把它们按既定顺序拼成 parts。
 *
 * 顺序契约（与既有 doSendPrompt 一致，勿改）：
 *   cleanText → syntheticTexts（按传入顺序，均 synthetic）→ txt/md FilePart → 图片 FilePart
 * 注意 [附件] 清单必须排在 chip 模板之前（InsightTurn 按 "[附件]" 头定位渲染文件卡片），
 * 这个「谁在前」由调用方组 syntheticTexts 时保证。
 */

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-INS-032 §2.5：内联分层阈值
//
// 三个数字都不是魔法值，写成带推导的常量，换模型只改 MODEL_CTX_TOKENS 一个输入。
// 完整推导与刷新步骤见 spec §2.5，这里只留复算所需的算式。
//
// 换算口径（中文，保守取值）：UTF-8 3 字节/字；1 token/字（实测区间 0.6–1.5，取 1 是
// 往「更容易超」的方向保守）⇒ 1KB ≈ 341 token，50KB ≈ 1.7 万 token。
// ─────────────────────────────────────────────────────────────────────────────

/** 内网当前模型的上下文窗口。**换模型时唯一需要手改的输入。** */
export const MODEL_CTX_TOKENS = 100_000

/**
 * 内联预算：本轮可内联文本文件的**总字节**超过它，就整批转子代理分治。
 *
 * 取值依据是**用途**而不是「父代理还能塞多少」：内联的全部价值是「一份随手贴的小材料，
 * 一轮直接答，省掉一整轮子代理往返」；超过 1 万汉字的东西已经是研究材料，本来就该走
 * 通读流程，**哪怕窗口变大也一样**。故它不跟 MODEL_CTX_TOKENS 线性缩放。
 *
 * 只需满足一条来自窗口的上界约束（是要满足，不是要取满）：
 *   INLINE_BUDGET ≤ MODEL_CTX_TOKENS × 0.15
 *   32KB ≈ 11_000 token ≤ 100_000 × 0.15 = 15_000 ✓
 */
export const INLINE_BUDGET = 32 * 1024

/**
 * 单份上界：**分治不扩容**——子代理与父代理跑同一个模型、同一个窗口，超过这个体量
 * 派子代理也读不完，只能响亮失败让用户拆分（spec §2.4）。
 *
 * 跟 MODEL_CTX_TOKENS 线性缩放，换模型后按此式重算并向下取到 50KB 的整数倍
 * （对齐 read 分页，让「几次 read 读完」是整数）：
 *   正文预算 = (MODEL_CTX_TOKENS - 固定开销 5_000 - 产出预留 10_000) × 安全系数 0.6
 *           = (100_000 - 5_000 - 10_000) × 0.6 ≈ 51_000 token ≈ 51_000 汉字 ≈ 153KB
 *   → 150KB（恰好 3 次 read）
 * 固定开销 = insight_reader 系统提示 + 工具定义 + 任务描述；产出预留 = 结论输出 +
 * 「边读边记」的中间要点；安全系数 0.6 是因为长上下文尾部召回质量会下降，不用满窗口。
 */
export const SINGLE_DOC_LIMIT = 150 * 1024

/** 上游 read 工具的单次上限（read.ts DEFAULT_READ_LIMIT / MAX_BYTES），仅供文案换算，**不由本仓设定** */
export const UPSTREAM_READ_CAP_BYTES = 50 * 1024

/**
 * **份数口径**(SPEC-INS-032 §2.6):office / pdf 达到这个份数就整批转分治。
 *
 * 为什么这类不用字节预算:发送前只有二进制大小,拿不到正文体量 —— docx 是压缩容器,
 * 压缩比不定(还可能整份都是嵌图),按它反推文本量是引入一个不准的估算。
 *
 * 为什么份数是**同一种判断**而不是降级代理:INLINE_BUDGET 的立论本来就不是「父代理还能塞多少」,
 * 而是**用途**(见其注释:超过 1 万汉字的东西已经是研究材料,本来就该走通读流程)。同理,
 * 用户一次给 ≥3 份文档,他嘴里说的就是「这批材料」,语义上已经是通读流程。
 *
 * 取 3:1 份 = 单篇分析,2 份 = 两篇对比,父代理自己读都在能力内且更快;3 份起才值得付子代理的往返成本。
 */
export const DOC_COUNT_THRESHOLD = 3

/**
 * **单份兜底**:任一 office / pdf 的二进制大小超过它也整批转分治。
 *
 * 单向门槛 —— 大 ⇒ 一定分治;小 ⇏ 不用分治(份数那条仍可能命中)。所以它不需要准,
 * 只需要「过了这个线就不可能是随手贴的小材料」。2MB 的 docx 若是纯文本,解压后是数百万字;
 * 若整份是嵌图,则正文可能很少 —— 后者会被误判成要分治,**代价只是多跑一轮子代理,结果照样对**。
 *
 * 两类误判的代价不对称,这是取值偏保守的依据:
 *   · 该内联的判成要分治 → 慢一点、多花点 token
 *   · 该分治的判成不用分治 → 父上下文爆 → 静默丢材料 → 报告基于半份材料且不报错
 */
export const DOC_SINGLE_BYTES = 2 * 1024 * 1024

export type InlineFileInput = {
  filename: string
  path: string
  /** UTF-8 字节数。附件取 Attachment.size；`@` 引用的会话文件由调用方用 api.readFileBuffer 补。
   *  未知时按 0 计入总量并记进 unknownCount（读不到的文件服务端 read 同样会失败，本就进不了上下文）*/
  bytes?: number
}

/** 本轮文本材料的内联判定结果（SPEC-INS-032 §2.3.2） */
export interface InlineDecision {
  /** inline = 维持内联（行为与 v2 之前一致）；dispatch = 整批不内联，交父代理派子代理通读 */
  mode: "inline" | "dispatch"
  /** 参与判定的文件（已按 isTextInlineFile 过滤、按 path 去重） */
  files: Array<{ filename: string; path: string; bytes: number }>
  /** files 的字节总和 */
  totalBytes: number
  /** 单份超 SINGLE_DOC_LIMIT：**仍然派子代理**，只是子代理会拿到 extract_document 的切段清单
   *  按段读（SPEC-INS-032 §2.4 v3：它是**切段阈值**，不再是拒绝阈值） */
  oversized: Array<{ filename: string; path: string; bytes: number }>
  /** 走 extract_document 的文档类（office / pdf）。按**份数**而非字节参与判定，见 DOC_COUNT_THRESHOLD */
  docs: Array<{ filename: string; path: string; bytes: number }>
  /** 单份二进制超 DOC_SINGLE_BYTES 的文档类（单向兜底，仅供文案与日志） */
  largeDocs: Array<{ filename: string; path: string; bytes: number }>
  /** 命中了哪几条判据（供日志排查「为什么这轮分治了 / 没分治」） */
  reasons: Array<"text-budget" | "doc-count" | "doc-size">
  /** 拿不到字节数的份数（降级路径，按 0 计入，仅供日志） */
  unknownCount: number
}

/**
 * SPEC-INS-032 §2.3.2：**发送前**按总字节确定性分层，不交给模型判断。
 *
 * 独立导出而不是揉进 assembleInsightParts，是因为调用方需要先拿到判定结果才能组
 * `[附件]` 清单的体量说明（formatUploadsForPrompt 的第二参），顺序上必须在组装之前。
 */
export function decideInlineStrategy(input?: InlineFileInput[]): InlineDecision {
  const seenPaths = new Set<string>()
  const files: InlineDecision["files"] = []
  const docs: InlineDecision["docs"] = []
  let unknownCount = 0

  for (const f of input ?? []) {
    // 同一文件既是本轮附件、又被 `@` 引用时只算一次（与下方组装的去重口径一致）
    if (seenPaths.has(f.path)) continue

    // 文档类（office / pdf）走**份数**口径：发送前只有二进制大小、拿不到正文体量，不并入字节预算。
    if (isExtractableDocFile(f.filename)) {
      seenPaths.add(f.path)
      docs.push({ filename: f.filename, path: f.path, bytes: f.bytes ?? 0 })
      continue
    }
    // 图片走 vision，两个口径都不参与
    if (!isTextInlineFile(f.filename)) continue

    seenPaths.add(f.path)
    if (f.bytes == null) unknownCount++
    files.push({ filename: f.filename, path: f.path, bytes: f.bytes ?? 0 })
  }

  const oversized = files.filter((f) => f.bytes > SINGLE_DOC_LIMIT)
  const largeDocs = docs.filter((f) => f.bytes > DOC_SINGLE_BYTES)
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0)

  // 三条判据**取或**，命中任一条就整批 dispatch（文本 + 文档一起交给子代理）。「整批」与 §2.3.2
  // 已定的口径一致：不做「大的分治 + 小的仍内联」，否则父代理要记「哪几份我看过、哪几份还要派活」，
  // 弱模型容易漏派或重复派。
  // 注意：oversized 的字节同样计入 totalBytes——有超大件时必然 > INLINE_BUDGET 而落到 dispatch。
  const reasons: InlineDecision["reasons"] = []
  if (totalBytes > INLINE_BUDGET) reasons.push("text-budget")
  if (docs.length >= DOC_COUNT_THRESHOLD) reasons.push("doc-count")
  if (largeDocs.length > 0) reasons.push("doc-size")

  return {
    mode: reasons.length > 0 ? "dispatch" : "inline",
    files,
    totalBytes,
    oversized,
    docs,
    largeDocs,
    reasons,
    unknownCount,
  }
}

export interface AssembleInsightPartsInput {
  text: string
  /** 有序 synthetic 文本块（[附件]清单 / chipTemplate / chipDeclaration / <skill_content> / [引用文件]…），均已算好 */
  syntheticTexts?: string[]
  /** 可内联文件（本地 path；附件栏文件 + `@` 引用的会话文件合并后传入）→ FilePart(file://, text/plain)，
   *  opencode 组 prompt 时自动 Read 内联正文。非文本类由 isTextInlineFile 反向排除，重复 path 只取一次 */
  textInlineFiles?: InlineFileInput[]
  /** 图片（S3 url）→ vision FilePart{url}，交多模态模型看 */
  imageFiles?: Array<{ filename: string; mime?: string; url: string }>
  /** decideInlineStrategy 的结果。不传则内部按同一批文件现算（两个调用方都会传，留默认是为了单测好写） */
  inlineDecision?: InlineDecision
}

export interface AssembledInsightParts {
  /** 发送用完整 parts */
  parts: Array<TextPartInput | FilePartInput>
  /** 图片 FilePart（供调用方做 optimistic 镜像，避免重复映射） */
  imageParts: FilePartInput[]
  /** 本轮的内联判定（调用方据此打点 / 提示，与实际产出的 FilePart 严格一致） */
  inlineDecision: InlineDecision
}

export function assembleInsightParts(input: AssembleInsightPartsInput): AssembledInsightParts {
  const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: input.text }]
  const inlineDecision = input.inlineDecision ?? decideInlineStrategy(input.textInlineFiles)

  for (const t of input.syntheticTexts ?? []) {
    if (t) parts.push({ type: "text", text: t, synthetic: true })
  }

  // ① 可内联文件 → FilePart(file://, text/plain)，服务端组 prompt 时调 `read` 把正文读进上下文。
  // office / pdf / 图片由 isTextInlineFile 反向排除（各自走 extract_document / vision）。
  // 来源含**附件栏文件 + `@` 引用的会话文件**（SPEC-INS-023 §7.2，2026-08-20 起两者一致），
  // 故 decideInlineStrategy 已按 path 去重：同一文件既是本轮附件、又被 `@` 引用时只内联一次。
  //
  // SPEC-INS-032 §2.3：**总字节超预算时一个 FilePart 都不产**——服务端把 text/plain 的
  // FilePart 翻成一次 `read`，而 read 有 2000 行 / 50KB 上限，多份累加既撞窗口、单份还会被
  // 静默截断（拿到半份材料却不报错）。超预算改由父代理逐份派 insight_reader 子代理通读，
  // 每份在自己的上下文窗口里读完、只回结论。
  if (inlineDecision.mode === "inline") {
    for (const f of inlineDecision.files) {
      parts.push({ type: "file", mime: "text/plain", url: `file://${encodeFilePath(f.path)}`, filename: f.filename })
    }
  }

  // ③ 图片 → vision FilePart{url:S3}（非多模态由 opencode stripMedia 换占位）
  const imageParts: FilePartInput[] = (input.imageFiles ?? []).map((a) => ({
    type: "file" as const,
    mime: a.mime || "image/png",
    url: a.url,
    filename: a.filename,
  }))
  parts.push(...imageParts)

  return { parts, imageParts, inlineDecision }
}
