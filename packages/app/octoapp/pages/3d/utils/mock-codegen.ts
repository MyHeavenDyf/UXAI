/**
 * 片A 验证脚手架 —— mock 一份 codegen agent 的标准产物，走 parseCodeFiles→extractSceneData→
 * onCodeVersionReady，端到端验 host 侧管线（解析→分组 sceneData→workspace 物化→51857 预览渲染）。
 *
 * 产物：heatmap handler（5×5 热力图网格，原生 THREE 原语，无资源依赖）+ 全量 handlers/index.ts
 * （模板 5 + heatmap，自包含）+ public/live-data.json（分组 TreeScene，heatmap 1 根节点）。
 *
 * 片C 起 LLM 真实生成流替换此 mock；handleWorkspaceDev 改调 codegen_scene。
 */
import { parseCodeFiles, extractSceneData } from "./parse-code-files"

// heatmap handler —— 仿 example.ts 契约：create 返回 Group，子 mesh 自建非共享，delete 走默认 dispose。
const HEATMAP_HANDLER_SRC = `
import * as THREE from 'three'
import type { ComponentHandler, ComponentContext } from '../../ComponentManager'
import type { TreeNode } from '../../../../scene/loader'
import { toOptions } from '../base/options'

// 5x5 热力图网格：每个格子高度按 (x+z)%5 映射，颜色按高度分档（绿→黄→红）。
export const heatmapHandler: ComponentHandler = {
  create(node: TreeNode, _ctx: ComponentContext) {
    const opts = toOptions(node)
    const group = new THREE.Group()
    const colors = [0x1a9850, 0x91cf60, 0xfdae61, 0xf46d43, 0xd73027]
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        const h = 0.5 + ((x + z) % 5) * 0.5
        const geo = new THREE.BoxGeometry(0.8, h, 0.8)
        const mat = new THREE.MeshStandardMaterial({ color: colors[(x + z) % 5] })
        const box = new THREE.Mesh(geo, mat)
        box.position.set(x - 2, h / 2, z - 2)
        box.castShadow = true
        box.receiveShadow = true
        group.add(box)
      }
    }
    if (opts.position) group.position.fromArray(opts.position)
    if (opts.rotation) group.rotation.fromArray(opts.rotation)
    if (opts.scale) group.scale.fromArray(opts.scale)
    return group
  },
  delete() {
    return false // 走默认 disposeObject：mesh 几何/材质自建非共享，可 dispose
  },
}
`

// 全量 handlers/index.ts —— 模板 5 handler + heatmap，自包含（overlay 整文件替换）。
const INDEX_TS_SRC = `
import { componentManager, type ComponentHandler } from '../ComponentManager'
import { sharedState } from './base/shared'
import { registerAllComponents } from '../../../components'
import { buildingsHandler } from './buildings/buildings'
import { roadsHandler } from './roads/roads'
import { waterHandler } from './water/water'
import { exampleHandler } from './exampleField/example'
import { modelHandler } from './model/model'
import { heatmapHandler } from './heatmap/heatmap'

export { sharedState, ComponentSharedState } from './base/shared'

const typeHandlers: Array<{ type: string; handler: ComponentHandler }> = [
  { type: 'buildings', handler: buildingsHandler },
  { type: 'roads', handler: roadsHandler },
  { type: 'water', handler: waterHandler },
  { type: 'example', handler: exampleHandler },
  { type: 'model', handler: modelHandler },
  { type: 'heatmap', handler: heatmapHandler },
]

export const registerComponentHandlers = (): void => {
  registerAllComponents()
  componentManager.registerHandlers(typeHandlers)
}

export const disposeComponentHandlers = (): void => {
  sharedState.dispose()
}
`

// 分组 TreeScene —— heatmap 1 根节点（parentId=null）+ camera/lights/scene。
const LIVE_DATA = {
  version: "1.0",
  scene: { background: "#1a1a2e", environment: { preset: "studio", intensity: 0.8 } },
  camera: {
    type: "perspective",
    position: [8, 7, 10],
    lookAt: [0, 1, 0],
    perspective: { fov: 50, near: 0.1, far: 1000 },
  },
  lights: [
    { type: "ambient", intensity: 0.5 },
    { type: "directional", intensity: 1.2, position: [8, 12, 6], castShadow: true },
  ],
  heatmap: [{ id: "hm-1", parentId: null, params: { position: [0, 0, 0] } }],
}

/** 拼成 codegen agent 的 Markdown 输出（`## file:` + fenced 代码块）。 */
const MOCK_CODEGEN_MARKDOWN = [
  "## file: src/3d/managers/component/handlers/heatmap/heatmap.ts",
  "```ts",
  HEATMAP_HANDLER_SRC.trim(),
  "```",
  "",
  "## file: src/3d/managers/component/handlers/index.ts",
  "```ts",
  INDEX_TS_SRC.trim(),
  "```",
  "",
  "## file: public/live-data.json",
  "```json",
  JSON.stringify(LIVE_DATA, null, 2),
  "```",
].join("\n")

/**
 * 片A 验证入口：解析 mock markdown → { files, sceneData }，供 handleWorkspaceDev 调 onCodeVersionReady。
 * files 含 heatmap.ts + 全量 index.ts + live-data.json；sceneData 是分组 TreeScene。
 */
export function getMockCodegen(): {
  files: { path: string; content: string }[]
  sceneData: Record<string, unknown> | null
  summary: string
} {
  const files = parseCodeFiles(MOCK_CODEGEN_MARKDOWN)
  const sceneData = extractSceneData(files)
  return { files, sceneData, summary: "mock 热力图 codegen" }
}
