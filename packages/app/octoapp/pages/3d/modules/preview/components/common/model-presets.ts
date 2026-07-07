/**
 * MODEL_PRESETS — GLB 预设模型声明式配置表
 *
 * 集中管理所有"预设模型"（按名字加载指定 GLB 的快捷映射）。
 * 新增预设模型只需在此追加一条，无需新建组件文件。
 *
 * 用法（在 SceneDocument 中）：
 *   { type: "component", component: { type: "model", params: { preset: "windmill" } } }
 * model 组件的 buildModel 会按 preset 名查本表取 url/scale，
 * params 显式值（url/scale）优先于 preset 配置。
 */
export interface ModelPresetConfig {
  url: string
  scale?: number
  description?: string
}

export const MODEL_PRESETS = {
  windmill: {
    url: "assets/model/2592c9a1ec7fea63.glb",
    description: "风车（户外/能源场景）",
  },
  // 未来新增预设模型只在此追加一条
} as const satisfies Record<string, ModelPresetConfig>

export type ModelPresetName = keyof typeof MODEL_PRESETS

/** 按 preset 名查配置，未知名返回 undefined */
export function getModelPreset(name: string): ModelPresetConfig | undefined {
  return (MODEL_PRESETS as Record<string, ModelPresetConfig>)[name]
}
