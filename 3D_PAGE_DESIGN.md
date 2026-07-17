# 3D 页面改造 — 完整方案文档

> 维护方式：每次重要决策后更新本文件。新会话开始时将本文件作为初始 prompt，基于已定结论继续推进，不重复讨论。
> 同步基线 commit：`40177fd038fccc8004b7d77588c34d5a6c8239f2`（dev_pattern，本次会话时点 HEAD）。
> 旧基线 `18de05fbf` 已过时，但仍在 git 历史中可达。

---

## 0. 现状核验（2026-07-10）

> ⚠️ 上一会话的"已实施"记录是**设计稿，未落地**。三工程均为原始状态。本文件描述的是**待落地**的完整方案。

### octoapp（SolidJS，`packages/app/octoapp/`）
- `pages/3d/` 仅一个空 `utils/` 子目录，无任何代码。
- titlebar `TabType = "chat"|"make"|"cowork"|"studio"|"pattern"`，无 3D。
- `octo.tsx:647` 仅有 `/pattern/:id?` 路由，无 `/3d`。
- `context/layout.tsx` 的 `lastSessionPerTab` 无 `3d` 槽位。
- package.json 不含 three —— 约束保持。

### 3d-templete（Vue3 SPA，`D:/cyc/project/octo/3d-templete/`）
- Vite 8，`private:true`，依赖仅 axios/three@^0.185/vue/vue-router，**未引入 3d-components**。
- 渲染引擎在 `src/3d/`，主入口 `createScene3D(canvas,data,opts)`（`src/3d/createScene3D.ts:117`），返回 `Scene3DHandle`。
- 正统 Schema = `LiveDataConfig`（`src/3d/utils/liveDataLoader.ts:54-150`），示例 `public/live-data.json`（3044行城市/操场场景）。
- 解析：`applyLiveDataToApp()` 两遍构建对象树（nodeMap + parentId 挂载）。`createLiveObject3D` 按 `cfg.type` switch 分发：group/mesh/component/glb。
- 17 个内置预制组件（ComponentRegistry 双模式：函数 builder + 类 ctor）。
- 已有：GLTFLoader、CSS2D 卡片系统（CardManager + Raycaster 仅用于卡片点击）、AssetPool 缓存、DebugOverlay、PMREM(RoomEnvironment)、增量更新 sceneUpdate.ts。
- **缺**：postMessage/iframe 桥、通用 Raycaster 选中、CSS3D、Sprite、外部模型格式识别、3d-components 接入。
- `src/3d/bridge/`、`src/3d/interaction/` 是**空目录**（预留）。

### 3d-components（npm 包 `@cyc/3d-components@0.1.0`）
- Vite lib mode + rollup，双格式 ESM/CJS，5 子路径 exports（. /core /heat /material /utils），sideEffects:false，peer: three/gsap/three-bvh-csg/three-mesh-bvh。结构上已发布就绪。
- 组件 = Three.js Object3D 子类（class），`new Component(options)` 构造，options 对象模式（继承 ComponentOptions/GroupComponentOptions），有 IUpdatable/IDisposable 约定。
- **无注册表/工厂/按名加载机制** —— 纯 ES export，使用方按需 import。
- core 11 组件（BaseGroup/Wall/Shape/Grid/Path/Outlines/Wireframe/BitmapText/Html/Sky/InstancedMesh2）；heat 2；material 2；utils 工具集。
- 领域目录现有 core/heat/material/utils，**无 energy/warehouse**。
- `InstancedMesh2.ts` 有 `// @ts-nocheck`，发布前需补类型。

### pattern → previewpc 通信（2D 模板，3D 完全仿照）
- iframe 嵌入：`<iframe src="http://127.0.0.1:51856">`（`pages/pattern/modules/preview/index.tsx:451`）。
- postMessage 协议：`A2UI_UPDATE`(父→子携JSON)、`A2UI_READY`(子→父握手)、`TOGGLE_THEME`、`DOM_PICKER_*`、`DRAG_MODE`、`DRAG_REORDER`。
- 握手时序：iframe load → previewpc `onMounted` 发 `A2UI_READY` → octoapp 收到重发 pendingData。
- 部署：previewpc build → `packages/previewdist`（`outDir:'../previewdist'`）；Electron `packages/desktop/src/main/preview-server.ts` 起固定 `127.0.0.1:51856` 静态 server 托管。

---

## 1. 技术方案设计

### 1.1 架构图（三工程 + 数据流 + 部署）

```
┌──────────────────────────── octoapp（SolidJS，主应用）────────────────────────────┐
│  pages/3d/  (克隆 pages/pattern/ 的对话流/历史/导出骨架)                          │
│    ChatPanel ──► 3D Agent 产 SceneConfig JSON                                    │
│    PreviewPage3D: <iframe src=VITE_3D_TEMPLATE_URL>                              │
│         │ postMessage { type:'SCENE_UPDATE', payload:SceneConfig }              │
│         │ window.addEventListener('message', handle ← SCENE_READY/PICK/ERROR)  │
└─────────┼────────────────────────────────────────────────────────────────────────┘
          │ iframe（跨源）   octoapp 永不 import three / @cyc/3d-components
          ▼
┌──────────────────────── 3d-templete（Vue3，3D 渲染引擎）──────────────────────────┐
│  src/views/embed.vue  (预览入口 interactive:true + postMessage host + picker)    │
│  src/views/Scene3D.vue (交付/运行态入口 interactive:false，无桥)                 │
│  createScene3D(canvas,data,{interactive}) → Scene3DHandle                        │
│    applyLiveDataToApp → 解析 objects[]：                                        │
│      ① type:component → library-bridge 查 @cyc/3d-components (优先)              │
│      ② type:model    → ModelLoader (次优先；asset:/http:/hunyuan: 占位)         │
│      ③ type:mesh     → 原生几何体拼装 (兜底)                                    │
│  + CSS2D/3D/Sprite 标签、Raycaster 选中（仅 interactive）                       │
└──────────┬───────────────────────────────────────────────────────────────────────┘
           │ package.json dependencies
           ▼
┌──────── 3d-components（npm: @cyc/3d-components）─────────────────────────────────┐
│  core/  heat/  material/  utils/   （后续增 energy/ warehouse/ …，与 core 平级） │
│  Object3D 子类组件，library-bridge 静态导出包成 name→工厂                       │
└───────────────────────────────────────────────────────────────────────────────────┘

部署模式（仿 2D previewpc/previewdist）：
  dev : 3d-templete vite server (port 5173, route /embed)
  prod: 3d-templete build → packages/previewdist3d → Electron 起 127.0.0.1:51857 静态 server
  octoapp iframe src = VITE_3D_TEMPLATE_URL (dev=http://127.0.0.1:5173/embed, prod=http://127.0.0.1:51857)
```

### 1.2 通信方式选型：postMessage + iframe（与 pattern 完全一致）

**结论：iframe + postMessage，不选 React/Solid 组件封装。** 理由：
1. 与 pattern 体验一致，复用成熟的握手/重发/去重逻辑。
2. **依赖隔离硬约束**：iframe 让 3d-templete(Vue+three) 跑在独立 realm，octoapp(SolidJS) 进程内零 three 依赖，package.json 不改。
3. 跨技术栈（SolidJS 宿主 + Vue 引擎）只能 iframe，无法做组件级封装。
4. 生产态 Electron 内嵌静态 server 托管 build 产物，天然支持离线/打包。

**3D 通信协议（命名与 2D 对齐但语义不同）：**

