/**
 * scene-protocol.ts —— 3D 场景图 JSON 协议
 * ============================================================================
 * 角色:对等 pattern/utils/a2ui-protocol.ts。本文件是「自然语言生成 3D 场景」
 * 功能的核心资产,供 proto_3d_* agent 的 prompt 拼装使用,约束 LLM 只输出
 * 合规的 SceneDocument JSON,再由 Three.js 渲染器消费。
 *
 * 知识来源:提炼自 .claude/skills/threejs-* 的 10 个 Three.js skill
 * (fundamentals / geometry / materials / textures / lighting / loaders /
 *  animation / interaction / shaders / postprocessing)。
 *
 * 设计原则(继承 A2UI JSON 的 5 条铁律,适配 3D):
 *  1. 扁平 objects[] + parentId 引用(非嵌套树)—— 易生成、易局部 patch、易合并
 *  2. parent-first 输出顺序 —— 渲染器自顶向下构建变换链
 *  3. 封闭目录 —— 几何/材质/灯光/环境/renderStyle 全是有限枚举,禁止编造
 *  4. 结构/数据分离 —— assets 声明一次,objects 用 key 引用(DRY)
 *  5. 严格约束 + 示例 + schema 塞进 prompt —— 压制 LLM 出错率
 *
 * 关键决策(均由 skills 背书,见各处 【skills】 注释):
 *  - 所有角度统一用「度」,渲染器转弧度(LLM 用弧度极易出错)
 *  - 排除 raw shader(静默失败)、text 几何(异步字体)、FBX/OBJ、keyframe 轨道数据
 *  - 保留声明式动效:animation(clip 名) + spin(度/秒)
 *  - 渲染外观用封闭的 renderStyle 预设,而非让 LLM 组装 pass 链
 * ============================================================================
 */

// ===========================================================================
// 1. TypeScript 类型(供渲染器/前端使用,也作为协议的权威定义)
// ===========================================================================

export type Vec3 = [number, number, number]
export type AngleUnit = "degree" | "radian"

/** 几何体封闭目录 —— 仅保留参数化、纯数值参数的体
 * 【skills】排除 text(需异步 FontLoader)、lathe/extrude/tube/polyhedron
 *           (需 Vector2[] / Shape / Curve,LLM 难可靠生成),留待 v2 */
export type GeometryType =
  | "box"
  | "sphere"
  | "plane"
  | "circle"
  | "cylinder"
  | "cone"
  | "torus"
  | "torusKnot"
  | "ring"
  | "capsule"
  | "dodecahedron"
  | "icosahedron"
  | "octahedron"
  | "tetrahedron"

/** 材质封闭目录。默认 standard(PBR)。basic=无光照,toon=卡通,normal=法线调试 */
export type MaterialType =
  | "standard" // DEFAULT —— 真实 PBR,受灯光+环境影响
  | "physical" // PBR+,有 clearcoat/transmission/ior/sheen
  | "basic" // 无光照,自发光色/UI/线框
  | "phong" // 高光塑料感
  | "lambert" // 廉价哑光
  | "toon" // 卡通分层
  | "normal" // 法线可视化(调试/风格化)

/** 灯光封闭目录。ambient/hemisphere 不投影 */
export type LightType =
  | "ambient"
  | "hemisphere"
  | "directional"
  | "point"
  | "spot"
  | "rectArea"

/** 环境贴图预设(经 PMREM 预处理,提供 IBL + 反射)【skills】 */
export type EnvironmentPreset =
  | "studio"
  | "sunset"
  | "warehouse"
  | "city"
  | "park"
  | "night"
  | "neutral"

/** 渲染外观预设 —— 封装后处理+色调组合,LLM 只挑一个字符串 【skills】 */
export type RenderStyle =
  | "studio" // 默认。无 bloom,ACES,中性。产品/CAD 观感
  | "cinematic-bloom" // 中等 bloom + 轻晕影。英雄/自发光场景
  | "soft-glow" // 极弱 bloom。Web 产品级润色
  | "neon" // 强 bloom + 暗背景。霓虹/合成波
  | "flat-shaded" // 无后处理,扁平。数据可视化/风格化
  | "wireframe-debug" // 线框,纯调试

export interface TextureAsset {
  url: string
  /** 决定 colorSpace:type=color/emissive→sRGB,其余→Linear。LLM 不可直接设 colorSpace 【skills】 */
  type: "color" | "normal" | "roughness" | "metalness" | "ao" | "emissive" | "displacement" | "alpha"
  repeat?: Vec2
  offset?: Vec2
  wrap?: "clamp" | "repeat" | "mirror" // 默认 color→repeat,其余→clamp
  rotation?: number // 度(angleUnit 生效)
}
export type Vec2 = [number, number]

