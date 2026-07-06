import * as THREE from "three"
import type { ComponentRegistry } from "../ComponentRegistry"
import type { AssetPool } from "../AssetPool"

/**
 * 办公桌 — 骨架组件
 * TODO: 完整实现，当前为占位
 */
export type DeskParams = {
  width?: number
  height?: number
  depth?: number
  
}

/** 注册 desk 组件到 ComponentRegistry */
export function registerDesk(registry: ComponentRegistry): void {
  registry.register("desk", buildDesk)
}

function buildDesk(
  params: Record<string, number | string>,
  material: THREE.Material,
  pool: AssetPool,
): THREE.Group {
  const width = Number(params.width) > 0 ? Number(params.width) : 1
  const height = Number(params.height) > 0 ? Number(params.height) : 1
  const depth = Number(params.depth) > 0 ? Number(params.depth) : 1

  const group = new THREE.Group()

  // 占位：简单 box
  const geo = pool.getGeometry(
    `desk:placeholder:${width},${height},${depth}`,
    () => new THREE.BoxGeometry(width, height, depth),
  )
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)

  return group
}