| 方向 | type | payload | 作用 |
|---|---|---|---|
| 父→子 | `SCENE_UPDATE` | `{ payload: SceneConfig \| null }` | 推送/清空场景 JSON（对齐 `A2UI_UPDATE`） |
| 父→子 | `SCENE_PICK_MODE` | `{ enabled: boolean }` | 开/关编辑态选中（对齐 `DOM_PICKER_TOGGLE`） |
| 父→子 | `SCENE_FLY_TO` | `{ targetId: string }` | 聚焦到某物体（3D 专属） |
| 父→子 | `SCENE_THEME` | `{ mode: 'light'\|'dark' }` | 切主题（对齐 `TOGGLE_THEME`） |
| 父→子 | `SCENE_PATCH` | `SceneUpdatePatch` | 增量 upsert/remove（复用 3d-templete sceneUpdate） |
| 子→父 | `SCENE_READY` | — | 握手，父收到重发 pendingData（对齐 `A2UI_READY`） |
| 子→父 | `SCENE_PICK` | `{ id, name, component, props }` | 选中物体回传（对齐 `DOM_PICKER_QUICK_FIX`） |
| 子→父 | `SCENE_ERROR` | `{ message }` | 解析/加载错误 |

> 2D 的 `DOM_PICKER_*`/`DRAG_*` 系列是 DOM 专属，3D 不移植；其语义由 `SCENE_PICK_MODE`+`SCENE_PICK` 承接。

### 1.3 JSON Schema：SceneConfig（对齐 LiveDataConfig，扩展优先级）

**设计原则**：不新发明 schema，而是在 3d-templete 已有的 `LiveDataConfig` 上**最小扩展**——把"优先级"从隐式（靠 type 字段）改为显式 resolver 顺序，并补 model/css2d/css3d/sprite 类型。这样 3d-templete 的解析器改动最小，且 octoapp 生成端与解析端共享同一份类型常量。

```jsonc
{
  "version": "1.0",
  "angleUnit": "deg",                    // "deg" | "rad"，统一角度单位避免混淆
  "scene": {
    "background": "#87CEEB",
    "environment": { "preset": "studio", "intensity": 1 },   // PMREM IBL
    "fog": { "type": "linear", "color": "#cccccc", "near": 10, "far": 100 }
  },
  "camera": {
    "type": "perspective",               // perspective | orthographic
    "position": [15, 12, 18],
    "lookAt": [0, 0, 0],
    "perspective": { "fov": 50, "near": 0.1, "far": 1000 }
  },
  "lights": [
    { "type": "ambient", "intensity": 0.6 },
    { "type": "directional", "intensity": 1.2, "position": [10,20,8], "castShadow": true,
      "shadow": { "mapSize": 2048, "camera": { "near":0.5, "far":50, "left":-30,"right":30,"top":30,"bottom":-30 } } }
  ],
  "objects": [
    // ① 组件库组件（最高优先级）：name 命中 @cyc/3d-components
    { "id":"grid-1", "type":"component", "parentId":null,
      "component": { "name":"Grid", "options": { "size":40, "division":40 } } },
    // ② 3D 模型（次优先级）：src 前缀路由
    { "id":"windmill-1", "type":"model", "parentId":null,
      "src":"asset:windmill", "format":"auto", "castShadow": true },
    // ③ Low-Poly 拼装（兜底）：原生几何体
    { "id":"box-1", "type":"mesh", "parentId":null,
      "geometry": { "type":"box", "params": { "width":2, "height":2, "depth":2 } },
      "material": { "type":"standard", "color":"#4a90d9", "roughness":0.6, "metalness":0.1 },
      "position":[0,1,0], "castShadow": true, "receiveShadow": true },
    // ④ CSS2D 标签
    { "id":"label-1", "type":"css2d", "parentId":"box-1",
      "position":[0,1.5,0], "label": { "text":"设备A", "style":{ "color":"#fff","background":"rgba(0,0,0,0.7)"} } },
    // 层级：parentId 指向其他 object id
    { "id":"group-1", "type":"group", "parentId":null, "position":[5,0,0] },
    { "id":"child-1", "type":"mesh", "parentId":"group-1",
      "geometry":{"type":"sphere","params":{"radius":0.5,"seg":16}}, "material":{"type":"standard","color":"#ff8800"} }
  ]
}
```

**匹配优先级**（任务要求 component > model > low-poly）：不在 object 上靠 type 隐式判断，而是由 resolver 顺序显式实现。即同一个 object 若同时给出 `component` 和 `src`，resolver 链先试 component，命中即用，未命中回落 model，再回落 mesh。type 字段作为**首选提示**，resolver 仍按链尝试，保证"兜底"语义。具体见 1.7。

**src 前缀路由**（生成端 octoapp 与解析端 3d-templete 共享常量 `SRC_PREFIX`）：
- `asset:<name>` → 3d-templete 本地 `modelRegistry`（Vite ?url import 的 GLB）+ GLTFLoader
- `http://` / `https://` → 远程 + 按扩展名/Content-Type 识别格式（gltf/glb/obj/fbx）
- `hunyuan:<prompt>` → 混元 provider 占位（本次仅 console.warn + 抛"未接入"提示，留接口）

### 1.4 3d-components 接口规范 + 领域包结构

**关键现状**：3d-components **无注册表/工厂**，纯 ES export。3d-templete 要按 `component.name` 字符串加载组件，需要在 3d-templete 侧建一个 `library-bridge.ts`：把 `@cyc/3d-components` 的静态导出包成 `name → (options) => Object3D` 的工厂映射。

**桥接设计**（`3d-templete/src/3d/library/library-bridge.ts`）：
```ts
import * as Core from '@cyc/3d-components/core'
import * as Heat from '@cyc/3d-components/heat'
import * as Material from '@cyc/3d-components/material'

// 组件类名 → 工厂。Class 名即 component.name 的候选值
type Ctor = new (opts?: Record<string, unknown>) => THREE.Object3D
const registry = new Map<string, Ctor>()
function register(mod: Record<string, unknown>) {
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function' && /^(?:[A-Z])/.test(k)) registry.set(k, v as Ctor)
  }
}
register(Core); register(Heat); register(Material)   // 按需注册领域

export function resolveComponent(name: string): Ctor | undefined {
  return registry.get(name)  // 命中返回构造器，3d-templete new 之并 scene.add
}
export function hasComponent(name: string) { return registry.has(name) }
```

- `component.name` = 3d-components 的**导出类名**（如 `Grid`/`Wall`/`HeatMesh`）。
- `component.options` 透传给组件构造函数（对齐 3d-components 的 options 对象模式）。
- 命中失败（`hasComponent` false）→ resolver 落到 model/mesh。
- **按需加载领域**：`register()` 只注册已 import 的领域。后续 energy/warehouse 各自一个 `@cyc/3d-components/energy` 子入口，3d-templete 按需 import 并 register 即可，领域互不干扰。

**领域包结构**（3d-components 侧，确认合理，仅补领域）：
```
3d-components/src/
  core/   heat/  material/  utils/        # 现有
  energy/   warehouse/   (后续，与 core 平级)
```
每个领域包：独立 `index.ts` 导出 + vite.config.ts `lib.entry` 增一项 + package.json `exports` 增一个子路径。结构合理，无需 monorepo 化（当前单包多入口已满足 tree-shaking 与按需）。

**3d-components 待落地的发布项**：
- `package.json` 加 `publishConfig: { access: "public" }`（scoped 包默认 restricted，发布到 npm 必须显式 public）。
- 补 `InstancedMesh2.ts` 类型（去 `@ts-nocheck`）。
- 补 vitest 最小测试（可选，建议至少跑一次 build 验证 `rollupTypes`）。

