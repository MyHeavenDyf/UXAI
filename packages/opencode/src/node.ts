// 临时调试：捕获所有 AbortController.abort() 调用，定位 UND_ERR_ABORTED 根因
// 移除方法：删除下面这行，并删除 packages/opencode/src/util/debug-abort.ts
import "@/util/debug-abort"

// 本地 provider 直连兜底：追加 NO_PROXY 让 Node 跳过华为内网域名
import { setupBypassProxyForLocalProviders } from "@/util/network"
setupBypassProxyForLocalProviders()

export { Config } from "@/config/config"
export { Server } from "./server/server"
export { bootstrap } from "./cli/bootstrap"
export * as Log from "@opencode-ai/core/util/log"
export { Database } from "@/storage/db"
export { JsonMigration } from "@/storage/json-migration"
export { BuiltinMCP } from "@/config/builtin-mcp"
