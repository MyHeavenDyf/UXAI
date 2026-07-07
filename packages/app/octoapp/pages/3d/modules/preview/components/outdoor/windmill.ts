import type { ComponentRegistry } from "../ComponentRegistry"

/** 风车对应的 GLB 文件路径 */
const WINDMILL_GLB_URL = "assets/model/2592c9a1ec7fea63.glb"

/** 注册户外/能源组件到 ComponentRegistry */
export function registerOutdoorComponents(registry: ComponentRegistry): void {
  registry.register("windmill", (params, material, pool) => {
    // 风车代理到 model 组件，传入风车 GLB 路径
    return registry.create("model", { url: WINDMILL_GLB_URL, ...params }, material, pool)!
  })
}