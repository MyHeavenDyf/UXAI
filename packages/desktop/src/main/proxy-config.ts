import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ProxyConfig = {
  http_proxy?: string
  https_proxy?: string
  no_proxy?: string
  proxyOptionId?: string
}

// proxy_config.json 固定存放在 ~/.config/octo/，刻意不跟随 XDG_CONFIG_HOME。
// 旧实现写入用 getOctoConfigPath()（尊重 XDG_CONFIG_HOME），而 index.ts / server.ts /
// sidecar.ts 读取时硬编码 ~/.config/octo —— shell 里设置了 XDG_CONFIG_HOME 的 mac 上
// 写读分裂，重启后主进程与 sidecar 都读不到代理（设置页却仍显示已配置）。
// 所有读写必须统一走本模块。
export function proxyConfigFile() {
  return join(homedir(), ".config", "octo", "proxy_config.json")
}

export function readProxyConfig(): ProxyConfig | null {
  try {
    const file = proxyConfigFile()
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf-8"))
    if (!parsed || typeof parsed !== "object") return null
    return parsed as ProxyConfig
  } catch {
    return null
  }
}

// 日志用：隐藏代理 URL 中的账号密码
export function maskProxyUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url)
    if (parsed.username) {
      parsed.username = "***"
      parsed.password = ""
    }
    return parsed.toString()
  } catch {
    return "<invalid-url>"
  }
}