export interface MaterialNode {
  type?: MaterialType // 默认 "standard"
  color?: string // sRGB hex,如 "#ffffff"
  opacity?: number // 0–1,默认 1
  transparent?: boolean // 默认 false;opacity<1 或 transmission>0 时渲染器自动置 true
  side?: "front" | "back" | "double" // 默认 "front"
  wireframe?: boolean
  flatShading?: boolean
  // PBR(standard / physical)
  roughness?: number // 0–1,默认 0.5。木~0.7 塑料~0.4 镜面~0.05
  metalness?: number // 0–1,默认 0。几乎只在 0 或 1 取值;>0 需环境光否则发黑 【skills】
  envMapIntensity?: number // 默认 1
  emissive?: string // sRGB hex
  emissiveIntensity?: number // 默认 1
  // physical 专属
  clearcoat?: number // 0–1
  clearcoatRoughness?: number // 0–1
  transmission?: number // 0–1,1=玻璃
  thickness?: number // 默认 0
  ior?: number // 1–2.333,默认 1.5(水 1.33 玻璃 1.5 钻石 2.42)
  sheen?: number
  sheenColor?: string
  // 贴图槽(均引用 assets.textures 的 key)
  map?: string
  normalMap?: string
  normalScale?: Vec2
  roughnessMap?: string
  metalnessMap?: string
  aoMap?: string // 【skills】需要 uv2,渲染器自动拷贝 uv→uv2
  aoMapIntensity?: number
  emissiveMap?: string
  displacementMap?: string
  displacementScale?: number
  alphaMap?: string
  // phong 专属
  specular?: string
  shininess?: number // 0–1000,默认 100
}

export interface GlbAsset {
  type: "glb"
  url: string
  draco?: boolean // 默认 true 更安全 【skills】Draco 压缩无声失败
  meshopt?: boolean
  ktx2?: boolean
  /** 自动居中+单位化到 maxDim,让 LLM 无需猜测模型原始比例 【skills】 */
  normalize?: boolean | { scale?: number; center?: boolean }
}

export interface Assets {
  glb?: Record<string, GlbAsset>
  materials?: Record<string, MaterialNode> // 可复用材质,objects 用 key 引用
  textures?: Record<string, TextureAsset>
}

export interface LightNode {
  id?: string
  type: LightType
  color?: string // 默认 "#ffffff"
  intensity?: number // 无量纲乘子(见 DESIGN_GUIDE 推荐范围)
  position?: Vec3
  target?: Vec3 // directional / spot
  groundColor?: string // hemisphere
  distance?: number // point / spot,0=无穷
  decay?: number // point / spot,默认 2(物理正确)
  angle?: number // spot,度,≤90 【skills】
  penumbra?: number // spot,0–1
  width?: number // rectArea
  height?: number // rectArea
  castShadow?: boolean // 仅 directional/point/spot 生效 【skills】
  shadow?: {
    mapSize?: 512 | 1024 | 2048 | 4096 // 默认 1024
    camera?: { near?: number; far?: number; left?: number; right?: number; top?: number; bottom?: number; fov?: number }
    bias?: number
    normalBias?: number
    radius?: number
  }
}

export interface CameraNode {
  type?: "perspective" | "orthographic" // 默认 perspective
  position: Vec3
  /** 看向的目标点。对 LLM 而言优先用 lookAt 而非 rotation 【skills】 */
  lookAt?: Vec3
  perspective?: { fov?: number; near?: number; far?: number } // fov 度,默认 50
  orthographic?: { frustumSize?: number; near?: number; far?: number }
}

export interface PostprocessingNode {
  enabled?: boolean // 默认 true
  bloom?: { enabled?: boolean; strength?: number; radius?: number; threshold?: number } // strength 0–3
  toneMapping?: "ACESFilmic" | "AgX" | "Reinhard" | "Cineon" | "Linear" | "None" // 默认 ACESFilmic
  exposure?: number // 0–3,默认 1
  antialiasing?: "none" | "FXAA" | "SMAA" // 默认 SMAA
  vignette?: { offset?: number; darkness?: number }
}

export interface SceneMeta {
  background?: string | { texture: string; blurriness?: number; intensity?: number }
  environment?: { preset?: EnvironmentPreset; url?: string; intensity?: number }
  fog?:
    | { type: "linear"; color: string; near: number; far: number }
    | { type: "exp2"; color: string; density: number }
  renderStyle?: RenderStyle
  postprocessing?: PostprocessingNode
}

export type SceneObjectType = "group" | "mesh" | "glb" | "points"

