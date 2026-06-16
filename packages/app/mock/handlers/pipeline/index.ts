import type { IncomingMessage, ServerResponse } from "node:http"
import {
  MOCK_DELAY_MS,
  MOCK_DOMAINS,
  MOCK_PRODUCT_LINES,
  MOCK_PRODUCTS,
  MOCK_VERSIONS,
  mockDomainInfoByProduct,
  mockProductCancelTop,
  mockProductTop,
  mockSearchProducts,
  mockVersionCancelTop,
  mockVersionTop,
} from "./data.js"

export const prefix = "/pipeline/rest.root/workflow"

const mockEnabled = () => process.env.MOCK_API !== "false"

function wrapResponse(content: any) {
  return JSON.stringify({ errorCode: 200, errorMessage: "", content })
}

function parseQuery(url: string) {
  const idx = url.indexOf("?")
  if (idx === -1) return {}
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)))
}

function setCors(res: ServerResponse) {
  res.setHeader("Content-Type", "application/json")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

export function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!mockEnabled()) return next()

  const path = req.url!.slice(prefix.length)
  const query = parseQuery(req.url!)

  if (req.method === "OPTIONS") {
    setCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  const route = (() => {
    if (path.startsWith("/domain/getDomains")) return "domains"
    if (path.startsWith("/domain/getSubDomains")) return "productLines"
    if (path.startsWith("/domain/getDomainInfoByProduct")) return "domainInfoByProduct"
    if (path.startsWith("/product/getProducts")) return "products"
    if (path.startsWith("/product/search")) return "search"
    if (path.startsWith("/product/top")) return "productTop"
    if (path.startsWith("/product/cancelTop")) return "productCancelTop"
    if (path.startsWith("/version/getVersionByProduct")) return "versions"
    if (path.startsWith("/version/top")) return "versionTop"
    if (path.startsWith("/version/cancelTop")) return "versionCancelTop"
    return null
  })()

  if (!route) return next()

  setCors(res)

  setTimeout(() => {
    let content: any
    switch (route) {
      case "domains": content = MOCK_DOMAINS; break
      case "productLines": content = MOCK_PRODUCT_LINES[Number(query.domainId)] ?? []; break
      case "products": content = MOCK_PRODUCTS[Number(query.subDomainId)] ?? []; break
      case "versions": content = MOCK_VERSIONS[Number(query.productId)] ?? []; break
      case "search": content = mockSearchProducts(query.searchKey ?? ""); break
      case "domainInfoByProduct": content = mockDomainInfoByProduct(Number(query.productId)); break
      case "productTop": content = mockProductTop(Number(query.productId)); break
      case "productCancelTop": content = mockProductCancelTop(Number(query.productId)); break
      case "versionTop": content = mockVersionTop(Number(query.teamId)); break
      case "versionCancelTop": content = mockVersionCancelTop(Number(query.teamId)); break
    }
    res.end(wrapResponse(content))
  }, MOCK_DELAY_MS)
}
