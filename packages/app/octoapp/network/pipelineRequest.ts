// Pipeline API 请求模块 — 浏览器 fetch 直连后端:
//   host 取自 VITE_OCTO_BASE_URL; 空值时走相对路径(由 Vite mock/proxy 拦截)
//   跨域直连 + 鉴权(uiplustoken/cookie)由 desktop 主进程 webRequest 拦截统一注入,
//   详见 packages/desktop/src/main/windows.ts;纯 web 环境下 host 需同源或经 Vite proxy。
import { showToast } from "@opencode-ai/ui/toast"
import type { Domain, DomainInfoByProduct, Product, ProductLine, SearchResult, Version, UploadDeliverableBody, ActivityTeamInfo } from "./types"

// 后端路径前缀注册表 — 新增路径时在此添加即可, 各接口函数通过 prefix 参数引用
const API_PREFIXES = {
  pipeline: "/pipeline/rest.root/workflow",
  main: "/main/rest.root/main",
}

// 请求失败统一上报: 右下角 toast 报错(非阻断, 不中断用户) + 详情进 console;
// 返回 null 让调用方降级为空态, 不抛异常 → 既不整页崩溃也不把面板替换成报错页。
function reportRequestError<T>(userMessage: string, ...consoleArgs: any[]): T {
  console.error(...consoleArgs)
  showToast({ title: userMessage, variant: "error" })
  return null as T
}

// 统一解析后端响应格式: { errorCode:200, content } 或 { data:{ errorCode:200, content } }
function parseResponse<T>(data: any): T {
  const inner = data?.data ?? data
  if (!inner) return reportRequestError<T>("网络异常,请稍后重试", "Empty response")
  if (inner.errorCode === 400 || inner.errorCode === 1417) {
    (window as any).openLogin?.() // 登录态失效 → 跳登录, 非错误, 不弹 toast
    return null as T
  }
  if (inner.errorCode === 200) return inner.content as T
  return reportRequestError<T>(inner.errorMessage || "请求失败,请稍后重试", inner.errorMessage ?? "Unknown error", inner)
}

function buildQueryString(query: Record<string, any>): string {
  const entries = Object.entries(query).filter(([_, v]) => v != null)
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
}

// 通用请求选项 — 扩展参数时只需在此添加字段
type ApiFetchOptions = {
  path: string
  method?: string
  query?: Record<string, any>
  body?: any
  prefix?: string
}

// 通用请求 — body 为 JSON(application/json), 浏览器 fetch 直连后端
async function apiFetch<T>(options: ApiFetchOptions): Promise<T> {
  const { path, method = "GET", query = {}, body, prefix = API_PREFIXES.pipeline } = options
  const relativeUrl = prefix + path + buildQueryString(query)
  const headers: Record<string, string> = {}
  if (body) headers["content-type"] = "application/json"

  const host = (import.meta.env.VITE_OCTO_BASE_URL as string) ?? ""
  try {
    const res = await fetch(host + relativeUrl, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) {
      return reportRequestError<T>("网络异常,请稍后重试", `Failed to ${method} ${relativeUrl}: HTTP ${res.status} ${res.statusText}`)
    }
    return parseResponse<T>(await res.json())
  } catch (error) {
    return reportRequestError<T>("网络异常,请稍后重试", `Failed to ${method} ${relativeUrl}:`, error)
  }
}

export async function topProduct(productId: number): Promise<void> {
  return apiFetch({ path: "/product/top", method: "POST", query: { productId } })
}

export async function cancelTopProduct(productId: number): Promise<void> {
  return apiFetch({ path: "/product/cancelTop", method: "POST", query: { productId } })
}

export async function topVersion(teamId: number): Promise<void> {
  return apiFetch({ path: "/version/top", method: "POST", query: { teamId } })
}

export async function cancelTopVersion(teamId: number): Promise<void> {
  return apiFetch({ path: "/version/cancelTop", method: "POST", query: { teamId } })
}

export async function fetchDomains(): Promise<Domain[]> {
  return apiFetch({ path: "/domain/getDomains" })
}

export async function fetchProductLines(domainId: number): Promise<ProductLine[]> {
  return apiFetch({ path: "/domain/getSubDomains", query: { domainId } })
}

export async function fetchProducts(subDomainId: number): Promise<Product[]> {
  return apiFetch({ path: "/product/getProducts", query: { subDomainId } })
}

export async function fetchVersions(productId: number): Promise<Version[]> {
  return apiFetch({ path: "/version/getVersionByProduct", query: { productId } })
}

export async function searchProducts(searchKey: string): Promise<SearchResult[]> {
  if (!searchKey) return []
  return apiFetch({ path: "/product/search", query: { searchKey } })
}

export async function fetchDomainInfoByProduct(productId: number): Promise<DomainInfoByProduct> {
  return apiFetch({ path: "/domain/getDomainInfoByProduct", query: { productId } })
}

// token 过期检查 — prefix 使用 main
export async function checkTokenExpiration(): Promise<any> {
  return apiFetch({ path: "/token/isExpiration", prefix: API_PREFIXES.main })
}

// deliverable 搜索
export async function searchDeliverables(teamId: number, pageNum: number, pageSize: number): Promise<any> {
  return apiFetch({ path: "/deliverable/search", query: { teamId, pageNum, pageSize } })
}

// deliverable 上传
export async function uploadDeliverable(body: UploadDeliverableBody): Promise<any> {
  return apiFetch({ path: "/deliverable/uploadDeliverable", method: "POST", body })
}

// 按文件夹(teamId)查询活动信息,返回 deliverableType 作为 uploadDeliverable 的 typeId
export async function getActivityByTeam(teamId: number): Promise<ActivityTeamInfo> {
  return apiFetch({ path: "/team/getActivityByTeam", query: { teamId } })
}


