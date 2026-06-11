interface TrackParams {
  module: string
  name: string
  from?: string
  extend?: string
}

interface UserInfo {
  account?: string
  uid?: string
}

function getUserInfo(): UserInfo {
  try {
    return JSON.parse(localStorage.getItem("userInfo") ?? "{}") as UserInfo
  } catch {
    return {}
  }
}

function parseBrowser(): { browserName: string; browserVersion: string } {
  const ua = navigator.userAgent
  const edgeMatch = ua.match(/Edg\/(\d+)/)
  if (edgeMatch) return { browserName: "Edge", browserVersion: edgeMatch[1] }
  const chromeMatch = ua.match(/Chrome\/(\d+)/)
  if (chromeMatch) return { browserName: "Chrome", browserVersion: chromeMatch[1] }
  const firefoxMatch = ua.match(/Firefox\/(\d+)/)
  if (firefoxMatch) return { browserName: "Firefox", browserVersion: firefoxMatch[1] }
  const safariMatch = ua.match(/Version\/(\d+).*Safari/)
  if (safariMatch) return { browserName: "Safari", browserVersion: safariMatch[1] }
  return { browserName: "Unknown", browserVersion: "" }
}

function parseOS(): string {
  const ua = navigator.userAgent
  if (ua.includes("Windows")) return "Windows"
  if (ua.includes("Mac OS X")) return "macOS"
  if (ua.includes("Linux")) return "Linux"
  if (ua.includes("Android")) return "Android"
  if (/iPhone|iPad|iOS/.test(ua)) return "iOS"
  return "Unknown"
}

const ENDPOINT = "/record/logger/page"

async function send(type: "page" | "interaction" | "duration", params: TrackParams) {
  const baseUrl = (import.meta.env.VITE_OCTO_REPORT_BASE_URL as string) ?? ""
  const url = baseUrl ? `${baseUrl}${ENDPOINT}` : ENDPOINT
  const { account, uid } = getUserInfo()
  const { browserName, browserVersion } = parseBrowser()

  const payload = {
    account: account ?? "",
    uid,
    browserName,
    browserVersion,
    module: params.module,
    os: parseOS(),
    platform: 3 as const,
    project: "octo-agent",
    userAgent: navigator.userAgent,
    datas: {
      from: params.from,
      name: params.name,
      path: window.location.href,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      type,
      extend: params.extend,
    },
  }

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {
    // tracking failure must not affect app
  }
}

export const tracker = {
  page: (params: TrackParams) => send("page", params),
  interaction: (params: TrackParams) => send("interaction", params),
  duration: (params: TrackParams) => send("duration", params),
}
