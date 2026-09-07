// 渲染进程 console 对象参数序列化(SPEC-INS-011 阶段3 落盘链路的补丁)。
//
// 背景:主进程用 `console-message` 事件把 renderer console 全量转发进 insight-debug.log,
// 该事件只能拿到**格式化后的字符串**——对象参数到主进程时已是 "[object Object]",落盘救不回来
// (2026-07-16 内网产物下载排障,两份日志因此全废)。唯一解法是在渲染端把对象变成字符串。
//
// 只在生产构建安装(octo.tsx `!import.meta.env.DEV` 分支):dev 有 DevTools,保留对象可展开;
// 成品包 DevTools 用得少、远程只有落盘日志,可读性优先。
//
// Error 专门处理:JSON.stringify(err) 得到 "{}"(message/stack 不可枚举);这里展开
// message + name + cause 链(与主进程 describeNetworkError 同思路),stack 不带(太长,
// 未捕获异常的 stack 由 error-beacon 单独兜)。

const MAX_ARG_LEN = 2000 // 单参数截断,防长文本/base64 刷爆 5MB 滚动日志

function errorToPlain(e: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { message: e.message }
  if (e.name && e.name !== "Error") out.name = e.name
  if (e.cause !== undefined) out.cause = e.cause instanceof Error ? errorToPlain(e.cause) : String(e.cause)
  return out
}

export function serializeConsoleArg(arg: unknown): unknown {
  if (arg === null || typeof arg !== "object") return arg
  try {
    const seen = new WeakSet<object>()
    const json = JSON.stringify(arg, (_key, val: unknown) => {
      if (val instanceof Error) return errorToPlain(val)
      if (typeof val === "function") return `[function ${val.name || "anonymous"}]`
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[circular]"
        seen.add(val)
      }
      return val
    })
    // JSON.stringify 对纯 undefined 等返回 undefined,兜底 String
    const text = json ?? String(arg)
    return text.length > MAX_ARG_LEN ? text.slice(0, MAX_ARG_LEN) + "…[truncated]" : text
  } catch {
    // Proxy / DOM 节点等 stringify 可能 throw,宁可粗糙不可丢日志
    try {
      return String(arg)
    } catch {
      return "[unserializable]"
    }
  }
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const

/** 幂等安装:把 console.* 的对象参数替换为 JSON 字符串再交给原始 console(转发/log ring 均受益)。 */
let installed = false
export function installConsoleObjectSerializer(): void {
  if (installed) return
  installed = true
  for (const level of LEVELS) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => original(...args.map(serializeConsoleArg))
  }
}
