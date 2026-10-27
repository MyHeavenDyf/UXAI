import { expect, test } from "bun:test"
import { recommendationRequest } from "@/studio/prompt-recommendation-http"
import { acquireBudget } from "@/studio/prompt-recommendation-budget"

test("a stalled JSON body times out explicitly and releases its reader and admission permit", async () => {
  let cancelled = false
  const response = await recommendationRequest(
    new Request("http://localhost/studio/prompt-expansions", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true
        },
      }),
    }),
    "submit",
  )
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ data: { code: "PREPARATION_TIMEOUT" } })
  expect(cancelled).toBe(true)
  const release = Array.from({ length: 4 }, () => acquireBudget("request"))
  release.forEach((done) => done())
}, 40_000)
