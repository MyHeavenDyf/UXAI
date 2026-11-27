import type { MiddlewareHandler } from "hono"
import { WithInstance } from "@/project/with-instance"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceID } from "@/control-plane/schema"
import { studioRequestTiming } from "@/server/studio-request-timing"

export function InstanceMiddleware(workspaceID?: WorkspaceID): MiddlewareHandler {
  return async (c, next) => {
    const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
    const directory = AppFileSystem.resolve(
      (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })(),
    )

    return WorkspaceContext.provide({
      workspaceID,
      async fn() {
        const timing = studioRequestTiming(c.req.raw)
        timing?.mark("instance_loading")
        return WithInstance.provide({
          directory,
          async fn() {
            timing?.mark("instance_ready")
            return next()
          },
        })
      },
    })
  }
}
