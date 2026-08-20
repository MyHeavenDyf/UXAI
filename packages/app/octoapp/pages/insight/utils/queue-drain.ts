import { INSIGHT_AGENT } from "@/constants/agent"
import { Identifier } from "@/utils/id"
import type { useGlobalSDK } from "@/context/global-sdk"
import { buildChipDeclaration, buildChipTemplate, buildToolGate } from "../store/mcp-trigger"
import { getDesktopApi } from "../lib/electron-api"
import { formatUploadsForPrompt, formatMentionedFilesForPrompt, isImageFile } from "../lib/upload"
import { isPendingUploadPath } from "./worktree-layout"
import { assembleInsightParts } from "./build-prompt-parts"
import { currentAccount } from "./account"
import type { Attachment } from "../components/attachment-bar"
import type { QueuedSend } from "./send-queue"

type GlobalSDK = ReturnType<typeof useGlobalSDK>

/**
 * 入队时把**上传的附件**快照进队列项（SPEC-INS-027 §3.7）
 *
 * 附件属于「排队的这条消息」，不再留在共享附件栏靠 flush 时 consumeAttachments 顺手抓（那样多条排队会
 * 绑错、且 drain 迁到页面无关 runner 后页面栏根本读不到 → 文件丢失）。这里镜像 doSendPrompt 的附件解析
 * （done 分流 + 把还在 .octo/tmps 的 pending 上传搬进会话 uploads/），但**自包含、不碰 doSendPrompt**。
 *
 * 前置：调用方保证传入的都是 status==="done"（handleSubmit 有 hasUploadingAttachments 拦截，上传中不让入队）。
 */
export async function snapshotAttachmentsForQueue(
  done: Attachment[],
  sid: string | undefined,
  baseDir: string | undefined,
): Promise<{ uploads: Array<{ filename: string; path: string }>; images: Array<{ filename: string; url: string; mime?: string }> }> {
  const localFiles = done.filter((a) => !isImageFile(a.filename) && a.path)
  const imageFiles = done.filter((a) => isImageFile(a.filename) && a.url)

  // 把还落在预会话落地区（.octo/tmps/）的附件 rename 进真实会话目录（.octo/<sid>/uploads/）。
  // sid 入队时已知（busy 说明有会话）；失败不阻断，快照退化为指向预会话区的旧路径，仍可读。
  const movedPaths = new Map<string, string>()
  const api = getDesktopApi()
  if (sid && baseDir && typeof api?.movePendingUploadToSession === "function") {
    await Promise.all(
      localFiles
        .filter((a) => a.path && isPendingUploadPath(a.path))
        .map(async (a) => {
          try {
            movedPaths.set(a.id, await api.movePendingUploadToSession!(a.path!, baseDir, sid))
          } catch (err) {
            console.warn("[octo:queue] enqueue upload-move failed, keep pending path", { id: a.id, path: a.path, err })
          }
        }),
    )
  }

  return {
    uploads: localFiles.map((a) => ({ filename: a.filename, path: movedPaths.get(a.id) ?? a.path! })),
    images: imageFiles.map((a) => ({ filename: a.filename, url: a.url!, mime: a.mime })),
  }
}

/**
 * 页面无关的排队项发送（SPEC-INS-027 §3.4）
 *
 * 全局 runner 在 insight 页面**可能已卸载**时调用它 drain 队列，故不碰任何页面态：
 * - 目录级 scoped client 由 `globalSDK.createClient({ directory })` 现建（directory 入队时已固化）；
 *   绝不能用不带 directory 的 client，否则 promptAsync 跑在 home 实例、事件落错 store（见 index.tsx 注释）。
 * - 组 parts 走与正常发送共用的 `assembleInsightParts`（防两套漂移）；synthetic 文本（[附件]/chip/@技能/@文件）
 *   在此按序算好（技能读 SKILL.md 失败只 console.warn，不弹 toast——用户在别的 tab，无来由提示会困惑）。
 * - **不含 optimistic**（optimistic 写 insight-scoped sync，页面没挂就没有——真实消息经全局 SSE 落库，
 *   切回 insight 正常显示）。
 */
