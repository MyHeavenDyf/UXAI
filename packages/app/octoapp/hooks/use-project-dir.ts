import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"

export function useProjectDir() {
  const server = useServer()
  const globalSync = useGlobalSync()
  const params = useParams<{ dir?: string }>()

  return () => {
    if (params.dir) {
      const decoded = decode64(params.dir)
      if (decoded) return decoded
    }
    const last = server.projects.last()
    if (last && last !== "/" && !/^[A-Z]:\\?$/.test(last)) return last
    return globalSync.data.path.home
  }
}