---
name: threejs-3d-ref
description: Three.js 3D 场景生成精简参考 + 全量 skill 索引。3D 页 agent 专用,遇到特定需求时指向对应 skill。
---

# Three.js 3D 精简参考

## 坐标系(右手系)
+X=右, +Y=上, +Z=朝观察者。地面在 XZ 平面。1 单位=1 米。

## 几何体构造函数
```
BoxGeometry(w, h, d)                    PlaneGeometry(w, h)
SphereGeometry(r, ws, hs)               CircleGeometry(r, seg)
CylinderGeometry(rTop, rBot, h, seg)    ConeGeometry(r, h, seg)
TorusGeometry(r, tube, rs, ts)          RingGeometry(inner, outer, ts)
CapsuleGeometry(r, len, capSeg, radSeg) TetrahedronGeometry(r, detail)
```

## 材质(MeshStandardMaterial 为默认 PBR)
```
standard: color, roughness(0-1), metalness(0|1), emissive, map, normalMap
physical: standard + clearcoat, transmission(玻璃), ior(1-2.3), sheen, thickness
basic:    color, wireframe (无光照)
```
metalness>0 必须有环境光(scene.environment),否则发黑。

## 灯光
```
AmbientLight(color, intensity)          HemisphereLight(skyColor, groundColor)
DirectionalLight(color, intensity)      PointLight(color, intensity, dist, decay)
SpotLight(color, intensity, dist, angle, penumbra)
```

## 方向约定(相机在 +X/+Y/+Z 看向原点)
左=-X, 右=+X, 远/背景=-Z, 近/前景=+Z, 高=+Y

## 防共面 z-fighting
接触地面 Y 加 0.02~0.05 余量。叠放层间留 ≥0.02 间隙。

---

# Three.js Skill 索引(按需求查阅)

以下 skill 包含完整 API 文档和代码示例。生成场景时如遇对应需求,参考相关 skill 的知识:

| 需求 | Skill | 关键内容 |
|---|---|---|
| **创建 GUI / 操作面板 / 工具栏 / 标签** | `threejs-gui` | CSS2DRenderer(HTML 浮层)、CSS3DRenderer(3D 变换)、TransformControls(gizmo)、lil-gui(参数面板)、截图/全屏 |
| **几何体详细参数 / 自定义几何** | `threejs-geometry` | 全部内置几何完整参数、BufferGeometry、InstancedMesh、EdgesGeometry |
| **材质高级参数 / 贴图槽** | `threejs-materials` | 9 种材质完整属性、PBR 参数、环境贴图、多材质 |
| **灯光配置 / 阴影 / IBL** | `threejs-lighting` | 6 种灯光详细参数、阴影设置、PMREM 环境光、三点布光 |
| **纹理 / UV / 环境贴图** | `threejs-textures` | TextureLoader、UV 映射、CubeTexture、HDR、render target |
| **动画 / 关键帧 / 骨骼** | `threejs-animation` | Clock、AnimationMixer、关键帧、morph targets、GLTF 动画 |
| **加载 GLB / Draco / HDR** | `threejs-loaders` | GLTFLoader、DRACOLoader、RGBELoader、LoadingManager |
| **着色器 / GLSL / 自定义特效** | `threejs-shaders` | ShaderMaterial、uniforms、vertex/fragment、RawShaderMaterial |
| **后处理 / Bloom / DOF** | `threejs-postprocessing` | EffectComposer、Bloom、DOF、自定义 Pass |
| **交互 / 射线检测 / 控制器** | `threejs-interaction` | Raycaster、OrbitControls、鼠标/触摸、物体选中 |
| **场景搭建基础** | `threejs-fundamentals` | Scene/Camera/Renderer、Object3D、Group、坐标系、数学工具 |

## 使用约定
- **css2d 卡片**:用 `mode: "css2d"` + `card: true`,HTML 属性用单引号(`style='...'`)
- **货架/置物架**:用 `type: "component"`, `component: { type: "rack", params: { levels, width, height, depth } }`;隔板子节点 id 为 `{objectId}_shelf0~N`,其他物体可用 parentId 引用在指定层放物品
- **3D 文字**:ASCII 用 `mode: "3d"`,中文用 `mode: "css2d"` 或 canvas 贴图
