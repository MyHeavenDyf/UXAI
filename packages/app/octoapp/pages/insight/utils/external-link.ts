import { getDesktopApi } from "../lib/electron-api"

// 预览(编辑器 / 卡片)里点外链 → 唤起系统浏览器,避免在 Electron webview 内导航后无返回入口。
// 仅拦 http/https/mailto;锚点(#标题,大纲跳转)与相对链接放行。
// 挂在预览容器上、capture 阶段调用。见 docs/specs/ui/insight-markdown-editor.md §6.5。
export function interceptExternalLink(e: MouseEvent): boolean {
  const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null
  if (!a) return false
  const href = a.getAttribute("href") || ""
  if (!/^(https?:|mailto:)/i.test(href)) return false
  e.preventDefault()
  e.stopPropagation()
  console.log("[octo:mdedit] open-link", { href })
  const api = getDesktopApi()
  if (typeof api?.openLink === "function") api.openLink(href)
  else window.open(href, "_blank", "noopener")
  return true
}
