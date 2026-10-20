import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import * as pipeline from "./handlers/pipeline/index.js"
import * as tracker from "./handlers/tracker/index.js"
import { infoHandler as shareInfo, manifestHandler as shareManifest } from "./handlers/share/index.js"

interface MockHandler {
  prefix: string
  handle: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
}

export function octoMockPlugin(): Plugin {
  return {
    name: "octo:mock",
    configureServer(server) {
      // share 是真实功能(见 vite.config.ts shareProxy 注释):dev server 已为分享接口配置 proxy
      // (指向真实后端或本地 share-mock-server)时,mock 必须放行,由 proxy 接管。
      // 否则插件中间件先于 proxy 执行,分享页拿到的永远是 handlers/share/data.ts 的固定数据,
      // 链接里的 uniqueId 会被完全忽略,页面内容与被分享会话对不上。
      const proxyKeys = Object.keys(server.config.server.proxy ?? {})
      const covered = (prefix: string) =>
        proxyKeys.some((key) => prefix.startsWith(key) || key.startsWith(prefix))
      const handlers: MockHandler[] = [
        pipeline,
        tracker,
        ...(covered(shareInfo.prefix) ? [] : [shareInfo]),
        ...(covered(shareManifest.prefix) ? [] : [shareManifest]),
      ]
      server.middlewares.use((req, res, next) => {
        const matched = handlers.find((h) => req.url?.startsWith(h.prefix))
        matched ? matched.handle(req, res, next) : next()
      })
    },
  }
}
