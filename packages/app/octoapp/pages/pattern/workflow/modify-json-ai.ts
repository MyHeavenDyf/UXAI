import proto_triage from "../agents/proto-triage"
import proto_modify from "../agents/proto-modify/index"
import { mergeModules } from "../agents/merge"
import { saveDebugSnapshot } from "../utils/debug-log"
import { loadCurrentPatternState } from "../utils/version-history"
import { withAgentError } from "../utils/error-msg"

type ProtoModifyJsonInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  extra?: Record<string, unknown>
  onSessionCreated?: (childSessionID: string) => void
  refreshPreview?: () => void
  fileParts?: { type: "file"; mime: string; filename: string; url: string }[]
}

type LastDataInput = {
  lastIntent: any
  lastPlanner: any
  lastModules: any
}

export default async function modify_json_ai(
  inputCtx: ProtoModifyJsonInput,
  lastData: LastDataInput,
  onFinshed: (finalJson: any) => Promise<void>,
) {
  const lastPlanner = lastData.lastPlanner
  const lastModules = lastData.lastModules
  const historyDir = `${inputCtx.sdk.directory}/.octo/design/history`

  const triage = await withAgentError("proto_triage", () => proto_triage({ ...inputCtx, ...lastData }))
  void saveDebugSnapshot(historyDir, inputCtx.rootSession, "modify_triage")

  if (triage.routing === "chat") return { routing: "chat" as const, reply: triage.reply }
  if (triage.routing !== "modify") return {}

  const enrichedInput = triage.attachment_description
    ? `[参考内容]: ${triage.attachment_description}\n[用户需求]: ${inputCtx.userInput}`
    : inputCtx.userInput

  const state = await loadCurrentPatternState(historyDir, inputCtx.rootSession)
  const currentPage: Record<string, unknown> = (state?.mergedA2UI as Record<string, unknown> | undefined)
    ?? (lastModules.length === 1
      ? lastModules[0] as Record<string, unknown>
      : mergeModules(
          { rootId: lastPlanner.rootId, elements: lastPlanner.elements },
          lastModules,
          (lastPlanner.slots ?? lastPlanner.layout_planner?.slots ?? []) as Array<{ section_id: string; element_id: string }>,
        )) as unknown as Record<string, unknown>

  const triageOps = [
    ...triage.delete.map((d) => ({ element_id: d.element_id, action: d.action })),
    ...triage.add.map((a) => ({ element_id: "", action: a.action })),
    ...triage.modify.map((m) => ({ element_id: m.element_id, action: m.action })),
  ]

  const modifyResult = await withAgentError("proto_modify", () => proto_modify({
    sdk: inputCtx.sdk,
    sync: inputCtx.sync,
    modelKey: inputCtx.modelKey,
    rootSession: inputCtx.rootSession,
    userInput: inputCtx.userInput,
    extra: inputCtx.extra,
    onSessionCreated: inputCtx.onSessionCreated,
    input: {
      ui_json_str: currentPage,
      audit_feedback: enrichedInput,
      triage_ops: triageOps,
      idPrefix: "",
      sectionId: "",
      originModules: {},
      modifications: {},
      intentDescription: undefined,
    },
  }))

  void saveDebugSnapshot(historyDir, inputCtx.rootSession, "modify")

  const result = modifyResult.ui_json as Record<string, unknown>

  await onFinshed({
    pageIntent: null,
    layoutPlanner: modifyResult.ui_json as unknown as Record<string, unknown>,
    modulesJson: [modifyResult.ui_json],
    pageJson: result,
  })
}
