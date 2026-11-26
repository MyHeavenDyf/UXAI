// 在测试机启动软件后、第一次进入 Studio 前，将本文件粘贴到 DevTools Console 执行。
// 复现后执行 copy(window.__studioEntryTiming.export()) 导出，再执行 .stop() 停止。
// 只保留时间、接口路径及 DOM 数量，不收集请求头、请求正文或对话内容。
(() => {
  window.__studioEntryTiming?.stop()
  const started = performance.now()
  const events = []
  const original = { fetch: window.fetch, parse: JSON.parse, push: history.pushState, replace: history.replaceState }
  const bodies = new Map(["json", "text"].map((name) => [name, Response.prototype[name]]))
  const record = (stage, details = {}, at = performance.now()) => {
    events.push({ ms: Math.round((at - started) * 10) / 10, stage, ...details })
    if (events.length > 3000) events.shift()
  }
  const path = (value) => new URL(value, location.href).pathname
  const selected = (value) => /\/(?:session|studio|experimental\/session|session-group)(?:\/|$)/.test(value)
  const route = () => record("route", { studio: /\/studio(?:\/|$|\?)/.test(location.hash || location.pathname) })
  const fetch = function (...args) {
    const url = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href)
    if (!selected(url.pathname)) return Reflect.apply(original.fetch, this, args)
    const id = ++requestSequence
    const begin = performance.now()
    record("fetch-start", { id, path: url.pathname, method: args[1]?.method ?? (args[0] instanceof Request ? args[0].method : "GET"), directory: url.searchParams.has("directory") })
    return Reflect.apply(original.fetch, this, args).then((response) => {
      record("fetch-headers", { id, path: url.pathname, elapsed: Math.round(performance.now() - begin), status: response.status })
      return response
    }, (error) => {
      record("fetch-error", { id, path: url.pathname, elapsed: Math.round(performance.now() - begin), error: error.name })
      throw error
    })
  }
  let requestSequence = 0
  window.fetch = fetch
  const wrappedBodies = new Map([...bodies].map(([name, method]) => {
    const wrapped = function (...args) {
      if (!this.url || !selected(path(this.url))) return Reflect.apply(method, this, args)
      const begin = performance.now()
      record(`${name}-start`, { path: path(this.url) })
      return Reflect.apply(method, this, args).then((value) => {
        record(`${name}-ready`, { path: path(this.url), elapsed: Math.round(performance.now() - begin) })
        return value
      })
    }
    Response.prototype[name] = wrapped
    return [name, wrapped]
  }))
  const parse = function (...args) {
    const begin = performance.now()
    const result = Reflect.apply(original.parse, this, args)
    const elapsed = performance.now() - begin
    if (elapsed >= 10) record("slow-json-parse", { elapsed: Math.round(elapsed), characters: typeof args[0] === "string" ? args[0].length : undefined })
    return result
  }
  JSON.parse = parse
  const navigation = new Map(["pushState", "replaceState"].map((name) => {
    const method = name === "pushState" ? original.push : original.replace
    const wrapped = function (...args) {
      const result = Reflect.apply(method, this, args)
      route()
      return result
    }
    history[name] = wrapped
    return [name, { method, wrapped }]
  }))
  window.addEventListener("hashchange", route)
  window.addEventListener("popstate", route)
  const click = (event) => {
    const text = event.target instanceof Element ? event.target.closest("button")?.textContent?.trim() : undefined
    if (text === "Studio" || text === "AI推荐") record("click", { action: text })
  }
  document.addEventListener("click", click, true)
  const resources = new PerformanceObserver((list) => list.getEntries().forEach((entry) => {
    if (!selected(path(entry.name)) && entry.duration < 100) return
    record("resource", { path: path(entry.name), elapsed: Math.round(entry.duration), initiator: entry.initiatorType }, entry.startTime)
  }))
  resources.observe({ type: "resource" })
  const longtasks = PerformanceObserver.supportedEntryTypes.includes("longtask")
    ? new PerformanceObserver((list) => list.getEntries().forEach((entry) => record("longtask", { elapsed: Math.round(entry.duration) }, entry.startTime)))
    : undefined
  longtasks?.observe({ type: "longtask" })
  let previous = ""
  let frame = 0
  const inspect = () => {
    frame = 0
    const state = {
      center: Boolean(document.querySelector(".studio-center")),
      workspace: Boolean(document.querySelector(".studio-workspace")),
      turns: document.querySelectorAll("[data-studio-turn-id]").length,
      cards: document.querySelectorAll(".studio-result-card").length,
      guide: Boolean(document.querySelector(".studio-recommendation-shortcuts")),
    }
    const signature = JSON.stringify(state)
    if (signature === previous) return
    previous = signature
    record("dom-frame", state)
  }
  const dom = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(inspect) })
  dom.observe(document.documentElement, { childList: true, subtree: true })
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    record("stopped")
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    resources.disconnect()
    longtasks?.disconnect()
    dom.disconnect()
    document.removeEventListener("click", click, true)
    window.removeEventListener("hashchange", route)
    window.removeEventListener("popstate", route)
    if (window.fetch === fetch) window.fetch = original.fetch
    if (JSON.parse === parse) JSON.parse = original.parse
    wrappedBodies.forEach((wrapped, name) => { if (Response.prototype[name] === wrapped) Response.prototype[name] = bodies.get(name) })
    navigation.forEach((value, name) => { if (history[name] === value.wrapped) history[name] = value.method })
    console.info("Studio 计时已停止；记录仍可导出。")
  }
  const timer = setTimeout(stop, 5 * 60 * 1000)
  window.__studioEntryTiming = {
    stop,
    export: () => JSON.stringify({ capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, events }, null, 2),
    table: () => console.table(events),
  }
  record("started")
  route()
  inspect()
  console.info("Studio 计时已就绪。进入 Studio 复现后，执行 copy(window.__studioEntryTiming.export()) 导出。")
})()
