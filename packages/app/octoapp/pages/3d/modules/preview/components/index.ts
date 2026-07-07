/**
 * 组件模块统一导出 + 注册入口
 *
 * 新增组件只需:
 *   1. 在对应分类目录下创建组件文件，实现 registerXxx(registry) 函数
 *   2. 在分类 index.ts 中 import 并在 registerXxxComponents 中调用
 *   3. 在此文件 registerAllComponents 中添加对应分类的 register 调用
 *   4. 无需修改渲染器代码
 */
export { AssetPool } from "./AssetPool"
export { ComponentRegistry } from "./ComponentRegistry"
export type { ComponentBuilder } from "./ComponentRegistry"

import type { ComponentRegistry } from "./ComponentRegistry"
import { registerWarehouseComponents } from "./warehouse"
import { registerIndustrialComponents } from "./industrial"
import { registerPortComponents } from "./port"
import { registerCommonComponents } from "./common"

/** 注册所有组件到 registry（在渲染器初始化时调用一次） */
export function registerAllComponents(registry: ComponentRegistry): void {
  registerWarehouseComponents(registry)
  registerIndustrialComponents(registry)
  registerPortComponents(registry)
  registerCommonComponents(registry)

  // 兼容垫片:AI 可能仍输出老格式 {type:"windmill"},这里自动转 model + preset
  // 等确认 AI 稳定输出新格式 {type:"model",params:{preset:"windmill"}} 后可删除
  registry.register("windmill", (params, material, pool) => {
    console.warn('[components] `type:"windmill"` 已废弃,请改用 `type:"model", params:{preset:"windmill"}`')
    return registry.create("model", { preset: "windmill", ...params }, material, pool)!
  })
}
