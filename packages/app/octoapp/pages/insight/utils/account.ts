// 当前登录工号(SPEC-INS-030 §5)。
//
// 用途:随 promptAsync 的 `extra.account` 透传给 sidecar,让 knowledge_search 按真实用户调内网知识库
// —— 该接口**按 account 限流**,不传会让全体用户共用后端兜底的同一个限流桶。
//
// 取值:`localStorage.userInfo.account`,**纯工号**(如 `c60050492`),不拼姓名 —— 后端只认工号。
// 拿不到时返回 undefined:调用方不传该字段,由工具侧显式告知「未获取到登录工号」并跳过检索,
// **不做任何兜底工号**(静默兜底 = 把限流问题掩盖回开发态假象)。
// 取不到工号是稳定状态(登录态不会一轮一变),故只在**首次**打一条 warn ——
// 每次发送都打会把 DevTools 刷满,反而盖住真正的异常。server 侧那条 `[octo:kb] account missing`
// 只在模型真的调了知识库工具时才出,两条互补(日志字典见 octo-agent docs/insight-debugging.md)。
let warnedMissing = false

export function currentAccount(): string | undefined {
  const account = readAccount()
  if (!account && !warnedMissing) {
    warnedMissing = true
    console.warn("[octo:kb] account missing:localStorage.userInfo.account 取不到工号,本次会话的内网知识库检索会被工具拒答")
  }
  return account
}

function readAccount(): string | undefined {
  const raw = localStorage.getItem("userInfo")
  if (!raw) return undefined
  try {
    const account = (JSON.parse(raw) as { account?: unknown }).account
    if (typeof account !== "string") return undefined
    const trimmed = account.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}
