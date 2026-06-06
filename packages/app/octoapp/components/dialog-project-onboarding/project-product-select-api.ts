const BASE_URL = "https://octo.hdesign.huawei.com/pipeline/rest.root/workflow"

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

async function request<T>(url: string): Promise<T> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`API request failed: ${res.status} ${res.statusText}`)
    const json = await res.json()
    const data = json.data
    if (!data) throw new Error("API response missing data field")
    if (data.errorCode !== 0) throw new Error(`API error: ${data.errorCode} - ${data.errorMessage}`)
    return data.content as T
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error)
    // throw error
  }
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