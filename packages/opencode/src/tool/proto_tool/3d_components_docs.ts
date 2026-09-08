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

// list 展示用的一句话摘要：取首个中文句号前，超 60 字截断
function shortSummary(s: string): string {
  const i = s.indexOf("。")
  const first = i >= 0 ? s.slice(0, i) : s
  return first.length > 60 ? first.slice(0, 60) + "…" : first
}

// ── codegen prompt 静态注入用：精简目录 ──
// 只保留 name + summary + 构造 + Options + DataTypes（methods/properties/examples/notes 跳过）。
// codegen 写 handler 只需 options 字段与嵌套数据结构；
// methods/examples/properties 对选型无用且体积大，跳过省 token。
// 由 gen-component-catalog.ts 预烘成 .txt 注入 prompt，替代运行时 tool 调用。
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

