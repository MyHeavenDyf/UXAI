/**
 * SceneRenderer —— 框架无关的 Three.js 渲染器,消费 SceneDocument。
 * ============================================================================
 * 从 SceneCanvas.tsx 抽离的渲染核心。纯 TS,零框架依赖(不 import solid-js),
 * 既被页内 SceneCanvas(Solid 薄包装)使用,也被独立预览页(packages/preview3d)复用。
 * 改这个文件时务必保持「不引任何前端框架」—— 这是独立预览页能打包复用的前提。
 *
 * 职责:把 scene-protocol.ts 定义的 SceneDocument 渲染成可交互 3D 画布。
 *  - 构建 scene/camera/lights/objects(扁平 objects + parentId 关联)
 *  - 度→弧度转换(协议规定 angleUnit=degree)
 *  - PBR 材质 + sRGB + ACES 色调;阴影
 *  - glb 加载(Draco)+ clone 复用 + 内置动画片段
 *  - 声明式动效 spin(度/秒)
 *  - OrbitControls;Raycaster 点选(向上找 userData.id)
 *  - resize / dispose
 *
 * v1 取舍(详见各处注释):
 *  - 后处理(bloom/SSAO)未接入;renderStyle 仅映射到基础参数(exposure/背景)。
 *  - 环境贴图统一用 three 自带 RoomEnvironment(PMREM,无外部 HDR 依赖),preset 暂作扩展点。
 *  - 贴图只接基础 map 槽;colorSpace 由协议 textures.type 决定(渲染器按槽设置)。
 * ============================================================================
 */
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { SceneDocument, SceneObject, MaterialNode, LightNode, CameraNode } from "../../utils/scene-protocol"

const DEG2RAD = Math.PI / 180
/** Draco 解码器默认路径(CDN);离线/打包场景由 opts.dracoPath 注入本地路径 */
const DEFAULT_DRACO_PATH = "https://www.gstatic.com/draco/v1/decoders/"

export interface SceneRendererOptions {
  /** Draco 解码器路径。页内默认走 CDN;独立预览页传本地相对路径(离线可用) */
  dracoPath?: string
  /** 点选物体回调(页内预览用;独立预览页可不传) */
  onPickObject?: (id: string | null) => void
}

export class SceneRenderer {
  // Three 核心对象(constructor 内 initThree 后可用)
  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera
  private controls!: OrbitControls
  private clock!: THREE.Clock
  private pmrem!: THREE.PMREMGenerator
  private gltfLoader!: GLTFLoader
  private textureLoader!: THREE.TextureLoader
  private raf = 0

  // 动画/资源追踪
  private spinners: Array<{ obj: THREE.Object3D; spin: [number, number, number] }> = []
  private mixers: THREE.AnimationMixer[] = []
  private gltfCache = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>()
  private resizeObs: ResizeObserver | undefined

  private container: HTMLElement
  private doc: SceneDocument | null | undefined
  private opts: SceneRendererOptions
  private disposed = false

  constructor(container: HTMLElement, opts: SceneRendererOptions = {}) {
    this.container = container
    this.opts = opts
    this.initThree()
  }

  /** 设置/更新场景文档(doc 变化时全量重建,保留 renderer/camera/controls) */
  setDoc(doc: SceneDocument | null | undefined): void {
    this.doc = doc
    void this.buildScene(doc)
  }

  /** 重置相机视角 */
  resetView(): void {
    this.controls?.reset()
  }

  /** 强制重建场景(消费当前 doc) */
  refresh(): void {
    void this.buildScene(this.doc)
  }

