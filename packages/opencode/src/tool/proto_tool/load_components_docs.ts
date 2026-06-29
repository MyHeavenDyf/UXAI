import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import path from "path"
import { homedir } from "os"

import { readdirSync, statSync, readFileSync } from "fs"
import { readFile } from "fs/promises"

import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "load_components_docs" })

// 递归扫描 API 目录，发现所有组件
// 父子关系从 api 目录下的 children.json 中读取
function scanApiDir(apiDir: string): { components: string[]; childrenMap: Record<string, string[]> } {
  const components: string[] = []
  let childrenMap: Record<string, string[]> = {}

  const childrenFile = path.join(apiDir, "children.json")
  try {
    const raw = readFileSync(childrenFile, "utf-8")
    childrenMap = JSON.parse(raw)
  } catch {}

  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      try {
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath)
          continue
        }
        if (!entry.endsWith(".json")) continue
        const compName = path.basename(entry, ".json")
        // 跳过 children.json 本身和 H5.json（通用 HTML 容器，不算组件）
        if (compName === "children") continue
        components.push(compName)
      } catch {}
    }
  }
  walk(apiDir)
  return { components, childrenMap }
}

// 按设计系统缓存扫描结果，避免重复扫描同一目录
const scanCache = new Map<string, { components: string[]; childrenMap: Record<string, string[]> }>()

function getScanResult(apiDir: string) {
  if (!scanCache.has(apiDir)) scanCache.set(apiDir, scanApiDir(apiDir))
  return scanCache.get(apiDir)!
}

// 根据设计系统 ID 解析对应的 components 目录路径（从 ~/.config/octo/prototype/ 读取部署后的文件）
function designSystemDir(id: string) {
  return path.join(homedir(), ".config", "octo", "prototype", id, "components")
}

export const Parameters = Schema.Struct({
  components: Schema.Array(Schema.String).annotate({
    description: '组件名称数组，例如 ["Table", "Tabs", "Button"]',
  }),
  designSystem: Schema.optional(Schema.String).annotate({
    description: '设计系统版本，如 "ICT3.1"、"ICT3.2"',
  }),
})

// 根据请求的组件列表，自动补全所需的子组件（如 Table → TableRow）
function expandComponents(input: string[], childrenMap: Record<string, string[]>): string[] {
  const expanded = [...input]
  for (const comp of input) {
    const children = childrenMap[comp] ?? []
    for (const child of children) {
      if (!expanded.includes(child)) expanded.push(child)
    }
  }
  return expanded
}

// 递归遍历目录，构建组件名 → 文件路径的扁平映射
function indexComponentFiles(dir: string): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (currentDir: string) => {
    let entries: string[]
    try { entries = readdirSync(currentDir) } catch { return }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry)
      try {
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath)
        } else {
          map.set(path.basename(fullPath, path.extname(fullPath)), fullPath)
        }
      } catch { }
    }
  }
  walk(dir)
  return map
}

// 按目录缓存文件路径映射，避免重复文件系统扫描
const apiMapCache = new Map<string, Map<string, string>>()
const exampleMapCache = new Map<string, Map<string, string>>()

function getApiMap(apiDir: string) {
  if (!apiMapCache.has(apiDir)) apiMapCache.set(apiDir, indexComponentFiles(apiDir))
  return apiMapCache.get(apiDir)!
}

function getExampleMap(exampleDir: string) {
  if (!exampleMapCache.has(exampleDir)) exampleMapCache.set(exampleDir, indexComponentFiles(exampleDir))
  return exampleMapCache.get(exampleDir)!
}

type JsonSchema = Record<string, unknown>

// 提取 JSON Schema $ref 路径的最后一段名称
function refName(ref: string): string {
  const parts = ref.split("/")
  return parts[parts.length - 1] ?? ref
}

// 提取 JSON Schema 中的 $defs 或 definitions
function getDefs(schema: JsonSchema): Record<string, JsonSchema> {
  return (schema.$defs as Record<string, JsonSchema>) ?? (schema.definitions as Record<string, JsonSchema>) ?? {}
}

// 将 enum 值格式化为联合类型字符串："a" | "b" | "c"
function formatEnum(schema: JsonSchema): string {
  const values = schema.enum as unknown[]
  if (!values) return ""
  return values.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(" | ")
}