### 1.5 模型加载模块：ModelLoader（provider 抽象 + 混元单次生成缓存）

`3d-templete/src/3d/loaders/ModelLoader.ts`，provider 抽象：
```ts
export interface ModelProvider {
  match(src: string): boolean
  load(src: string, opts: LoadOpts): Promise<THREE.Object3D>
}

export const assetProvider: ModelProvider = { /* match: /^asset:/, 用 modelRegistry + GLTFLoader */ }
export const httpProvider:  ModelProvider = { /* match: /^https?:/, 按扩展名选 GLTF/OBJ/FBX loader */ }
export const providers = [assetProvider, httpProvider, hunyuanProvider]  // 顺序即优先级
export async function loadModel(src: string, opts): Promise<THREE.Object3D> {
  const p = providers.find(p => p.match(src)) ?? httpProvider
  return p.load(src, opts)
}
```
- 扩展名识别：`.gltf/.glb`→GLTFLoader，`.obj`→OBJLoader，`.fbx`→FBXLoader，`.hdr`→HDRLoader（环境贴图）。

**混元 provider（本次落地，带单次生成缓存）** —— `3d-templete/src/3d/loaders/hunyuan-provider.ts`：

核心约束：**每个模型（按 prompt 归一化 key）只调用混元一次**，生成结果缓存，后续命中直接复用，绝不重复调用。

```ts
// 混元生成产物：bytes（glb）或 src（远程 url）。两类都要缓存。
interface HunyuanCacheEntry {
  status: 'pending' | 'done' | 'error'
  bytes?: ArrayBuffer      // 若混元返回 glb bytes
  src?: string            // 若混元返回远程 url（不再缓存 bytes，只记 src）
  object?: THREE.Object3D // 可选：已 clone 好的原型，多个引用时 clone 而非重新加载
  err?: unknown
}
const cache = new Map<string, HunyuanCacheEntry>()
const inFlight = new Map<string, Promise<THREE.Object3D>>()  // 防并发重复：同 key 并发调用共享一个 promise

// 归一化：src 形如 "hunyuan:风力发电机"，prompt 大小写/首尾空格差异不应导致重复生成
function normalizeKey(src: string): string {
  return decodeURIComponent(src.replace(/^hunyuan:/i, '')).trim().toLowerCase()
}

export const hunyuanProvider: ModelProvider = {
  match: (src) => /^hunyuan:/i.test(src),
  async load(src): Promise<THREE.Object3D> {
    const key = normalizeKey(src)
    // ① 已完成：直接复用缓存（bytes 重新 parse 太贵 → 优先复用 object clone）
    const hit = cache.get(key)
    if (hit?.status === 'done') {
      return hit.object ? hit.object.clone(true) : await parseBytes(hit.bytes!)
    }
    // ② 进行中：共享同一个 in-flight promise，绝不并发重复调混元
    if (inFlight.has(key)) return inFlight.get(key)!

    // ③ 首次：发起一次生成
    const p = (async () => {
      try {
        const result = await callHunyuanGenerate(key)   // 真实接入时实现：调混元 API
        const entry: HunyuanCacheEntry = { status: 'done' }
        if (result.bytes) {
          entry.bytes = result.bytes
          entry.object = await parseGlbBytes(result.bytes)  // 解析一次存原型，后续 clone
        } else if (result.src) {
          entry.src = result.src                            // 远程 url：记 src，加载仍走 http
        }
        cache.set(key, entry)
        return entry.object ? entry.object.clone(true) : await loadRemoteOrBytes(result)
      } catch (err) {
        cache.set(key, { status: 'error', err })
        console.warn(`[Hunyuan] 生成失败 (${key})，回落 mesh 兜底`, err)
        throw err   // 上层 resolver catch → 落 mesh + SCENE_ERROR
      } finally {
        inFlight.delete(key)
      }
    })()
    inFlight.set(key, p)
    return p
  }
}

// 持久化（可选，跨会话复用，避免每次刷新都重新生成）：
//   - 内存 cache 够 dev 用；生产可落盘到 IndexedDB（key=normalizeKey, value=bytes）
//   - key 稳定（基于 prompt 归一化），刷新后命中即跳过混元调用
```

**三层防重复**（确保"每个模型只生成一次"）：
1. **归一化 key**：`normalizeKey` 把 `hunyuan:风力发电机` 和 `Hunyuan: 风力发电机 ` 归一为同一 key，避免大小写/空格差异导致重复生成。
2. **inFlight 去重**：同 key 并发调用（如一个 prompt 在场景里出现多次，或 SceneConfig 同帧 upsert 多次）共享同一个 promise，绝不并发调混元。
3. **cache 复用**：已完成的 bytes/object 缓存，后续直接复用（object 用 `clone(true)` 多实例复用同一份解析结果，避免重复 parse glb）。

**回落链**：混元失败 → resolver catch → 落 mesh 兜底（一个带该 prompt 描述的 box + 文字标签）+ `SCENE_ERROR`。即"混元调不通也不阻塞场景渲染"。

**后续真实接入混元**：只实现 `callHunyuanGenerate(key)`（调混元 API 拿 glb bytes 或 src），provider 接口、缓存、去重逻辑全部不变。本次若混元 API 不可用，`callHunyuanGenerate` 直接 `throw`（走回落链），缓存逻辑已就绪，接入零改动。

### 1.6 交互拾取机制（编辑态 vs 运行态）

**核心约束**：Three.js 对象在 iframe realm，宿主 octoapp 拿不到对象引用 → **拾取实现必须在 3d-templete**，但默认关闭、按需开启、独立模块、运行态入口不挂载。

**两入口隔离**（`createScene3D({ interactive })`）：
- `interactive: false`（生产/交付）：`Scene3D.vue`，不返 `pick/flyTo/setTheme`，不 import picker，postMessage 桥不挂载 → tree-shake 掉。用户下载 templete 集成时默认此模式。
- `interactive: true`（预览/编辑）：`embed.vue`，挂 postMessage host + ScenePicker，供 octoapp iframe 嵌入。

**ScenePicker**（`3d-templete/src/3d/interaction/picker.ts`，独立模块）：
```ts
export class ScenePicker {
  constructor(private app: App3D, private onPick: (info: PickInfo) => void) {}
  enable(): void   // 注册 pointerdown/click listener
  disable(): void  // 摘 listener，零残留（SCENE_PICK_MODE enabled:false 立刻调）
  private _ray = new THREE.Raycaster()
  pickAt(ndc: THREE.Vector2): void { /* raycaster.intersectObjects(scene.children,true)，取首个非 ground，沿父子链找 id/name */ }
  highlight(obj?: THREE.Object3D): void  // EdgesGeometry 描边或 outline
}
```
- 拖动 >5px 视为轨道操作忽略（仿 CardManager 现有逻辑）。
- 选中信息：`{ id, name, component, props }` → `onPick` → postMessage `SCENE_PICK`。
- 命中物体沿父子链查 `userData.__id`（解析时由 liveDataLoader 写入）拿到 object id。

**运行态"按需交互"机制**（任务要求：操场草地不拾取、建筑点击弹卡片）：
- SceneConfig object 增可选 `interactive?: boolean`（默认 false）。
- 运行态默认不开 ScenePicker，而是**复用现有 CSS2D 卡片系统**的 Raycaster（CardManager 已实现点击拾取卡片关联物体）。
- 即：运行态交互 = 卡片点击（建筑挂卡片 → 点击弹卡）；编辑态交互 = ScenePicker 全量拾取（配 SCENE_PICK_MODE）。
- 两种态共用"Raycaster 在 3d-templete"这一事实，但入口不同、模块不同、默认开关不同。生产入口（interactive:false）连 ScenePicker 都不 import。

