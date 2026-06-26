import { ConfigMCP } from "./mcp"

// uxr-tool MCP 地址。生产环境通过 OCTO_UXR_MCP_URL 注入；未设置时回退到 beta 内网 IP。
const UXR_MCP_DEFAULT_URL = "http://7.192.161.60:8005/mcp"
const UXR_MCP_URL = process.env.OCTO_UXR_MCP_URL || UXR_MCP_DEFAULT_URL

// 生效地址来源（供启动日志确认连的是 beta 还是 prod，见 docs/insight-debugging.md [octo:mcp]）。
export const UXR_MCP_URL_SOURCE = process.env.OCTO_UXR_MCP_URL ? "env(OCTO_UXR_MCP_URL)" : "default(beta)"

export const BUILTIN_MCP_SERVERS: Record<string, ConfigMCP.Info> = {
  "uxr-tool": {
    type: "remote",
    url: UXR_MCP_URL,
    enabled: true,
    timeout: 30000,
    // 7.x 是公司内网非标准私有 IP，isPrivateUrl 不识别 → 默认会走系统代理触发 504。
    // 显式 proxy: false 强制绕过代理，避免 Proxy response (504) when HTTP Tunneling。
    proxy: false,
  },
}

export const BUILTIN_MCP_KEYS = new Set(Object.keys(BUILTIN_MCP_SERVERS))

export * as BuiltinMCP from "./builtin-mcp"
