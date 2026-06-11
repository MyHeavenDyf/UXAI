import type { Plugin } from "vite"
import {
  MOCK_DELAY_MS,
  MOCK_DOMAINS,
  MOCK_PRODUCT_LINES,
  MOCK_PRODUCTS,
  MOCK_VERSIONS,
  mockSearchProducts,
  mockDomainInfoByProduct,
  mockProductTop,
  mockProductCancelTop,
  mockVersionTop,
  mockVersionCancelTop,
} from "./octo-pipeline-mock"

const API_PREFIX = "/pipeline/rest.root/workflow"

export function viteMockPlugin(): Plugin {
  let enabled = true
  return {
    name: "octo:mock-api",
    configResolved(config) {
      enabled = config.mode !== "beta" && config.mode !== "prod" && process.env.MOCK_API !== "false"
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!enabled) return next()
        if (!req.url?.startsWith(API_PREFIX)) return next()

        const path = req.url.slice(API_PREFIX.length)
        const query = parseQuery(req.url)

        const route = (() => {
          if (path.startsWith("/domain/getDomains")) return "domains"
          if (path.startsWith("/domain/getSubDomains")) return "productLines"
          if (path.startsWith("/domain/getDomainInfoByproduct")) return "domainInfoByProduct"
          if (path.startsWith("/product/getProducts")) return "products"
          if (path.startsWith("/product/search")) return "search"
          if (path.startsWith("/product/top")) return "productTop"
          if (path.startsWith("/product/cancelTop")) return "productCancelTop"
          if (path.startsWith("/version/getversionByProduct")) return "versions"
          if (path.startsWith("/version/top")) return "versionTop"
          if (path.startsWith("/version/cancelTop")) return "versionCancelTop"
          return null
        })()

        if (!route) return next()

        if (req.method === "OPTIONS") {
          res.setHeader("Content-Type", "application/json")
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
          res.setHeader("Access-Control-Allow-Headers", "Content-Type")
          res.statusCode = 204
          res.end()
          return
        }

        res.setHeader("Content-Type", "application/json")
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type")

        const delay = MOCK_DELAY_MS
        setTimeout(() => {
          let content: any
          switch (route) {
            case "domains":
              content = MOCK_DOMAINS
              break
            case "productLines":
              content = MOCK_PRODUCT_LINES[Number(query.domainId)] ?? []
              break
            case "products":
              content = MOCK_PRODUCTS[Number(query.subDomainId)] ?? []
              break
            case "versions":
              content = MOCK_VERSIONS[Number(query.productId)] ?? []
              break
            case "search":
              content = mockSearchProducts(query.searchKey ?? "")
              break
            case "domainInfoByProduct":
              content = mockDomainInfoByProduct(Number(query.productId))
              break
            case "productTop":
              content = mockProductTop(Number(query.productId))
              break
            case "productCancelTop":
              content = mockProductCancelTop(Number(query.productId))
              break
            case "versionTop":
              content = mockVersionTop(Number(query.teamId))
              break
            case "versionCancelTop":
              content = mockVersionCancelTop(Number(query.teamId))
              break
          }
          res.end(wrapResponse(content))
        }, delay)
      })
    },
  }
}