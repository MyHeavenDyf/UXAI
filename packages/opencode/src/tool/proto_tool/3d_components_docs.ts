import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { createRequire } from "module"

import { readFileSync } from "fs"

import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "3d_components_docs" })

// 通过包导出 @a3d/a3d-components/docs 读取 3d-components 仓库生成的 docs/components.json
// （单一数据源：3d-components `npm run gen:component-docs` 解析 index.html 生成）。
const require = createRequire(import.meta.url)

// ── 文档结构类型（对应 3d-components/docs/components.json）──

interface OptionField {
  name: string
  type: string
  default: string
  description: string
}
interface PropertyField {
  name: string
  type: string
  description: string
}
interface MethodField {
  signature: string
  description: string
}
interface DataType {
  name: string
  fields: OptionField[]
}
interface ComponentDoc {
  name: string
  summary: string
  importPath: string
  extends: string
  constructor: string
  options: OptionField[]
  dataTypes: DataType[]
  properties: PropertyField[]
  methods: MethodField[]
  examples: string[]
  notes?: string[]
}
interface DocIndexEntry {
  name: string
  summary: string
}

// ── 加载（同步，带缓存）──

let docCache: ComponentDoc[] | null = null

function loadDocs(): ComponentDoc[] {
  if (docCache) return docCache
  const file = require.resolve("@a3d/a3d-components/docs")
  const raw = readFileSync(file, "utf-8")
  const docs = JSON.parse(raw) as ComponentDoc[]
  docs.sort((a, b) => a.name.localeCompare(b.name))
  docCache = docs
  log.info(`已加载 ${docs.length} 个 3D 组件文档（${file}）`)
  return docCache
}

export function scanDocIndex(): DocIndexEntry[] {
  return loadDocs().map((d) => ({ name: d.name, summary: d.summary }))
}

// 按组件名（PascalCase，大小写不敏感）查文档
export function findDoc(name: string): ComponentDoc | undefined {
  return loadDocs().find((d) => d.name.toLowerCase() === name.toLowerCase())
}

// list 展示用的一句话摘要：取首个中文句号前，超 60 字截断
function shortSummary(s: string): string {
  const i = s.indexOf("。")
  const first = i >= 0 ? s.slice(0, i) : s
  return first.length > 60 ? first.slice(0, 60) + "…" : first
}

// ── list 工具的过滤（OR 召回）──
function filterIndex(index: DocIndexEntry[], query: string): DocIndexEntry[] {
  const terms = query
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (terms.length === 0) return index
  return index.filter((d) => {
    const hay = `${d.name} ${d.summary}`.toLowerCase()
    return terms.some((t) => hay.includes(t))
  })
}

// ── get 工具的 markdown 格式化 ──
export function formatDoc(doc: ComponentDoc): string {
  const lines: string[] = []
  lines.push(`## ${doc.name}`)
  lines.push(`> ${doc.summary}`)
  lines.push("")
  lines.push(`- import: \`import { ${doc.name} } from '../../../../components'\`  (barrel，handler 相对路径；运行态/导出工程 vendor @a3d 均可解析)`)
  lines.push(`- extends: ${doc.extends}`)
  lines.push(`- 构造: \`${doc.constructor}\``)

  if (doc.options.length > 0) {
    lines.push("")
    lines.push("### Options")
    for (const o of doc.options) {
      lines.push(`- \`${o.name}\` (${o.type}) 默认 \`${o.default}\` — ${o.description}`)
    }
  }
  if (doc.dataTypes.length > 0) {
    lines.push("")
    lines.push("### Data Types")
    for (const dt of doc.dataTypes) {
      lines.push("")
      lines.push(`#### ${dt.name}`)
      for (const f of dt.fields) {
        lines.push(`- \`${f.name}\` (${f.type}) 默认 \`${f.default}\` — ${f.description}`)
      }
    }
  }
  if (doc.properties.length > 0) {
    lines.push("")
    lines.push("### Properties")
    for (const p of doc.properties) {
      lines.push(`- \`${p.name}\` (${p.type}) — ${p.description}`)
    }
  }
  if (doc.methods.length > 0) {
    lines.push("")
    lines.push("### Methods")
    for (const m of doc.methods) {
      lines.push(`- \`${m.signature}\` — ${m.description}`)
    }
  }
  if (doc.examples.length > 0) {
    lines.push("")
    lines.push("### Examples")
    for (const ex of doc.examples) {
      lines.push("")
      lines.push("```ts")
      lines.push(ex)
      lines.push("```")
    }
  }
  if (doc.notes && doc.notes.length > 0) {
    lines.push("")
    lines.push("### Notes")
    for (const n of doc.notes) {
      lines.push(`- ${n}`)
    }
  }
  return lines.join("\n")
}