export async function sendQueuedItem(globalSDK: GlobalSDK, sessionID: string, item: QueuedSend): Promise<void> {
  const directory = item.directory
  if (!directory) {
    // 入队时未固化 directory（理论不该发生）——无法建 scoped client，跳过本次 drain，保留队列可见。
    console.warn("[octo:queue] drain skipped: missing directory", { sessionID })
    return
  }

  const syntheticTexts: string[] = []

  // [附件] 清单（synthetic）：与正常发送同款 formatUploadsForPrompt。必须排在 chip 模板之前
  // （InsightTurn 按 "[附件]" 头定位渲染文件卡片）。
  const uploadBlock = formatUploadsForPrompt(item.uploads ?? [])
  if (uploadBlock) syntheticTexts.push(uploadBlock)

  // SPEC-INS-017 chip：模板 + 机器可读声明
  if (item.chip) {
    syntheticTexts.push(buildChipTemplate(item.chip.selection, item.text))
    syntheticTexts.push(buildChipDeclaration(item.chip.selection, item.text))
  }

  // SPEC-INS-023 @技能：自读 SKILL.md 作 synthetic 注入；读不到只 console.warn（后台不弹 toast）
  // SPEC-INS-029：与 doSendPrompt 同口径——只把**注入成功**的技能名报进 extra.skills，供服务端发 skill.used。
  const injectedSkills: string[] = []
  if (item.skills?.length) {
    const api = getDesktopApi()
    for (const name of item.skills) {
      try {
        const res = await api?.getSkillContent?.(name)
        if (res?.success && res.content) {
          syntheticTexts.push(`<skill_content name="${name}">\n${res.content}\n</skill_content>`)
          injectedSkills.push(name)
        } else {
          console.warn("[octo:queue] drain skill content missing, skip inject", { name, ok: res?.success })
        }
      } catch (err) {
        console.warn("[octo:queue] drain getSkillContent failed, skip inject", { name, err })
      }
    }
  }

  // SPEC-INS-023 @文件：引用清单 synthetic（与 doSendPrompt 共用 formatMentionedFilesForPrompt，防两套文案漂移）
  if (item.files?.length) {
    syntheticTexts.push(formatMentionedFilesForPrompt(item.files))
  }

  const { parts } = assembleInsightParts({
    text: item.text,
    syntheticTexts,
    textInlineFiles: item.uploads ?? [],
    imageFiles: item.images ?? [],
  })

  const messageID = Identifier.ascending("message")
  const tools = buildToolGate(item.chip?.selection.preset.expectedTool)
  console.log("[octo:queue] drain-send", {
    sessionID,
    directory,
    messageID,
    model: item.model,
    skills: item.skills?.length ?? 0,
    files: item.files?.length ?? 0,
    uploads: item.uploads?.length ?? 0,
    images: item.images?.length ?? 0,
    chip: item.chip?.selection.preset.id,
  })

  const account = currentAccount()
  const promptExtra =
    injectedSkills.length || account
      ? { ...(injectedSkills.length ? { skills: injectedSkills } : {}), ...(account ? { account } : {}) }
      : undefined

  const client = globalSDK.createClient({ directory, throwOnError: true })
  await client.session.promptAsync({
    sessionID,
    agent: INSIGHT_AGENT,
    model: item.model,
    parts,
    messageID,
    tools,
    // extra 与即时发送(index.tsx doSendPrompt)保持同构，否则「busy 时排队发出的那条」会缺字段：
    //   - skills(SPEC-INS-029)：不带则技能用量统计缺一块。
    //   - account(SPEC-INS-030 §5)：不带则该轮 knowledge_search 拿不到工号、直接拒答。
    ...(promptExtra ? { extra: promptExtra } : {}),
  })
}