### 1.7 3d-templete 工程重构方案

**不推翻重写**，在现有 `src/3d/` 基础上补全 + 整理。现有引擎（App3D/createScene3D/liveDataLoader/CardManager/sceneUpdate）质量良好且与 SceneConfig 契合，重写是浪费。

**目录结构（新增/改动用 ★ 标记）：**
```
src/3d/
  index.ts                 ★ 导出 ScenePicker/ModelLoader/bridge 相关类型
  createScene3D.ts         ★ Scene3DOptions 加 interactive；Handle 加 pick?/flyTo?/setTheme?（仅 interactive=true 挂载）
  utils/liveDataLoader.ts  ★ 扩展：① resolver 链 ② model/css2d/css3d/sprite 分支 ③ userData.__id 写入
  utils/sceneUpdate.ts     （复用，SCENE_PATCH 用它）
  bridge/                  ★ postMessage-host.ts（收 SCENE_*，回 SCENE_READY/PICK/ERROR）
  interaction/             ★ picker.ts（ScenePicker）
  library/                 ★ library-bridge.ts（@cyc/3d-components name→工厂）
  loaders/
    AssetLoader.ts         （现有，GLTF/Texture/HDR）
    ModelLoader.ts         ★ provider 抽象（asset/http/hunyuan）
  cards/                   （现有 CSS2D，复用为运行态交互）
  components/              （现有 17 内置 builder，保留为内置兜底组件库）
  ...其余现有不变
src/views/
  Scene3D.vue              ★ 改：createScene3D({interactive:false})，无桥
  embed.vue                ★ 新增：interactive:true + bindPostMessageHost + ScenePicker + 最小空场景占位
src/router/index.ts        ★ 加 /embed → embed.vue
vite.config.ts             ★ port=5173、cors:true、X-Frame-Options:ALLOWALL（dev）
package.json               ★ 加 @cyc/3d-components 依赖
```

**resolver 链实现**（liveDataLoader 改造核心，`createLiveObject3D`）：
```ts
async function resolveObject(cfg: LiveDataObject, ctx): Promise<THREE.Object3D> {
  // 优先级：component > model > mesh
  if (cfg.component?.name) {
    const Ctor = libraryBridge.resolveComponent(cfg.component.name)
    if (Ctor) return applyTransform(new Ctor(cfg.component.options), cfg)
  }
  if (cfg.src) {
    return applyTransform(await modelLoader.load(cfg.src, {...}), cfg)
  }
  if (cfg.geometry || cfg.type === 'mesh' || cfg.type === 'group') {
    return applyTransform(createLiveMeshOrGroup(cfg, ctx), cfg)  // 现有逻辑
  }
  // label 类型
  if (cfg.label) return createLiveLabel(cfg)   // css2d/css3d/sprite
  throw new Error('unresolvable object: ' + cfg.id)
}
```
- 两遍构建保留：第一遍 `resolveObject`（含 async model load，await 全部占位 Group 先入 nodeMap，再异步替换内容）；第二遍按 parentId 挂载。
- model 异步：先放占位 Group，`loadModel().then(obj => 占位.add(obj))`，失败回落一个 box + SCENE_ERROR。

### 1.8 待决策问题：分析与建议

**Q1. 混元接入位置** → **建议选项B：3d-templete 侧**。
理由：混元本质是"给一个描述/prompt → 拿到一个 3D 模型（src 或 bytes）"，属于**资产获取能力**，必须用 Three.js loader 装载渲染。若放 octoapp，则宿主要处理模型 bytes/Three.js 对象 → 违反"octoapp 不 import three"硬约束。正解：octoapp 只在 JSON 写 `src:"hunyuan:风力发电机"`（纯字符串，不感知 three），3d-templete 的 `hunyuanProvider` 负责调混元拿模型并加载。
**单次生成 + 缓存**（补充要求）：每个模型按 prompt 归一化 key 只调一次混元，结果缓存（bytes 解析为原型 object，后续 `clone(true)` 复用），同 key 并发共享 in-flight promise 防重复，跨会话可落盘 IndexedDB。详见 §1.5。本次若混元 API 未就绪，`callHunyuanGenerate` 直接 throw 走回落链，缓存逻辑已就绪，接入时只补该函数。

**Q2. 交互拾取放哪** → **建议选项B：3d-templete 侧**，且编辑态/运行态分离。
理由：Three.js 对象在 iframe realm，宿主无法跨 iframe 拿对象引用做 Raycaster，跨 realm 只能传 id 字符串——拾取实现必须在渲染引擎侧。编辑态用 ScenePicker（全量，SCENE_PICK_MODE 开关）；运行态复用 CSS2D 卡片 Raycaster（按需，object 挂卡片才可点）；生产交付入口 `interactive:false` 连 picker 都不 import。这套设计同时满足"交付包运行态不一定需要拾取/只需部分物体交互"的需求。

**Q3. 3d-components 领域包结构** → **现状结构合理，无需 monorepo 化**。
理由：当前单包多入口（core/heat/material/utils 各一个子 export + vite entry）已满足 tree-shaking 与按需加载，`sideEffects:false` 保证未用领域被剔除。3d-templete 按需 `import` 领域子包并在 `library-bridge.register()` 注册即可。后续增 energy/warehouse 只需：`src/energy/` 目录 + `lib.entry` 加一项 + `exports` 加子路径。若将来领域组件极多导致包体过大，再考虑拆 monorepo（用 pnpm workspace + changeset），但当前阶段过早拆分是过度设计。

---

## 2. 三工程具体改动清单

### 2.1 octoapp（不改 package.json）

| 文件 | 改动 | 关键点 |
|---|---|---|
| `components/titlebar-simple.tsx` | 改 | `TabType` 加 `"3d"`；`TAB_ITEMS` 加 `{key:"3d",label:"3D"}`；`activeTab` 加 `/3d` 判断；`handleTabClick` 加 3d 分支 |
| `context/layout.tsx` | 改 | `LastSessionPerTab` 加 `'3d'?:{id}`；createStore 初始化加 `'3d':undefined`；加 `get3D/set3D` |
| `octo.tsx` | 改 | lazy `Scene3DPage`；`<Route path="/3d/:id?" component={Scene3DPage}>`；侧栏 `is3DPage()` |
| `pages/3d/index.tsx` | 新增 | 入口 `Scene3DPage`（Provider 包装 + `Scene3DContent`），克隆 pattern 的 Provider 链与状态机骨架 |
| `pages/3d/modules/chat/index.tsx` | 新增 | 克隆 pattern ChatPanel（消息列表+输入框），3D 专属 prompt |
| `pages/3d/modules/preview/index.tsx` | 新增 | **核心**：`<iframe src={import.meta.env.VITE_3D_TEMPLATE_URL}>`；`sendToPreview`→`postMessage({type:'SCENE_UPDATE',payload})`；`handleIframeMessage`←`SCENE_READY/PICK/ERROR`；`PreviewPageAPI` 类型 |
| `pages/3d/utils/scene-config.ts` | 新增 | SceneConfig 类型定义 + `detectSceneConfig()`（对齐 pattern 的 a2ui-protocol） |
| `pages/3d/utils/preview-handler/index.ts` | 新增 | 导出/实时预览/版本回退（克隆 pattern，目录改 `.octo/design-3d/history`） |
| `pages/3d/utils/desktop-api.ts` | 新增/复用 | 复用 pattern 的 DesktopApi，加 `getPreview3dDistDir`（若需要实时预览 3D） |
| `pages/3d/utils/version-history.ts` | 新增 | 克隆 pattern，目录前缀 `octo:pattern:3d:` |
| `pages/3d/workflow/create-scene.ts` | 新增（阶段2） | 3D Agent 产 SceneConfig（克隆 create-json） |
| `pages/3d/agents/*` | 新增（阶段2） | 3D 生成 agent（场景规划/物体生成/合并） |
| `.env` / `.env.development` | 新增 | `VITE_3D_TEMPLATE_URL=http://127.0.0.1:5173/embed`（dev） |

