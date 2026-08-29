/**
 * Resource Tracker
 *
 * 监听 iframe 内通过资源收集桥（injectResourceCollectorBridge）上报的
 * `od:resource-loaded` 消息，按 iframe 元素累加 URL 集合。
 *
 * 用于 ZIP 打包时识别「实际加载过的资源」。
 *
 * 使用：
 *   const tracker = createResourceTracker()
 *   tracker.observe(iframeEl)
 *   // iframe 加载资源时累积
 *   const urls = tracker.getPaths(iframeEl)
 *   tracker.dispose(iframeEl)  // 清理单个
 *   tracker.disposeAll()       // 清理全部
 */

const RESOURCE_MSG_TYPE = "od:resource-loaded"

export interface ResourceTracker {
  observe: (iframe: HTMLIFrameElement) => void
  getPaths: (iframe: HTMLIFrameElement) => string[]
  reset: (iframe: HTMLIFrameElement) => void
  dispose: (iframe: HTMLIFrameElement) => void
  disposeAll: () => void
}

export function createResourceTracker(): ResourceTracker {
  const store = new WeakMap<HTMLIFrameElement, Set<string>>()
  const activeIframes = new Set<HTMLIFrameElement>()

  const handler = (event: MessageEvent) => {
    const data = event.data
    if (!data || data.type !== RESOURCE_MSG_TYPE) return
    if (typeof data.url !== "string") return

    const source = event.source
    for (const iframe of activeIframes) {
      if (iframe.contentWindow === source) {
        let set = store.get(iframe)
        if (!set) {
          set = new Set()
          store.set(iframe, set)
        }
        set.add(data.url)
        return
      }
    }
  }

  window.addEventListener("message", handler)

  return {
    observe(iframe: HTMLIFrameElement) {
      activeIframes.add(iframe)
    },
    getPaths(iframe: HTMLIFrameElement) {
      const set = store.get(iframe)
      return set ? Array.from(set) : []
    },
    reset(iframe: HTMLIFrameElement) {
      store.delete(iframe)
    },
    dispose(iframe: HTMLIFrameElement) {
      store.delete(iframe)
      activeIframes.delete(iframe)
    },
    disposeAll() {
      // WeakMap 不能遍历，只能清空 active 引用；GC 后 WeakMap 项自动消失
      activeIframes.clear()
      window.removeEventListener("message", handler)
    },
  }
}

/**
 * 把 local:// URL 转回绝对文件路径。支持两种形式：
 *  - local:///C:/foo/bar.png?v=2  （pathToLocalUrl 产生，3 斜杠 + 盘符）
 *  - local://d/code/foo/bar.png   （浏览器规范化后，2 斜杠 + 单字符 host = 盘符）
 *
 * 反向操作为 pathToLocalUrl（artifact-file-api.ts）。
 */
export function localUrlToPath(url: string): string {
  if (!url) return ""
  let s = url.trim()

  // 剥 query/hash
  const qIdx = s.indexOf("?")
  if (qIdx >= 0) s = s.slice(0, qIdx)
  const hIdx = s.indexOf("#")
  if (hIdx >= 0) s = s.slice(0, hIdx)

  // 解析 URL 区分 host / pathname
  let rest: string
  if (s.startsWith("local:///")) {
    // local:///C:/foo → 剥前缀后是 C:/foo
    rest = s.slice("local:///".length)
  } else if (s.startsWith("local://")) {
    // local://d/code/foo → 剥 'local://' 后是 'd/code/foo'，首段 d 是盘符 host
    rest = s.slice("local://".length)
    // 把单字符 host 转成 'D:' 形式
    const m = rest.match(/^([A-Za-z])\/(.*)$/)
    if (m) {
      rest = `${m[1].toUpperCase()}:/${m[2]}`
    }
  } else {
    return ""
  }

  // 解码
  try {
    s = decodeURIComponent(rest)
  } catch {
    s = rest
  }

  // Windows 盘符：去掉残留的多余前导斜杠（如 '/D:/foo' → 'D:/foo'）
  if (/^\/[A-Za-z]:[\/\\]/.test(s)) {
    s = s.slice(1)
  }

  return s
}

/**
 * 把 local:// URL 数组筛出 htmlDir 下的相对路径（用于和静态解析结果并集）。
 * 输入：['local:///C:/foo/images/a.png?v=2', 'http://other/...']
 * 输出（htmlDir = 'C:/foo'）：['images/a.png']
 */
export function filterObservedUrlsToRelative(observedUrls: string[], htmlDir: string): string[] {
  const base = htmlDir.replace(/\\/g, "/").replace(/\/+$/, "")
  const result: string[] = []

  for (const url of observedUrls) {
    const abs = localUrlToPath(url)
    if (!abs) continue
    const normalized = abs.replace(/\\/g, "/")
    if (normalized === base) continue
    if (normalized.toLowerCase().startsWith(base.toLowerCase() + "/")) {
      const rel = normalized.slice(base.length + 1)
      result.push(rel)
    }
  }

  return Array.from(new Set(result))
}

/**
 * 把 local:// URL 数组转换为绝对文件路径（不做目录过滤）。
 * 非 local:// 协议的 URL 会被跳过。
 */
export function observedUrlsToAbsPaths(observedUrls: string[]): string[] {
  const result: string[] = []
  for (const url of observedUrls) {
    const abs = localUrlToPath(url)
    if (abs) result.push(abs.replace(/\\/g, "/"))
  }
  return Array.from(new Set(result))
}
