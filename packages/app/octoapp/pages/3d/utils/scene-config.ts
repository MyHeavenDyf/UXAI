/**
 * SceneConfig 类型 + 检测 + 示例场景
 *
 * 阶段0 最小版：SceneConfig 直接对齐 3d-templete 的 LiveDataConfig 结构
 * （3d-templete src/3d/utils/liveDataLoader.ts:54-150）。
 * 阶段1 再扩展 component/model/css2d/css3d/sprite 等类型字段。
 */

/** 阶段0：SceneConfig = 3d-templete 的 LiveDataConfig 结构镜像 */
export interface SceneConfigObject {
  type: string
  params?: Record<string, number | string>
}
export interface SceneConfigGeometry {
  type: string
  params?: Record<string, number | string>
}
export interface SceneConfigMaterial {
  type: string
  color?: string
  roughness?: number
  metalness?: number
  transparent?: boolean
  opacity?: number
  [key: string]: unknown
}
export interface SceneConfigObject3D {
  id: string
  type: "group" | "mesh" | "component" | "glb"
  parentId: string | null
  position?: number[]
  rotation?: number[]
  scale?: number[]
  geometry?: SceneConfigGeometry
  material?: SceneConfigMaterial
  component?: { type: string; params?: Record<string, number | string> }
  src?: string
  castShadow?: boolean
  receiveShadow?: boolean
}
export interface SceneConfigLight {
  type: "ambient" | "hemisphere" | "directional"
  intensity: number
  color?: string
  skyColor?: string
  groundColor?: string
  position?: number[]
  target?: number[]
  castShadow?: boolean
  shadow?: Record<string, unknown>
}
export interface SceneConfig {
  version: string
  angleUnit: "deg" | "rad"
  scene: {
    background?: string
    environment?: { preset: string; intensity: number }
    fog?: { type: string; color: string; near: number; far: number }
  }
  camera: {
    type: "perspective" | "orthographic"
    position: number[]
    lookAt: number[]
    perspective?: { fov: number; near: number; far: number }
    orthographic?: Record<string, number>
  }
  lights?: SceneConfigLight[]
  objects?: SceneConfigObject3D[]
}

/**
 * 物体级增量补丁（镜像 3d-templete 的 SceneUpdatePatch；octoapp 不跨工程 import）。
 * SCENE_PATCH 用：选中物改属性后，只 upsert 该物体，不重发整场景，避免闪烁。
 */
export interface ScenePatch {
  objects?: {
    /** 按 id 增/改（id 已存在则就地补丁 transform/material/geometry，保留身份） */
    upsert?: SceneConfigObject3D[]
    /** 按 id 删除 */
    remove?: string[]
  }
}

/**
 * 从一段文本里检测并解析 SceneConfig（仿 pattern 的 detectA2UIJson）。
 * 支持 ```json 代码块包裹。
 */
export function detectSceneConfig(text: string): SceneConfig | null {
  try {
    const raw = text.includes("```json")
      ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text
      : text
    const parsed = JSON.parse(raw.trim())
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.objects) && parsed.camera) {
      return parsed as SceneConfig
    }
  } catch {}
  return null
}

/**
 * 阶段0 示例场景：一个 box + 一个 ground + 灯光 + 透视相机。
 * 用于"加载示例场景"按钮触发 SCENE_UPDATE，验证 iframe 通道 + createScene3D 渲染。
 */
export const SAMPLE_SCENE: SceneConfig = {
  version: "1.0",
  angleUnit: "deg",
  scene: {
    background: "#1a1a2e",
    environment: { preset: "studio", intensity: 0.8 },
  },
  camera: {
    type: "perspective",
    position: [6, 5, 8],
    lookAt: [0, 0.5, 0],
    perspective: { fov: 50, near: 0.1, far: 1000 },
  },
  lights: [
    { type: "ambient", intensity: 0.5 },
    {
      type: "directional",
      intensity: 1.2,
      position: [8, 12, 6],
      castShadow: true,
      shadow: { mapSize: 2048, camera: { near: 0.5, far: 50, left: -15, right: 15, top: 15, bottom: -15 } },
    },
  ],
  objects: [
    {
      id: "ground-1",
      type: "mesh",
      parentId: null,
      geometry: { type: "plane", params: { width: 20, height: 20, widthSegments: 1, heightSegments: 1 } },
      material: { type: "standard", color: "#3a3a5c", roughness: 0.9, metalness: 0 },
      position: [0, 0, 0],
      rotation: [-1.5708, 0, 0],
      receiveShadow: true,
    },
    {
      id: "box-1",
      type: "mesh",
      parentId: null,
      geometry: { type: "box", params: { width: 1.5, height: 1.5, depth: 1.5 } },
      material: { type: "standard", color: "#e94560", roughness: 0.4, metalness: 0.2 },
      position: [0, 0.75, 0],
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: "box-2",
      type: "mesh",
      parentId: null,
      geometry: { type: "box", params: { width: 1, height: 1, depth: 1 } },
      material: { type: "standard", color: "#0f9b8e", roughness: 0.5, metalness: 0.1 },
      position: [2.5, 0.5, 1],
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: "sphere-1",
      type: "mesh",
      parentId: null,
      geometry: { type: "sphere", params: { radius: 0.6, widthSegments: 24, heightSegments: 16 } },
      material: { type: "standard", color: "#f5b945", roughness: 0.3, metalness: 0.3 },
      position: [-2.5, 0.6, -1],
      castShadow: true,
    },
  ],
}