  /** 销毁:取消 raf、断开 resize、removeEventListener、dispose 全部 GPU 资源 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObs?.disconnect()
    if (this.renderer) this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown)
    this.clearSceneContents()
    this.controls?.dispose()
    this.pmrem?.dispose()
    this.gltfCache.forEach((c) => this.disposeObject(c.scene))
    this.gltfCache.clear()
    this.renderer?.dispose()
    if (this.renderer?.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
  }

  // --------------------------------------------------------------------------
  // 生命周期
  // --------------------------------------------------------------------------
  private initThree() {
    const el = this.container
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    renderer.domElement.style.display = "block"
    this.renderer = renderer

    this.scene = new THREE.Scene()

    this.pmrem = new THREE.PMREMGenerator(renderer)
    // 默认环境贴图(IBL + 反射),保证 PBR 物体不发黑。preset 接入外部 HDR 前统一用 RoomEnvironment。
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000)
    camera.position.set(4, 3, 6)
    this.camera = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    this.controls = controls

    this.clock = new THREE.Clock()

    this.textureLoader = new THREE.TextureLoader()
    const gltfLoader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(this.opts.dracoPath ?? DEFAULT_DRACO_PATH)
    gltfLoader.setDRACOLoader(draco)
    this.gltfLoader = gltfLoader

    renderer.domElement.addEventListener("pointerdown", this.onPointerDown)

    this.resizeObs = new ResizeObserver(() => this.onResize())
    this.resizeObs.observe(el)

    this.animate()
  }

  private onResize() {
    if (!this.renderer || !this.camera) return
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  // 箭头函数字段:addEventListener / rAF 需传同一引用,且方法内要用 this,故必须用箭头字段
  private onPointerDown = (e: PointerEvent) => {
    if (!this.opts.onPickObject || !this.renderer || !this.camera || !this.scene) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hits = ray.intersectObjects(this.scene.children, true)
    const hit = hits[0]
    if (!hit) {
      this.opts.onPickObject(null)
      return
    }
    // 击中的可能是 mesh 子节点,向上找带 userData.id 的祖先(group/glb 根带 id)
    let o: THREE.Object3D | null = hit.object
    while (o && !o.userData?.id) o = o.parent
    this.opts.onPickObject((o?.userData?.id as string) ?? null)
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate)
    const dt = this.clock?.getDelta() ?? 0
    for (const s of this.spinners) {
      s.obj.rotation.x += s.spin[0] * dt * DEG2RAD
      s.obj.rotation.y += s.spin[1] * dt * DEG2RAD
      s.obj.rotation.z += s.spin[2] * dt * DEG2RAD
    }
    for (const m of this.mixers) m.update(dt)
    this.controls?.update()
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera)
  }

  // --------------------------------------------------------------------------
  // 场景构建(doc 变化时全量重建;保留 renderer/camera/controls)
  // --------------------------------------------------------------------------
  private async buildScene(doc: SceneDocument | null | undefined) {
    if (!this.renderer || !this.scene || !this.camera || !this.controls) return // 未初始化不构建
    this.clearSceneContents()
    if (!doc) return

    this.applySceneMeta(doc)
    this.applyCamera(doc.camera)
    for (const l of doc.lights ?? []) {
      const light = this.buildLight(l)
      if (light) this.scene.add(light)
    }

    // objects 已 parent-first 排序(mergeScene.topoSortByParent 保证)
    const idMap = new Map<string, THREE.Object3D>()
    for (const obj of doc.objects ?? []) {
      const o = this.buildObject(obj)
      if (!o) continue
      o.userData.id = obj.id
      o.name = obj.id
      const parent = obj.parentId ? idMap.get(obj.parentId) : undefined
      ;(parent ?? this.scene).add(o)
      idMap.set(obj.id, o)
      if (obj.spin && Array.isArray(obj.spin)) this.spinners.push({ obj: o, spin: obj.spin as [number, number, number] })
    }
  }

  private clearSceneContents() {
    this.spinners.length = 0
    for (const m of this.mixers) m.stopAllAction()
    this.mixers.length = 0
    if (!this.scene) return
    for (const child of [...this.scene.children]) {
      this.scene.remove(child)
      this.disposeObject(child)
    }
  }

  private disposeObject(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose?.()
      const mat = mesh.material
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((mm) => this.disposeMaterial(mm))
        else this.disposeMaterial(mat as THREE.Material)
      }
    })
  }

  private disposeMaterial(m: THREE.Material) {
    const slots = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "displacementMap"]
    for (const k of slots) {
      const t = (m as unknown as Record<string, THREE.Texture | undefined>)[k]
      t?.dispose?.()
    }
    m.dispose()
  }

  // --------------------------------------------------------------------------
  // scene 元信息 / 相机 / 灯光
  // --------------------------------------------------------------------------
  private applySceneMeta(doc: SceneDocument) {
    if (!this.scene) return
    const bg = doc.scene?.background
    if (typeof bg === "string") {
      this.scene.background = new THREE.Color(bg)
    } else if (bg && typeof bg === "object" && "texture" in bg && this.textureLoader) {
      // 纹理背景(v1:按 color 处理 url 纹理)
      const tex = this.textureLoader.load(bg.texture as string)
      tex.colorSpace = THREE.SRGBColorSpace
      this.scene.background = tex
    }
    const fog = doc.scene?.fog
    if (fog?.type === "linear") this.scene.fog = new THREE.Fog(new THREE.Color(fog.color), fog.near, fog.far)
    else if (fog?.type === "exp2") this.scene.fog = new THREE.FogExp2(new THREE.Color(fog.color), fog.density)

    // renderStyle 简易映射(v1:不接入后处理,仅调 exposure)
    const style = doc.scene?.renderStyle
    if (this.renderer) {
      if (style === "neon" || style === "cinematic-bloom") this.renderer.toneMappingExposure = 1.15
      else if (style === "flat-shaded" || style === "wireframe-debug") this.renderer.toneMappingExposure = 1.0
      else this.renderer.toneMappingExposure = 1.0
    }
  }

  private applyCamera(cam: CameraNode | undefined) {
    if (!cam || !this.camera || !this.controls) return
    // v1:保持 perspective(orthographic 切换留扩展)
    if (cam.perspective?.fov != null && this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = cam.perspective.fov
      this.camera.updateProjectionMatrix()
    }
    if (cam.position) this.camera.position.set(cam.position[0], cam.position[1], cam.position[2])
    const lookAt = cam.lookAt ?? [0, 0, 0]
    this.camera.lookAt(lookAt[0], lookAt[1], lookAt[2])
    this.controls.target.set(lookAt[0], lookAt[1], lookAt[2])
    this.controls.update()
  }

  private buildLight(l: LightNode): THREE.Object3D | null {
    const color = l.color ? new THREE.Color(l.color) : new THREE.Color(0xffffff)
    const intensity = l.intensity ?? 1
    let light: THREE.Light | null = null
    switch (l.type) {
      case "ambient":
        light = new THREE.AmbientLight(color, intensity)
        break
      case "hemisphere":
        light = new THREE.HemisphereLight(color, l.groundColor ? new THREE.Color(l.groundColor) : new THREE.Color(0x444444), intensity)
        break
      case "directional": {
        const d = new THREE.DirectionalLight(color, intensity)
        if (l.position) d.position.set(l.position[0], l.position[1], l.position[2])
        if (l.castShadow) {
          d.castShadow = true
          const sc = d.shadow.camera
          const c = l.shadow?.camera ?? {}
          if (c.near != null) sc.near = c.near
          if (c.far != null) sc.far = c.far
          if (c.left != null) sc.left = c.left
          if (c.right != null) sc.right = c.right
          if (c.top != null) sc.top = c.top
          if (c.bottom != null) sc.bottom = c.bottom
          const ms = l.shadow?.mapSize ?? 1024
          d.shadow.mapSize.set(ms, ms)
          if (l.shadow?.bias != null) d.shadow.bias = l.shadow.bias
          if (l.shadow?.normalBias != null) d.shadow.normalBias = l.shadow.normalBias
          if (l.shadow?.radius != null) d.shadow.radius = l.shadow.radius
        }
        light = d
        break
      }
      case "point": {
        const p = new THREE.PointLight(color, intensity, l.distance ?? 0, l.decay ?? 2)
        if (l.position) p.position.set(l.position[0], l.position[1], l.position[2])
        if (l.castShadow) {
          p.castShadow = true
          if (l.shadow?.mapSize) p.shadow.mapSize.set(l.shadow.mapSize, l.shadow.mapSize)
        }
        light = p
        break
      }
      case "spot": {
        const angleRad = Math.min((l.angle ?? 45) * DEG2RAD, Math.PI / 2) // 协议:度,且 ≤90°
        const s = new THREE.SpotLight(color, intensity, l.distance ?? 0, angleRad, l.penumbra ?? 0, l.decay ?? 2)
        if (l.position) s.position.set(l.position[0], l.position[1], l.position[2])
        if (l.castShadow) {
          s.castShadow = true
          if (l.shadow?.mapSize) s.shadow.mapSize.set(l.shadow.mapSize, l.shadow.mapSize)
        }
        light = s
        break
      }
      case "rectArea": {
        const r = new THREE.RectAreaLight(color, intensity, l.width ?? 1, l.height ?? 1)
        if (l.position) r.position.set(l.position[0], l.position[1], l.position[2])
        light = r
        break
      }
      default:
        return null
    }
    return light
  }

  // --------------------------------------------------------------------------
  // 物体构建
  // --------------------------------------------------------------------------
  private buildObject(obj: SceneObject): THREE.Object3D | null {
    let o: THREE.Object3D | null = null
    switch (obj.type) {
      case "group":
        o = new THREE.Group()
        break
      case "mesh": {
        const geo = this.buildGeometry(obj.geometry?.type, (obj.geometry?.params ?? {}) as Record<string, number>)
        const mat = this.buildMaterial(obj.material)
        const mesh = new THREE.Mesh(geo, mat)
        if (obj.castShadow) mesh.castShadow = true
        if (obj.receiveShadow) mesh.receiveShadow = true
        o = mesh
        break
      }
      case "points": {
        const geo = this.buildGeometry(obj.geometry?.type, (obj.geometry?.params ?? {}) as Record<string, number>)
        const mat = new THREE.PointsMaterial({
          color: typeof obj.material === "object" && obj.material?.color ? new THREE.Color(obj.material.color) : 0xffffff,
          size: obj.size ?? 0.1,
          sizeAttenuation: true,
        })
        o = new THREE.Points(geo, mat)
        break
      }
      case "glb": {
        // 异步:先返回占位 group,加载完成后填充;spin/parent 作用在占位上
        const placeholder = new THREE.Group()
        const assetKey = obj.asset
        const assetsGlb = (this.doc?.assets?.glb ?? {}) as Record<string, { url: string; draco?: boolean }>
        const asset = assetKey ? assetsGlb[assetKey] : undefined
        if (asset?.url) {
          void this.loadGlb(assetKey!, asset).then((loaded) => {
            if (!loaded) return
            const cloned = cloneSkeleton(loaded.scene)
            cloned.traverse((c) => {
              const m = c as THREE.Mesh
              if (m.isMesh) {
                m.castShadow = obj.castShadow ?? true
                m.receiveShadow = obj.receiveShadow ?? true
              }
            })
            placeholder.add(cloned)
            // 内置动画片段
            const anim = obj.animation
            if (anim && loaded.animations.length > 0) {
              const mixer = new THREE.AnimationMixer(cloned)
              const clips =
                anim === true
                  ? [loaded.animations[0]]
                  : (Array.isArray(anim) ? anim : [anim])
                      .map((name) => THREE.AnimationClip.findByName(loaded.animations, name as string))
                      .filter(Boolean) as THREE.AnimationClip[]
              for (const clip of clips) mixer.clipAction(clip).play()
              this.mixers.push(mixer)
            }
          })
        }
        o = placeholder
        break
      }
      default:
        return null
    }

    // 公共变换(协议:角度用度)
    this.applyTransform(o, obj)
    if (obj.visible === false) o.visible = false
    return o
  }

  private applyTransform(o: THREE.Object3D, obj: SceneObject) {
    if (obj.position) o.position.set(obj.position[0], obj.position[1], obj.position[2])
    if (obj.rotation) o.rotation.set(obj.rotation[0] * DEG2RAD, obj.rotation[1] * DEG2RAD, obj.rotation[2] * DEG2RAD)
    if (obj.scale != null) {
      if (typeof obj.scale === "number") o.scale.setScalar(obj.scale)
      else o.scale.set(obj.scale[0], obj.scale[1], obj.scale[2])
    }
  }

  private buildGeometry(type: string | undefined, p: Record<string, number>): THREE.BufferGeometry {
    const r = (k: string, d: number) => (typeof p[k] === "number" && p[k] > 0 ? p[k] : d)
    const ri = (k: string, d: number) => Math.max(1, Math.min(128, Math.floor(r(k, d))))
    switch (type) {
      case "box":
        return new THREE.BoxGeometry(r("width", 1), r("height", 1), r("depth", 1))
      case "sphere":
        return new THREE.SphereGeometry(r("radius", 1), ri("widthSegments", 32), ri("heightSegments", 32))
      case "plane":
        return new THREE.PlaneGeometry(r("width", 10), r("height", 10))
      case "circle":
        return new THREE.CircleGeometry(r("radius", 1), ri("segments", 32))
      case "cylinder":
        return new THREE.CylinderGeometry(r("radiusTop", 1), r("radiusBottom", 1), r("height", 2), ri("radialSegments", 32))
      case "cone":
        return new THREE.ConeGeometry(r("radius", 1), r("height", 2), ri("radialSegments", 32))
      case "torus":
        return new THREE.TorusGeometry(r("radius", 1), r("tube", 0.4), ri("radialSegments", 16), ri("tubularSegments", 100))
      case "torusKnot":
        return new THREE.TorusKnotGeometry(r("radius", 1), r("tube", 0.4), ri("tubularSegments", 100), ri("radialSegments", 16))
      case "ring":
        return new THREE.RingGeometry(r("innerRadius", 0.5), r("outerRadius", 1), ri("thetaSegments", 32))
      case "capsule":
        return new THREE.CapsuleGeometry(r("radius", 0.5), r("length", 1), ri("capSegments", 4), ri("radialSegments", 8))
      case "dodecahedron":
        return new THREE.DodecahedronGeometry(r("radius", 1), ri("detail", 0))
      case "icosahedron":
        return new THREE.IcosahedronGeometry(r("radius", 1), ri("detail", 0))
      case "octahedron":
        return new THREE.OctahedronGeometry(r("radius", 1), ri("detail", 0))
      case "tetrahedron":
        return new THREE.TetrahedronGeometry(r("radius", 1), ri("detail", 0))
      default:
        return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  private buildMaterial(node: MaterialNode | string | undefined): THREE.Material {
    // 字符串 = 引用 assets.materials[key]
    const assetsMats = (this.doc?.assets?.materials ?? {}) as Record<string, MaterialNode>
    const n: MaterialNode = typeof node === "string" ? assetsMats[node] ?? { type: "standard" } : node ?? { type: "standard" }
    const type = n.type ?? "standard"
    const color = n.color ? new THREE.Color(n.color) : new THREE.Color(0xffffff)
    let mat: THREE.Material

    switch (type) {
      case "basic":
        mat = new THREE.MeshBasicMaterial({ color })
        break
      case "lambert":
        mat = new THREE.MeshLambertMaterial({ color })
        break
      case "phong":
        mat = new THREE.MeshPhongMaterial({ color, specular: n.specular ? new THREE.Color(n.specular) : undefined, shininess: n.shininess ?? 100 })
        break
      case "toon":
        mat = new THREE.MeshToonMaterial({ color })
        break
      case "normal":
        mat = new THREE.MeshNormalMaterial()
        break
      case "physical": {
        const m = new THREE.MeshPhysicalMaterial({ color })
        this.applyStandard(m, n)
        if (n.clearcoat != null) m.clearcoat = n.clearcoat
        if (n.clearcoatRoughness != null) m.clearcoatRoughness = n.clearcoatRoughness
        if (n.transmission != null) {
          m.transmission = n.transmission
          m.transparent = true
        }
        if (n.thickness != null) m.thickness = n.thickness
        if (n.ior != null) m.ior = n.ior
        if (n.sheen != null) m.sheen = n.sheen
        if (n.sheenColor) m.sheenColor = new THREE.Color(n.sheenColor)
        mat = m
        break
      }
      case "standard":
      default: {
        const m = new THREE.MeshStandardMaterial({ color })
        this.applyStandard(m, n)
        mat = m
        break
      }
    }

    // 通用属性
    const anyMat = mat as THREE.MeshStandardMaterial
    if (n.opacity != null && n.opacity < 1) {
      anyMat.transparent = true
      anyMat.opacity = n.opacity
    }
    if (n.transparent) anyMat.transparent = true
    if (n.wireframe) anyMat.wireframe = true
    if (n.flatShading && "flatShading" in anyMat) anyMat.flatShading = true
    if (n.side === "back") anyMat.side = THREE.BackSide
    else if (n.side === "double") anyMat.side = THREE.DoubleSide
    if (anyMat.needsUpdate) anyMat.needsUpdate = true
    return mat
  }

  private applyStandard(m: THREE.MeshStandardMaterial, n: MaterialNode) {
    if (n.roughness != null) m.roughness = n.roughness
    if (n.metalness != null) m.metalness = n.metalness
    if (n.envMapIntensity != null) m.envMapIntensity = n.envMapIntensity
    if (n.emissive) m.emissive = new THREE.Color(n.emissive)
    if (n.emissiveIntensity != null) m.emissiveIntensity = n.emissiveIntensity
  }

  // --------------------------------------------------------------------------
  // glb 加载 + 缓存(clone 复用)
  // --------------------------------------------------------------------------
  private async loadGlb(
    key: string,
    asset: { url: string; draco?: boolean },
  ): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
    if (!this.gltfLoader) return null
    const cached = this.gltfCache.get(key)
    if (cached) return cached
    try {
      const gltf = await this.gltfLoader.loadAsync(asset.url)
      const result = { scene: gltf.scene, animations: gltf.animations ?? [] }
      this.gltfCache.set(key, result)
      return result
    } catch (err) {
      console.error(`[SceneRenderer] glb 加载失败(${key}):`, asset.url, err)
      return null
    }
  }
}
