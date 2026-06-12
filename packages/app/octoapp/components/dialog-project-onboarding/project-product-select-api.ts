import { showToast } from "@opencode-ai/ui/toast";

const BASE_URL = (import.meta.env.VITE_OCTO_BASE_URL ?? "") + "/pipeline/rest.root/workflow"

export type Domain = {
  id: number
  name: string
  industryId: number | null
  parentId: number
  enableView: boolean
  sort: number
  visibleDeptCodes: string | null
}

export type ProductLine = {
  id: number
  name: string
  industryId: number | null
  parentId: number
  enableView: boolean
  sort: number
  visibleDeptCodes: string | null
}

export type Product = {
  id: number
  name: string
  parentId: number
  industryId: number | null
  enableView: boolean
  sort: number
  visibleDeptCodes: string | null
  isEnd: boolean
  isSecret: boolean
  isTop: boolean
  isProductMember: boolean
  deliveryTypeId: number
  commonTeam: number
  commonType: string | null
  count: number | null
  enableDesignReserve: boolean
  enableProductCommon: boolean
}

export type Version = {
  id: number
  name: string
  productId: number
  productName: string
  deliveryTypeId: number
  industryId: number | null
  isEnd: boolean
  isTop: boolean
  modelId: number
  permissionFlag: boolean
  baseTeam: number
  sort: number
  spaceId: number
  userTeamType: number | null
  workflowRoleList: number[]
}

export type SearchResult = {
  productId: number
  name: string
  deliveryTypeId: number
  isEnd: boolean
  isProductMember: boolean
  isSecret: boolean
  isTop: boolean
  count: number | null
  userTeamType: number | null
}

export type DomainInfoByProduct = {
  domain: Domain
  subDomain: ProductLine
  product: Product
}

async function request<T>(url: string, method: string = "GET"): Promise<T> {
  try {
    const uiplusToken = localStorage.getItem("uiplusToken") ?? ""
    const res = await fetch(url, {
      method,
      headers: uiplusToken ? { uiplustoken: uiplusToken } : {},
    })
    if (!res.ok) throw new Error(`API request failed: ${res.status} ${res.statusText}`)
    const text = await res.text();
    const data = JSON.parse(text);
    if (!data) throw new Error("API response missing data field")
    const { content, errorCode, errorMessage } = data;
    if (errorCode ===  400 || errorCode === 1417) {
      (window as any).openLogin?.();
      return null as T;
    }
    if (errorCode === 200) {
      return content as T;
    }
    showToast({title: errorMessage});
    throw new Error(`API error: ${content} - ${errorMessage}`);
  } catch (error) {
    console.error(`Failed to ${method} ${url}:`, error)
    return null as T
  }
}

export async function topProduct(productId: number): Promise<void> {
  return request<void>(`${BASE_URL}/product/top?productId=${productId}`, "POST")
}

export async function cancelTopProduct(productId: number): Promise<void> {
  return request<void>(`${BASE_URL}/product/cancelTop?productId=${productId}`, "POST")
}

export async function topVersion(teamId: number): Promise<void> {
  return request<void>(`${BASE_URL}/version/top?teamId=${teamId}`, "POST")
}

export async function cancelTopVersion(teamId: number): Promise<void> {
  return request<void>(`${BASE_URL}/version/cancelTop?teamId=${teamId}`, "POST")
}

export async function fetchDomains(): Promise<Domain[]> {
  return request<Domain[]>(`${BASE_URL}/domain/getDomains`)
}

export async function fetchProductLines(domainId: number): Promise<ProductLine[]> {
  return request<ProductLine[]>(`${BASE_URL}/domain/getSubDomains?domainId=${domainId}`)
}

export async function fetchProducts(subDomainId: number): Promise<Product[]> {
  return request<Product[]>(`${BASE_URL}/product/getProducts?subDomainId=${subDomainId}`)
}

export async function fetchVersions(productId: number): Promise<Version[]> {
  return request<Version[]>(`${BASE_URL}/version/getversionByProduct?productId=${productId}`)
}

export async function searchProducts(searchKey: string): Promise<SearchResult[]> {
  if (!searchKey) return []
  return request<SearchResult[]>(`${BASE_URL}/product/search?searchKey=${encodeURIComponent(searchKey)}`)
}

export async function fetchDomainInfoByProduct(productId: number): Promise<DomainInfoByProduct> {
  return request<DomainInfoByProduct>(`${BASE_URL}/domain/getDomainInfoByproduct?productId=${productId}`)
}