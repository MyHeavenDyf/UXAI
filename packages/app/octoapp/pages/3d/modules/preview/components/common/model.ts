import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import type { ComponentRegistry } from "../ComponentRegistry"
import type { AssetPool } from "../AssetPool"
import { getModelPreset } from "./model-presets"

/** GLB 场景缓存：url → 已加载的场景，多实例 clone 复用 */
const gltfCache = new Map<string, THREE.Group>()
const loadPromises = new Map<string, Promise<THREE.Group | null>>()

function getGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader()
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
  loader.setDRACOLoader(dracoLoader)
  return loader
}

/**
 * 将相对路径解析为可加载的绝对 URL。
 * - 绝对 URL (http/https/file) 直接返回
 * - 相对路径 (assets/model/xxx.glb) 由 Vite public 目录或静态服务器托管
 */
function resolveModelUrl(url: string): string {
  if (/^(https?:|file:|\/)/.test(url)) return url
  // 相对路径基于当前页面 origin 解析,Vite public 目录下的文件可直接访问
  return new URL(url, window.location.origin).href
}

async function loadGlb(url: string): Promise<THREE.Group | null> {
  const resolvedUrl = resolveModelUrl(url)
  if (gltfCache.has(resolvedUrl)) return gltfCache.get(resolvedUrl)!
  if (loadPromises.has(resolvedUrl)) return loadPromises.get(resolvedUrl)!

  const promise = getGltfLoader()
    .loadAsync(resolvedUrl)
    .then((gltf) => {
      gltfCache.set(resolvedUrl, gltf.scene)
      loadPromises.delete(resolvedUrl)
      return gltf.scene
    })
    .catch((err) => {
      console.error(`[model] GLB 加载失败(${url}):`, err)
      loadPromises.delete(resolvedUrl)
      return null
    })

  loadPromises.set(resolvedUrl, promise)
  return promise
}

/** 注册通用模型组件到 ComponentRegistry */
export function registerCommonModelComponents(registry: ComponentRegistry): void {
  registry.register("model", buildModel)
}

function buildModel(
  params: Record<string, number | string>,
  _material: THREE.Material,
  _pool: AssetPool,
): THREE.Group {
  // preset 查表：按预设名取 url/scale，params 显式值优先于 preset 配置
  const presetName =
    params.preset != null && String(params.preset) !== "" ? String(params.preset) : undefined
  const presetCfg = presetName ? getModelPreset(presetName) : undefined
  if (presetName && !presetCfg) {
    console.warn(`[model] 未知 preset: "${presetName}"`)
  }

  const url = String(params.url ?? presetCfg?.url ?? "")
  const scaleRaw = Number(params.scale ?? presetCfg?.scale ?? 1)
  const scale = scaleRaw > 0 ? scaleRaw : 1

  const group = new THREE.Group()

  if (!url) {
    console.warn("[model] 缺少 url 或有效 preset")
    return group
  }

  // 异步加载 GLB，加载完成后填充到 group
  void loadGlb(url).then((scene) => {
    if (!scene) return
    const cloned = scene.clone(true)
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    if (scale !== 1) cloned.scale.setScalar(scale)
    group.add(cloned)
  })

  return group
}
