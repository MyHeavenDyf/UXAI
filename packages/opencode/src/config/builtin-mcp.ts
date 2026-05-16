import { ConfigMCP } from "./mcp"

export const BUILTIN_MCP_SERVERS: Record<string, ConfigMCP.Info> = {
  "uxr-tool": {
    type: "remote",
    url: "http://7.192.161.60:8005/mcp",
    enabled: true,
    timeout: 30000,
  },
}

export const BUILTIN_MCP_KEYS = new Set(Object.keys(BUILTIN_MCP_SERVERS))

export * as BuiltinMCP from "./builtin-mcp"
