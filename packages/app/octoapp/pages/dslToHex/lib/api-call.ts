if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
}

const VECTOR_API_BASE = process.env.VECTOR_API_BASE || "https://octo-beta.hdesign.huawei.com"

function parseArgs(): { command: string; opts: Record<string, string> } {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const opts: Record<string, string> = {}
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2)
      const value = argv[i + 1]
      if (value && !value.startsWith("--")) {
        opts[key] = value
        i++
      } else {
        opts[key] = "true"
      }
    }
  }
  return { command, opts }
}

function encodeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => {
      if (k === "illus_id") {
        const encoded = v.split(",").map((id) => encodeURIComponent(id.trim())).join(",")
        return `${encodeURIComponent(k)}=${encoded}`
      }
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    })
    .join("&")
}

async function httpGet(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = encodeQuery(params)
  const url = qs ? `${VECTOR_API_BASE}${path}?${qs}` : `${VECTOR_API_BASE}${path}`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}: ${url}`)
    process.exit(1)
  }
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function httpPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${VECTOR_API_BASE}${path}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}: ${url}`)
    process.exit(1)
  }
  return await res.json()
}

function output(data: unknown): void {
  if (typeof data === "string") {
    console.log(data)
  } else {
    console.log(JSON.stringify(data, null, 2))
  }
}

async function handleGetConfig(opts: Record<string, string>): Promise<void> {
  const flow = opts.flow
  if (flow === "icon") {
    output(await httpGet("/iconPlus/getConfig", {}))
  } else if (flow === "illus") {
    output(await httpGet("/illusPlus/getConfig", {}))
  } else {
    console.error(`Unknown flow: ${flow}. Use "icon" or "illus".`)
    process.exit(1)
  }
}

async function handleGetIconInfo(opts: Record<string, string>): Promise<void> {
  if (!opts.keyword) {
    console.error("Missing required parameter: --keyword")
    process.exit(1)
  }
  const params: Record<string, string> = { keyword: opts.keyword }
  if (opts.topK) params.topK = opts.topK
  if (opts.Category) params.Category = opts.Category
  output(await httpGet("/iconPlus/getIconInfo", params))
}

async function handleGetSvg(opts: Record<string, string>): Promise<void> {
  if (!opts.icon_id || !opts.size || !opts.style || !opts.color) {
    console.error("Missing required parameters: --icon_id, --size, --style, --color")
    process.exit(1)
  }
  const params: Record<string, string> = {
    icon_id: opts.icon_id,
    size: opts.size,
    style: opts.style,
    color: opts.color,
  }
  if (opts.fileType) params.fileType = opts.fileType
  output(await httpGet("/iconPlus/getSvg", params))
}

async function handleGetIllusInfo(opts: Record<string, string>): Promise<void> {
  if (!opts.keyword) {
    console.error("Missing required parameter: --keyword")
    process.exit(1)
  }
  const params: Record<string, string> = { keyword: opts.keyword }
  if (opts.topK) params.topK = opts.topK
  if (opts.Category) params.Category = opts.Category
  output(await httpGet("/illusPlus/getIllusInfo", params))
}

async function handleGetIllus(opts: Record<string, string>): Promise<void> {
  if (!opts.illus_id) {
    console.error("Missing required parameter: --illus_id")
    process.exit(1)
  }
  const params: Record<string, string> = { illus_id: opts.illus_id }
  if (opts.theme) params.theme = opts.theme
  if (opts.fileType) params.fileType = opts.fileType
  output(await httpGet("/illusPlus/getIllus", params))
}

async function handleVectorSearch(opts: Record<string, string>): Promise<void> {
  if (!opts.type || !opts.queries) {
    console.error("Missing required parameters: --type, --queries")
    process.exit(1)
  }
  const queries = opts.queries.split(",").map((q) => q.trim())
  const body: Record<string, unknown> = {
    type: opts.type,
    queries,
    top_k: opts.top_k ? parseInt(opts.top_k, 10) : 5,
  }
  output(await httpPost("/lib-resource-service/api/vector/search/llm", body))
}

async function handleVectorDetail(opts: Record<string, string>): Promise<void> {
  if (!opts.type || !opts.data_id) {
    console.error("Missing required parameters: --type, --data_id")
    process.exit(1)
  }
  output(await httpGet("/lib-resource-service/api/vector/detail", { type: opts.type, data_id: opts.data_id }))
}

const handlers: Record<string, (opts: Record<string, string>) => Promise<void>> = {
  getConfig: handleGetConfig,
  getIconInfo: handleGetIconInfo,
  getSvg: handleGetSvg,
  getIllusInfo: handleGetIllusInfo,
  getIllus: handleGetIllus,
  vectorSearch: handleVectorSearch,
  vectorDetail: handleVectorDetail,
}

const { command, opts } = parseArgs()

if (!handlers[command]) {
  console.error(
    `Unknown command: ${command}\nAvailable commands: getConfig, getIconInfo, getSvg, getIllusInfo, getIllus, vectorSearch, vectorDetail`,
  )
  process.exit(1)
}

handlers[command](opts)