export interface SceneObject {
  id: string // 稳定 pick id → mesh.userData.id + mesh.name 【skills】
  parentId?: string | null // 扁平引用;子节点变换继承父节点 【skills】
  type: SceneObjectType
  // mesh:
  geometry?: { type: GeometryType; params?: Record<string, number> } // params 键名见 GEOMETRY_PARAMS
  material?: MaterialNode | string // string = 引用 assets.materials[key]
  // glb:
  asset?: string // 引用 assets.glb[key]
  animation?: boolean | string | string[] // true=播首个 clip;string=clip 名(findByName)【skills】
  spin?: Vec3 // 各轴 度/秒 的声明式旋转(风车/行星/转盘)【skills】
  // 公共变换(度,受 angleUnit 生效):
  position?: Vec3 // 默认 [0,0,0]
  rotation?: Vec3 // 度,默认 [0,0,0]
  scale?: Vec3 | number // 默认 [1,1,1]
  // 阴影/可见:
  castShadow?: boolean // 默认 false
  receiveShadow?: boolean // 默认 false
  visible?: boolean // 默认 true
  // points:
  size?: number // points 材质大小
}

export interface SceneDocument {
  version: "1"
  angleUnit?: AngleUnit // 默认 "degree"
  rotationOrder?: string // 默认 "XYZ"
  scene: SceneMeta
  camera: CameraNode
  lights: LightNode[]
  assets?: Assets
  objects: SceneObject[]
}

// ===========================================================================
// 2. 封闭目录(供 prompt 引用 + 渲染器映射)
// ===========================================================================

/** 几何构造参数表 —— params 键名与构造器参数一一对应 【skills/geometry】 */
export const GEOMETRY_PARAMS: Record<GeometryType, { params: string[]; defaults: Record<string, number> }> = {
  box: { params: ["width", "height", "depth"], defaults: { width: 1, height: 1, depth: 1 } },
  sphere: { params: ["radius", "widthSegments", "heightSegments"], defaults: { radius: 1, widthSegments: 32, heightSegments: 32 } },
  plane: { params: ["width", "height"], defaults: { width: 10, height: 10 } },
  circle: { params: ["radius", "segments"], defaults: { radius: 1, segments: 32 } },
  cylinder: { params: ["radiusTop", "radiusBottom", "height", "radialSegments"], defaults: { radiusTop: 1, radiusBottom: 1, height: 2, radialSegments: 32 } },
  cone: { params: ["radius", "height", "radialSegments"], defaults: { radius: 1, height: 2, radialSegments: 32 } },
  torus: { params: ["radius", "tube", "radialSegments", "tubularSegments"], defaults: { radius: 1, tube: 0.4, radialSegments: 16, tubularSegments: 100 } },
  torusKnot: { params: ["radius", "tube", "tubularSegments", "radialSegments"], defaults: { radius: 1, tube: 0.4, tubularSegments: 100, radialSegments: 16 } },
  ring: { params: ["innerRadius", "outerRadius", "thetaSegments"], defaults: { innerRadius: 0.5, outerRadius: 1, thetaSegments: 32 } },
  capsule: { params: ["radius", "length", "capSegments", "radialSegments"], defaults: { radius: 0.5, length: 1, capSegments: 4, radialSegments: 8 } },
  dodecahedron: { params: ["radius", "detail"], defaults: { radius: 1, detail: 0 } },
  icosahedron: { params: ["radius", "detail"], defaults: { radius: 1, detail: 0 } },
  octahedron: { params: ["radius", "detail"], defaults: { radius: 1, detail: 0 } },
  tetrahedron: { params: ["radius", "detail"], defaults: { radius: 1, detail: 0 } },
}

export const GEOMETRY_DESCRIPTIONS: Record<GeometryType, string> = {
  box: "长方体/方块。家具、建筑、箱子",
  sphere: "球体。球、行星、果实",
  plane: "平面(默认无厚度,常做地面/墙)。地面需旋转 -90° 绕 X 轴",
  circle: "圆面。圆盘、装饰",
  cylinder: "圆柱(可锥化:radiusTop=0 即锥)。柱子、罐子、树干",
  cone: "圆锥。尖顶、路障",
  torus: "圆环(甜甜圈)。环、轮胎、轨道",
  torusKnot: "环面纽结。装饰、抽象",
  ring: "平面圆环。光环、垫圈",
  capsule: "胶囊(圆柱+半球端)。角色身体、药丸",
  dodecahedron: "十二面体。水晶、骰子",
  icosahedron: "二十面体(最接近球的多面体)。水晶、低多边形球",
  octahedron: "八面体。水晶、宝石",
  tetrahedron: "四面体。最简单多面体",
}

export const LIGHT_DESCRIPTIONS: Record<LightType, string> = {
  ambient: "环境光,均匀提亮,无方向。每个场景都应有一个,防止阴影区全黑",
  hemisphere: "半球光(天/地两色)。户外自然照明的基底",
  directional: "平行光(像太阳)。主光源,可投影,不随距离衰减",
  point: "点光源(全向)。灯泡、火把,可投影,物理衰减",
  spot: "聚光灯(锥形)。舞台灯、手电,可投影",
  rectArea: "矩形面光(柔光大面板)。仅影响 PBR 材质,不可投影",
}