关键代码片段（iframe 通信层，[pages/3d/modules/preview/index.tsx](packages/app/octoapp/pages/3d/modules/preview/index.tsx)）：
```tsx
let iframeRef: HTMLIFrameElement | undefined
let pendingData: SceneConfig | null = null
const lastSent = new Map<string, string>()

export function sendToPreview(data: SceneConfig | null) {
  const sid = params.id; if (!sid) return
  const json = JSON.stringify(data)
  if (lastSent.get(sid) === json) return   // 去重，对齐 pattern
  lastSent.set(sid, json)
  pendingData = data
  iframeRef?.contentWindow?.postMessage({ type: 'SCENE_UPDATE', payload: data }, '*')
}

const handle = (e: MessageEvent) => {
  if (e.data?.type === 'SCENE_READY') { if (pendingData) sendToPreview(pendingData) }  // 握手重发
  else if (e.data?.type === 'SCENE_PICK') { /* 选中 → 开属性编辑弹窗（3D 版） */ }
  else if (e.data?.type === 'SCENE_ERROR') { /* 错误提示 */ }
}
window.addEventListener('message', handle)
// <iframe src={import.meta.env.VITE_3D_TEMPLATE_URL} onLoad={()=>pendingData&&sendToPreview(pendingData)} />
```

### 2.2 3d-templete（改 package.json，加 3d-components 依赖）

| 文件 | 改动 | 说明 |
|---|---|---|
| `package.json` | 改 | dependencies 加 `@cyc/3d-components: "workspace:*"` 或版本号（取决于发布形态）；scripts 加 build 产 dist |
| `vite.config.ts` | 改 | port 5173；server.cors:true；`headers:{'X-Frame-Options':'ALLOWALL'}`；build.outDir 保持 dist |
| `src/router/index.ts` | 改 | 加 `/embed` 路由 → `embed.vue` |
| `src/views/Scene3D.vue` | 改 | 调用 `createScene3D(canvas,data,{interactive:false})`，去掉 demo 的 window.scene3d |
| `src/views/embed.vue` | 新增 | 预览入口：`createScene3D(canvas,data,{interactive:true})` + `bindPostMessageHost` + ScenePicker + 空场景占位（等 SCENE_UPDATE） |
| `src/3d/index.ts` | 改 | 导出 ScenePicker/bindPostMessageHost/ModelLoader/library-bridge 类型 |
| `src/3d/createScene3D.ts` | 改 | `Scene3DOptions` 加 `interactive?:boolean`；`Scene3DHandle` 加 `pick?/flyTo?/setTheme?`（仅 interactive=true 挂载） |
| `src/3d/utils/liveDataLoader.ts` | 改 | resolver 链；model/css2d/css3d/sprite 分支；`userData.__id` 写入；model 异步占位+回落 |
| `src/3d/bridge/postMessage-host.ts` | 新增 | `bindPostMessageHost(handle,picker)`：收 `SCENE_UPDATE/PICK_MODE/FLY_TO/THEME/PATCH`，回 `SCENE_READY/PICK/ERROR` |
| `src/3d/interaction/picker.ts` | 新增 | ScenePicker（enable/disable/pickAt/onPick/highlight） |
| `src/3d/library/library-bridge.ts` | 新增 | `resolveComponent/hasComponent`（包 @cyc/3d-components 导出） |
| `src/3d/loaders/ModelLoader.ts` | 新增 | provider 抽象 + `loadModel` 路由（asset/http/hunyuan） |
| `src/3d/loaders/hunyuan-provider.ts` | 新增 | 混元 provider：归一化 key + cache + inFlight 防重复 + clone 复用 + 落盘（§1.5）；`callHunyuanGenerate` 本次 throw 走回落 |

关键代码片段（postMessage host，[src/3d/bridge/postMessage-host.ts](D:/cyc/project/octo/3d-templete/src/3d/bridge/postMessage-host.ts)）：
```ts
export function bindPostMessageHost(handle: Scene3DHandle, picker: ScenePicker) {
  window.parent.postMessage({ type: 'SCENE_READY' }, '*')   // 握手
  window.addEventListener('message', async (e) => {
    const { type, payload } = e.data ?? {}
    if (type === 'SCENE_UPDATE') {
      try { await applyLiveDataToApp(handle.app, payload); window.parent.postMessage({type:'SCENE_PICK', id:''}, '*') /* noop */ }
      catch (err) { window.parent.postMessage({ type:'SCENE_ERROR', message:String(err) }, '*') }
    } else if (type === 'SCENE_PICK_MODE') { payload.enabled ? picker.enable() : picker.disable() }
    else if (type === 'SCENE_FLY_TO') { handle.flyTo?.(payload.targetId) }
    else if (type === 'SCENE_THEME') { handle.setTheme?.(payload.mode) }
    else if (type === 'SCENE_PATCH') { handle.update(payload) }
  })
}
```

### 2.3 3d-components（发布配置）

| 文件 | 改动 | 说明 |
|---|---|---|
| `package.json` | 改 | 加 `publishConfig:{access:"public"}` |
| `src/core/InstancedMesh2/InstancedMesh2.ts` | 改 | 补类型，去 `// @ts-nocheck` |
| `vitest.config.ts` + `src/**/*.test.ts` | 新增（可选） | 最小单测 |
| `src/energy/`、`src/warehouse/` | 后续新增 | 领域包（本次不做，留结构说明） |

