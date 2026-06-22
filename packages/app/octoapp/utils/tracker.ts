interface PageParams {
  module: string
  name?: string
  subType?: string
  from?: string
  extend?: string
}

interface InteractionParams {
  module: string
  name: string
  subType?: string
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
  const edgeMatch = ua.match(/Edg\/([\d.]+)/)
  if (edgeMatch) return { browserName: "edge", browserVersion: edgeMatch[1] }
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/)
  if (chromeMatch) return { browserName: "chrome", browserVersion: chromeMatch[1] }
  const firefoxMatch = ua.match(/Firefox\/([\d.]+)/)
  if (firefoxMatch) return { browserName: "firefox", browserVersion: firefoxMatch[1] }
  const safariMatch = ua.match(/Version\/([\d.]+).*Safari/)
  if (safariMatch) return { browserName: "safari", browserVersion: safariMatch[1] }
  return { browserName: "unknown", browserVersion: "" }
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

function getPlatform(): number {
  const ua = navigator.userAgent
  if (ua.includes("Windows")) return 1
  if (ua.includes("Mac OS X")) return 2
  if (ua.includes("Linux")) return 3
  if (/iPhone|iPad|iOS/.test(ua)) return 4
  if (ua.includes("Android")) return 5
  return 1
}

function buildBase() {
  const { account, uid } = getUserInfo()
  const { browserName, browserVersion } = parseBrowser()
  return {
    account: account ?? "",
    uid,
    browserName,
    browserVersion,
    os: parseOS(),
    platform: getPlatform(),
    project: "octo-agent",
    userAgent: navigator.userAgent,
  }
}

async function sendPage(params: PageParams) {
  try {
    const baseUrl = (import.meta.env.VITE_OCTO_REPORT_BASE_URL as string) ?? ""
    await fetch(`${baseUrl}/record/logger/page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...buildBase(),
        module: params.module,
        datas: [{
          type: "page",
          subType: params.subType,
          name: params.name,
          path: window.location.href,
          from: params.from ?? "",
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          extend: params.extend,
        }],
      }),
    })
  } catch (err) {
    console.warn("[tracker] page failed silently", err)
  }
}

async function sendInteraction(params: InteractionParams) {
  try {
    const baseUrl = (import.meta.env.VITE_OCTO_REPORT_BASE_URL as string) ?? ""
    await fetch(`${baseUrl}/record/logger/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...buildBase(),
        module: params.module,
        datas: [{
          type: "interaction",
          subType: params.subType ?? "click",
          name: params.name,
          path: window.location.href,
          extend: params.extend,
        }],
      }),
    })
  } catch (err) {
    console.warn("[tracker] interaction failed silently", err)
  }
}

export const tracker = {
  page: (params: PageParams): void => {
    console.log("[octo:track] page", params.module, params.name, params.extend ?? "")  // 调试日志:内网验证打点用,验证完成后删除
    void sendPage(params)
  },
  interaction: (params: InteractionParams): void => {
    console.log("[octo:track] interaction", params.module, params.name, params.extend ?? "")  // 调试日志:内网验证打点用,验证完成后删除
    void sendInteraction(params)
  },
}