// ===========================================================================
// 3. 协议正文(喂给 agent 的核心约束文档,对应 A2UI_JSON_PROTOCOL)
// ===========================================================================

export const SCENE_JSON_PROTOCOL = `
# ThreeD Scene JSON Protocol

## 0. 全局约定(CRITICAL)
- **角度单位**:所有 rotation / spin / spot.angle 字段默认使用「度(degree)」。顶层 angleUnit 默认 "degree"。渲染器内部转弧度。**严禁输出弧度数值**(如 1.5708),请写 90。
- **坐标系**:Three.js 右手系,**+Y 朝上**,+Z 朝向观察者。地面在 XZ 平面,物体高度沿 Y。
- **变换顺序**:position × rotation × scale;旋转顺序默认 "XYZ"。
- **比例**:以「米」为参考单位(1 单位 = 1 米)。人物高约 1.7,建筑高约 10,桌面高约 0.75。

## 1. 顶层结构
JSON 是单一对象,顶层键顺序:**version → scene → camera → lights → assets → objects**。
\`\`\`
{
  "version": "1",
  "angleUnit": "degree",
  "scene": { ... 渲染环境 ... },
  "camera": { ... 相机 ... },
  "lights": [ ... 灯光数组 ... ],
  "assets": { "glb": {...}, "materials": {...}, "textures": {...} },
  "objects": [ ... 扁平节点数组 ... ]
}
\`\`\`

## 2. objects 数组(扁平 + ID 引用)
objects 是**扁平列表**,节点间通过 parentId 引用形成层级,**禁止嵌套对象**。
- **Parent First**:父节点必须在子节点之前出现。
- **唯一 id**:每个节点必须有全局唯一 id。命名遵循 \`[区域][物体][类型]\` 驼峰,如 groundPlane / forestTreeGroup / deskLegCylinder。禁止 obj1/div3 等无语义 id。
- **变换继承**:有 parentId 的节点,其 position/rotation/scale 是**相对父节点**的局部变换。移动一个 group,所有子节点跟随。

节点类型(type)封闭枚举:
- \`group\` —— 空容器,用于组织/整体变换一组节点
- \`mesh\` —— 基本几何体(配 geometry + material)
- \`glb\` —— 引用 assets.glb 的外部模型(配 asset)
- \`points\` —— 点云(配 material.color + size)

### mesh 节点
\`\`\`json
{ "id":"deskTop", "type":"mesh",
  "geometry": { "type":"box", "params": {"width":2, "height":0.05, "depth":1} },
  "material": { "type":"standard", "color":"#8B5A2B", "roughness":0.7 },
  "position":[0, 0.75, 0], "castShadow":true, "receiveShadow":true }
\`\`\`
geometry.type 只能取封闭目录(见 GEOMETRY CATALOG);params 键名必须匹配该几何的参数名,值全部为正数,分段数(s egments)为 ≥1 的整数且 ≤128。

### glb 节点(真实模型)
\`\`\`json
{ "id":"heroChar", "type":"glb", "asset":"character",
  "position":[0,0,0], "animation":"Walk", "castShadow":true }
\`\`\`
- asset 必须指向 assets.glb 中已声明的 key。**禁止在 object 里直接写 url**。
- 想放多个同类模型(一片树):在 assets.glb 声明一次,objects 里放多个引用同一 asset 的 glb 节点(渲染器会自动 clone)。

### 声明式动效(简单可靠,优先使用)
- \`"spin":[0, 30, 0]\` —— 各轴 度/秒 持续旋转。风车/转盘/行星默认用这个。
- \`"animation":"Walk"\` —— 播放该 glb 内置的动画片段(按名查找)。true=播首个。
- **禁止**在 JSON 里写关键帧/轨道数值数据。

## 3. 材质(material)
material 可以内联对象,也可以是字符串引用 assets.materials[key](复用)。type 封闭枚举,默认 "standard"。
**PBR 铁律(CRITICAL)**:
- metalness 几乎只在 0 或 1 取值。非金属(木/塑料/布/砖)=0,金属(铁/金/铜)=1。
- **metalness>0 时必须有环境光(scene.environment)否则物体发黑**。
- roughness:镜面/玻璃≈0,塑料≈0.4,木头≈0.7,哑光布≈0.9。
- 玻璃:type="physical", transmission=1, roughness=0, ior=1.5, thickness>0。
- 颜色一律 sRGB hex 字符串("#rrggbb")。**禁止**用 0xff0000、"red"、rgb()。

## 4. 灯光(lights)
每个场景**至少**包含:1 个 ambient/hemisphere(基底,防黑)+ 1 个 directional(主光+投影)。灯光类型封闭枚举。
- directional:主光,模拟太阳,intensity≈1–3,castShadow=true,通过 position + target 定向。
- point/spot:decay 默认 2(物理衰减),大场景需更高 intensity。spot.angle ≤ 90 度。
- **CRITICAL**:只有 directional/point/spot 能投影;ambient/hemisphere/rectArea 不能。

## 5. 渲染环境(scene)
- **scene.environment**:PBR 必需。优先用 preset("studio"/"sunset"/...)。无环境光时 PBR 会暗淡。
- scene.background:sRGB hex 或 { texture: "<ref>" }。
- scene.renderStyle:整体观感预设,默认 "studio"。想要发光/电影感选 "cinematic-bloom" 或 "neon"。
- fog:可选,linear{near,far} 或 exp2{density}。

## 6. 资源声明(assets,DRY)
- glb / materials / textures 各为 key→定义 的映射。
- textures.type 决定 colorSpace(必须正确,见 DESIGN_GUIDE),**禁止**自己指定 colorSpace。
- 在 assets 声明一次,objects/lights/materials 用 key 引用,不要重复内联 url。

## 7. 相机(camera)
- position 必填。优先用 lookAt 指向目标,而非手算 rotation。
- perspective.fov 默认 50 度。**禁止**输出 aspect(渲染器按画布算)。
- 默认 perspective;正交用 orthographic.frustumSize。
`

