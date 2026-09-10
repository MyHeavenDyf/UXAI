// Pipeline API 请求模块 — 浏览器 fetch 直连后端:
//   host 取自 VITE_OCTO_BASE_URL; 空值时走相对路径(由 Vite mock/proxy 拦截)
//   跨域直连 + 鉴权(uiplustoken/cookie)由 desktop 主进程 webRequest 拦截统一注入,
//   详见 packages/desktop/src/main/windows.ts;纯 web 环境下 host 需同源或经 Vite proxy。
import { showToast } from "@opencode-ai/ui/toast"
import type { Domain, DomainInfoByProduct, Product, ProductLine, SearchResult, Version, UploadDeliverableBody, ActivityTeamInfo, UploadDeliverableResult } from "./types"

// 后端路径前缀注册表 — 新增路径时在此添加即可, 各接口函数通过 prefix 参数引用
const API_PREFIXES = {
  pipeline: "/pipeline/rest.root/workflow",
  main: "/main/rest.root/main",
  designAgent: "/main/rest.root/octoAgentServer/designAgent",
  deliverable: "/main/rest.root/workflow/deliverable",
}

// 请求失败统一上报: 右下角 toast 报错(非阻断, 不中断用户) + 详情进 console;
// 返回 null 让调用方降级为空态, 不抛异常 → 既不整页崩溃也不把面板替换成报错页。
// silent=true 时仅 console.error、不弹 toast, 供需自定义失败提示的调用方使用(如归档自行 throw)。
function reportRequestError<T>(userMessage: string, silent: boolean, ...consoleArgs: any[]): T {
  console.error(...consoleArgs)
  if (!silent) showToast({ title: userMessage, variant: "error" })
  return null as T
}

// 统一解析后端响应格式: { errorCode:200, content } 或 { data:{ errorCode:200, content } }
function parseResponse<T>(data: any, silent = false): T {
  const inner = data?.data ?? data
  if (!inner) return reportRequestError<T>("网络异常,请稍后重试", silent, "Empty response")
  if (inner.errorCode === 400 || inner.errorCode === 1417) {
    ;(window as any).openLogin?.() // 登录态失效 → 跳登录,非错误,不弹 toast(与 silent 无关,任何调用都应跳)
    return null as T
  }
  if (inner.errorCode === 200) return inner.content as T
  return reportRequestError<T>(inner.errorMessage || "请求失败,请稍后重试", silent, inner.errorMessage ?? "Unknown error", inner)
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
  body?: any            // JSON body(application/json, 自动 stringify)
  formData?: FormData   // multipart body(原样透传, 不设 content-type, 让浏览器带 boundary)
  prefix?: string
  raw?: boolean         // true: 返回 res.json() 原样, 不走 errorCode 解包(用于非 {errorCode,content} 形态的接口)
  silent?: boolean      // true: 失败仅 console.error、不弹 toast
}

// 通用请求 — 浏览器 fetch 直连后端
async function apiFetch<T>(options: ApiFetchOptions): Promise<T> {
  const { path, method = "GET", query = {}, body, formData, prefix = API_PREFIXES.pipeline, raw = false, silent = false } = options
  const relativeUrl = prefix + path + buildQueryString(query)
  const headers: Record<string, string> = {}
  if (body) headers["content-type"] = "application/json"

  const host = (import.meta.env.VITE_OCTO_BASE_URL as string) ?? ""
  try {
    const res = await fetch(host + relativeUrl, { method, headers, body: body ? JSON.stringify(body) : formData })
    if (!res.ok) {
      return reportRequestError<T>("网络异常,请稍后重试", silent, `Failed to ${method} ${relativeUrl}: HTTP ${res.status} ${res.statusText}`)
    }
    const data = await res.json()
    return raw ? (data as T) : parseResponse<T>(data, silent)
  } catch (error) {
    return reportRequestError<T>("网络异常,请稍后重试", silent, `Failed to ${method} ${relativeUrl}:`, error)
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

// deliverable 上传(apiFetch 失败返回 null,见 reportRequestError)
export async function uploadDeliverable(body: UploadDeliverableBody): Promise<UploadDeliverableResult[] | null> {
  return apiFetch({ path: "/deliverable/uploadDeliverable", method: "POST", body })
}

// 按文件夹(teamId)查询活动信息,返回 deliverableType 作为 uploadDeliverable 的 typeId
export async function getActivityByTeam(teamId: number): Promise<ActivityTeamInfo | null> {
  return apiFetch({ path: "/team/getActivityByTeam", query: { teamId } })
}

// ── 归档(HTML 复刻 Design 流程)走 apiFetch,统一 baseUrl/prefix 与错误上报 ──

export type CreateDeliverableResult = { deliverableId: number; uniqueId: string }

// 新建 deliverable(designAgent 前缀,JSON);无该文件夹权限(401)或其他失败返回 null(silent,由调用方 throw 自定义提示)
export async function createDeliverable(teamId: number, fileName: string): Promise<CreateDeliverableResult> {
  const content = await apiFetch<{ deliverableId?: number; id?: number; uniqueId?: string; docId?: string }>({
    path: "/createDeliverable",
    method: "POST",
    prefix: API_PREFIXES.designAgent,
    body: { teamId, typeId: 41, fileName: fileName.replace(/\.html?$/i, "") },
    silent: true,
  })
  if (!content) throw new Error("无该文件夹权限或创建失败")
  const deliverableId = content.deliverableId ?? content.id
  const uniqueId = content.uniqueId ?? content.docId
  if (deliverableId == null || !uniqueId) throw new Error("createDeliverable 返回内容缺失")
  return { deliverableId, uniqueId }
}

// 上传 deliverable 封面图(deliverable 前缀,multipart);失败抛错(由调用方 toast)
// raw:true — 该接口不走 {errorCode,content} 包装,返回裸 {success,...}(待联调确认;若实为标准形态,去掉 raw 走 parseResponse)
export async function uploadCover(deliverableId: number, file: Blob): Promise<void> {
  const formData = new FormData()
  formData.append("uploadFile", file, "screenshot.jpg")
  formData.append("deliverableId", String(deliverableId))
  const res = await apiFetch<any>({ path: "/uploadCover", method: "POST", prefix: API_PREFIXES.deliverable, formData, raw: true, silent: true })
  if (!res) throw new Error("封面上传失败")
}

// 上传 deliverable 版本 zip(designAgent 前缀,multipart);返回 { success }，失败时 success=false(已 silent，由调用方判 false 后 throw)
// raw:true — 该接口不走 {errorCode,content} 包装,返回裸 {success,...}(待联调确认;若实为标准形态,去掉 raw 走 parseResponse)
export async function uploadVersion(uniqueId: string, file: Blob): Promise<{ success: boolean }> {
  const formData = new FormData()
  formData.append("file", file, "archive.zip")
  formData.append("uniqueId", uniqueId)
  formData.append("fileSource", "Design")
  const res = await apiFetch<any>({ path: "/uploadVersion", method: "POST", prefix: API_PREFIXES.designAgent, formData, raw: true, silent: true })
  return { success: res?.success ?? false }
}