// 递归解析 JSON Schema 节点为可读的类型字符串
function formatType(schema: JsonSchema, defs: Record<string, JsonSchema>, sharedDefs: Record<string, JsonSchema>, visited: Set<string>): string {
  if (!schema) return "any"

  if (schema.$ref) {
    const name = refName(schema.$ref as string)
    if (sharedDefs[name]) return name
    if (visited.has(name)) return name
    const defn = defs[name]
    if (!defn) return name
    const newVisited = new Set(visited)
    newVisited.add(name)
    return formatType(defn, defs, sharedDefs, newVisited)
  }

  if (schema.oneOf) {
    return (schema.oneOf as JsonSchema[]).map((opt) => formatType(opt, defs, sharedDefs, visited)).join(" | ")
  }
  if (schema.anyOf) {
    return (schema.anyOf as JsonSchema[]).map((opt) => formatType(opt, defs, sharedDefs, visited)).join(" | ")
  }

  if (schema.enum) return formatEnum(schema)

  if (schema.type === "array") {
    const items = schema.items as JsonSchema | undefined
    const itemType = items ? formatType(items, defs, sharedDefs, visited) : "any"
    return `${itemType}[]`
  }

  if (schema.type === "object") {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>
    if (Object.keys(props).length === 0) return "object"
    const required = (schema.required as string[]) ?? []
    const entries = Object.entries(props).map(([key, val]) => {
      const mark = required.includes(key) ? "" : "?"
      const typeStr = formatType(val, defs, sharedDefs, visited)
      return `\`${key}${mark}\`: ${typeStr}`
    })
    return `{ ${entries.join(", ")} }`
  }

  if (schema.type) {
    if (Array.isArray(schema.type)) return (schema.type as string[]).join(" | ")
    return schema.type as string
  }

  return "any"
}

// 构建共享类型定义的头部章节，用于多个组件复用的类型
function buildSharedHeader(sharedDefs: Record<string, JsonSchema>): string {
  if (Object.keys(sharedDefs).length === 0) return ""
  const lines: string[] = ["## Shared Definitions"]
  lines.push("以下类型定义被组件复用，属性类型标注为这些名称时参照此定义：")

  for (const [name, defn] of Object.entries(sharedDefs)) {
    const desc = defn.description ? defn.description as string : ""
    lines.push("")
    lines.push(`### ${name}`)
    if (desc) lines.push(`> ${desc}`)

    if (defn.type === "object" && defn.properties) {
      const defRequired = new Set((defn.required as string[]) ?? [])
      for (const [pname, pschema] of Object.entries(defn.properties as Record<string, JsonSchema>)) {
        const pdesc = pschema.description ? pschema.description as string : ""
        const opt = defRequired.has(pname) ? "" : "?"
        const examples = (pschema as any).examples as unknown[] | undefined
        const exStr = examples ? ` (e.g., ${examples.map(String).join(", ")})` : ""
        if (pdesc || exStr) {
          lines.push(`- \`${pname}${opt}\`: ${pschema.type ?? "any"}${exStr} — ${pdesc}`)
        } else {
          lines.push(`- \`${pname}${opt}\`: ${pschema.type ?? "any"}`)
        }
      }
    } else if (defn.type === "array" && defn.items) {
      const items = defn.items as JsonSchema
      const itemType = items.type ?? "any"
      const itemDesc = items.description ? items.description as string : ""
      if (itemDesc) {
        lines.push(`类型: ${itemType}[] — ${itemDesc}`)
      } else {
        lines.push(`类型: ${itemType}[]`)
      }
    } else {
      const typeStr = formatType(defn, sharedDefs, {}, new Set())
      lines.push(`类型: ${typeStr}`)
    }
  }

  return lines.join("\n")
}

// 将单个组件的 JSON Schema 格式化为紧凑的 Markdown 文档
function compactSchema(schema: JsonSchema, sharedDefs: Record<string, JsonSchema>): string {
  const defs = getDefs(schema)
  const name = (schema.name as string) ?? (schema.title as string) ?? "Unknown"
  const desc = (schema.description as string) ?? ""
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>

  const lines: string[] = []

  lines.push(`## ${name}`)
  if (desc) lines.push(`> ${desc}`)

  const compConst = (properties.component as JsonSchema)?.const ?? name
  const topParts: string[] = []
  topParts.push("id: string")
  topParts.push(`component: "${compConst}"`)

  const hasProps = "props" in properties
  const hasChildren = "children" in properties

  if (hasProps) topParts.push("props: object")
  if (hasChildren) topParts.push("children: object")

  lines.push("> " + topParts.join(" | "))

// 渲染 props 表格
  if (hasProps) {
    const propsSchema = properties.props
    const propsProps = (propsSchema.properties ?? {}) as Record<string, JsonSchema>
    const propsRequired = new Set((propsSchema.required as string[]) ?? [])

    lines.push("")
    lines.push("### props")

    for (const [pname, pschema] of Object.entries(propsProps)) {
      const pdesc = pschema.description ? pschema.description as string : ""
      const deflt = pschema.default !== undefined ? ` (default: ${JSON.stringify(pschema.default)})` : ""
      const opt = propsRequired.has(pname) ? "" : "?"

      if (pschema.type === "object" && pschema.properties) {
        lines.push(`- \`${pname}${opt}\`:` + (pdesc ? ` — ${pdesc}` : ""))
        const nestedReq = new Set((pschema.required as string[]) ?? [])
        for (const [nk, nv] of Object.entries(pschema.properties as Record<string, JsonSchema>)) {
          const nt = formatType(nv, defs, sharedDefs, new Set())
          const nd = nv.description ? nv.description as string : ""
          const nopt = nestedReq.has(nk) ? "" : "?"
          const ndef = (nv as any).default !== undefined ? ` (default: ${JSON.stringify((nv as any).default)})` : ""
          if (nd) {
            lines.push(`  - \`${nk}${nopt}\`: ${nt}${ndef} — ${nd}`)
          } else {
            lines.push(`  - \`${nk}${nopt}\`: ${nt}${ndef}`)
          }
        }
      } else {
        const typeStr = formatType(pschema, defs, sharedDefs, new Set())
        let line = `- \`${pname}${opt}\`: ${typeStr}${deflt}`
        if (pdesc) line += ` — ${pdesc}`
        lines.push(line)
      }
    }
  }

  // 渲染 children 约束
  if (hasChildren) {
    const childrenSchema = properties.children
    const childrenDesc = childrenSchema.description ? childrenSchema.description as string : ""

    lines.push("")
    lines.push("### children")

    if (childrenSchema.$ref) {
      const ref = refName(childrenSchema.$ref as string)
      if (sharedDefs[ref]) {
        lines.push(`类型: ${ref}`)
      } else if (defs[ref]) {
        const refDef = defs[ref]
        const typeStr = formatType(refDef, defs, sharedDefs, new Set())
        lines.push(`类型: ${typeStr}`)
      } else {
        lines.push(`类型: ${ref}`)
      }
    } else {
      const typeStr = formatType(childrenSchema, defs, sharedDefs, new Set())
      lines.push(`类型: ${typeStr}`)
    }

    if (childrenDesc) lines.push(`> ${childrenDesc}`)
  }

  return lines.join("\n")
}

