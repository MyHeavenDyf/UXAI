// 按 sessionID 存储前端透传的 extra 数据(promptAsync 的 input.extra)。原是 prompt.ts 模块内
// Map,抽成叶子模块供两方消费:工具 ctx.extra(prompt.ts 组装,knowledge_search 的 account 等)
// 与服务端打点(SPEC-INS-033 D3,tracking/report.ts 读 account)——直接 import prompt.ts 会与
// summary.ts 成环,故下放。
//
// 生命周期:进程内存 Map,prompt 时覆写、不清理(与原实现一致);服务重启即空,消费方须对
// 取不到 extra/account 自行容错。

const sessionExtras = new Map<string, Record<string, unknown>>()

export function setExtra(sessionID: string, extra: Record<string, unknown>) {
  sessionExtras.set(sessionID, extra)
}

export function getExtra(sessionID: string): Record<string, unknown> | undefined {
  return sessionExtras.get(sessionID)
}

/** 读 extra 里的字符串字段(如 account:纯工号)。非字符串 / 不存在 / 空串返回 undefined。 */
export function readExtraString(sessionID: string, key: string): string | undefined {
  const value = getExtra(sessionID)?.[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export * as SessionExtras from "./extras"
