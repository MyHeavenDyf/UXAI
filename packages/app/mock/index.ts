import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import * as pipeline from "./handlers/pipeline/index.js"
import * as tracker from "./handlers/tracker/index.js"
import { infoHandler as shareInfo, manifestHandler as shareManifest } from "./handlers/share/index.js"

interface MockHandler {
  prefix: string
  handle: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
}

const handlers: MockHandler[] = [pipeline, tracker, shareInfo, shareManifest]

export function octoMockPlugin(): Plugin {
  return {
    name: "octo:mock",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const matched = handlers.find((h) => req.url?.startsWith(h.prefix))
        matched ? matched.handle(req, res, next) : next()
      })
    },
  }
}
