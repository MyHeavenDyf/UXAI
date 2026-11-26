import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  "bpit-beta",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      if (projectStore.provider_ready) return projectStore.provider
    }
    return globalSync.data.provider
  }
  const all = () => providers().all
  return {
    all,
    default: () => providers().default,
    popular: () => all().filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return all().filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return all().filter((p) => connected.has(p.id))
    },
  }
}
