import { createRoot } from "solid-js"
import { createPromptRecommendation } from "./studio-prompt-recommendation"

type RecommendationInput = Parameters<typeof createPromptRecommendation>[0]

export function mountRecommendation(input: Pick<RecommendationInput, "request"> & Partial<RecommendationInput>) {
  const scope = crypto.randomUUID()
  return createRoot((dispose) => ({
    dispose,
    api: createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      uploadImage: async () => ({ path: "/uploaded" }),
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
      ...input,
    }),
  }))
}
