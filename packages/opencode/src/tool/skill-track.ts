import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "skill-track" })

const SKILL_TRACKING_BETA_URL = "https://octo-beta.hdesign.huawei.com/main/rest.root/report/skill/count"
const SKILL_TRACKING_PROD_URL = "https://octo.hdesign.huawei.com/main/rest.root/report/skill/count"

// 模式 A：env 覆盖默认 beta（与 config/builtin-mcp.ts 一致）。
// 生产部署注入 OCTO_SKILL_TRACKING_URL=<prod URL> 即切到 prod。
export const SKILL_TRACKING_URL = process.env.OCTO_SKILL_TRACKING_URL || SKILL_TRACKING_BETA_URL
export const SKILL_TRACKING_URL_SOURCE = process.env.OCTO_SKILL_TRACKING_URL
  ? "env(OCTO_SKILL_TRACKING_URL)"
  : "default(beta)"

let sourceLogged = false

// fire-and-forget 上报一次 skill 使用计数。
// - 脱离 effect scope：用裸 fetch().then() 而非 Effect.fork，避免 tool scope 关闭时 fiber 被中断
// - 失败静默：rejection / non-ok / 超时 全部 catch，只 log.warn
// - 不传 ctx.abort：用户取消 skill 不影响计数
export function reportSkillUse(skillName: string): void {
  if (!sourceLogged) {
    sourceLogged = true
    log.info("skill tracking url", { url: SKILL_TRACKING_URL, source: SKILL_TRACKING_URL_SOURCE })
  }

  void fetch(SKILL_TRACKING_URL, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ zipName: skillName, type: "citation" }),
    signal: AbortSignal.timeout(5_000),
  }).then(
    (res) => {
      if (!res.ok) {
        log.warn("skill tracking non-ok", { skillName, status: res.status, statusText: res.statusText })
      }
    },
    (error: unknown) => {
      log.warn("skill tracking failed", {
        skillName,
        error: error instanceof Error ? error.message : String(error),
      })
    },
  )
}
