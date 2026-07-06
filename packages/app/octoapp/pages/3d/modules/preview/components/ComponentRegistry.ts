import * as THREE from "three"

/**
 * ComponentRegistry — 组件构建函数注册表
 *
 * 设计原则:
 *  - 组件只需实现 ComponentBuilder 函数并注册，渲染器自动走注册表分发
 *  - 新增组件无需改渲染器代码
 *  - 注册是声明式的: registry.register('rack', buildRack)
 *
 * 用法:
 *  registry.register('rack', (params, material, pool) => { ... return group })
 *  const group = registry.create('rack', { levels: 4, width: 2, height: 2, depth: 0.6 }, material, pool)
 */

export type ComponentBuilder = (
  params: Record<string, number | string>,
  material: THREE.Material,
  pool: import("./AssetPool").AssetPool,
) => THREE.Group

export class ComponentRegistry {
  private _builders = new Map<string, ComponentBuilder>()

  /** 注册组件构建函数 */
  register(type: string, builder: ComponentBuilder): void {
    if (this._builders.has(type)) {
      console.warn(`[ComponentRegistry] "${type}" 已存在，将被覆盖`)
    }
    this._builders.set(type, builder)
  }

  /** 按类型创建组件 */
  create(
    type: string,
    params: Record<string, number | string>,
    material: THREE.Material,
    pool: import("./AssetPool").AssetPool,
  ): THREE.Group | null {
    const builder = this._builders.get(type)
    if (!builder) {
      console.warn(`[ComponentRegistry] 未知组件类型: "${type}"，可用: ${this.list().join(", ")}`)
      return null
    }
    return builder(params, material, pool)
  }

  /** 列出所有已注册组件类型 */
  list(): string[] {
    return Array.from(this._builders.keys())
  }
}
