/**
 * Scan design-plan artifacts from session message stream.
 *
 * Source of truth: messages + parts. The design-plan artifact produced by the
 * agent lives inside assistant text parts. This module:
 *   1. Walks assistant messages in order
 *   2. Concatenates their text parts and parses artifact tags
 *   3. Picks the latest `text/design-plan` artifact
 *   4. Infers whether the plan has been confirmed by looking at later
 *      messages for `[confirm-plan <id>]` or any `text/html` artifact
 */

import type { Message } from "@opencode-ai/sdk/v2/client"
import type { OutputCard } from "../components/insight-turn"
import { createArtifactParser } from "./artifact-parser"

type TextPartLike = { type: string; text?: string }

/** Build a stable, unique tab ID for a design-plan artifact within a session. */
export function planTabId(sessionID: string, identifier: string): string {
  return `plan:${sessionID}:${identifier}`
}

/**
 * Extract the latest design-plan artifact from a session's message stream.
 * Returns null if no design-plan artifact exists yet.
 *
 * @param messages  The session's message list (sync.data.message[sessionID])
 * @param partStore  The part store keyed by messageID (sync.data.part)
 * @param sessionID  The sessionID used to build the stable tab ID
 */
export function scanDesignPlanFromMessages(
  messages: Message[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
  sessionID: string,
): OutputCard | null {
  if (!messages || messages.length === 0) return null

  let latest: OutputCard | null = null
  let latestCreatedAt: number = -1

  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const text = concatMessageText(partStore?.[msg.id])
    if (!text || !text.includes("<artifact")) continue

    const parser = createArtifactParser()
    let pendingStart: { identifier: string; title: string; createdAt: number } | null = null

    const handleEvent = (ev: import("./artifact-parser").ArtifactEvent) => {
      if (ev.type === "artifact:start") {
        // 识别 design-plan:type 严格匹配 text/design-plan;或 agent 把 type 写错时
        // (例如写成 markdown-document),只要 identifier 以 "plan-" 开头也视为方案 artifact。
        const isPlan =
          ev.artifactType === "text/design-plan" ||
          ev.identifier.startsWith("plan-")
        if (!isPlan) {
          pendingStart = null
          return
        }
        pendingStart = {
          identifier: ev.identifier,
          title: ev.title || "设计方案",
          createdAt: msg.time.created,
        }
      } else if (ev.type === "artifact:end" && pendingStart && ev.identifier === pendingStart.identifier) {
        // Later messages overwrite earlier ones — agent may iterate the plan
        // with the same identifier, in which case we want the newest version.
        if (pendingStart.createdAt >= latestCreatedAt) {
          latestCreatedAt = pendingStart.createdAt
          latest = {
            id: planTabId(sessionID, pendingStart.identifier),
            title: pendingStart.title,
            type: "design-plan",
            content: ev.fullContent,
            artifactIdentifier: pendingStart.identifier,
            createdAt: new Date(pendingStart.createdAt),
          }
        }
        pendingStart = null
      }
    }

    for (const ev of parser.feed(text)) handleEvent(ev)
    // flush picks up any artifact that ended at the buffer boundary
    for (const ev of parser.flush()) handleEvent(ev)
  }

  return latest
}

/**
 * Infer whether a plan has been confirmed.
 *
 * Heuristic: once we see the plan artifact, any later signal counts as
 * confirmation:
 *   - a user message containing `[confirm-plan <id>]` or `[confirm-plan]`
 *     (sent by the [确认开始生成] button)
 *   - an assistant message containing a `text/html` artifact (the agent
 *     moved on to generating the actual deliverable)
 *
 * HTML-artifact detection is intentionally restricted to assistant messages
 * — user prompts may quote `type="text/html"` as a literal string without
 * implying confirmation.
 */
export function isPlanConfirmed(
  messages: Message[] | undefined,
  partStore: Record<string, TextPartLike[] | undefined> | undefined,
  planIdentifier: string | undefined,
): boolean {
  if (!messages || !planIdentifier) return false

  let planSeen = false
  for (const msg of messages) {
    if (msg.role !== "assistant" && msg.role !== "user") continue
    const text = concatMessageText(partStore?.[msg.id])
    if (!text) continue

    if (!planSeen) {
      // 容错:agent 把 type 写错(例如写成 markdown-document)时,
      // 只要 identifier 匹配就视为 plan 已出现。
      if (text.includes(`identifier="${planIdentifier}"`)) {
        planSeen = true
      }
      continue
    }

    // After plan is seen, check this message for confirmation signals.
    if (msg.role === "user") {
      // User side: only the explicit [confirm-plan] command counts.
      // Avoids false positives from user quoting "text/html" as text.
      if (text.includes(`[confirm-plan ${planIdentifier}]`)) return true
      if (text.includes("[confirm-plan]")) return true
      continue
    }

    // Assistant side: any HTML artifact means the agent moved past planning.
    if (HTML_ARTIFACT_RE.test(text)) return true
  }
  return false
}

const HTML_ARTIFACT_RE = /<artifact\b[^>]*\btype\s*=\s*["']text\/html["']/

function concatMessageText(parts: TextPartLike[] | undefined): string {
  if (!parts || parts.length === 0) return ""
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n")
}