// ── plan agent 静态注入用：精简目录 ──
// 只保留 name + summary + 构造 + Options + DataTypes（methods/properties/examples/notes 跳过）。
// plan 选型 + 写 build_detail 只需 options 字段与嵌套数据结构；
// methods/examples/properties 对选型无用且体积大，跳过省 token。
// 替代 plan 运行时调 list_3d_components + N×get_3d_component_doc（省 3-7 轮 LLM 往返）。
export function formatCatalog(): string {
  const docs = loadDocs()
  const lines: string[] = []
  for (const doc of docs) {
    lines.push(`### ${doc.name}`)
    lines.push(`> ${shortSummary(doc.summary)}`)
    lines.push(`- extends: ${doc.extends}  (Mesh/Group→group.add，Material→mesh.material=)`)
    lines.push(`- 构造: \`${doc.constructor}\``)
    if (doc.options.length > 0) {
      lines.push("")
      lines.push("Options:")
      for (const o of doc.options) {
        lines.push(`- \`${o.name}\` (${o.type}) 默认 \`${o.default}\` — ${o.description}`)
      }
    }
    if (doc.dataTypes.length > 0) {
      lines.push("")
      lines.push("DataTypes:")
      for (const dt of doc.dataTypes) {
        lines.push(`- **${dt.name}**:`)
        for (const f of dt.fields) {
          lines.push(`  - \`${f.name}\` (${f.type}) 默认 \`${f.default}\` — ${f.description}`)
        }
      }
    }
    // 非 Object3D/材质组件（extends 空，如 HeatMap 纹理生成器）：LLM 无法靠 extends 推断用法，
    // 必须补 properties（怎么取产物）+ methods（怎么操作）。实证：漏补致 HeatMap 被脑补 getTexture()
    // （实际是 texture 属性）渲染失败。
    if (!doc.extends) {
      if (doc.properties.length > 0) {
        lines.push("")
        lines.push("Properties:")
        for (const p of doc.properties) {
          lines.push(`- \`${p.name}\` (${p.type}) — ${p.description}`)
        }
      }
      if (doc.methods.length > 0) {
        lines.push("")
        lines.push("Methods:")
        for (const m of doc.methods) {
          lines.push(`- \`${m.signature}\` — ${m.description}`)
        }
      }
    }
    lines.push("")
  }
  return lines.join("\n")
}

// ── Schema 参数 ──

export const List3dComponentsParameters = Schema.Struct({
  filter: Schema.optional(Schema.String).annotate({
    description: "过滤词，按组件名/用途匹配（空格或逗号分隔，任一命中即返回）；留空返回全部组件目录",
  }),
})

export const Get3dComponentDocParameters = Schema.Struct({
  name: Schema.String.annotate({
    description: "组件名（PascalCase，如 Grid / Wall / InstancedMesh2），从 list_3d_components 取得",
  }),
})

// ── 工具：list_3d_components ──
// 列出 3D 场景可用组件目录（来自 @a3d/a3d-components）。每项含组件名与一句话用途。
// 传 filter 按词过滤（OR 召回），留空返回全部。选定后用 get_3d_component_doc(name) 取全文。
export const List3dComponentsTool = Tool.define(
  "list_3d_components",
  Effect.gen(function* () {
    return {
      description:
        "列出 3D 场景可用的组件目录（来自 @a3d/a3d-components）。每项含组件名与一句话用途。传 filter 按词过滤（空格或逗号分隔，任一命中即返回），留空返回全部。选定后用 get_3d_component_doc(name) 取某组件的构造参数与示例全文。",
      parameters: List3dComponentsParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const { filter } = params as { filter?: string }
          const index = scanDocIndex()
          const matched = filter ? filterIndex(index, filter) : index
          log.info(`list_3d_components: filter="${filter ?? ""}"，命中 ${matched.length}/${index.length}`)
          if (matched.length === 0) {
            return {
              title: `list_3d_components: 0 个`,
              output: `没有匹配「${filter ?? ""}」的组件。可用组件：${index.map((d) => d.name).join(", ") || "（无）"}`,
              metadata: { count: 0 },
            }
          }
          const lines = matched.map((d) => `${d.name} — ${shortSummary(d.summary)}`)
          lines.push("")
          lines.push(`（共 ${matched.length} 个；调用 get_3d_component_doc(name) 取某组件的构造参数与示例全文）`)
          return {
            title: `list_3d_components: ${matched.length} 个`,
            output: lines.join("\n"),
            metadata: { count: matched.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ── 工具：get_3d_component_doc ──
// 获取某个 3D 组件的完整文档（构造签名、Options 字段与默认值、Data Types、属性、方法、示例、注意点）。
// name 必须是 list_3d_components 返回的 PascalCase 组件名。
export const Get3dComponentDocTool = Tool.define(
  "get_3d_component_doc",
  Effect.gen(function* () {
    return {
      description:
        "获取某个 3D 组件的完整文档（构造签名、Options 字段与默认值、Data Types、属性、方法、示例、注意点）。name 必须是 list_3d_components 返回的 PascalCase 组件名。",
      parameters: Get3dComponentDocParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const { name } = params as { name: string }
          const doc = findDoc(name)
          if (!doc) {
            const all = scanDocIndex()
              .map((d) => d.name)
              .join(", ")
            log.warn(`get_3d_component_doc: 未知组件 "${name}"`)
            return {
              title: `get_3d_component_doc: 未知 ${name}`,
              output: `未知组件「${name}」。先调用 list_3d_components 查看可用组件名（PascalCase）。可用：${all || "（无）"}`,
              metadata: { found: false },
            }
          }
          log.info(`get_3d_component_doc: 返回 ${doc.name}`)
          return {
            title: `get_3d_component_doc: ${doc.name}`,
            output: formatDoc(doc),
            metadata: { found: true },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
