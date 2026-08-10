/**
 * Resource Collector Bridge
 *
 * 注入到预览 iframe（通过 local: 协议处理器或 srcdoc-builder），
 * 抓取所有实际加载的网络资源 URL，通过 postMessage 上报给父窗口。
 *
 * 上报消息：{ type: 'od:resource-loaded', url: string }
 *
 * 抓取途径：
 *  1. PerformanceObserver — resource timing 条目（含历史 buffered）
 *  2. fetch hook — 动态 fetch 调用
 *  3. XMLHttpRequest.open hook — 动态 XHR 调用
 *
 * 仅上报 URL，不改变运行时行为。
 */
export const RESOURCE_COLLECTOR_BRIDGE_SCRIPT = `<script data-od-resource-collector>(function(){
  if (window.__od_resource_collector__) return
  window.__od_resource_collector__ = true

  function send(url){
    if (!url) return
    try { window.parent.postMessage({ type: 'od:resource-loaded', url: String(url) }, '*') } catch(_) {}
  }

  // 1. PerformanceObserver
  if (window.PerformanceObserver) {
    try {
      var obs = new PerformanceObserver(function(list){
        var entries = list.getEntries()
        for (var i = 0; i < entries.length; i++) {
          send(entries[i].name)
        }
      })
      obs.observe({ type: 'resource', buffered: true })
    } catch(_) {}
  }

  // 2. fetch hook
  var origFetch = window.fetch
  if (origFetch) {
    window.fetch = function(){
      try {
        var arg = arguments[0]
        var u = (typeof arg === 'string') ? arg : (arg && arg.url)
        send(u)
      } catch(_) {}
      return origFetch.apply(this, arguments)
    }
  }

  // 3. XMLHttpRequest.open hook
  var XHROpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method, url){
    try { send(url) } catch(_) {}
    return XHROpen.apply(this, arguments)
  }
})();</script>`