### 2.4 desktop 预览 server（previewdist3d 仿造）

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/desktop/src/main/preview-server-3d.ts` | 新增 | 仿 preview-server.ts，端口 51857，目录 `previewdist3d` |
| `packages/desktop/src/main/ipc.ts` | 改 | 加 `get-preview-dist-3d-dir` |
| `packages/desktop/src/main/index.ts` | 改 | 启动 3D server |
| 打包脚本 | 改 | 3d-templete build 产物拷进 `resources/previewdist3d` |

> dev 阶段先用 vite 5173，previewdist3d 部署是阶段0后期/阶段1再落地。

---

## 3. 实施步骤（分阶段，每阶段可独立验证）

**阶段0：通信打通（最小闭环）**
- 3d-templete：`embed.vue` + `postMessage-host.ts` + `picker.ts` 占位 + `createScene3D` 加 interactive + router /embed + vite cors。
- octoapp：titlebar 3D tab + `/3d` 路由 + `pages/3d/` 骨架（iframe + sendToPreview + handleIframeMessage）+ `.env`。
- 验证：octoapp 点 3D tab → iframe 加载 embed → 控制台手发 `SCENE_UPDATE` 带示例 SceneConfig → 3d-templete 渲染现有 live-data 场景 → SCENE_READY 握手成功。

**阶段1：JSON Schema + 解析扩展（3d-templete 独立）**
- liveDataLoader resolver 链 + model/css2d 分支 + ModelLoader + library-bridge + package.json 加依赖。
- 验证：构造含 component/model/mesh 的 SceneConfig，确认三条路径分别命中 3d-components 组件 / GLB / 原生几何体；hunyuan: 抛占位错误。

**阶段2：octoapp 对话 + Agent（克隆 pattern）** ✅ 已落地（2026-07-13）
- 完整克隆 pattern 对话流（2 暂停点 + checkpoint 持久化 + 轮次分组 + chat 面板 + AI 修改流），去掉 Pattern 模板匹配暂停点（3D 无模板库）。
- 后端注册 8 个 scene_3d_* agent（intent/intent_confirm/intent_audit/planner_create/planner_modify/module_create/module_modify/triage）+ 2 个 stastics（SCENE_CONFIG_SCHEMA/MESH_GEOMETRY_CATALOG，替代 load_components_docs 工具）。
- 落地文件：
  - 后端：`packages/opencode/src/agent/agent.ts`（注册）、`proto/index.js`（export）、`proto/prompt/scene_3d/*.txt`×8、`proto/prompt/stastics/{SCENE_CONFIG_SCHEMA,MESH_GEOMETRY_CATALOG}.txt`×2
  - 前端 agents：`pages/3d/agents/{run-child-session,merge,scene-intent,scene-intent-confirm,scene-intent-audit,scene-planner-create,scene-planner-modify,scene-module-create,scene-module-modify,scene-triage}/`
  - 前端 workflow：`pages/3d/workflow/{create-scene,modify-scene-ai}.ts`
  - 前端 utils：`pages/3d/utils/{json-parser,session-map,round-messages,desktop-api,debug-log,error-msg,rename,version-history,scene-checkpoint}.ts`（version-history/checkpoint 改 3D 语义）
  - 前端页面：`pages/3d/index.tsx`（Provider 链 + 状态机 + handleSubmit 三阶段 + 暂停点渲染 + session 恢复）
  - 前端 UI：`pages/3d/modules/chat/`（裁剪去 design-system-picker/tab-switcher）、`pages/3d/modules/preview/{index(PreviewPage3D),SceneWireframeReview,SceneGenerating,IntentConfirmReview}.tsx`
- 关键设计：planner 生成 camera/lights/scene（宏观）+ elements/slots（分区），module 生成分区 objects（微观），mergeSceneObjects 合并平铺数组（比 pattern mergeModules 简化 70%，无 children 引用树）。
- 验证：packages/app + packages/opencode typecheck 通过（exit 0）。运行时端到端验证待启动 dev server。

**阶段3：交互闭环 + 发布** ✅ 交互闭环 + 发布已落地（2026-07-15）；previewdist3d 部署推迟
- ScenePicker 编辑态选中 → SCENE_PICK → 属性编辑弹窗（3D 版）。✅
- 3d-components 发布（补类型 + publishConfig）。✅ publishConfig 已加；build 验证通过（ESM+CJS+.d.ts 正常产出）；InstancedMesh2 仍 @ts-nocheck（21 文件 vendored BVH 子系统，按"务实"决策保留）。
- previewdist3d 部署。⏸ 推迟（本次不做，dev 走 vite 5173；后续单独一轮）。
- 验证：选中物体改属性 → 增量 SCENE_PATCH → 场景更新；打包后离线渲染。✅ 代码层验证（octoapp tsgo 过、3d-templete 我的文件 vue-tsc 过 + vite build 过、3d-components build 过）；运行时端到端待手动跑 dev server 点选验证。
- 落地细节：
  - 3d-templete：`interaction/picker.ts`（ScenePicker：BoxHelper 高亮 + >5px 拖拽阈值与 OrbitControls 共存 + 沿父子链 userData.__id 解析）；`createScene3D` Handle 增 picker/flyTo/setTheme（仅 interactive）；`liveDataLoader.createLiveObject3D` 末尾统一写 `userData.__id`（设计文档早写但此前未落地，阶段3 补）；`embed.vue` 4 个回调接 picker/handle；`index.ts` 导出 ScenePicker/PickInfo。
  - octoapp：`modules/preview/property-editor-popup/`（3D 版弹窗：Transform + 完整材质 + 几何参数，本地 NumberField 不跨页 import pattern）；`modules/preview/index.tsx`（PreviewPage3D 自包含：编辑态按钮 + SCENE_PICK→弹窗 + sendPatch/sendPickMode/sendFlyTo + 本地 objectsById 同步）；`utils/scene-config.ts` 增 ScenePatch 类型。
- ⚠️ 已知遗留（非本次引入）：3d-templete `npm run build`（vue-tsc）因 3d-components 源码的未用变量 lint（BaseGroup/BitmapText/Html/Outlines/Wireframe/HeatMesh，TS 验证为死代码）失败——仅影响 previewdist3d 生产构建路径（已推迟），运行时 `vite dev` 不受影响。previewdist3d 落地时一并清理这些 lint（或在 3d-components tsconfig 加 noUnusedLocals 统一治理）。

**阶段4：修复 modify 流物体异常（加物体丢 / 删不掉 / 手动编辑复位）** ✅ 代码落地 + typecheck 过（2026-07-16）；运行时验证待手动跑
- 背景：修改流多症状——①加物体后原有物体消失（桌子 31→加球 11）；②删单个物体删不掉（删一棵树计数不掉，但删整个分区成功）；③手动挪动物体后，下次 agent 操作"复位"+ 切走切回"恢复编辑前"。跨多轮未根治。
- 根因 A（加物体丢 + 删不掉，汇聚到 modify 分区 merge 语义）：
  - `scene_3d_planner_modify` 的 LLM 会重新生成 element_id（不可控，prompt L45 要求保持但无效）。漂移后 `merge.ts` 的 `resolveZoneOp` 沿旧物体 parentId 链走到旧分区根（parentId:null）返回 undefined → none 分区旧物被整体丢弃（"加物体丢原有"）。
  - `scene_3d_module_modify` 契约是**返回分区完整物体清单**（prompt "输出完整的该分区全部物体...数量自检原有数+1"）。故 module 输出 = 分区最终态，merge 必须用它**整体替换**该分区旧物。但原实现是 UNION（保留 modify 旧物 + module 覆盖同 id）→ 被删的物体从旧集复活（"删不掉"）、改名物体重复。
- 根因 B（手动编辑复位）：属性编辑器 `sendPatch` 只 post 给 iframe + 更新 PreviewPage3D 本地 objectsById，**不回写 lastSceneObjects/磁盘** → 下次 agent 从编辑前 lastSceneObjects 重生成（复位）、切走切回从磁盘读编辑前（恢复编辑前）。
- 修复：
  1. **element_id 重映射**（`pages/3d/workflow/modify-scene-ai.ts`）：planner_modify 后用 section_id（稳定主键）建 `eidRemap`（旧→新 element_id），把旧物体 parentId 改写到新 id 再传 merge；id 稳定时 no-op。
  2. **modify 分区 merge = REPLACE**（`pages/3d/agents/merge.ts`）：keptOld 只保留 operation==="none" 的分区；modify/create 分区旧物丢弃，由 module 输出整体替换。**推翻早先"modify 也保留旧物"——那是错的（删不掉/重复）**。
  3. **findPrevModuleObjects 收集整棵子树**（`modify-scene-ai.ts`）：递归收分区全部后代给 module_modify（它要逐个保留未改动后代），否则 REPLACE 整代丢失嵌套物体。
  4. **手动编辑回写 + 防抖落盘**（`modules/preview/index.tsx` 加 onPatch 回调 + `pages/3d/index.tsx` handleScenePatch）：patch 即时更新 lastSceneObjects（内存，agent 立即读到）+ 800ms 防抖 `updateSceneVersion` 落盘。**坑**：不能更新 pendingPreviewData（变化触发重建 objectsById effect 关属性弹窗）。agent run 前 `clearPatchPersistTimer`。
  5. **诊断日志**：merge 打印 `old/shell/keptOld/module/merged/valid`；漂移 warn eidRemap；快照加 `extra:{eidRemap, slots}`。
- 验证：`packages/app` `bun run typecheck` exit 0。运行时验证待手动：①加球→加树→加长桌 sendToPreview 单调增（已验 20→21→27→34）；②删单棵树 merge log merged 下降；③挪树→删另一棵树，被挪树位置保留；④挪球→切走切回在新位置。详情见 memory/3d-modify-objects-lost.md。
- 设计要点：modify 流正确性的关键在读懂 module_modify 契约（完整分区 → REPLACE）。修复做在编排层（modify-scene-ai.ts 持有新旧 planner）+ merge 语义层，不依赖 LLM 行为可控。section_id 是比 element_id 更安全的基础假设。REPLACE 依赖 module_modify 严守"输出完整分区"（prompt 已强制）。

**功能：编辑态「整体/部件」双粒度选中** ✅ 代码落地 + typecheck 过（2026-07-16）；运行时验证待手动跑
- 需求：编辑态点选时支持两种模式——①整体（一棵树=树干+树冠作为一个整体，整体位移/缩放/旋转）；②部件（叶子，现状）。
- 实现（跨两工程，5 文件）：
  1. **liveDataLoader 标记**（`3d-templete/src/3d/utils/liveDataLoader.ts`）：两遍构建后按 parentId 图标记 `userData.__zone`（root 的直接子=分区 group）和 `userData.__logicalRoot`（zone 的直接子=用户视角的"一个整体"，如 enviTree1/enviFloor）。纯图计算，零运行时风险。
  2. **picker 粒度解析**（`3d-templete/src/3d/interaction/picker.ts`）：加 `granularity:'part'|'whole'` + `setGranularity`。`pickAt` 沿父子链：part 模式取首个 `__id`（叶子）；whole 模式取最近的 `__logicalRoot` 祖先（整体），无则回落叶子。高亮（BoxHelper）随解析对象——整体模式下包围盒包住整棵树。
  3. **新消息 SCENE_PICK_GRANULARITY**（`postMessage-host.ts` + `embed.vue`）：宿主→iframe `{granularity:'part'|'whole'}` → `picker.setGranularity`。
  4. **octoapp UI**（`pages/3d/modules/preview/index.tsx`）：编辑态右上工具条加「部件｜整体」分段开关，默认部件（=现状）。`switchGranularity` 发消息；`toggleEditMode` 进入编辑态时重申当前粒度（picker 每次渲染新建、默认 part）。
- 关键设计：编辑 group 的 transform 时 Three.js 自动把父变换传给子节点 → 整体一起动；属性弹窗对 group 只显 Transform（`isMesh()` gating 材质/几何）。整体选中后改 position/scale/rotation 即整体变换。**坑**：picker 每次 SCENE_UPDATE 重建（createScene3D），粒度会重置为 part，故进入编辑态必须重发 SCENE_PICK_GRANULARITY。
- 验证：octoapp tsgo exit 0；3d-templete vue-tsc 仅 8 个既有 3d-components noUnusedLocals 错（非本次引入），本次 4 文件零错。运行时待验：进编辑态→切"整体"→点树干/树冠→应选中 enviTree1 整棵（包围盒包整树）→改位置整棵移动。

**功能：分区生成容错（单分区失败不拖垮整次生成）** ✅ 代码落地 + typecheck 过（2026-07-17）
- 背景：操场 4 分区并行生成，其中 1 个 `scene_3d_module_create` 返回空串（length=0，LLM 瞬态故障）→ extractJson null → 抛 "did not return valid JSON" → Promise.all 整体失败，整次生成崩。LLM 偶发返回空/坏 JSON 是已知故障模式，不应让单分区拖垮全局。
- 修复（`pages/3d/utils/module-retry.ts` + create-scene.ts + modify-scene-ai.ts + index.tsx）：
  - `withModuleRetry(label, fn)`：重试一次（瞬态故障常见），仍失败返回 null。
  - create 流：每分区用 withModuleRetry 包裹；失败分区跳过（shell 保留空 group，无物体），modules 过滤 null。`skipped: string[]` 经 onFinished 回传。
  - modify 流：create 分区失败同上跳过；**modify 分区失败回落用旧物体填充**（关键：merge 对 modify 分区是 REPLACE，若不兜底会整分区丢失旧物体）。failed modify 不计入 skipped（已保留旧物，无数据丢失）。
  - UI：onFinished 收到 `skipped` 时 toast「N 个分区生成失败已跳过，可重新生成或继续对话补齐」。
- 不变量：**module 生成（create/modify）必须用 withModuleRetry 包裹，不能裸 Promise.all 抛出**——否则单分区瞬态故障会让整次生成崩。重构时勿退回。

**风险点：**
- 跨源 iframe：配 vite CORS + 移除 X-Frame-Options/CSP frame-ancestors（embed.vue 必须可被 octoapp 域加载）。
- SolidJS ≠ Vue：pattern 的 DOM picker/drag-reorder 是 2D+SolidJS 专属，3D 用 Raycaster 在 3d-templete 侧产生，不移植。
- three 版本：3d-components peer >=0.150，3d-templete ^0.185 兼容；octoapp 绝不 import three。
- InstancedMesh2 `@ts-nocheck`：发布前补类型，否则 `rollupTypes` 可能漏类型。
- src 前缀路由常量：octoapp 生成端与 3d-templete 解析端必须共享同一份 `SRC_PREFIX` 常量定义。建议放 3d-components `utils/` 导出，两端共享。
- 混元缓存：归一化 key 不当时会导致同模型重复生成（浪费配额）；务必让 `normalizeKey` 覆盖大小写/空格/编码差异。多实例用 `clone(true)` 复用同一份解析原型，避免重复 parse glb。
- 历史/版本目录隔离：3D 用 `.octo/design-3d/history`，与 pattern 的 `.octo/design/history` 分开，避免混跑。

---

## 4. 后续同步策略（dev_pattern → 3D 页面，长期多次同步）

**目标**：dev_pattern 持续更新，需要反复把适用改动迁移到 `pages/3d/`。设计一套**可重复执行、可追溯、不丢改动**的机制，而非一次性 diff。

### 4.1 同步状态文件（机制核心）

在 octoapp 工程根维护 `3D_SYNC_STATE.yaml`（人机两读），**每次同步后更新**。这是"上次同步到哪、下次从哪开始"的唯一事实源：

```yaml
# 3D 页面 ↔ dev_pattern 同步状态
last_synced_commit: 40177fd038fccc8004b7d77588c34d5a6c8239f2   # 上次同步到的 dev_pattern commit
last_synced_date: 2026-07-10
sync_round: 0                                                  # 同步轮次，每次 +1

# 已确认的迁移性映射（pattern 文件 → 3D 处理策略），跨轮次累积，避免每次重新评估
file_mapping:
  pages/pattern/index.tsx:
    target: pages/3d/index.tsx
    transferability: common         # common(✅套用) | skip(❌2D专属) | partial(⚠️借流程换语义)
    notes: "Provider 链 + 状态机骨架直接套，但渲染目标 A2UI→SceneConfig"
  pages/pattern/modules/preview/index.tsx:
    target: pages/3d/modules/preview/index.tsx
    transferability: partial
    notes: "iframe+postMessage 骨架套，DOM_PICKER_* 协议换成 SCENE_*"
  pages/pattern/modules/preview/property-editor-popup/:
    transferability: skip
    notes: "DOM 属性编辑 2D 专属，3D 用 SCENE_PICK + 3D 属性弹窗重写"
  pages/pattern/utils/a2ui-protocol.ts:
    target: pages/3d/utils/scene-config.ts
    transferability: partial
    notes: "结构借，schema 换成 SceneConfig"

# 永久跳过清单（这些 pattern 文件永不迁移，避免每次评估）
always_skip:
  - "pages/pattern/**/dom-picker*"        # DOM 选择器，2D 专属
  - "pages/pattern/**/drag-bridge*"       # 拖拽重排序，2D+DOM 专属
  - "pages/pattern/**/*device-switch*"    # 设备切换（手机/平板），3D 无此概念