// ===========================================================================
// 4. 3D 设计规范(对应 DESKTOP_DESIGN_SYSTEM)
// ===========================================================================

export const SCENE_DESIGN_GUIDE = `
# 3D Scene Design Guide

## 1. 光照布光(三点光的简化)
- **基底**:ambient(intensity≈0.4–0.6)或 hemisphere(天/地色,intensity≈0.6)——填阴影,防黑。
- **主光(key)**:directional,intensity≈1.5–2.5,castShadow=true,position 偏上方斜射(如 [5,8,5]),target 指向场景中心。
- **辅光(fill)**:可选第二个 directional 或 hemisphere,强度低于主光,柔化阴影。
- **室内/夜景**:加 point/spot(灯泡/壁灯),decay=2,intensity 视距离放大。

## 2. 阴影
- 主光源 castShadow=true。
- 地面/桌面 receiveShadow=true;中小物体 castShadow=true 且 receiveShadow=true。
- **CRITICAL**:投影需要三件齐:渲染器开阴影(渲染器负责)+ 灯 castShadow + 物体 cast/receiveShadow。缺一则无阴影。
- 巨大物体(地面/墙)只 receive 不 cast,避免阴影遮挡整个场景。

## 3. 材质取值速查
| 材质 | roughness | metalness | 备注 |
|---|---|---|---|
| 木材 | 0.6–0.8 | 0 | |
| 塑料 | 0.3–0.5 | 0 | |
| 哑光金属(铝) | 0.25–0.4 | 1 | 需环境光 |
| 抛光金属(铬) | 0.05–0.15 | 1 | 需环境光 |
| 玻璃 | 0–0.1 | 0 | physical, transmission=1, ior=1.5 |
| 石头/砖 | 0.8–0.95 | 0 | |
| 布料 | 0.8–1.0 | 0 | 可用 sheen |
| 水 | 0–0.05 | 0 | physical, transmission=1, ior=1.33 |
- 想让物体发光(霓虹/屏幕):emissive 设色 + emissiveIntensity>1,配合 renderStyle="cinematic-bloom" 或 "neon" 才会泛光。

## 4. 贴图 colorSpace(自动,但 type 必须填对)
- color/emissive 贴图:type 写 "color"/"emissive" → sRGB。
- normal/roughness/metalness/ao/displacement/alpha 贴图:type 写对应名 → Linear。
- **CRITICAL**:type 填错会导致颜色/法线失真。ao 贴图需要 uv2(渲染器自动处理)。

## 5. 比例与构图
- 以米为单位规划尺寸,保持物体间比例合理(别让椅子比房子大)。
- 相机 position 与 lookAt 决定构图;常见:正面平视 lookAt=[0,1,0],俯视 position=[0,8,10]。
- 物体不要浮空:接触地面的物体,Y(高度)至少 = 自身半高。

## 6. 性能
- 几何分段数(segments)够用即可(球 32,柱 32),不要全场 128。
- 重复物体用 glb 引用同一 asset(渲染器 clone),不要每个都内联完整模型。
- 封闭目录外的能力(自定义着色器、SSAO、景深)协议不支持,不要尝试生成。
`

// ===========================================================================
// 5. 示例(对应 CARD_EXAMPLE / LIST_EXAMPLE ...)
// ===========================================================================

