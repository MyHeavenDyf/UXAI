import { logRecommendationFailure, recommendationLogIDs } from "./prompt-recommendation-log"
import { configureModelsApiHeaders } from "@/plugin/model-headers"
import {
  initializeRecommendation,
  submitExpansion,
  getRecommendationState,
  cancelExpansion,
  dismissRecommendation,
} from "./prompt-recommendation"
import { acquireBudget, createPreparation, MAX_BODY, readRecommendationBody } from "./prompt-recommendation-budget"
import { RecommendationError, safeError } from "./prompt-recommendation-schema"
import type { ExpansionServices } from "./prompt-expansion"

// Both HTTP stacks use this adapter before their automatic JSON decoders.
export async function recommendationRequest(
  request: Request,
  action: "initialize" | "submit" | "state" | "cancel" | "dismiss",
  target?: { sessionID: string; assistantMessageID?: string; guidePartID?: string },
  services?: ExpansionServices,
) {
  const startedAt = Date.now()
  const context: Record<string, string | number | boolean | undefined> = {
    action,
    sessionID: target?.sessionID,
    assistantMessageID: target?.assistantMessageID,
    guidePartID: target?.guidePartID,
    stage: action === "state" || action === "cancel" ? action : "read-request",
  }
  try {
    if (action === "state")
      return Response.json(
        await getRecommendationState(
          target!.sessionID,
          new URL(request.url).searchParams.get("guidePartID") ?? undefined,
        ),
      )
    if (action === "dismiss") return Response.json(dismissRecommendation(target!.sessionID, target!.guidePartID!))
    if (action === "cancel") return Response.json(await cancelExpansion(target!.sessionID, target!.assistantMessageID!))
    const release = acquireBudget("request")
    const preparation = createPreparation(request.signal)
    try {
      if (!request.body) throw new RecommendationError("INVALID_INPUT")
      if ((Number(request.headers.get("content-length")) || 0) > MAX_BODY)
        throw new RecommendationError("PAYLOAD_TOO_LARGE", 413)
      const reader = request.body.getReader()
      const abort = () => {
        void reader.cancel().catch(() => {})
      }
      preparation.signal.addEventListener("abort", abort, { once: true })
      if (preparation.signal.aborted) abort()
      const chunks = async function* () {
        while (true) {
          const chunk = await reader.read()
          preparation.check()
          if (chunk.done) return
          yield chunk.value
        }
      }
      const value = await readRecommendationBody(chunks(), preparation.signal).finally(() => {
        preparation.signal.removeEventListener("abort", abort)
        void reader.cancel().catch(() => {})
      })
      Object.assign(context, recommendationLogIDs(value), { stage: action })
      preparation.check()
      if (action === "initialize") return Response.json(await initializeRecommendation(value, preparation))
      configureModelsApiHeaders(Object.fromEntries(request.headers.entries()))
      return Response.json(await submitExpansion(value, services, preparation), { status: 202 })
    } catch (error) {
      preparation.check()
      throw error
    } finally {
      preparation.dispose()
      release()
    }
  } catch (error) {
    const safe = error instanceof SyntaxError ? new RecommendationError("INVALID_INPUT") : safeError(error)
    logRecommendationFailure(error, {
      ...context,
      code: safe.code,
      status: safe.status,
      elapsedMs: Date.now() - startedAt,
      cancelled: request.signal.aborted,
    })
    return Response.json(safe.body(), { status: safe.status })
  }
}
