import type { IncomingMessage, ServerResponse } from "node:http"

export const prefix = "/record/logger"

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

export function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const isPage = req.url?.startsWith("/record/logger/page")
  const isInteraction = req.url?.startsWith("/record/logger/interaction")
  if (!isPage && !isInteraction) return next()

  if (req.method === "OPTIONS") {
    setCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== "POST") return next()

  const tag = isPage ? "[octo:tracker-mock:page]" : "[octo:tracker-mock:interaction]"
  let body = ""
  req.on("data", (chunk) => { body += chunk })
  req.on("end", () => {
    try {
      const payload = JSON.parse(body)
      console.log(tag, JSON.stringify(payload, null, 2))
    } catch {
      console.log(tag, "raw body:", body)
    }
    setCors(res)
    res.statusCode = 200
    res.end()
  })
}