export const EXAMPLE_MINIMAL = `{
  "version": "1",
  "angleUnit": "degree",
  "scene": { "background": "#1a1a2e", "environment": { "preset": "studio" }, "renderStyle": "studio" },
  "camera": { "type": "perspective", "position": [4, 3, 5], "lookAt": [0, 0.5, 0], "perspective": { "fov": 50, "near": 0.1, "far": 100 } },
  "lights": [
    { "type": "ambient", "intensity": 0.5 },
    { "type": "directional", "color": "#ffffff", "intensity": 2, "position": [5, 8, 5], "target": [0,0,0], "castShadow": true,
      "shadow": { "mapSize": 1024, "camera": { "near": 0.5, "far": 30, "left": -10, "right": 10, "top": 10, "bottom": -10 } } }
  ],
  "objects": [
    { "id": "groundPlane", "type": "mesh", "geometry": { "type": "plane", "params": { "width": 20, "height": 20 } },
      "material": { "type": "standard", "color": "#3a3a4a", "roughness": 0.9 },
      "rotation": [-90, 0, 0], "receiveShadow": true },
    { "id": "heroCube", "type": "mesh", "geometry": { "type": "box", "params": { "width": 1, "height": 1, "depth": 1 } },
      "material": { "type": "standard", "color": "#0067D1", "roughness": 0.4, "metalness": 0.2 },
      "position": [0, 0.5, 0], "spin": [0, 30, 0], "castShadow": true, "receiveShadow": true }
  ]
}`

export const EXAMPLE_GLB_INSTANCES = `{
  "version": "1",
  "scene": { "environment": { "preset": "park" }, "renderStyle": "soft-glow" },
  "camera": { "position": [6, 4, 8], "lookAt": [0, 1, 0] },
  "lights": [
    { "type": "hemisphere", "color": "#bcd", "groundColor": "#443", "intensity": 0.6 },
    { "type": "directional", "intensity": 2, "position": [5, 10, 5], "castShadow": true }
  ],
  "assets": {
    "glb": { "tree": { "type": "glb", "url": "assets/tree.glb", "draco": true, "normalize": { "scale": 2, "center": true } } }
  },
  "objects": [
    { "id": "groundPlane", "type": "mesh", "geometry": { "type": "plane", "params": { "width": 30, "height": 30 } },
      "material": { "type": "standard", "color": "#4a7c3a", "roughness": 0.95 }, "rotation": [-90,0,0], "receiveShadow": true },
    { "id": "forestGroup", "type": "group", "position": [0,0,0] },
    { "id": "treeA", "type": "glb", "asset": "tree", "parentId": "forestGroup", "position": [-2, 0, 1], "castShadow": true },
    { "id": "treeB", "type": "glb", "asset": "tree", "parentId": "forestGroup", "position": [1, 0, -1], "rotation": [0, 45, 0], "scale": 1.2, "castShadow": true },
    { "id": "treeC", "type": "glb", "asset": "tree", "parentId": "forestGroup", "position": [3, 0, 2], "castShadow": true }
  ]
}`

export const EXAMPLE_FULL_INTERIOR = `{
  "version": "1",
  "scene": { "background": "#0d1117", "environment": { "preset": "warehouse", "intensity": 0.8 },
    "fog": { "type": "exp2", "color": "#0d1117", "density": 0.02 }, "renderStyle": "cinematic-bloom" },
  "camera": { "position": [5, 3, 6], "lookAt": [0, 1, 0], "perspective": { "fov": 45, "near": 0.1, "far": 100 } },
  "lights": [
    { "type": "ambient", "intensity": 0.3 },
    { "type": "point", "color": "#ffd9a0", "intensity": 8, "position": [0, 2.5, 0], "distance": 8, "decay": 2, "castShadow": true },
    { "type": "spot", "color": "#88ccff", "intensity": 6, "position": [3, 4, 3], "target": [0,0,0], "angle": 40, "penumbra": 0.5, "distance": 12, "decay": 2 }
  ],
  "assets": {
    "materials": {
      "matTable": { "type": "standard", "color": "#2a2a35", "roughness": 0.3, "metalness": 0.8 },
      "matGlow": { "type": "standard", "color": "#000000", "emissive": "#00ffe0", "emissiveIntensity": 3 }
    }
  },
  "objects": [
    { "id": "floor", "type": "mesh", "geometry": { "type": "plane", "params": { "width": 12, "height": 12 } },
      "material": { "type": "standard", "color": "#1a1a22", "roughness": 0.4, "metalness": 0.6 },
      "rotation": [-90,0,0], "receiveShadow": true },
    { "id": "tableGroup", "type": "group", "position": [0,0,0] },
    { "id": "tableTop", "parentId": "tableGroup", "type": "mesh", "material": "matTable",
      "geometry": { "type": "cylinder", "params": { "radiusTop": 1.2, "radiusBottom": 1.2, "height": 0.08, "radialSegments": 48 } },
      "position": [0, 0.8, 0], "castShadow": true, "receiveShadow": true },
    { "id": "tableLeg", "parentId": "tableGroup", "type": "mesh", "material": "matTable",
      "geometry": { "type": "cylinder", "params": { "radiusTop": 0.06, "radiusBottom": 0.06, "height": 0.8 } },
      "position": [0, 0.4, 0] },
    { "id": "glowOrb", "type": "mesh", "material": "matGlow",
      "geometry": { "type": "icosahedron", "params": { "radius": 0.25, "detail": 1 } },
      "position": [0, 1.2, 0], "spin": [0, 60, 0] }
  ]
}`

