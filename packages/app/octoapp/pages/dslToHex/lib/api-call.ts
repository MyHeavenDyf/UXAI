// NODE_TLS_REJECT_UNAUTHORIZED=0 时跳过证书校验（内网自签/企业 CA 场景）。
// Bun 的 fetch 不认这个 Node 环境变量，必须显式传 tls 选项。
const FETCH_OPTS = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ? ({ tls: { rejectUnauthorized: false } } as RequestInit)
  : undefined

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
      if (k === "illus_id" || k === "icon_id") {
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
  const res = await fetch(url, FETCH_OPTS)
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
    ...FETCH_OPTS,
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

function safeName(s: string): string {
  // 保留 Unicode 字母/数字（含中文，如 style="线性"），避免不同参数生成同名文件
  return s.replace(/[^\p{L}\p{N}._-]+/gu, "_")
}

// 本文件在 web 包内（无 bun 全局类型），但运行时始终是 bun，从 globalThis 取
const bunWrite = (globalThis as { Bun?: { write(path: string, data: string | Uint8Array): Promise<number> } }).Bun?.write

function looksLikeBase64(s: string): boolean {
  const t = s.trim()
  return t.length > 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(t)
}

// 把素材写入 --save 指定目录，返回文件相对路径；写失败返回 null（调用方回退打印原始内容）
async function saveAsset(dir: string, filename: string, content: string | Uint8Array): Promise<string | null> {
  if (!bunWrite) return null
  const file = `${dir.replace(/\/+$/, "")}/${filename}`
  try {
    await bunWrite(file, content)
    return file
  } catch {
    return null
  }
}

// svg → 原文写 .svg；png → base64 解码写 .png；其余（错误文本等）返回 null 走回退
function assetPayload(data: string, fileType: string, basename: string): { filename: string; content: string | Uint8Array } | null {
  if (data.includes("<svg")) return { filename: `${basename}.svg`, content: data }
  if (fileType === "png" && looksLikeBase64(data)) {
    try {
      return { filename: `${basename}.png`, content: Uint8Array.from(atob(data.trim().replace(/\s+/g, "")), (c) => c.charCodeAt(0)) }
    } catch {
      return null
    }
  }
  return null
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
  const data = await httpGet("/iconPlus/getSvg", params)
  const fileType = opts.fileType || "svg"
  if (opts.save) {
    const themeStyle = opts.style
    const themeColor = opts.color
    const themeSize = opts.size
    // 单 id 返回 JSON envelope {icon_id, name, data}；多 id 返回 [{icon_id, name, data}]；
    // 旧版可能返回裸 SVG 字符串
    if (typeof data === "string") {
      const basename = `icon-${safeName(opts.icon_id)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
      const payload = assetPayload(data, fileType, basename)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ icon_id: opts.icon_id, file, icon_file_type: fileType, size: themeSize, style: themeStyle, color: themeColor })
        return
      }
    }
    if (typeof data === "object" && !Array.isArray(data) && typeof (data as Record<string, unknown>).icon_id === "string" && typeof (data as Record<string, unknown>).data === "string") {
      const envelope = data as { icon_id: string; name?: string; data: string }
      const basename = `icon-${safeName(envelope.icon_id)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
      const payload = assetPayload(envelope.data, fileType, basename)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ icon_id: envelope.icon_id, ...(envelope.name ? { name: envelope.name } : {}), file, icon_file_type: fileType, size: themeSize, style: themeStyle, color: themeColor })
        return
      }
    }
    if (Array.isArray(data)) {
      const entries: unknown[] = []
      for (const item of data as Array<{ icon_id?: string; name?: string; data?: string }>) {
        if (typeof item?.icon_id === "string" && typeof item.data === "string") {
          const basename = `icon-${safeName(item.icon_id)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
          const payload = assetPayload(item.data, fileType, basename)
          const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
          if (file) {
            entries.push({ icon_id: item.icon_id, ...(item.name ? { name: item.name } : {}), file, icon_file_type: fileType, size: themeSize, style: themeStyle, color: themeColor })
            continue
          }
        }
        entries.push(item)
      }
      output(entries)
      return
    }
  }
  output(data)
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
  const data = await httpGet("/illusPlus/getIllus", params)
  // --save <dir>：插画素材落盘（svg 原文 / png 解码 base64），stdout 只打印文件引用 JSON。
  // 单 id 返回裸内容，多 id 返回 [{illus_id, alias, data}]，逐条落盘；识别不了的内容原样输出
  if (opts.save) {
    const theme = opts.theme || "浅色"
    const fileType = opts.fileType || "svg"
    if (typeof data === "string") {
      const payload = assetPayload(data, fileType, `illus-${safeName(opts.illus_id)}-${safeName(theme)}`)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ illus_id: opts.illus_id, file, illus_file_type: fileType, theme })
        return
      }
    }
    if (typeof data === "object" && !Array.isArray(data) && typeof (data as Record<string, unknown>).illus_id === "string" && typeof (data as Record<string, unknown>).data === "string") {
      const envelope = data as { illus_id: string; alias?: string; data: string }
      const payload = assetPayload(envelope.data, fileType, `illus-${safeName(envelope.illus_id)}-${safeName(theme)}`)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ illus_id: envelope.illus_id, ...(envelope.alias ? { alias: envelope.alias } : {}), file, illus_file_type: fileType, theme })
        return
      }
    }
    if (Array.isArray(data)) {
      const entries: unknown[] = []
      for (const item of data as Array<{ illus_id?: string; alias?: string; data?: string }>) {
        if (typeof item?.illus_id === "string" && typeof item.data === "string") {
          const payload = assetPayload(item.data, fileType, `illus-${safeName(item.illus_id)}-${safeName(theme)}`)
          const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
          if (file) {
            entries.push({ illus_id: item.illus_id, ...(item.alias ? { alias: item.alias } : {}), file, illus_file_type: fileType, theme })
            continue
          }
        }
        entries.push(item)
      }
      output(entries)
      return
    }
  }
  output(data)
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
