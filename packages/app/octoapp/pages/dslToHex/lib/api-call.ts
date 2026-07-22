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
      if (k === "url" || k === "illus_id" || k === "icon_id" || k === "image_id") {
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
  return s.replace(/[^\p{L}\p{N}._-]+/gu, "_")
}

const bunWrite = (globalThis as { Bun?: { write(path: string, data: string | Uint8Array): Promise<number> } }).Bun?.write

function looksLikeBase64(s: string): boolean {
  const t = s.trim()
  return t.length > 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(t)
}

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

function assetPayload(data: string, fileType: string, basename: string): { filename: string; content: string | Uint8Array } | null {
  if (data.includes("<svg")) return { filename: `${basename}.svg`, content: data }
  if (fileType === "png" && looksLikeBase64(data)) {
    try {
      return { filename: `${basename}.png`, content: Uint8Array.from(atob(data.trim().replace(/\s+/g, "")), (c) => c.charCodeAt(0)) }
    } catch {
      return null
    }
  }
  // jpg: base64 解码写 .jpg（与 png 解码逻辑相同，扩展名不同）
  if ((fileType === "jpg" || fileType === "jpeg") && looksLikeBase64(data)) {
    try {
      return { filename: `${basename}.jpg`, content: Uint8Array.from(atob(data.trim().replace(/\s+/g, "")), (c) => c.charCodeAt(0)) }
    } catch {
      return null
    }
  }
  return null
}

// 将逗号分隔的 ids 字符串与 urls 字符串按位置配对，用于 --save 回填标识。
// 如果 ids 数量少于 urls，缺失位置用空字符串占位。
function zipIdsWithUrls(idsStr: string | undefined, urlsStr: string): Array<{ id: string; url: string }> {
  const urls = urlsStr.split(",").map((u) => u.trim())
  const ids = idsStr ? idsStr.split(",").map((i) => i.trim()) : []
  return urls.map((url, idx) => ({ id: ids[idx] ?? "", url }))
}