// ===========================================================================
// 6. JSON Schema(对应 A2UI STRUCTURE SCHEMA)
// ===========================================================================

export const SCENE_JSON_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "required": ["version", "scene", "camera", "lights", "objects"],
  "properties": {
    "version": { "const": "1" },
    "angleUnit": { "enum": ["degree", "radian"] },
    "scene": {
      "type": "object",
      "properties": {
        "background": { "type": ["string","object"] },
        "environment": { "type": "object" },
        "fog": { "type": "object" },
        "renderStyle": { "enum": ["studio","cinematic-bloom","soft-glow","neon","flat-shaded","wireframe-debug"] }
      }
    },
    "camera": {
      "type": "object", "required": ["position"],
      "properties": {
        "type": { "enum": ["perspective","orthographic"] },
        "position": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 },
        "lookAt": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 }
      }
    },
    "lights": { "type": "array", "items": { "type": "object", "required": ["type"] } },
    "assets": { "type": "object" },
    "objects": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object", "required": ["id", "type"],
        "properties": {
          "id": { "type": "string" },
          "parentId": { "type": ["string","null"] },
          "type": { "enum": ["group","mesh","glb","points"] }
        }
      }
    }
  }
}`

// ===========================================================================
// 7. Prompt 构建器(供 agent 封装拼装,对应 buildModulePrompt 等)
// ===========================================================================

/** 目录文本(拼进 prompt) */
function geometryCatalog(): string {
  const lines = ["# Geometry Catalog (closed)"]
  for (const key of Object.keys(GEOMETRY_PARAMS) as GeometryType[]) {
    const g = GEOMETRY_PARAMS[key]
    const desc = GEOMETRY_DESCRIPTIONS[key]
    const ps = g.params.map((p) => `${p}=${g.defaults[p]}`).join(", ")
    lines.push(`- \`${key}\`(${desc}) params: ${ps}`)
  }
  return lines.join("\n")
}

function lightCatalog(): string {
  const lines = ["# Light Catalog (closed)"]
  for (const key of Object.keys(LIGHT_DESCRIPTIONS) as LightType[]) {
    lines.push(`- \`${key}\`: ${LIGHT_DESCRIPTIONS[key]}`)
  }
  return lines.join("\n")
}

const MATERIAL_CATALOG_TEXT = `# Material Catalog (closed; default "standard")
- \`standard\` (PBR, 默认): color, roughness(0-1), metalness(0|1), emissive, emissiveIntensity, envMapIntensity, flatShading, wireframe + 贴图槽 map/normalMap/roughnessMap/metalnessMap/aoMap/emissiveMap
- \`physical\` (PBR+): standard 全部 + clearcoat, clearcoatRoughness, transmission(玻璃), thickness, ior(1-2.333), sheen, sheenColor
- \`basic\` (无光照): color, wireframe —— UI/线框/纯色,不受灯光影响
- \`phong\`: color, specular, shininess
- \`lambert\`: 廉价哑光
- \`toon\`: 卡通分层
- \`normal\`: 法线可视化(风格化/调试)`

const RENDERSTYLE_CATALOG_TEXT = `# Render Style (closed; default "studio")
- \`studio\`: 中性产品/CAD 观感,无 bloom
- \`cinematic-bloom\`: 中等 bloom + 轻晕影,英雄/自发光场景
- \`soft-glow\`: 极弱 bloom,Web 产品级润色
- \`neon\`: 强 bloom + 暗背景,霓虹/合成波
- \`flat-shaded\`: 无后处理,数据可视化/风格化
- \`wireframe-debug\`: 线框调试`

/** 意图扩展 agent 的 prompt:把用户一句话扩成结构化场景意图 */
export function buildIntentPrompt(query: string): string {
  return [
    `[ThreeD Intent Expansion Mode]`,
    `You are a 3D scene requirements analyst. Expand the user's request into a structured scene intent.`,
    ``,
    geometryCatalog(),
    ``,
    lightCatalog(),
    ``,
    `输出 JSON,包含:场景主题、风格(renderStyle 候选)、规模、关键物体清单(每个物体建议用基本体还是 glb)、光照氛围、相机视角。`,
    `---`,
    ``,
    query,
  ].join("\n")
}

