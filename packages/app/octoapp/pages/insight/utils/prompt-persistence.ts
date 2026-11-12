/** 合并输入期间的同步存储写入；切会话或离开页面前可立即落盘。 */
export function createPromptPersistence<T>(write: (sessionId: string | undefined, doc: T) => void, delay = 300) {
  let pending: { sessionId: string | undefined; doc: T } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const value = pending
    pending = undefined
    write(value.sessionId, value.doc)
  }
  return {
    schedule(sessionId: string | undefined, doc: T) {
      if (pending && pending.sessionId !== sessionId) flush()
      pending = { sessionId, doc }
      clearTimeout(timer)
      timer = setTimeout(flush, delay)
    },
    flush,
  }
}
