import * as THREE from "three"
import type { ComponentRegistry } from "../ComponentRegistry"
import type { AssetPool } from "../AssetPool"

/**
 * 货架(rack)组件 —— 程序化生成多层置物架。
 *
 * 结构:4 根角柱 + N 层隔板(含底+顶)。
 * 参数:
 *   levels — 层数(默认 4)
 *   width  — 总宽(默认 2)
 *   height — 总高(默认 2)
 *   depth  — 总深(默认 0.6)
 *
 * 子节点命名约定(供 parentId 引用):
 *   角柱: postBL / postBR / postTL / postTR
 *   隔板: shelf0 ~ shelf{N-1}
 *   SceneCanvas 会给子节点设 userData.id = "{objectId}_{name}"
 *   其他物体可用 parentId="{objectId}_shelf2" 在指定层放物品
 *
 * 性能:
 *   Geometry 通过 AssetPool 缓存，相同参数的柱子/隔板共享同一个 BufferGeometry。
 *   Material 由渲染器传入（也经过 AssetPool 缓存）。
 */
export type RackParams = {
  levels?: number
  width?: number
  height?: number
  depth?: number
}

/** 注册 rack 组件到 ComponentRegistry */
export function registerRack(registry: ComponentRegistry): void {
  registry.register("rack", buildRack)
}

/** rack 组件构建函数 */
function buildRack(
  params: Record<string, number | string>,
  material: THREE.Material,
  pool: AssetPool,
): THREE.Group {
  const levels = Math.max(2, Math.min(20, Math.floor(Number(params.levels) || 4)))
  const width = Number(params.width) > 0 ? Number(params.width) : 2
  const height = Number(params.height) > 0 ? Number(params.height) : 2
  const depth = Number(params.depth) > 0 ? Number(params.depth) : 0.6

  const postSize = 0.08
  const shelfThick = 0.04
  const halfW = width / 2 - postSize / 2
  const halfD = depth / 2 - postSize / 2

  const group = new THREE.Group()

  const postGeo = pool.getGeometry(
    `rack:post:${postSize},${height},${postSize}`,
    () => new THREE.BoxGeometry(postSize, height, postSize),
  )

  const corners: Array<[string, number, number]> = [
    ["postBL", -halfW, -halfD],
    ["postBR", halfW, -halfD],
    ["postTL", -halfW, halfD],
    ["postTR", halfW, halfD],
  ]
  for (const [name, cx, cz] of corners) {
    const post = new THREE.Mesh(postGeo, material)
    post.name = name
    post.position.set(cx, height / 2, cz)
    post.castShadow = true
    post.receiveShadow = true
    group.add(post)
  }

  const shelfGeo = pool.getGeometry(
    `rack:shelf:${width},${shelfThick},${depth}`,
    () => new THREE.BoxGeometry(width, shelfThick, depth),
  )

  for (let i = 0; i < levels; i++) {
    const y = levels > 1 ? (i / (levels - 1)) * height : 0
    const shelf = new THREE.Mesh(shelfGeo, material)
    shelf.name = `shelf${i}`
    shelf.position.set(0, y, 0)
    shelf.castShadow = true
    shelf.receiveShadow = true
    group.add(shelf)
  }

  return group
}