// 批量格式化多个组件 schema，共享类型定义去重
function compactSchemasBatch(schemas: JsonSchema[]): string {
  const sharedDefs: Record<string, JsonSchema> = {}
  for (const schema of schemas) {
    const defs = getDefs(schema)
    for (const [name, defn] of Object.entries(defs)) {
      if (!sharedDefs[name]) sharedDefs[name] = defn
    }
  }

  const parts: string[] = []
  const header = buildSharedHeader(sharedDefs)
  if (header) parts.push(header)

  for (const schema of schemas) {
    parts.push(compactSchema(schema, sharedDefs))
  }

  return parts.join("\n\n---\n\n")
}

export const LoadComponentsDocsTool = Tool.define(
  "load_components_docs",
  Effect.gen(function* () {
    return {
      description:
        "获取具体组件的 API Schema 和用法示例。传入你决定使用的组件名称数组，例如 [\"Table\", \"Tabs\", \"Button\"]。会自动补充必要的子组件（如 Table → TableRow）。",
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const { components, designSystem } = params as { components: string[]; designSystem?: string }
          // 确定设计系统：优先参数 > ctx.extra > default
          const ds = designSystem || (ctx.extra?.designSystem as string) || "default"
          const resolvedDs = ds === "default" ? "ICT3.1" : ds
          const baseDir = designSystemDir(resolvedDs)
          const apiDir = path.join(baseDir, "api")
          const exampleDir = path.join(baseDir, "example")
          log.info(`[load_components_docs] 请求组件: [${components.join(", ")}]，设计系统: ${ds} → ${resolvedDs}，目录: ${apiDir}`)

          // 发现当前设计系统下的可用组件和父子关系
          const { components: allComponents, childrenMap } = getScanResult(apiDir)
          const expanded = expandComponents(components, childrenMap)
          if (expanded.length !== components.length) {
            log.info(`[load_components_docs] 子组件补全后: [${expanded.join(", ")}]`)
          }

          const validComps: string[] = []
          const apiSchemas: JsonSchema[] = []

          const apiMap = getApiMap(apiDir)
          const exampleMap = getExampleMap(exampleDir)

          for (const comp of expanded) {
            if (!allComponents.includes(comp)) {
              log.warn(`⚠️ 组件 [${comp}] 未在 API 目录中找到，已被过滤`)
              continue
            }
            validComps.push(comp)

            const apiFile = apiMap.get(comp)
            if (!apiFile) {
              log.warn(`❌ 组件 [${comp}] 在设计系统 [${ds}] 的 API 目录下找不到对应的文件`)
              continue
            }

            const raw = yield* Effect.promise(() => readFile(apiFile, "utf-8"))
            const parsed = JSON.parse(raw)
            apiSchemas.push(parsed)
          }

          log.info(`[load_components_docs] 有效组件: [${validComps.join(", ")}]，共 ${apiSchemas.length} 个 schema`)

          const resultParts: string[] = []

          // 将 API schema 渲染为紧凑 Markdown
          if (apiSchemas.length > 0) {
            const compactMd = compactSchemasBatch(apiSchemas)
            resultParts.push(`# 组件 API Schema\n\n${compactMd}`)
          }

          // 追加使用示例
          for (const comp of validComps) {
            const exampleFile = exampleMap.get(comp)
            if (!exampleFile) continue
            const content = yield* Effect.promise(() => readFile(exampleFile, "utf-8"))
            resultParts.push(content)
          }

          return {
            title: `load_components_docs: ${validComps.join(", ")}`,
            output: resultParts.join("\n\n---\n\n"),
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
