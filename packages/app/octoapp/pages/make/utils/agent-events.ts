import type { MentionAttrs } from '../components/prosemirror-editor/schema'

export const SEND_TEXT_EVENT = 'octo:send-text'

export interface SendTextEventDetail {
  text: string
  source?: string
  mentions?: MentionAttrs[]
  ack?: (result: { ok: boolean; message?: string }) => void
}

export function sendTextToAgent(
  text: string,
  opts?: { source?: string; timeoutMs?: number; mentions?: MentionAttrs[] }
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
      mentions: opts?.mentions,
      ack: (r) => {
        window.clearTimeout(timer)
        finish(r)
      },
    }
    window.dispatchEvent(new CustomEvent(SEND_TEXT_EVENT, { detail }))
  })
}

export const APPEND_TO_COMPOSER_EVENT = 'octo:append-to-composer'

export interface AppendToComposerEventDetail {
  text: string
}

export function appendToMainComposer(text: string): void {
  window.dispatchEvent(new CustomEvent(APPEND_TO_COMPOSER_EVENT, { detail: { text } }))
}

export const SUBMIT_COMPOSER_EVENT = 'octo:submit-composer'

export function submitMainComposer(): void {
  window.dispatchEvent(new CustomEvent(SUBMIT_COMPOSER_EVENT))
}
