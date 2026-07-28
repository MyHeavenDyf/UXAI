/**
 * resource-path — 本地资源路径泛路改写
 *
 * A2UI JSON 中本地上传资源以 `/uploads/{file}`（可选 `/history/ses_{session}` 前缀）形式引用。
 * 管线产出 React 项目时统一改写为 `/assets/{file}`——zip 打包时资源文件落到 `assets/` 目录
 * （资源文件本身由 Electron 打包处理，管线只改引用路径，不回传资源清单）。
 *
 * 网络 URL（http/https）不动，避免误伤远端 URL 里恰好含 `/uploads/` 的情况。
 *
 * 三处统一调用本 util，避免规则漂移：
 *   1. buildTrees `#processValue` 字面量叶子改写
 *   2. stateBuilder state 物化（stateEntries + enrichment consts）改写 binding 值 / CV 结果
 *   3. tailwind converter（lib/ CLI 版；Electron main/tailwind-to-css 镜像）改写 url() 内路径
 */

/** 改写后的资源基础路径（zip 中静态文件夹名）。改这里即改全局约定，不抽成 config 字段。 */
const ASSET_BASE_PATH = '/assets/'

/** 本地资源路径匹配：可选 /history/{session} 前缀 + /uploads/{file} */
const RESOURCE_RE = /^(?:\/history\/[^/]+)?\/uploads\/(.+)$/

/** 网络 URL（http/https 或协议相对 //）不改写 */
function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || s.startsWith('//')
}

/**
 * 改写单个资源路径字符串。
 *
 * - 网络 URL → 原样
 * - 命中 `/uploads/{file}`（含可选 `/history/ses_xxx` 前缀）→ `/assets/{file}`
 * - 其他（普通文本/标签名/state 指针等）→ 原样
 *
 * 注意：A2UI DataBinding 的 `path` 字段（如 `/brandInfo/backgroundImages/0`）是 state 指针，
 * 不含 `/uploads/`，不会命中，故 binding 路径不会被误改。
 */
export function rewriteResourcePath(s: string): string {
  if (typeof s !== 'string' || !s) return s
  if (isHttpUrl(s)) return s
  const m = s.match(RESOURCE_RE)
  if (m) return ASSET_BASE_PATH + m[1]
  return s
}

/**
 * 递归改写值中的资源路径字符串叶子（用于 state 物化：stateEntries / enrichment consts）。
 *
 * 只对 string 叶子应用 `rewriteResourcePath`；非命中 pattern 的字符串（标签名、import 路径、
 * className、state 指针等）原样返回，故递归进 BuildNode / 值类对象也安全（无副作用）。
 * 返回新值，不修改入参。
 */
export function rewriteResourcePathsInValue(v: any): any {
  if (v == null) return v
  if (typeof v === 'string') return rewriteResourcePath(v)
  if (Array.isArray(v)) return v.map(rewriteResourcePathsInValue)
  if (typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const [k, val] of Object.entries(v)) out[k] = rewriteResourcePathsInValue(val)
    return out
  }
  return v
}

/** CSS `url(...)` 内容提取正则（支持可选引号） */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g

/**
 * 改写字符串中所有 `url(...)` 内的资源路径（用于 tailwind className / CSS 值）。
 *
 * 如 `bg-[url(/uploads/x.png)]` → `bg-[url(/assets/x.png)]`；
 * `url(https://.../x.png)` 内为网络 URL → 原样。
 */
export function rewriteCssUrlPaths(s: string): string {
  if (typeof s !== 'string' || !s) return s
  return s.replace(CSS_URL_RE, (full, quote: string, path: string) => {
    return `url(${quote}${rewriteResourcePath(path)}${quote})`
  })
}
