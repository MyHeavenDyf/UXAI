import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import path from "path"
import { fileURLToPath } from "url"
import { readdirSync, statSync } from "fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_DIR = path.join(__dirname, "api")
const EXAMPLE_DIR = path.join(__dirname, "example")

const COMPONENT_CATALOG: Record<string, string[]> = {
  General: ["Button", "Icon"],
  Navigation: ["Tabs", "TabItem", "Steps", "StepItem", "Breadcrumb", "Dropdown", "Menu"],
  DataEntry: ["Checkbox", "CheckboxGroup", "RadioGroup", "Select", "Slider", "Switch", "Input", "InputNumber", "TextArea", "TimePicker", "DatePicker", "Rate"],
  DataDisplay: ["Tag", "Table", "TableRow", "Collapse", "CollapseItem", "Timeline", "TimelineItem", "Divider", "Badge", "Carousel", "Segmented", "Tree"],
  Response: ["Progress"],
  Chart: ["LineChart", "BarChart", "PieChart", "RadarChart", "GaugeChart", "ProcessChart", "BubbleChart", "AssembleBubbleChart", "BulletChart", "FunnelChart", "HillChart", "ScatterChart", "JadeJueChart", "CircleProcessChart"],
  Custom: ["PatGauge", "PatStackedBar"],
}

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
      } catch {}
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
  return values.map((v) => `\`${v}\``).join(" | ")
}

function formatType(schema: JsonSchema, defs: Record<string, JsonSchema>, sharedDefs: Record<string, JsonSchema>, visited: Set<string>, depth = 0): string {
  if (!schema) return "unknown"
  if (depth > 4) return "..."

  if (schema.$ref) {
    const name = refName(schema.$ref as string)
    const resolved = sharedDefs[name] ?? defs[name]
    if (resolved && !visited.has(name)) {
      visited.add(name)
      return name
    }
    return name
  }

  if (schema.oneOf || schema.anyOf) {
    const options = (schema.oneOf || schema.anyOf) as JsonSchema[]
    return options.map((opt) => formatType(opt, defs, sharedDefs, visited, depth + 1)).filter(Boolean).join(" | ")
  }

  if (schema.enum) return formatEnum(schema)

  if (schema.type === "array") {
    const items = schema.items as JsonSchema | undefined
    const itemType = items ? formatType(items, defs, sharedDefs, visited, depth + 1) : "any"
    return `Array<${itemType}>`
  }

  if (schema.type === "object") {
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>
    if (Object.keys(props).length === 0) return "object"
    const entries = Object.entries(props).slice(0, 8).map(([key, val]) => {
      const desc = val.description ? ` — ${val.description}` : ""
      const typeStr = formatType(val, defs, sharedDefs, visited, depth + 1)
      return `  ${key}: ${typeStr}${desc}`
    })
    if (Object.keys(props).length > 8) entries.push("  ...")
    return `{\n${entries.join("\n")}\n}`
  }

  if (schema.type) {
    if (Array.isArray(schema.type)) return (schema.type as string[]).join(" | ")
    return schema.type as string
  }

  return "unknown"
}

function buildSharedHeader(sharedDefs: Record<string, JsonSchema>): string {
  if (Object.keys(sharedDefs).length === 0) return ""
  const parts: string[] = ["## Shared Definitions\n"]
  for (const [name, defn] of Object.entries(sharedDefs)) {
    const desc = defn.description ? ` — ${defn.description as string}` : ""
    parts.push(`### ${name}${desc}`)
    const props = (defn.properties ?? {}) as Record<string, JsonSchema>
    const required = (defn.required as string[]) ?? []
    for (const [key, val] of Object.entries(props)) {
      const req = required.includes(key) ? " **(required)**" : ""
      const visited = new Set<string>()
      const typeStr = formatType(val, {}, sharedDefs, visited)
      const desc = val.description ? ` — ${val.description}` : ""
      const example = (val as any).examples ? ` e.g. ${JSON.stringify((val as any).examples)}` : ""
      parts.push(`- \`${key}\`: ${typeStr}${req}${desc}${example}`)
    }
    parts.push("")
  }
  return parts.join("\n")
}

function compactSchema(schema: JsonSchema, sharedDefs: Record<string, JsonSchema>): string {
  const title = (schema.title as string) ?? "Unknown"
  const description = (schema.description as string) ?? ""
  const props = ((schema.properties as Record<string, unknown>)?.props as Record<string, unknown>)?.properties as Record<string, JsonSchema> | undefined ?? {}
  const requiredProps = (((schema.properties as Record<string, unknown>)?.props as Record<string, unknown>)?.required as string[]) ?? []
  const children = (schema.properties as Record<string, unknown>)?.children as JsonSchema | undefined
  const defs = getDefs(schema)

  const parts: string[] = []
  parts.push(`### ${title}`)
  if (description) parts.push(description)
  parts.push("")

  if (Object.keys(props).length > 0) {
    parts.push("**Props:**")
    for (const [key, val] of Object.entries(props)) {
      const req = requiredProps.includes(key) ? " **(required)**" : ""
      const visited = new Set<string>()
      const typeStr = formatType(val, defs, sharedDefs, visited)
      const desc = val.description ? ` — ${val.description}` : ""
      parts.push(`- \`${key}\`: ${typeStr}${req}${desc}`)
    }
    parts.push("")
  }

  if (children) {
    const visited = new Set<string>()
    parts.push(`**Children:** ${formatType(children, defs, sharedDefs, visited)}`)
    if (children.description) parts.push(` — ${children.description}`)
    parts.push("")
  }

  return parts.join("\n")
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

          for (const comp of expanded) {
            if (!ALL_COMPONENTS.includes(comp)) continue
            validComps.push(comp)

            const apiFile = apiMap.get(comp)
            if (!apiFile) continue
            const raw = yield* Effect.promise(() => Bun.file(apiFile).text())
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
            const content = yield* Effect.promise(() => Bun.file(exampleFile).text())
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