/** 单个物体/模块生成 agent 的 prompt:为指定 group/slot 生成一组 objects */
export function buildObjectPrompt(opts: {
  intentJson: Record<string, unknown>
  slotElementId?: string
  idPrefix?: string
  query?: string
}): string {
  const intent = opts.intentJson
  return [
    `[ThreeD Object Generation Mode]`,
    `Component Catalog: Three.js objects`,
    ``,
    geometryCatalog(),
    ``,
    MATERIAL_CATALOG_TEXT,
    ``,
    lightCatalog(),
    ``,
    SCENE_JSON_PROTOCOL,
    ``,
    `## Design Guide`,
    SCENE_DESIGN_GUIDE,
    ``,
    `# OUTPUT RULES (CRITICAL)`,
    `- 只输出合法 JSON,不要 markdown / 代码块 / 解释文字。`,
    `- 输出 \`{ "objects": [...] }\`,数组内是该区域的节点(可含 group 及其子节点)。`,
    `- 父节点先于子节点;子节点用 parentId 引用父节点 id。`,
    `- 所有角度用「度」。所有颜色用 "#rrggbb"。`,
    `- 每个节点有唯一 id,且以给定前缀开头(根 group 除外)。`,
    `- geometry.type / material.type / light.type / renderStyle 只能取封闭目录值,禁止编造。`,
    `- glb 节点用 asset 引用,不要内联 url。`,
    `- metalness>0 的物体需场景有 environment(由整体场景保证)。`,
    ``,
    `【场景意图】:`,
    JSON.stringify(intent, null, 2),
    ``,
    opts.slotElementId ? `【本区域根节点 id】: ${opts.slotElementId}` : "",
    opts.idPrefix ? `【本区域内节点 id 前缀】: ${opts.idPrefix}` : "",
    opts.query ? `【原始需求】: ${opts.query}` : "",
    ``,
    `请生成本区域的 objects JSON。`,
  ]
    .filter(Boolean)
    .join("\n")
}

/** 整体场景一次性生成 agent 的 prompt */
export function buildScenePrompt(query: string): string {
  return [
    `[ThreeD Mode: A2UI-style generative 3D scene]`,
    ``,
    geometryCatalog(),
    ``,
    MATERIAL_CATALOG_TEXT,
    ``,
    lightCatalog(),
    ``,
    RENDERSTYLE_CATALOG_TEXT,
    ``,
    `You MUST output a complete SceneDocument JSON in the ThreeD Scene JSON Protocol:`,
    `{ "version":"1", "scene":{...}, "camera":{...}, "lights":[...], "assets":{...}, "objects":[...] }`,
    ``,
    `# OUTPUT RULES (CRITICAL)`,
    `- 只输出合法 JSON。无 markdown、无代码块、无解释。顶层键顺序:version → scene → camera → lights → assets → objects。`,
    `- 所有角度用「度」,颜色用 "#rrggbb"。`,
    `- objects 扁平 + parentId;父先于子;每个节点唯一 id。`,
    `- 至少 1 个基底光(ambient/hemisphere)+ 1 个主光(directional,castShadow)。`,
    `- PBR 物体(metalness>0)场景必须有 scene.environment。`,
    `- 几何分段数够用即可(球/柱 32),不要全场 128。`,
    `- 重复模型在 assets.glb 声明一次,objects 里引用同一 key。`,
    ``,
    SCENE_JSON_PROTOCOL,
    ``,
    `## Design Guide`,
    SCENE_DESIGN_GUIDE,
    ``,
    `# EXAMPLES`,
    `## Minimal (rotating cube on a floor)`,
    EXAMPLE_MINIMAL,
    `## GLB instances (a grove of trees)`,
    EXAMPLE_GLB_INSTANCES,
    `## Full interior (bloom + emissive + fog)`,
    EXAMPLE_FULL_INTERIOR,
    ``,
    `---`,
    ``,
    query,
  ].join("\n")
}

// ===========================================================================
// 8. 提取器(对等 a2ui-protocol.ts 的 detectA2UIJson / extractJson)
// ===========================================================================

/** 从 LLM 文本中识别并解析出完整 SceneDocument */
export function detectSceneJson(text: string): SceneDocument | null {
  try {
    const raw = text.includes("```json")
      ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text
      : text
    const parsed = JSON.parse(raw.trim())
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.objects) && parsed.camera) {
      return parsed as SceneDocument
    }
  } catch {
    // 兜底:截取首个 { 到最后 } 的子串
    try {
      const start = text.indexOf("{")
      const end = text.lastIndexOf("}")
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1).trim())
        if (parsed && Array.isArray(parsed.objects) && parsed.camera) return parsed as SceneDocument
      }
    } catch {}
  }
  return null
}

/** 从 LLM 文本中提取任意 JSON 片段(物体数组等)—— 复用 pattern 的稳健策略 */
export function extractSceneJson(text: string): Record<string, unknown> | null {
  if (!text || !text.trim()) return null
  try {
    const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/)
    const raw = match ? match[1] : text
    const parsed = JSON.parse(raw.trim())
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start === -1 || end <= start) return null
    try {
      const parsed = JSON.parse(text.slice(start, end + 1).trim())
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}
