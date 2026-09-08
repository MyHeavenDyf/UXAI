import { expect, test } from "bun:test"
import { parseModelsApi } from "@/plugin/model-headers"

test("normalizes array models from the remote catalog", () => {
  const catalog = parseModelsApi({
    content: {
      bpit: {
        id: "bpit",
        name: "BPIT",
        env: ["MODEL_API_KEY"],
        npm: "@ai-sdk/openai-compatible",
        api: "https://api.example.com/v1",
        models: [
          {
            id: "remote-only-model",
            name: "Remote only model",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: { context: 128_000, output: 16_000 },
          },
        ],
      },
    },
  })

  expect((catalog.bpit as Record<string, unknown>).models).toEqual({
    "remote-only-model": expect.objectContaining({
      id: "remote-only-model",
      name: "Remote only model",
      release_date: "",
    }),
  })
})
