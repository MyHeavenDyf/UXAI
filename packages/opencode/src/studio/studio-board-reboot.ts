import z from "zod"
import type { ImageGenerationQuery } from "./image-provider"

const executions = z.object({
  result: z
    .object({
      results_v2: z
        .array(
          z.object({
            execution_id: z.string().optional(),
            status: z.number().optional(),
            timestamp: z.object({ start: z.number().optional() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

export function boardRebootBaseline(query: ImageGenerationQuery) {
  return {
    capturedAt: Date.now(),
    executions: executions.safeParse(query.raw).data?.result?.results_v2 ?? [],
  }
}

export function boardRebootFailedAgain(
  query: ImageGenerationQuery,
  baseline: ReturnType<typeof boardRebootBaseline> | null,
) {
  if (!baseline || query.status !== "failed") return false
  return (executions.safeParse(query.raw).data?.result?.results_v2 ?? []).some((execution) => {
    if (execution.status === undefined || [0, 1, 2, 6].includes(execution.status)) return false
    const start = execution.timestamp?.start
    const afterSnapshot = start !== undefined && (start < 1e12 ? start * 1000 : start) > baseline.capturedAt
    const previous = baseline.executions.find((item) =>
      execution.execution_id ? item.execution_id === execution.execution_id : item.timestamp?.start === start,
    )
    if (previous) return afterSnapshot && previous.timestamp?.start !== undefined && start !== previous.timestamp.start
    if (execution.execution_id && baseline.executions.some((item) => item.execution_id)) return true
    // Without an old execution ID, only a provider start time after our snapshot proves a new run.
    return afterSnapshot
  })
}

export * as StudioBoardReboot from "./studio-board-reboot"
