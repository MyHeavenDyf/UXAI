// Pipeline API 请求模块 — 内网/外网双路径:
//   内网(Electron + VITE_OCTO_BASE_URL 有值): 通过 IPC → 主进程 net.fetch 直连真实接口(绕过 CORS)
//   外网(Web app 或 host 空): 浏览器 fetch → Vite mock/proxy 拦截
import { showToast } from "@opencode-ai/ui/toast"
import type { Domain, DomainInfoByProduct, Product, ProductLine, SearchResult, Version, UploadDeliverableBody } from "./types"

// 后端路径前缀注册表 — 新增路径时在此添加即可, 各接口函数通过 prefix 参数引用
const API_PREFIXES = {
  pipeline: "/pipeline/rest.root/workflow",
  main: "/main/rest.root/main",
}

// 统一解析后端响应格式: { errorCode:200, content } 或 { data:{ errorCode:200, content } }
function parseResponse<T>(data: any): T {
  const inner = data?.data ?? data
  if (!inner) throw new Error("Empty response")
  if (inner.errorCode === 400 || inner.errorCode === 1417) {
    (window as any).openLogin?.()
    return null as T
  }
  if (inner.errorCode === 200) return inner.content as T
  showToast({ title: inner.errorMessage ?? "" })
  throw new Error(inner.errorMessage ?? "Unknown error")
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

// 通用请求 — body 为 JSON(application/json), 内网走 IPC
async function apiFetch<T>(options: ApiFetchOptions): Promise<T> {
  const { path, method = "GET", query = {}, body, prefix = API_PREFIXES.pipeline } = options
  const relativeUrl = prefix + path + buildQueryString(query)
  const uiplusToken = localStorage.getItem("uiplusToken") ?? ""
  const headers: Record<string, string> = {}
  if (uiplusToken) headers.uiplustoken = uiplusToken
  if (body) headers["content-type"] = "application/json"

  const host = (import.meta.env.VITE_OCTO_BASE_URL as string) ?? ""
  const ipcApi = (window as any).api?.pipelineRequest
  const useIpc = ipcApi && host

  if (useIpc) {
    try {
      const data = await ipcApi(host + relativeUrl, method, uiplusToken, body, headers)
      return parseResponse<T>(data)
    } catch (error) {
      console.error(`Failed to ${method} ${host}${relativeUrl}:`, error)
      return null as T
    }
  }

  try {
    const res = await fetch(host ? host + relativeUrl : relativeUrl, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return parseResponse<T>(await res.json())
  } catch (error) {
    console.error(`Failed to ${method} ${relativeUrl}:`, error)
    return null as T
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

// deliverable 上传 — prefix 使用 main
export async function uploadDeliverable(body: UploadDeliverableBody): Promise<any> {
  return apiFetch({ path: "/deliverable/uploadDeliverable", method: "POST", body, prefix: API_PREFIXES.main })
}


