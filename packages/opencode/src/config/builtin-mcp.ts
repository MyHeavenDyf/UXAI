import { ConfigMCP } from "./mcp"

export const BUILTIN_MCP_SERVERS: Record<string, ConfigMCP.Info> = {
  "uxr-tool": {
    type: "remote",
    url: "http://7.192.161.60:8005/mcp",
    enabled: true,
    timeout: 30000,
    // 7.x 是公司内网非标准私有 IP，isPrivateUrl 不识别 → 默认会走系统代理触发 504。
    // 显式 proxy: false 强制绕过代理，避免 Proxy response (504) when HTTP Tunneling。
    proxy: false,
  },
}

export const BUILTIN_MCP_KEYS = new Set(Object.keys(BUILTIN_MCP_SERVERS))

export * as BuiltinMCP from "./builtin-mcp"
