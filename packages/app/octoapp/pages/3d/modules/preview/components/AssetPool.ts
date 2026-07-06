import * as THREE from "three"

/**
 * AssetPool — Geometry / Material 缓存池
 *
 * 设计原则:
 *  - 相同参数签名的资源只创建一次，后续复用
 *  - key 由调用方生成（通常为 "类型:参数序列" 格式）
 *  - dispose 时统一释放所有缓存
 *
 * 用法:
 *  const geo = pool.getGeometry("box:0.08,2,0.08", () => new THREE.BoxGeometry(0.08, 2, 0.08))
 *  const mat = pool.getMaterial("standard:#808080:0.4:1", () => new THREE.MeshStandardMaterial({ color: "#808080", roughness: 0.4, metalness: 1 }))
 */
export class AssetPool {
  private _geos = new Map<string, THREE.BufferGeometry>()
  private _mats = new Map<string, THREE.Material>()

  /** 获取或创建 Geometry（按 key 缓存） */
  getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this._geos.get(key)
    if (!geo) {
      geo = factory()
      this._geos.set(key, geo)
    }
    return geo
  }

  /** 获取或创建 Material（按 key 缓存） */
  getMaterial(key: string, factory: () => THREE.Material): THREE.Material {
    let mat = this._mats.get(key)
    if (!mat) {
      mat = factory()
      this._mats.set(key, mat)
    }
    return mat
  }

  /** 释放所有缓存资源 */
  dispose(): void {
    for (const geo of this._geos.values()) geo.dispose()
    for (const mat of this._mats.values()) mat.dispose()
    this._geos.clear()
    this._mats.clear()
  }
}
