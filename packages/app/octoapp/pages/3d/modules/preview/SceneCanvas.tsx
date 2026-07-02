/**
 * SceneCanvas —— Three.js 渲染器,消费 SceneDocument(页内 canvas 方案,Part B 路径一)。
 * ============================================================================
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
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js"
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js"
import { createEffect, on, onCleanup, onMount, type JSX } from "solid-js"
import type { SceneDocument, SceneObject, MaterialNode, LightNode, CameraNode } from "../../utils/scene-protocol"

const DEG2RAD = Math.PI / 180
/** Draco 解码器路径(默认 CDN;接入时可换本地 three/examples/jsm/libs/draco) */
const DRACO_PATH = "https://www.gstatic.com/draco/v1/decoders/"
/** 字体文件路径(text 几何用,CDN helvetiker regular) */
const FONT_URL = "https://unpkg.com/three@0.177.0/examples/fonts/helvetiker_regular.typeface.json"

export type SceneCanvasAPI = {
  resetView: () => void
  refresh: () => void
}

export function SceneCanvas(props: {
  doc: SceneDocument | null | undefined
  onPickObject?: (id: string | null) => void
  ref?: (api: SceneCanvasAPI) => void
}): JSX.Element {
  let containerRef: HTMLDivElement | undefined

  // Three 核心对象(onMount 后可用)
  let renderer: THREE.WebGLRenderer | undefined
  let scene: THREE.Scene | undefined
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined
  let controls: OrbitControls | undefined
  let clock: THREE.Clock | undefined
  let pmrem: THREE.PMREMGenerator | undefined
  let gltfLoader: GLTFLoader | undefined
  let textureLoader: THREE.TextureLoader | undefined
  let loadingManager: THREE.LoadingManager | undefined
  // text 几何用的字体(懒加载,首次遇到 text 类型时从 CDN 拉)
  let fontCache: any = null
  let fontPromise: Promise<any | null> | undefined
  let raf = 0

  // 动画/资源追踪
  const spinners: Array<{ obj: THREE.Object3D; spin: [number, number, number] }> = []
  const mixers: THREE.AnimationMixer[] = []
  const gltfCache = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>()
  let resizeObs: ResizeObserver | undefined

  // --------------------------------------------------------------------------
  // 生命周期
  // --------------------------------------------------------------------------
  onMount(() => {
    initThree()
    void buildScene(props.doc) // 首次构建
  })

  // 后续 doc 变化重建(跳过首次,首次由 onMount 负责)
  createEffect(
    on(
      () => props.doc,
      (doc, prev) => {
        if (prev !== undefined) void buildScene(doc)
      },
    ),
  )

  function initThree() {
    const el = containerRef!
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", logarithmicDepthBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    renderer.domElement.style.display = "block"

    scene = new THREE.Scene()

    pmrem = new THREE.PMREMGenerator(renderer)
    // 默认环境贴图(IBL + 反射),保证 PBR 物体不发黑。preset 接入外部 HDR 前统一用 RoomEnvironment。
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000)
    camera.position.set(4, 3, 6)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    clock = new THREE.Clock()

    loadingManager = new THREE.LoadingManager()
    loadingManager.onStart = (url, loaded, total) =>
      console.log(`[SceneCanvas] loading started: ${loaded}/${total} (${url})`)
    loadingManager.onProgress = (url, loaded, total) =>
      console.log(`[SceneCanvas] loading progress: ${loaded}/${total} (${url})`)
    loadingManager.onLoad = () => console.log("[SceneCanvas] all assets loaded")
    loadingManager.onError = (url) => console.error(`[SceneCanvas] loading error: ${url}`)

    textureLoader = new THREE.TextureLoader(loadingManager)
    gltfLoader = new GLTFLoader(loadingManager)
    const draco = new DRACOLoader()
    draco.setDecoderPath(DRACO_PATH)
    gltfLoader.setDRACOLoader(draco)

    renderer.domElement.addEventListener("pointerdown", onPointerDown)

    resizeObs = new ResizeObserver(() => onResize())
    resizeObs.observe(el)

    animate()

    if (props.ref) props.ref({ resetView: () => controls?.reset(), refresh: () => void buildScene(props.doc) })
  }

  function onResize() {
    if (!containerRef || !renderer || !camera) return
    const w = containerRef.clientWidth
    const h = containerRef.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (!props.onPickObject || !renderer || !camera || !scene) return
    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, camera)
    const hits = ray.intersectObjects(scene.children, true)
    const hit = hits[0]
    if (!hit) {
      props.onPickObject(null)
      return
    }
    // 击中的可能是 mesh 子节点,向上找带 userData.id 的祖先(group/glb 根带 id)
    let o: THREE.Object3D | null = hit.object
    while (o && !o.userData?.id) o = o.parent
    props.onPickObject((o?.userData?.id as string) ?? null)
  }

  function animate() {
    raf = requestAnimationFrame(animate)
    const dt = clock?.getDelta() ?? 0
    for (const s of spinners) {
      s.obj.rotation.x += s.spin[0] * dt * DEG2RAD
      s.obj.rotation.y += s.spin[1] * dt * DEG2RAD
      s.obj.rotation.z += s.spin[2] * dt * DEG2RAD
    }
    for (const m of mixers) m.update(dt)
    controls?.update()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }

  // --------------------------------------------------------------------------
  // 场景构建(doc 变化时全量重建;保留 renderer/camera/controls)
  // --------------------------------------------------------------------------

  /** 懒加载 text 几何用的字体(FontLoader 从 CDN 拉,缓存) */
  function ensureFont(): Promise<any | null> {
    if (fontCache) return Promise.resolve(fontCache)
    if (!fontPromise) {
      const loader = new FontLoader(loadingManager)
      fontPromise = loader.loadAsync(FONT_URL).then((f) => { fontCache = f; return f }).catch(() => null)
    }
    return fontPromise
  }

  async function buildScene(doc: SceneDocument | null | undefined) {
    if (!renderer || !scene || !camera || !controls) return // mount 前不构建
    clearSceneContents()
    if (!doc) return

    // 如果场景含 text 几何,预加载字体(异步,只拉一次)
    if (doc.objects?.some((o) => o.geometry?.type === "text")) await ensureFont()

    applySceneMeta(doc)
    applyCamera(doc.camera)
    for (const l of doc.lights ?? []) {
      const light = buildLight(l)
      if (light) scene.add(light)
    }

    // objects 已 parent-first 排序(mergeScene.topoSortByParent 保证)
    const idMap = new Map<string, THREE.Object3D>()
    for (const obj of doc.objects ?? []) {
      const o = buildObject(obj)
      if (!o) continue
      o.userData.id = obj.id
      o.name = obj.id
      const parent = obj.parentId ? idMap.get(obj.parentId) : undefined
      ;(parent ?? scene).add(o)
      idMap.set(obj.id, o)
      if (obj.spin && Array.isArray(obj.spin)) spinners.push({ obj: o, spin: obj.spin as [number, number, number] })
    }
  }

  function clearSceneContents() {
    spinners.length = 0
    for (const m of mixers) m.stopAllAction()
    mixers.length = 0
    if (!scene) return
    for (const child of [...scene.children]) {
      scene.remove(child)
      disposeObject(child)
    }
  }

  function disposeObject(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose?.()
      const mat = mesh.material
      if (mat) {
        if (Array.isArray(mat)) mat.forEach(disposeMaterial)
        else disposeMaterial(mat as THREE.Material)
      }
    })
  }

  function disposeMaterial(m: THREE.Material) {
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
  function applySceneMeta(doc: SceneDocument) {
    if (!scene) return
    const bg = doc.scene?.background
    if (typeof bg === "string") {
      scene.background = new THREE.Color(bg)
    } else if (bg && typeof bg === "object" && "texture" in bg && textureLoader) {
      // 纹理背景(v1:按 color 处理 url 纹理)
      const tex = textureLoader.load(bg.texture as string)
      tex.colorSpace = THREE.SRGBColorSpace
      scene.background = tex
    }
    const fog = doc.scene?.fog
    if (fog?.type === "linear") scene.fog = new THREE.Fog(new THREE.Color(fog.color), fog.near, fog.far)
    else if (fog?.type === "exp2") scene.fog = new THREE.FogExp2(new THREE.Color(fog.color), fog.density)

    // renderStyle 简易映射(v1:不接入后处理,仅调 exposure)
    const style = doc.scene?.renderStyle
    if (renderer) {
      if (style === "neon" || style === "cinematic-bloom") renderer.toneMappingExposure = 1.15
      else if (style === "flat-shaded" || style === "wireframe-debug") renderer.toneMappingExposure = 1.0
      else renderer.toneMappingExposure = 1.0
    }
  }

  function applyCamera(cam: CameraNode | undefined) {
    if (!cam || !camera || !controls) return
    // v1:保持 perspective(orthographic 切换留扩展)
    if (cam.perspective?.fov != null && camera instanceof THREE.PerspectiveCamera) {
      camera.fov = cam.perspective.fov
      camera.updateProjectionMatrix()
    }
    if (cam.position) camera.position.set(cam.position[0], cam.position[1], cam.position[2])
    const lookAt = cam.lookAt ?? [0, 0, 0]
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2])
    controls.target.set(lookAt[0], lookAt[1], lookAt[2])
    controls.update()
  }

  function buildLight(l: LightNode): THREE.Object3D | null {
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
  function buildObject(obj: SceneObject): THREE.Object3D | null {
    let o: THREE.Object3D | null = null
    switch (obj.type) {
      case "group":
        o = new THREE.Group()
        break
      case "mesh": {
        // text 几何特殊处理:ASCII 用 TextGeometry(3D 立体),非 ASCII(中文等)用 canvas 贴图
        const geoType = obj.geometry?.type
        if (geoType === "text") {
          const tp = (obj.geometry?.params ?? {}) as Record<string, any>
          const text = String(tp.text ?? "Text")
          const size = Number(tp.size) > 0 ? Number(tp.size) : 1
          const isAscii = /^[\x00-\x7F]*$/.test(text)
          if (isAscii && fontCache) {
            // A. TextGeometry(3D 挤出,仅 ASCII)
            const geo = buildGeometry("text", tp)
            const mat = buildMaterial(obj.material)
            const mesh = new THREE.Mesh(geo, mat)
            if (obj.castShadow) mesh.castShadow = true
            if (obj.receiveShadow) mesh.receiveShadow = true
            o = mesh
          } else {
            // B. canvas 贴图文字(支持中文/任意语言)
            const cv = document.createElement("canvas")
            const ctx = cv.getContext("2d")!
            const fs = 128
            ctx.font = `bold ${fs}px sans-serif`
            const m = ctx.measureText(text)
            cv.width = Math.ceil(m.width) + 32
            cv.height = fs + 32
            ctx.font = `bold ${fs}px sans-serif`
            ctx.fillStyle = "#ffffff"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(text, cv.width / 2, cv.height / 2)
            const tex = new THREE.CanvasTexture(cv)
            tex.colorSpace = THREE.SRGBColorSpace
            const planeW = size * (cv.width / cv.height)
            const geo = new THREE.PlaneGeometry(planeW, size)
            const matColor = typeof obj.material === "object" && (obj.material as any)?.color ? (obj.material as any).color : "#ffffff"
            const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(matColor), side: THREE.DoubleSide })
            const mesh = new THREE.Mesh(geo, mat)
            o = mesh
          }
          break
        }
        const geo = buildGeometry(obj.geometry?.type, (obj.geometry?.params ?? {}) as Record<string, number>)
        const mat = buildMaterial(obj.material)
        const mesh = new THREE.Mesh(geo, mat)
        if (obj.castShadow) mesh.castShadow = true
        if (obj.receiveShadow) mesh.receiveShadow = true
        o = mesh
        break
      }
      case "points": {
        const geo = buildGeometry(obj.geometry?.type, (obj.geometry?.params ?? {}) as Record<string, number>)
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
        const assetsGlb = (props.doc?.assets?.glb ?? {}) as Record<string, { url: string; draco?: boolean }>
        const asset = assetKey ? assetsGlb[assetKey] : undefined
        if (asset?.url) {
          void loadGlb(assetKey!, asset).then((loaded) => {
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
              mixers.push(mixer)
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
    applyTransform(o, obj)
    if (obj.visible === false) o.visible = false
    return o
  }

  function applyTransform(o: THREE.Object3D, obj: SceneObject) {
    if (obj.position) o.position.set(obj.position[0], obj.position[1], obj.position[2])
    if (obj.rotation) o.rotation.set(obj.rotation[0] * DEG2RAD, obj.rotation[1] * DEG2RAD, obj.rotation[2] * DEG2RAD)
    if (obj.scale != null) {
      if (typeof obj.scale === "number") o.scale.setScalar(obj.scale)
      else o.scale.set(obj.scale[0], obj.scale[1], obj.scale[2])
    }
  }

  function buildGeometry(type: string | undefined, p: Record<string, number>): THREE.BufferGeometry {
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
      case "text": {
        if (!fontCache) return new THREE.BoxGeometry(1, 0.5, 0.2) // 字体未就绪 → 占位
        return new TextGeometry(String(p.text ?? "Text"), {
          font: fontCache,
          size: r("size", 1),
          depth: r("depth", 0.2),
          curveSegments: 6,
          bevelEnabled: false,
        })
      }
      default:
        return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  function buildMaterial(node: MaterialNode | string | undefined): THREE.Material {
    // 字符串 = 引用 assets.materials[key]
    const assetsMats = (props.doc?.assets?.materials ?? {}) as Record<string, MaterialNode>
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
        applyStandard(m, n)
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
        applyStandard(m, n)
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

  function applyStandard(m: THREE.MeshStandardMaterial, n: MaterialNode) {
    if (n.roughness != null) m.roughness = n.roughness
    if (n.metalness != null) m.metalness = n.metalness
    if (n.envMapIntensity != null) m.envMapIntensity = n.envMapIntensity
    if (n.emissive) m.emissive = new THREE.Color(n.emissive)
    if (n.emissiveIntensity != null) m.emissiveIntensity = n.emissiveIntensity
  }

  // --------------------------------------------------------------------------
  // glb 加载 + 缓存(clone 复用)
  // --------------------------------------------------------------------------
  async function loadGlb(
    key: string,
    asset: { url: string; draco?: boolean },
  ): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
    if (!gltfLoader) return null
    const cached = gltfCache.get(key)
    if (cached) return cached
    try {
      const gltf = await gltfLoader.loadAsync(asset.url)
      const result = { scene: gltf.scene, animations: gltf.animations ?? [] }
      gltfCache.set(key, result)
      return result
    } catch (err) {
      console.error(`[SceneCanvas] glb 加载失败(${key}):`, asset.url, err)
      return null
    }
  }

  // --------------------------------------------------------------------------
  // 清理
  // --------------------------------------------------------------------------
  onCleanup(() => {
    cancelAnimationFrame(raf)
    resizeObs?.disconnect()
    if (renderer) renderer.domElement.removeEventListener("pointerdown", onPointerDown)
    clearSceneContents()
    controls?.dispose()
    pmrem?.dispose()
    gltfCache.forEach((c) => disposeObject(c.scene))
    gltfCache.clear()
    renderer?.dispose()
    if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement)
  })

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }} />
}
