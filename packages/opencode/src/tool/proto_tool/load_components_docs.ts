import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import path from "path"
import { homedir } from "os"
import { readdirSync, statSync, mkdirSync } from "fs"
import { readFile } from "fs/promises"

const CONFIG_DIR = path.join(homedir(), ".config", "octo")
const API_DIR = path.join(CONFIG_DIR, "api")
const EXAMPLE_DIR = path.join(CONFIG_DIR, "example")

mkdirSync(API_DIR, { recursive: true })
mkdirSync(EXAMPLE_DIR, { recursive: true })
import * as Log from "@opencode-ai/core/util/log"

const COMPONENT_CATALOG: Record<string, string[]> = {
  General: ["Button", "Icon"],
  Navigation: ["Tabs", "TabItem", "Steps", "StepItem", "Breadcrumb", "Dropdown", "Menu"],
  DataEntry: ["Checkbox", "CheckboxGroup", "RadioGroup", "Select", "Slider", "Switch", "Input", "InputNumber", "TextArea", "TimePicker", "DatePicker", "Rate"],
  DataDisplay: ["Tag", "Table", "TableRow", "Collapse", "CollapseItem", "Timeline", "TimelineItem", "Divider", "Badge", "Carousel", "Segmented", "Tree"],
  Response: ["Progress"],
  Chart: ["LineChart", "BarChart", "PieChart", "RadarChart", "GaugeChart", "ProcessChart", "BubbleChart", "AssembleBubbleChart", "BulletChart", "FunnelChart", "HillChart", "ScatterChart", "JadeJueChart", "CircleProcessChart"],
  Custom: ["PatGauge", "PatStackedBar"],
}

const log = Log.create({ service: "load_components_docs" })

const COMPONENT_CHILDREN: Record<string, string[]> = {
  Tabs: ["TabItem"],
  Steps: ["StepItem"],
  Table: ["TableRow"],
  Collapse: ["CollapseItem"],
  Timeline: ["TimelineItem"],
}

export const Parameters = Schema.Struct({
  components: Schema.Array(Schema.String).annotate({
    description: '组件名称数组，例如 ["Table", "Tabs", "Button"]',
  }),
})

const ALL_COMPONENTS = Object.values(COMPONENT_CATALOG).flat()

function expandComponents(input: string[]): string[] {
  const expanded = [...input]
  for (const comp of input) {
    const children = COMPONENT_CHILDREN[comp] ?? []
    for (const child of children) {
      if (!expanded.includes(child)) expanded.push(child)
    }
  }
  return expanded
}

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

let _apiMap: Map<string, string> | null = null
let _exampleMap: Map<string, string> | null = null

function getApiMap() {
  if (!_apiMap) _apiMap = indexComponentFiles(API_DIR)
  return _apiMap
}

function getExampleMap() {
  if (!_exampleMap) _exampleMap = indexComponentFiles(EXAMPLE_DIR)
  return _exampleMap
}

type JsonSchema = Record<string, unknown>

function refName(ref: string): string {
  const parts = ref.split("/")
  return parts[parts.length - 1] ?? ref
}

function getDefs(schema: JsonSchema): Record<string, JsonSchema> {
  return (schema.$defs as Record<string, JsonSchema>) ?? (schema.definitions as Record<string, JsonSchema>) ?? {}
}

function formatEnum(schema: JsonSchema): string {
  const values = schema.enum as unknown[]
  if (!values) return ""
  return values.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(" | ")
}

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
          const { components } = params as { components: string[] }
          const expanded = expandComponents(components)

          const validComps: string[] = []
          const apiSchemas: JsonSchema[] = []

          const apiMap = getApiMap()
          const exampleMap = getExampleMap()

          log.warn("=== [DEBUG] 路径检查 ===");
          log.warn("API_DIR 实际扫描路径", { path: API_DIR });
          log.warn("API_DIR 扫描到的所有组件 Key", { keys: Array.from(apiMap.keys()) });
          log.warn("=======================");

          for (const comp of expanded) {
            if (!ALL_COMPONENTS.includes(comp)) {
              log.warn(`⚠️ 组件 [${comp}] 没在 COMPONENT_CATALOG 注册，已被过滤`);
              continue
            }
            validComps.push(comp)

            const apiFile = apiMap.get(comp)
            // ======= 【DEBUG 2】打印文件匹配情况 =======
            if (!apiFile) {
              log.warn(`❌ 组件 [${comp}] 注册了，但在 API 目录下找不到对应的文件名！`);
              continue
            }

            log.warn(`✅ 成功找到组件 [${comp}] 的文件`, { file: apiFile });
            const raw = yield* Effect.promise(() => readFile(apiFile, "utf-8"))
            const parsed = JSON.parse(raw)
            apiSchemas.push(parsed)
          }

          const resultParts: string[] = []

          if (apiSchemas.length > 0) {
            const compactMd = compactSchemasBatch(apiSchemas)
            resultParts.push(`# 组件 API Schema\n\n${compactMd}`)
          }

          for (const comp of validComps) {
            const exampleFile = exampleMap.get(comp)
            if (!exampleFile) continue
            const content = yield* Effect.promise(() => readFile(exampleFile, "utf-8"))
            resultParts.push(content)
          }
          log.warn("=========================================================tool", {
            params,
            title: `load_components_docs: ${validComps.join(", ")}`,
            output: resultParts.join("\n\n---\n\n"),
            metadata: {},
          })
          return {
            title: `load_components_docs: ${validComps.join(", ")}`,
            output: resultParts.join("\n\n---\n\n"),
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
