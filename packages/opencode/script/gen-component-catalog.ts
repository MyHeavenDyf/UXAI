#!/usr/bin/env bun
/**
 * gen-component-catalog.ts
 * 从 @a3d/a3d-components/docs（单一 JSON 源）生成精简组件目录 .txt，
 * 注入 scene_3d_plan prompt（替代 plan 运行时调 list_3d_components + N×get_3d_component_doc，Step 8 加速①）。
 *
 * 预烘 .txt 而非运行时烘：避免 proto/index.ts → 3d_components_docs 的循环依赖 TDZ
 *（3d_components_docs 经 Tool → proto，若 proto 运行时调 formatCatalog 会在 docCache 初始化前触发 TDZ）。
 *
 * 运行：npm run gen:component-catalog
 * 何时重跑：3d-components 新增/改组件后（先在 3d-components 跑 `npm run gen:component-docs` 产 components.json，
 *           再回 opencode 跑本脚本）。
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { formatCatalog } from "../src/tool/proto_tool/3d_components_docs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const outPath = path.resolve(root, "src/agent/proto/prompt/stastics/COMPONENT_CATALOG.txt")

const catalog = formatCatalog()
fs.writeFileSync(outPath, catalog)
console.log(`gen:component-catalog → 写入 ${catalog.length} 字符到 src/agent/proto/prompt/stastics/COMPONENT_CATALOG.txt`)
