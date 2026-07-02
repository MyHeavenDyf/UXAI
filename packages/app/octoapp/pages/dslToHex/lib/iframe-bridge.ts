type MessageHandler = (payload: unknown) => void

type QueuedAction = {
  kind: "post"
  type: string
  payload: unknown
  transfer: ArrayBuffer[]
}

export class IframeBridge {
  private iframe: HTMLIFrameElement
  private handlers: Record<string, MessageHandler[]> = {}
  private queue: QueuedAction[] = []
  private ready = false
  private onMessage: (e: MessageEvent) => void

  constructor(baseUrl: string = "http://localhost:5173") {
    this.iframe = document.createElement("iframe")
    this.iframe.id = "octo-iframe"
    this.iframe.src = baseUrl + "/#/?step=1"
    this.iframe.style.cssText = "width:100%;height:100%;border:none"

    this.iframe.addEventListener("load", () => {
      this.ready = true
      this.flushQueue()
    })

    this.onMessage = (e: MessageEvent) => {
      if (e.source !== this.iframe.contentWindow) return
      const data = e.data as { type: string; payload?: unknown } | undefined
      if (!data?.type) return
      const fns = this.handlers[data.type]
      if (fns) for (const fn of fns) fn(data.payload)
    }
    window.addEventListener("message", this.onMessage)
  }

  mount(container: HTMLElement): this {
    // 从 DOM 卸载会销毁 iframe 的浏览上下文，重新 append 会触发 reload。
    // 必须复位 ready，否则 reload 期间 post() 会把消息直接打到正在加载的
    // contentWindow 上被丢弃。复位后消息入队，等 load 事件 flushQueue 按序投递。
    if (this.iframe.parentNode) {
      this.iframe.remove()
      this.ready = false
    }
    container.appendChild(this.iframe)
    return this
  }

  unmount(): void {
    window.removeEventListener("message", this.onMessage)
    this.iframe.remove()
    this.ready = false
    this.queue = []
  }

  call(method: string, ...args: unknown[]): this {
    console.warn("[IframeBridge] unknown method:", method)
    return this
  }

  post(type: string, payload: unknown, transfer: ArrayBuffer[] = []): this {
    const cw = this.iframe.contentWindow
    if (!cw || !this.ready) {
      this.queue.push({ kind: "post", type, payload, transfer })
      return this
    }
    cw.postMessage({ type, payload }, "*", transfer)
    return this
  }

  on(type: string, fn: MessageHandler): this {
    (this.handlers[type] ??= []).push(fn)
    return this
  }

  off(type: string, fn: MessageHandler): this {
    (this.handlers[type] = this.handlers[type]?.filter(f => f !== fn) ?? [])
    return this
  }

  getIframe(): HTMLIFrameElement {
    return this.iframe
  }

  private flushQueue(): void {
    while (this.queue.length > 0) {
      const action = this.queue.shift()!
      this.post(action.type, action.payload, action.transfer)
    }
  }
}
