/**
 * skill 配置写完即通知 sidecar 失效缓存(desktop 主进程收口)
 *
 * `skill_config.json` 与 `<octoConfig>/skill/` 是全局配置,sidecar 端 `Skill.Service`
 * 用 InstanceState 缓存,只有 `POST /skill/refresh` 能让所有 directory 的实例失效重建
 * (`invalidateAll`)。渲染端 skills 管理页在操作后会经 SDK 调 refresh,但主进程的
 * `add-skill`/`set-skill-config` 等 IPC 写文件时不通知的话,任何绕过管理页的调用方
 * (或未来新增入口)都会让 server 继续读旧清单 —— 这里在主进程侧收口兜底。
 *
 * 同 `fastui-export.ts` 的注入模式:sidecar 就绪时由 index.ts 注入 ServerInfo,
 * 崩溃重启复用同 URL/密码。fire-and-forget 语义:失败只 log.warn,永不 throw。
 */
import log from "electron-log/main.js"

type ServerInfo = { url: string; username: string | null; password: string | null }

/** sidecar 就绪时由 index.ts 注入。未就绪(或已退出)时为 null,refresh 直接跳过 */
let serverInfo: ServerInfo | null = null

export function setSkillRefreshServerInfo(info: ServerInfo | null) {
  serverInfo = info
}

/** 同机回环 + refresh 是同步 Effect(路由响应返回时 invalidateAll 已完成),秒级上限足够 */
const REFRESH_TIMEOUT_MS = 5000

export async function refreshSidecarSkills(): Promise<void> {
  const info = serverInfo
  if (!info) return
  try {
    const url = new URL("/skill/refresh", info.url)
    const headers = new Headers()
    if (info.password) {
      const auth = Buffer.from(`${info.username ?? "opencode"}:${info.password}`).toString("base64")
      headers.set("authorization", `Basic ${auth}`)
    }
    const res = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })
    if (!res.ok) log.warn("[skill-refresh] refresh failed", { status: res.status })
  } catch (error) {
    log.warn("[skill-refresh] refresh error", { error: String(error) })
  }
}
