// 设置-MCP 添加/编辑表单的校验与提交值构造。
// UI 类型与 octo.json 存储映射:stdio→{type:"local"};http/sse→{type:"remote",transport}。

export type McpFormType = "stdio" | "http" | "sse"

export type McpFormState = {
  name: string
  type: McpFormType
  json: string
  homepage: string
  docs: string
}

export type McpFormErrors = {
  name?: string
  json?: string
  homepage?: string
  docs?: string
}

export type McpFormResult = {
  name: string
  value: Record<string, unknown>
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

type Translator = (key: string, params?: Record<string, string | number | boolean>) => string

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

// SDK 生成的 McpRemoteConfig 类型尚未包含 transport/homepage/docs(SDK 未再生成),
// 运行时响应经 ConfigMCP schema 已包含;编辑预填时统一按宽对象处理。
export function mcpEntryToFormState(name: string, entry: Record<string, unknown>): McpFormState {
  const { type: _type, transport: _transport, homepage, docs, ...rest } = entry
  const transport = _transport === "sse" ? "sse" : "http"
  return {
    name,
    type: _type === "local" ? "stdio" : _type === "remote" ? transport : "http",
    json: JSON.stringify(rest, null, 2),
    homepage: typeof homepage === "string" ? homepage : "",
    docs: typeof docs === "string" ? docs : "",
  }
}

export function validateMcpForm(input: {
  form: McpFormState
  t: Translator
  existingNames: ReadonlySet<string>
}): { errors: McpFormErrors; result?: McpFormResult } {
  const { form, t } = input
  const errors: McpFormErrors = {}

  const name = form.name.trim()
  if (!name) errors.name = t("settings.mcp.form.err.name.required")
  else if (!NAME_PATTERN.test(name)) errors.name = t("settings.mcp.form.err.name.invalid")
  else if (input.existingNames.has(name)) errors.name = t("settings.mcp.form.err.name.duplicate")

  let parsed: Record<string, unknown> | undefined
  const json = form.json.trim()
  if (!json) {
    errors.json = t("settings.mcp.form.err.json.required")
  } else {
    try {
      const value = JSON.parse(json)
      if (!isPlainObject(value)) {
        errors.json = t("settings.mcp.form.err.json.object")
      } else {
        if (form.type === "stdio") {
          const command = value.command
          if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === "string")) {
            errors.json = t("settings.mcp.form.err.json.command")
          }
        } else {
          const url = value.url
          if (typeof url !== "string" || !isValidUrl(url)) errors.json = t("settings.mcp.form.err.json.url")
        }
        if (!errors.json) parsed = value
      }
    } catch {
      errors.json = t("settings.mcp.form.err.json.invalid")
    }
  }

  const homepage = form.homepage.trim()
  if (homepage && !isValidUrl(homepage)) errors.homepage = t("settings.mcp.form.err.homepage")
  const docs = form.docs.trim()
  if (docs && !isValidUrl(docs)) errors.docs = t("settings.mcp.form.err.docs")

  if (errors.name || errors.json || errors.homepage || errors.docs || !parsed) return { errors }

  const value: Record<string, unknown> = {
    ...parsed,
    type: form.type === "stdio" ? "local" : "remote",
    ...(form.type !== "stdio" ? { transport: form.type } : {}),
    ...(homepage ? { homepage } : {}),
    ...(docs ? { docs } : {}),
  }
  return { errors, result: { name, value } }
}
