import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { isValidUserPath } from "@/utils/path-valid"

const SESSIONS_DIR_NAME = "sessions"

export function octoSessionsDir(config: string): string {
  const octoConfig = config.replace(/opencode[/\\]?$/, "octo")
  const sep = octoConfig.includes("\\") ? "\\" : "/"
  const base = octoConfig.endsWith(sep) ? octoConfig.slice(0, -1) : octoConfig
  return base + sep + SESSIONS_DIR_NAME
}

export function useProjectDir(opts?: {
  mode?: (() => "project" | "config" | "chat") | "project" | "config" | "chat"
}) {
  const server = useServer()
  const globalSync = useGlobalSync()
  const params = useParams<{ dir?: string }>()
  const modeFn = typeof opts?.mode === "function" ? opts.mode : () => opts?.mode ?? "project"

  return () => {
    const mode = modeFn()
    if (mode === "config") {
      const config = globalSync.data.path.config
      return config ? octoSessionsDir(config) : ""
    }
    if (mode !== "chat") {
      if (params.dir) {
        const decoded = decode64(params.dir)
        if (decoded && isValidUserPath(decoded)) return decoded
      }
      const last = server.projects.last()
      if (last && isValidUserPath(last)) return last
    }
    const home = globalSync.data.path.home
    if (home && isValidUserPath(home)) return home
    return ""
  }
}