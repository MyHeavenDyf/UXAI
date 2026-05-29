import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"

const SESSIONS_DIR_NAME = "sessions"

export function octoSessionsDir(config: string): string {
  const octoConfig = config.replace(/opencode[/\\]?$/, "octo")
  const sep = octoConfig.includes("\\") ? "\\" : "/"
  const base = octoConfig.endsWith(sep) ? octoConfig.slice(0, -1) : octoConfig
  return base + sep + SESSIONS_DIR_NAME
}

export function useProjectDir(opts?: { mode?: "project" | "config" }) {
  const server = useServer()
  const globalSync = useGlobalSync()
  const params = useParams<{ dir?: string }>()
  const mode = opts?.mode ?? "project"

  return () => {
    if (mode === "config") {
      const config = globalSync.data.path.config
      return config ? octoSessionsDir(config) : ""
    }
    if (params.dir) {
      const decoded = decode64(params.dir)
      if (decoded) return decoded
    }
    const last = server.projects.last()
    if (last && last !== "/" && !/^[A-Z]:\\?$/.test(last)) return last
    return globalSync.data.path.home
  }
}