import { capabilityLabel } from "./data"
import { buildStudioDisplayPrompt, type StudioTurnData } from "./turns"

export function studioTurnAnchorID(turn: StudioTurnData) {
  if (turn.editorEntryID) return `editor:${turn.editorEntryID}`
  if (turn.result) return `generation:${turn.result.id}`
  return `turn:${turn.id}`
}

export function studioTurnAnchorText(turn: StudioTurnData) {
  const text = turn.hideUserBubble ? "" : turn.result?.displayPrompt?.trim() || turn.userText.trim()
  if (text) return buildStudioDisplayPrompt(text).replace(/\u200B/g, "").replace(/\s+/g, " ")
  if (turn.recommendation) return "提示词扩写"
  if (turn.editCapability) return capabilityLabel(turn.editCapability)
  return turn.result?.detailTitle?.trim() || (turn.result ? capabilityLabel(turn.result.capability) : "[附件]")
}