# 同步历史（最近 5 轮摘要，详情见 git log --grep='3D-SYNC')
history:
  - { round: 0, date: 2026-07-10, commit: 40177fd03, files: 0, note: "初始基线，未同步" }
```

**机制要点**：
- `last_synced_commit` 是游标 —— 下次同步只看 `last_synced_commit..dev_pattern`，不重算历史。
- `file_mapping` 跨轮次累积 —— 已评估过的 pattern 文件不再重新判断迁移性，新增/改动的文件才需评估。
- `always_skip` 永久排除清单 —— 把"每次都要花脑力判断、结论永远是跳过"的文件固化掉。
- `sync_round` 递增 —— 与 git commit message 联动，便于追溯。

### 4.2 同步工作流（每轮执行，6 步）

> 把这套流程写成一个可执行脚本提示词，每次同步时照跑。脚本见 §4.4。

1. **取游标**：读 `3D_SYNC_STATE.yaml` 的 `last_synced_commit`（记为 BASE）。
2. **列改动**：`git log BASE..dev_pattern --oneline -- packages/app/octoapp/pages/pattern` → 拿到本轮 pattern 的新 commit 列表与变更文件清单（`git diff --name-only BASE..dev_pattern -- pages/pattern`）。
3. **去重 + 跳过**：对照 `file_mapping` 和 `always_skip` —— 已在映射表里的文件按既定 `transferability` 处理；在 `always_skip` 里的直接跳过；**只有新文件或不在表里的文件**才需要本轮新评估。
4. **逐文件 diff + 评估**：对需要处理的文件 `git diff BASE..dev_pattern -- <file>`，套迁移规则（§4.3）定 transferability，落到 `pages/3d/` 对应文件。
5. **落地 + 验证**：改 `pages/3d/`，跑阶段0/1的验证（iframe 握手、SCENE_UPDATE 渲染、三条解析路径）。
6. **更新游标 + 记录**：更新 `3D_SYNC_STATE.yaml`（`last_synced_commit`→dev_pattern 新 HEAD、`sync_round`+1、新文件补进 `file_mapping`、`history` 加一轮）；提交 commit，message 格式 `3D-SYNC #N: <摘要> (base=<old>..new=<new>)`。

