import type { IncomingMessage, ServerResponse } from "node:http"

export const prefix = "/record/logger/page"

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

export function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.method === "OPTIONS") {
    setCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== "POST") return next()

  let body = ""
  req.on("data", (chunk) => { body += chunk })
  req.on("end", () => {
    try {
      const payload = JSON.parse(body)
      console.log("[octo:tracker-mock]", JSON.stringify(payload, null, 2))
    } catch {
      console.log("[octo:tracker-mock] raw body:", body)
    }
    setCors(res)
    res.statusCode = 204
    res.end()
  })
}