async function handleGetConfig(opts: Record<string, string>): Promise<void> {
  const flow = opts.flow
  if (flow === "icon") {
    output(await httpGet("/iconPlus/getConfig", {}))
  } else if (flow === "illus") {
    output(await httpGet("/illusPlus/getConfig", {}))
  } else if (flow === "image") {
    output(await httpGet("/imagePlus/getConfig", {}))
  } else {
    console.error(`Unknown flow: ${flow}. Use "icon", "illus", or "image".`)
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
  if (opts.category) params.category = opts.category
  if (opts.group_id) params.group_id = opts.group_id
  if (opts.source_id) params.source_id = opts.source_id
  output(await httpGet("/iconPlus/getIconInfo", params))
}

async function handleGetIcon(opts: Record<string, string>): Promise<void> {
  if (!opts.url) {
    console.error("Missing required parameter: --url")
    process.exit(1)
  }
  const params: Record<string, string> = { url: opts.url }
  if (opts.size) params.size = opts.size
  if (opts.style) params.style = opts.style
  if (opts.color) params.color = opts.color
  if (opts.fileType) params.fileType = opts.fileType
  const data = await httpGet("/iconPlus/getIcon", params)
  const fileType = opts.fileType || "svg"
  if (opts.save) {
    const themeStyle = opts.style ?? ""
    const themeColor = opts.color ?? ""
    const themeSize = opts.size ?? ""
    const pairs = zipIdsWithUrls(opts.icon_id, opts.url)
    // 单 url 返回 {url, name, data}；多 url 返回 [{url, name, data}]；旧版可能返回裸 SVG
    if (typeof data === "string") {
      const pair = pairs[0]
      const basename = pair.id
        ? `icon-${safeName(pair.id)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
        : `icon-${safeName(pair.url)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
      const payload = assetPayload(data, fileType, basename)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ ...(pair.id ? { icon_id: pair.id } : {}), url: pair.url, file, icon_file_type: fileType, size: themeSize, style: themeStyle, color: themeColor })
        return
      }
    }
    if (typeof data === "object" && !Array.isArray(data)) {
      const envelope = data as Record<string, unknown>
      const respUrl = typeof envelope.url === "string" ? envelope.url : pairs[0].url
      const respName = typeof envelope.name === "string" ? envelope.name : ""
      const respData = typeof envelope.data === "string" ? envelope.data : ""
      if (respData) {
        const pair = pairs[0]
        const basename = pair.id
          ? `icon-${safeName(pair.id)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
          : `icon-${safeName(respUrl)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
        const payload = assetPayload(respData, fileType, basename)
        const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
        if (file) {
          output({ ...(pair.id ? { icon_id: pair.id } : {}), url: respUrl, ...(respName ? { name: respName } : {}), file, icon_file_type: fileType, size: themeSize, style: themeStyle, color: themeColor })
          return
        }
      }
    }
    if (Array.isArray(data)) {
      const entries: unknown[] = []
      const items = data as Array<Record<string, unknown>>
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]
        const pair = pairs[idx] ?? { id: "", url: "" }
        const respUrl = typeof item.url === "string" ? item.url : pair.url
        const respName = typeof item.name === "string" ? item.name : ""
        const respData = typeof item.data === "string" ? item.data : ""
        if (respData) {
          const basename = pair.id
            ? `icon-${safeName(pair.id)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
            : `icon-${safeName(respUrl)}-${safeName(themeSize)}-${safeName(themeStyle)}-${safeName(themeColor)}`
          const payload = assetPayload(respData, fileType, basename)
          const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
          if (file) {
            entries.push({ ...(pair.id ? { icon_id: pair.id } : {}), url: respUrl, ...(respName ? { name: respName } : {}), file, icon_file_type: fileType, size: themeSize, style: themeStyle, color: themeColor })
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
  if (opts.source_id) params.source_id = opts.source_id
  if (opts.group_id) params.group_id = opts.group_id
  output(await httpGet("/illusPlus/getIllusInfo", params))
}

async function handleGetIllus(opts: Record<string, string>): Promise<void> {
  if (!opts.url) {
    console.error("Missing required parameter: --url")
    process.exit(1)
  }
  const params: Record<string, string> = { url: opts.url }
  if (opts.theme) params.theme = opts.theme
  if (opts.fileType) params.fileType = opts.fileType
  const data = await httpGet("/illusPlus/getIllus", params)
  if (opts.save) {
    const theme = opts.theme || "浅色"
    const fileType = opts.fileType || "svg"
    const pairs = zipIdsWithUrls(opts.illus_id, opts.url)
    if (typeof data === "string") {
      const pair = pairs[0]
      const basename = pair.id
        ? `illus-${safeName(pair.id)}-${safeName(theme)}`
        : `illus-${safeName(pair.url)}-${safeName(theme)}`
      const payload = assetPayload(data, fileType, basename)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ ...(pair.id ? { illus_id: pair.id } : {}), url: pair.url, file, illus_file_type: fileType, theme })
        return
      }
    }
    if (typeof data === "object" && !Array.isArray(data)) {
      const envelope = data as Record<string, unknown>
      const respId = typeof envelope.illus_id === "string" ? envelope.illus_id : (pairs[0].id || "")
      const respAlias = typeof envelope.alias === "string" ? envelope.alias : ""
      const respData = typeof envelope.data === "string" ? envelope.data : ""
      if (respData) {
        const pair = pairs[0]
        const idForName = pair.id || respId
        const basename = idForName
          ? `illus-${safeName(idForName)}-${safeName(theme)}`
          : `illus-${safeName(pair.url)}-${safeName(theme)}`
        const payload = assetPayload(respData, fileType, basename)
        const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
        if (file) {
          output({ ...(idForName ? { illus_id: idForName } : {}), ...(respAlias ? { alias: respAlias } : {}), url: pair.url, file, illus_file_type: fileType, theme })
          return
        }
      }
    }
    if (Array.isArray(data)) {
      const entries: unknown[] = []
      const items = data as Array<Record<string, unknown>>
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]
        const pair = pairs[idx] ?? { id: "", url: "" }
        const respId = typeof item.illus_id === "string" ? item.illus_id : pair.id
        const respAlias = typeof item.alias === "string" ? item.alias : ""
        const respData = typeof item.data === "string" ? item.data : ""
        if (respData) {
          const idForName = pair.id || respId
          const basename = idForName
            ? `illus-${safeName(idForName)}-${safeName(theme)}`
            : `illus-${safeName(pair.url)}-${safeName(theme)}`
          const payload = assetPayload(respData, fileType, basename)
          const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
          if (file) {
            entries.push({ ...(idForName ? { illus_id: idForName } : {}), ...(respAlias ? { alias: respAlias } : {}), url: pair.url, file, illus_file_type: fileType, theme })
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

async function handleGetImageInfo(opts: Record<string, string>): Promise<void> {
  if (!opts.keyword) {
    console.error("Missing required parameter: --keyword")
    process.exit(1)
  }
  const params: Record<string, string> = { keyword: opts.keyword }
  if (opts.topK) params.topK = opts.topK
  if (opts.source_id) params.source_id = opts.source_id
  if (opts.group_id) params.group_id = opts.group_id
  output(await httpGet("/imagePlus/getImageInfo", params))
}

async function handleGetImage(opts: Record<string, string>): Promise<void> {
  if (!opts.url) {
    console.error("Missing required parameter: --url")
    process.exit(1)
  }
  const params: Record<string, string> = { url: opts.url }
  if (opts.theme) params.theme = opts.theme
  if (opts.fileType) params.fileType = opts.fileType
  const data = await httpGet("/imagePlus/getImage", params)
  if (opts.save) {
    const theme = opts.theme || "浅色"
    const fileType = opts.fileType || "svg"
    const pairs = zipIdsWithUrls(opts.image_id, opts.url)
    if (typeof data === "string") {
      const pair = pairs[0]
      const basename = pair.id
        ? `image-${safeName(pair.id)}-${safeName(theme)}`
        : `image-${safeName(pair.url)}-${safeName(theme)}`
      const payload = assetPayload(data, fileType, basename)
      const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
      if (file) {
        output({ ...(pair.id ? { image_id: pair.id } : {}), url: pair.url, file, image_file_type: fileType, theme })
        return
      }
    }
    if (typeof data === "object" && !Array.isArray(data)) {
      const envelope = data as Record<string, unknown>
      const respUrl = typeof envelope.url === "string" ? envelope.url : pairs[0].url
      const respName = typeof envelope.name === "string" ? envelope.name : ""
      const respFormat = typeof envelope.format === "string" ? envelope.format : fileType
      const respData = typeof envelope.data === "string" ? envelope.data : ""
      if (respData) {
        const pair = pairs[0]
        const resolvedFileType = respFormat === "jpg" || respFormat === "jpeg" ? respFormat : fileType
        const basename = pair.id
          ? `image-${safeName(pair.id)}-${safeName(theme)}`
          : `image-${safeName(respUrl)}-${safeName(theme)}`
        const payload = assetPayload(respData, resolvedFileType, basename)
        const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
        if (file) {
          output({ ...(pair.id ? { image_id: pair.id } : {}), url: respUrl, ...(respName ? { name: respName } : {}), ...(respFormat ? { format: respFormat } : {}), file, image_file_type: resolvedFileType, theme })
          return
        }
      }
    }
    if (Array.isArray(data)) {
      const entries: unknown[] = []
      const items = data as Array<Record<string, unknown>>
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]
        const pair = pairs[idx] ?? { id: "", url: "" }
        const respUrl = typeof item.url === "string" ? item.url : pair.url
        const respName = typeof item.name === "string" ? item.name : ""
        const respFormat = typeof item.format === "string" ? item.format : fileType
        const respData = typeof item.data === "string" ? item.data : ""
        if (respData) {
          const resolvedFileType = respFormat === "jpg" || respFormat === "jpeg" ? respFormat : fileType
          const basename = pair.id
            ? `image-${safeName(pair.id)}-${safeName(theme)}`
            : `image-${safeName(respUrl)}-${safeName(theme)}`
          const payload = assetPayload(respData, resolvedFileType, basename)
          const file = payload ? await saveAsset(opts.save, payload.filename, payload.content) : null
          if (file) {
            entries.push({ ...(pair.id ? { image_id: pair.id } : {}), url: respUrl, ...(respName ? { name: respName } : {}), ...(respFormat ? { format: respFormat } : {}), file, image_file_type: resolvedFileType, theme })
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
  const detail = await httpGet("/lib-resource-service/api/vector/detail", { type: opts.type, data_id: opts.data_id })
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    output({ data_id: opts.data_id, ...(detail as Record<string, unknown>) })
    return
  }
  output(detail)
}

const handlers: Record<string, (opts: Record<string, string>) => Promise<void>> = {
  getConfig: handleGetConfig,
  getIconInfo: handleGetIconInfo,
  getIcon: handleGetIcon,
  getIllusInfo: handleGetIllusInfo,
  getIllus: handleGetIllus,
  getImageInfo: handleGetImageInfo,
  getImage: handleGetImage,
  vectorSearch: handleVectorSearch,
  vectorDetail: handleVectorDetail,
}

const { command, opts } = parseArgs()

if (!handlers[command]) {
  console.error(
    `Unknown command: ${command}\nAvailable commands: getConfig, getIconInfo, getIcon, getIllusInfo, getIllus, getImageInfo, getImage, vectorSearch, vectorDetail`,
  )
  process.exit(1)
}

handlers[command](opts)