### 4.3 迁移规则（决策表）

每个变更 pattern 文件按此表归类，结果写入 `file_mapping.transferability`：

| transferability | 触发条件 | 处理 |
|---|---|---|
| `common` ✅ | 纯通用逻辑：对话流/历史/导出/暂停/session 机制/Provider 链/骨架布局 | 直接套用到 `pages/3d/` 对应文件，路径/命名按 3D 约定 |
| `skip` ❌ | 2D+DOM 专属：DOM picker / drag reorder / device 切换 / design-system 选择器 / A2UI 元素属性编辑 | 跳过；3D 对应用 Raycaster+SCENE_PICK 替代 |
| `partial` ⚠️ | 借流程结构但语义不同：workflow/agent 编排、schema、协议名、渲染目标 | 借结构，把 2D 语义（A2UI/element/DOM picker）替换为 3D 语义（SceneConfig/object/SCENE_*） |

**冲突保护**：若某 pattern 文件本轮改动触及了 `pages/3d/` 里**已被 3D 专属逻辑覆写**的部分（如 preview/index.tsx 里把 `A2UI_*` 换成了 `SCENE_*`），同步时只迁移"通用骨架改动"，保留 3D 专属覆写不动。冲突时在 commit message 标注 `MANUAL-MERGE: <file>`，留人工复核痕迹。

### 4.4 可执行同步脚本（prompt 模板）

每次同步时，把以下作为任务指令发出（保存为 `scripts/sync-from-pattern.md` 便于复用）：

```markdown
执行 dev_pattern → 3D 页面同步（round N）：
1. 读 D:/cyc/project/octo/test/UXAI/3D_SYNC_STATE.yaml 的 last_synced_commit 作 BASE。
2. 跑 `git log BASE..origin/dev_pattern --oneline -- packages/app/octoapp/pages/pattern`
   和 `git diff --name-only BASE..origin/dev_pattern -- packages/app/octoapp/pages/pattern`，列出本轮 pattern 改动。
3. 对照 3D_SYNC_STATE.yaml 的 file_mapping 与 always_skip 分类：已在表/在跳过清单的按既定策略；新文件逐一 git diff + 按迁移规则(§4.3)定 transferability。
4. 对 common/partial 文件，把改动迁移到 pages/3d/ 对应文件；skip 跳过；冲突处保留 3D 专属覆写并标 MANUAL-MERGE。
5. 验证：iframe 握手 + SCENE_UPDATE 渲染 + 三条解析路径不回归。
6. 更新 3D_SYNC_STATE.yaml：last_synced_commit→新 HEAD、sync_round+1、新文件补进 file_mapping、history 加轮。
   提交：`3D-SYNC #N: <摘要> (base=<old>..new=<new>)`。
产出本轮同步报告（迁移/跳过/冲突清单），不要静默截断任何被跳过的文件。
```

### 4.5 防退化与可追溯

- **游标语义**：`last_synced_commit` = "pattern 已被吸收到 3D 的点"。每次同步只向前推进，永不回退（除非主动 revert 并记入 history）。
- **commit message 约定**：所有 3D 同步提交以 `3D-SYNC #N` 开头 → `git log --grep='3D-SYNC'` 一键查全部同步历史，与 dev_pattern 自身 commit 区分。
- **同步报告**：每轮输出"迁移 X 个 / 跳过 Y 个 / 冲突 Z 个"清单，被跳过的一律显式列出（不静默截断），避免"看起来同步了其实漏了"。
- **回归基线**：每轮同步后跑一次阶段0+阶段1验证（握手、渲染、三路径），确保 3D 侧未因同步引入回归。
- **3D 专属改动隔离**：`pages/3d/` 里非 pattern 克隆来源的原创改动（如 scene-config.ts、SCENE_* 协议、picker 桥接），在 `file_mapping` 的 `notes` 里标"3D 专属覆写"，同步时受冲突保护。

### 4.6 适用边界（明确不做什么）

- 同步**仅限 octoapp 工程内**的 `pages/3d/` 与 pattern 改动（任务约束）。3d-templete / 3d-components 不在 dev_pattern 同步范围内。
- 同步是"吸收通用改动"，不反向把 3D 改动推回 dev_pattern（单向）。
- 不试图自动 merge —— 评估和迁移需人工判断语义，脚本只负责"列改动+分类提示+更新游标"，落盘改动由人/agent 按 §4.4 执行。

---

## 附：会话持久化约定
- 本文件是**唯一事实源**。每次重要决策后更新本文件。
- 新会话开始时，将本文件全文作为初始 prompt 发出，并说明本次要做什么。
- 基于已定结论继续，不重复讨论；新决策直接更新对应章节。
- 记忆（`~/.claude/.../memory/`）保存精简指针（架构/对话/previewdist 三份），细节以本文件为准。
