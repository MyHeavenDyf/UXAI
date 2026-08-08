export const SEND_TEXT_EVENT = 'octo:send-text'

export interface SendTextEventDetail {
  text: string
  source?: string
  ack?: (result: { ok: boolean; message?: string }) => void
}

export function sendTextToAgent(
  text: string,
  opts?: { source?: string; timeoutMs?: number }
): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (r: { ok: boolean; message?: string }) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const timeout = opts?.timeoutMs ?? 30000
    const timer = window.setTimeout(
      () => finish({ ok: false, message: 'timeout' }),
      timeout
    )
    const detail: SendTextEventDetail = {
      text,
      source: opts?.source,
      ack: (r) => {
        window.clearTimeout(timer)
        finish(r)
      },
    }
    window.dispatchEvent(new CustomEvent(SEND_TEXT_EVENT, { detail }))
  })
}
