# 3D 代码生成 Agent · 设计文档（dev_cyc1）

> 新会话恢复：对本文件说「继续第 N 步」或「现在做第 N 步」即可。进度见「当前进度」节。
> 思维导图：`new3d-plan.html`（浏览器打开）。

## 一、目标与决策

把现有 `pages/3d`（8-agent JSON 流水线）的**生成逻辑**改成**代码驱动**：LLM 生成 handler / component 代码（挂在 manager→handler→component 框架上），而非产出复杂数据结构。**保留 manager 框架作二次开发的数据契约**，数据极简（type + id + optional props）。生成后产品按 dataSchema 接真实数据驱动状态。导出代码工程供二次开发。

**已确认决策**：
1. **主 LLM = GLM 或 DeepSeek**（写 handler / component 代码）。混元**不**当主 LLM。
2. **混元仅接入丰富 3D 资源库**（生成 GLB 模型），通过 `AssetCache.registerModelGenerator` 注册。
3. **保留 manager→handler→component 框架**：二次开发要接数据做驱动，这套 type 分发 + CRUD 生命周期是现成数据契约，不丢。
4. **handler 代码化**：handler 从"数据→组件薄映射"升级为"LLM 写的厚代码"（构建 / 动画 / 交互 / 接数据），表达力对齐代码驱动。
5. **数据格式统一为分组扁平 + parentId**：`{[type]: [{id, params, parentId}]}`（无 type 字段=分组 key、无 children=靠 parentId 跨分组、根 parentId=null），**摒弃原 scene_objects 平铺结构**。update 全量推送不 diff + 顶层 `remove:[ids]`。
6. **代码先行，数据后定**：LLM 先写 handler 把场景跑起来（默认值 / 硬编码），再反推 dataSchema（哪些属性暴露成 props）。
7. 资源库放 `3d-templete/assets-library/`（跟工程走、导出即带），后续可做成在线。
8. 图片输入：当视觉参考，VLM 描述成文字再走 NL 流程（不逐物体高保真重建）。
9. 不新建 new3D 页签，直接改现有 `pages/3d` 生成逻辑。
10. 三仓库（UXAI / 3d-templete / 3d-components）均建 `dev_cyc1` 分支。
11. **模板/工作空间/历史机制**：3d-templete 是模板母版，每轮 LLM 生成在干净副本里改代码（不污染母版、可追溯历史）。**workspace 粒度 = 全局唯一一个**（方案 A：永远只一个活动工程，切会话/切版本 = 覆盖 delta + 重启 dev）。复用现有 `.octo/design-3d/`（关联文件夹）+ Electron IPC + 每会话 `_versions.json` 老模式，扩"代码副本"维度。**砍"数据/代码按意图分离"优化**——改按"谁改的"分：LLM 生成轮永远走 workspace 覆盖 + 重启 dev（它本就是在写代码）；用户属性编辑器手动改走现有 SCENE_PATCH 数据推送（不重启）。详见第七节。

**路径抉择记录**（为什么是这套）：
- **路径①（纯数据驱动 scene_objects）— 淘汰**：ComponentManager 的 kind 链有限（library/example/model/primitive/group），新效果要加 handler，场景不收敛时 handler 无限膨胀；handler 是薄映射，表达不了动画 / shader / 过程化几何（registry.ts 注释自承"JSON 模式做不到"）；导出是 live-data.json 不是代码；LLM 设计复杂数据负担重、效果差强人意。
- **路径②（LLM 直接吐 SceneFactory 代码，抛掉 manager）— 部分采纳并修正**：表达力对，但抛掉 manager 丢了二次开发数据契约。修正为：manager 保留，handler 内部代码化——兼得数据契约与表达力。
- **路径③（img2threejs spec + 生成器）— 淘汰**：任意场景不收敛，spec 字段集无法收敛，生成器前提不成立（不是难做，是前提不成立）。
- **本方案 = ①② 融合**：manager 数据契约（①骨架）+ handler 代码化（②表达力）。

## 二、架构

保留 manager→handler→component 三层，跨三仓库：

```
octoapp/pages/3d（UXAI）        3d 聊天/会话/版本历史/预览/导出壳子保留
  ↓ 替换：8-agent JSON → 3-agent handler 代码生成
3d-templete（render）           manager→handler→component 框架保留；handler 代码化；
                               资源库 + 混元（资源生成）+ libraryBridge 复用
  ↓ alias
3d-components（库）             组件库（handler 调 createComponentObject）；low-poly helper 在 3d-templete 资源层（Step 5）
```

**三层链路**（data → manager → handlers → components）：
- **data**：`{[type]: [{id, params, parentId}]}` 分组扁平。type=分组 key（节点无 type 字段），id 标识实例，params 实例属性，parentId 跨分组表父子（根=null）。
- **manager**（`ComponentManager`，已改 type 注册）：按 type 走 type→handler 注册表分发，**只分发根节点（parentId=null）**；CRUD 生命周期（create / update / delete），盖 `userData.__id / __componentType / __logicalRoot`。子节点靠父 handler 经 `ctx.getChildren` 递归建。
- **handlers**（LLM 生成 / 修改）：每个 type 一个 handler，`create(node, ctx)` 拥有整棵子树——内部厚代码调库组件 `createComponentObject(name, opts)` 或原生 THREE，能表达动画 / 交互 / shader；经 `ctx.getChildren(id)` 递归建子节点并自盖 `__id`。handler 定义自己的 dataSchema（params 契约）。
- **components**（`src/3d/components/`）：必要时抽的独立组件类；`libraryBridge` 已桥接 3d-components 库。

**handler 契约**（树原生 ComponentHandler，已落地）：
```ts
interface ComponentHandler {
  /** 创建根节点子树：node={type,id,params,parentId}，内部厚代码构建 + ctx.getChildren 递归建子节点 */
  create?: (node: TreeNode, ctx: ComponentContext) => THREE.Object3D | null
  /** 全量更新（不 diff）：把 obj 调整到新 node 状态（重建子树或就地改，handler 自决） */
  update?: (obj: THREE.Object3D, node: TreeNode, ctx: ComponentContext) => boolean
  /** 清理资源（返回 true 跳过默认 dispose，保护共享资源） */
  delete?: (obj: THREE.Object3D, ctx: ComponentContext) => boolean
  /** 该 type 的 params 契约（代码先行后反推，供产品对接 + 绑定 UI） */
  dataSchema?: object
}
// TreeNode = { type, id, params, parentId }（type=分组 key，buildNodeIndex 展开 raw JSON 时附上）
// ComponentContext = { scene, index, shared, getChildren(parentId), getNode(id) }
```

**库约束**（handler 内部调用顺序，对应"库里有就用，没有自己写"）：
1. 3d-components 库有合适组件 → `createComponentObject(type, options)`（libraryBridge 已做好 type→Ctor 映射）
2. 库没有 → 原生 THREE 代码，或抽成独立 component 放 `src/3d/components/`
3. 资源（模型 / 贴图）→ `ctx.loadModel('asset:xxx')`，ResourceManager 解析

**资源 fallback 链**：库 manifest 命中 → 引用；未命中 → 调混元生成 GLB → 回写库；混元失败 → low-poly helper。

**agent 流水线**（替换老 8-agent）：
- `scene_plan`：意图 + 选 type + 选组件 / 资源（调 `list_components` / `search_assets`）
- `scene_codegen`：生成 handler 代码 + 可选 component 类 + type→handler 注册行 + 反推 dataSchema + mock-data，写入 workspace 工程内 `src/3d/managers/component/handlers/<type>/`（见第七节，不写母版）
- `scene_review`：**9a** 确定性结构健全性门控（编译+运行时+完整性+结构核对，零模型依赖）→ **9b** 截图+VLM 审美评审（暂缓，见§六）→ `pass / refine-code / request-input / stop`
- 有界循环：每轮 ≤3 次 refine，总 ≤6 次，`state.json` 为权威（不是聊天记录）

**组件知识**（Step 4）：3d-components 源码 JSDoc 极密集 + 手写 `docs/components/*/index.html` 结构化金矿；由 3d-components 仓 `scripts/gen-component-docs.mjs` 解析成 `docs/components.json`，经包导出 `./docs` 暴露；opencode 加 `@a3d/a3d-components` 依赖，`list_3d_components()` + `get_3d_component_doc(name)` 经 `require.resolve("@a3d/a3d-components/docs")` 读单份 JSON 按需取（单一数据源，无手工快照漂移）。

## 三、数据格式（分组扁平 + parentId，摒弃平铺）

**摒弃原 scene_objects 平铺结构**，统一改为按 type 分组、组内扁平数组、跨组 parentId 表达父子：

```jsonc
{
  "buildings": [
    { "id": "building", "params": {}, "parentId": null }
  ],
  "floors": [
    { "id": "FLOOR1", "params": { "height": 3 }, "parentId": "building" }
  ],
  "walls": [
    { "id": "wall1", "params": { "path": [...], "position": {...} }, "parentId": "FLOOR1" }
  ],
  "water": [
    { "id": "water", "params": { "style": 111 }, "parentId": null }
  ],
  "fishes": [
    { "id": "fishe1", "params": { "type": 11 }, "parentId": "water" }
  ],
  "remove": ["wave"]
}
```

- **type**（顶层 key）：对应 handler 注册名。value 一律是数组（单实例也包一层数组）。
- **节点**：`{id, params, parentId}`，**无 type 字段**（type=分组 key）、**无 children 字段**（父子靠 parentId 跨分组）。
- **id**：实例标识。CRUD 幂等键，写入 `userData.__id`。
- **params**：实例属性（业务字段 + 可选 position/rotation/scale/castShadow/receiveShadow）。schema 由 `handler.dataSchema` 定义。
- **parentId**：根节点=null；子节点指向父（可跨分组，如 floors/FLOOR1 → buildings/building）。manager 只分发根节点；handler 经 `ctx.getChildren(id)` 查 children 递归建子树。
- **update**：全量分组字典推送，**不 diff**（有数据就走 update）。缺席的 type 分组不自动删——删除只能靠顶层 `remove:[ids]` 显式拎。

**为什么分组扁平**：type 作顶层 key 按类型聚合；parentId 跨分组表父子让 handler 拥有整棵子树（厚代码递归建），又不强迫数据嵌套。平铺结构每项带 type 字段是冗余。

**坐标兼容**：`{x,y,z}` 对象 和 `[x,y,z]` 数组都收（`scene/utils.ts` 的 `toVec`/`toPath` 转换）。

**一刀切**：引擎只收新格式，老 adapters 配置层（tree/identity/default/registry）已砍。host(UXAI) 发送层改新格式留 Step 7（改 scene-config.ts 类型会级联断 14 个 agent 流水线文件，随 Step 7 agent 产出自带分组扁平时一起改）。

## 四、LLM 产出契约

每个场景生成产出（均写入 workspace 工程内，不写母版；路径相对 workspace 根）：
1. **handler 代码**：`src/3d/managers/component/handlers/<type>/<type>.ts`，实现升级版 ComponentHandler（create / update / delete + dataSchema）。
2. **可选 component 类**：`src/3d/components/<type>/`，handler 调用（必要时抽离）。
3. **type→handler 注册行**：`handlers/index.ts` 的 typeHandlers 数组加一项 `{ type, handler }`。
4. **dataSchema**：`handler.dataSchema`，props 契约（代码先行后反推）。
5. **mock-data.json**：`public/scenes/<type>/mock-data.json`，预览用分组数据。

## 五、两个库怎么喂 LLM

### 3d-components（代码组件库）
- **不用造文档**：源码 JSDoc 极密集（264 @param、302 @default、106 @example、107 @returns）+ TypeDoc 已配（`npm run docs`）。直接从 JSDoc 解析成结构化文档。
- **颗粒度**：一个组件一份（name / 一句话用途 / import 路径 / Options 字段+默认值 / @example 代码片段）。
- **喂法**：不全量塞 context（~20 组件 + Options 细节会爆）。给目录索引（id+一句话用途）+ 工具 `list_components(filter)` / `get_component_doc(name)` 按需查。20 个起步不用向量 RAG。
- **补 gap**：
  - 库没 primitive（box / sphere / cone）——文档明示"primitive 用原生 THREE，复合组件用库"。
  - 复杂组件（Wall / HeatMap / Graph3D）补截图或挂 `docs:serve`（7777 Vite 站）live demo 链接。

### 3D 资源库
- **喂 manifest**：每资源一条（id / 名称 / 类别 / 标签 / 缩略图URL / 路径 / 格式 / 多边形数 / 描述）。模型 / 贴图二进制不喂。
- **检索**：`search_assets(query)` + 缩略图。GLM / DeepSeek 多模态能看图，缩略图+文字比纯标签准。
- **引用**：handler 里 `ctx.loadModel('asset:xxx')`，ResourceManager 解析加载。
- **兜底链**：manifest 命中→引用；未命中→混元生成（`AssetCache.registerModelGenerator` 已预留，注释明写"用于按需生成的模型（如混元 AI 生成）"）→回写库；混元失败→low-poly helper（**已补 Step 5**，3d-templete `src/3d/resources/lowPolyFallback.ts`）。

## 六、门控与循环

Step 9 拆 **9a（确定性结构健全性门控，零模型依赖）** + **9b（截图 + VLM 审美评审，暂缓）**。拆分依据：**非审美问题**（建筑画在地下 / 布局重叠 / 像不像真实机房的结构面）是客观可判的，由 9a 确定性代码核对即可，不需模型；**真审美问题**（材质颜色、整体视觉协调）主观且难自动闭环，才需 9b 的 VLM——而 9b 收益不大（见下）。

### 9a — 确定性结构健全性门控（纯代码，零 LLM / 多模态依赖）

挡掉"生成了但跑不起来 / 少东西 / 结构硬伤"，全客观可判：

1. **编译门控**：workspace 工程内对生成 handler `.ts` + `index.ts` 跑 `vue-tsc --noEmit`。3D 产物是 5 个 `.ts`（TS 不像 HTML 容错），tsc 不过必崩 → `refine-code`。
2. **运行时门控**：51857 dev 起来后 iframe 加载场景，捕获 console error（Three.js 缺几何 / 缺材质 / null 引用 / 未注册 type）。机制：postMessage `SCENE_CONSOLE_ERROR` 从 3d-templete 回传 host（或 vite overlay 抓）→ `refine-code`。
3. **完整性核对**（3D codegen 特有）：解析 `live-data.json` 分组 `{type:[objects]}`，对照 plan 的 types 清单——缺 type / 某 type objects 数为 0 = `refine-code`（对应已知坑：LLM 漏写某分区 handler 或 live-data 空组致整分区丢失，JSON 时代靠 union-merge 兜底，代码时代靠核对）。
4. **确定性结构健全性核对**（用户点名的"非审美"项，纯函数核对）：
   - **Y 非负 / 不在地下**：postMessage `SCENE_DUMP_GRAPH` 让 3d-templete 回传所有 Object3D 世界坐标 + bbox，顶层物体 bbox 下界 < 0 = 疑似"建筑画在地下"。用运行时 graph（非静态提取代码）因 codegen 里 position 常是算出来的。
   - **重叠检测**：重写 `detectOverlaps`（spatial-check 曾有但 Step 7 codegen 重写后已删，见 memory `3d-layout-spatial-check`）——顶层物体世界 AABB 两两求交，过滤表面接触（Y 交叠<0.15m）/ 含于，相对穿透>8% 标疑似。**只检测不修正**（自动推开有风险，起步阶段只标疑似）。
   - **结构合理性**（像不像真实机房的结构面）：机柜成行对齐 / 朝向一致 / 通道宽度在合理区间——可由确定性规则核对（需知哪些 type 是机柜，靠 type 名或注册信息启发）。**边界**：规则化有限（冷热通道朝向 / 布线有领域知识门槛），先做 Y / 重叠 / 对齐三条通用的，机房专属结构核对按需后加，**别堆死领域规则**（用户反对）。

**零模型依赖**：9a 全程不调任何 LLM / 多模态——tsc / vue-tsc 是编译器，console / graph 是运行时数据，detectOverlaps / 结构规则是纯函数。换任意 codegen 模型，9a 照常工作。

### 9b — 截图 + VLM 审美评审（需多模态模型，暂缓）

补 9a 之后的"整体视觉协调 / 审美"残值：

1. **截图**：postMessage `SCENE_SCREENSHOT` → 3d-templete `renderer.domElement.toDataURL('image/png')` → base64 回传 host。**坑**：three.js WebGLRenderer 默认 `preserveDrawingBuffer:false` → toDataURL 得空图；修 = 设 `preserveDrawingBuffer:true` 或在 `render()` 后同步 `toDataURL`。
2. **VLM 打分**：截图 + 场景意图文字喂多模态模型（GLM-4V / GPT-4o 等），评"整体比例协调 / 空旷拥挤 / 光照刺眼 / 材质颜色搭配"并给修 code 建议。
3. **闭环**：VLM 判不行 → `refine-code`（带建议）回 codegen 重写。

**模型独立性**：VLM 评审角色与 codegen 主模型**解耦**——codegen 用 GLM/DeepSeek 文本，VLM 可换任意多模态模型（不同 provider）。唯一前提：得有一个多模态模型可用。**若将来 codegen 换成不支持图像的模型，9b 仍可行**（另挂一个多模态模型当评审即可）；只有"全链路一个多模态模型都没有"时 9b 才不可用。

**收益评估（为什么不急做）**：
- 9b 唯一能抓的是"整体视觉协调 + 材质颜色审美"——**主观**，且 VLM 评分无法自动闭环修正（要改审美得回 codegen 改材质 / 比例参数 = 又跑一轮 codegen，成本高、收益不确定，LLM 审美上限同样存在）。
- 布局问题 VLM 也只检测不修正（和 9a 的 `detectOverlaps` 一样只标疑似），但 `detectOverlaps` 更便宜更确定——VLM 在这块无额外价值。
- 引入多模态模型依赖 + 截图管线 + VLM 调用成本 / 延迟。

**决策（2026-08-19）**：9b 暂缓 ⬜，9a 先做（待开工）。9b 留文档，后续若 9a 跑稳后"硬伤都挡住了但出来的场景视觉上还是丑 / 不协调"再捡回；或将来多模态模型强到审美评分 + 自动 refine 闭环可靠时再做。

### 有界循环

- 每轮 ≤3 次 refine，总 ≤6 次。`state.json` 为权威（不是聊天记录）。
- 门控输出：`pass`（全过→预览定稿）/ `refine-code`（9a 任一项不过→带错误清单回 codegen）/ `request-input`（缺信息，如 modify 未指定 type）/ `stop`（超上限或意图已完成）。

## 七、模板/工作空间/历史机制（代码副本 + 历史归档）

**问题**：3d-templete 本质是示例模板，不是被反复改的固定工程。每轮 LLM 生成必须在干净模板副本里改代码，否则上轮污染下轮、且无法追溯历史。

**复用老模式**：沿用现有 `.octo/design-3d/`（关联本地文件夹下）+ Electron IPC + 每会话 `_versions.json` 索引 + 数据推送预览的成熟机制，在其上扩"代码副本"维度（不另起炉灶）。

### 1. 目录布局（关联文件夹 `.octo/design-3d/` 下）

```
.octo/design-3d/
├── workspace/                 # 全局唯一活动工程（方案A：永远只一个）
│   ├── src/ public/ 配置...   # template 母版拷贝（node_modules 软链到母版）
│   └── + 当前版本 code/ delta 覆盖 → 可跑 dev 工程（固定 51857）
├── history/
│   └── <sessionId>/
│       ├── _versions.json     # 版本索引 + current 指针（沿用，扩 codeDir 字段）
│       └── <versionId>/
│           ├── data.json      # 该版本分组数据（SceneSessionState，沿用）
│           └── code/          # 该版本代码增量（handler .ts + 注册行 + mock-data）
├── preview/                   # 沿用
└── debug-log/                 # 沿用
```

### 2. 模板母版来源

- **dev**：从 `D:\cyc\project\octo\3d-templete`（`template-base` 分支）拷。母版只含框架（manager/handler 骨架 + 库 + 预置 handler），不含任何 LLM 生成产物。
- **生产**：3d-templete 打进 app 资源，从 app 资源解压拷。
- 拷贝时 **node_modules 软链**到母版（不重复装依赖；src/config/public 实拷，体积小）。

### 3. workspace 粒度 = 全局唯一（方案 A）

磁盘只有 `workspace/` 这一个活动工程。切会话/切版本 = 把目标版本 `code/` delta 覆盖进 workspace + 重启 dev（51857）。node_modules 软链后重新物化（拷 src + 叠 delta）<1s，真正开销是 dev server 重启（A/B 方案都要付）→ 永远只占一个工程空间、一个端口、不用清理旧会话工程。（未来可探索 Vite HMR 热重载 handler 改动免重启，但 Three.js 场景 HMR 不一定稳，先不指望。）

### 4. 每轮生成怎么走（统一 workspace 覆盖路径）

**砍"数据/代码按意图分离"优化**（没新增 type 也可能要改代码，按意图猜 hold 不住）。改按**谁改的**分：

- **LLM 生成轮**（codegen / refine）：agent 写 handler 代码 → 写入该版本 `code/` → 覆盖进 workspace → 重启 dev → 截图 / VLM 评审。**永远走 workspace**（它本就是在写代码）。
- **用户属性编辑器手动改**：走现有 SCENE_PATCH 数据推送，不重启 dev（数据驱动，handler 不变）。

### 5. 历史归档与回溯

- 每版本 = `history/<sessionId>/<versionId>/{data.json, code/}`。`_versions.json` 扩 `codeDir` 指针（沿用 `appendSceneVersion`/`updateSceneVersion`/`switchToVersion`/`rollbackToVersion`，扩写 code 维度）。
- 历史查看 = 列版本 → 点某版本 → 覆盖该版本 `code/` 进 workspace + 重启 dev 预览 + 展示该版本代码。
- 切版本 / 回滚 = `switchToVersion` / `rollbackToVersion` 扩 code 覆盖 + 重启。

### 6. LLM 生成时路径指向

- agent 写文件目标 = **workspace 工程内** `src/3d/managers/component/handlers/<type>/`（绝对路径 = `<linkedFolder>/.octo/design-3d/workspace/src/...`），**绝不写母版**。
- 同时把代码增量归档到 `history/<sessionId>/<versionId>/code/`（同结构相对路径），供历史回溯。
- 注册行写 workspace 的 `handlers/index.ts`；mock-data 写 workspace 的 `public/scenes/<type>/`。

## 八、步骤总览

| 步骤 | 内容 | 仓库 | 完成标志 | 状态 |
|---|---|---|---|---|
| 0 | dev_cyc1 三仓库分支 + 设计文档 + memory + 思维导图 | 全部 | 分支建好、本文档存在 | ✅ 已完成（本文档已按融合方案更新） |
| 1 | ~~SceneFactory / CodeScene 基建~~ → 重定位：主路径走 manager+handler，预览走 Embed；SceneFactory/CodeScene 不作主路径 | 3d-templete | （见 Step 2 重定位） | ⚠️ 待重定位 |
| 2 | 数据格式重构：scene_objects 平铺→分组扁平+parentId；砍 adapters 配置层；manager 改 type 注册（只分发根节点）；handler 契约升级（树原生 create(node,ctx) 拥有子树）；buildings/roads/water/example handler；mock-tree 新格式 | 3d-templete | 分组数据经 Embed 渲染、vue-tsc src/ 0 错 | ✅ 已完成（host 衔接留 Step 7） |
| 3 | 资源库基础：assets-library/ + manifest + ResourceManager + loadModel 真实实现 + asset: 解析 | 3d-templete | `ctx.loadModel('asset:xxx')` 加载真实文件 | ✅ 运行时验证通过（manifest 驱动资源库 + searchAssets 引擎内检索 + ctx.loadModel；?scene=mock-tree.json 渲染 example.glb） |
| 4 | 组件文档预处理：3d-components 解析 index.html→docs/components.json + ./docs 包导出；opencode 加依赖经 require.resolve 读 + list_3d_components/get_3d_component_doc 工具 | 3d-components + UXAI | 工具能返回组件目录与全文 | ✅ 已完成（3d-components: gen 脚本+components.json+./docs export；UXAI: 依赖+重写工具读包导出+registry 注册；删 10 手写 JSON；tsgo 0+prettier+运行时 resolve+数据层验证 PASS；**不 commit 待 review**） |
| 5 | 混元集成（资源生成 GLB + AssetCache.registerModelGenerator）+ low-poly 兜底 helper | 3d-templete | 库未命中→混元→存库；混元失败→low-poly | ✅ 已完成（代码落地+验证；真实混元待密钥） |
| 6 | 模板/工作空间/历史机制：模板母版（dev 从 3d-templete template-base 拷，生产打进 app 资源）→ 全局唯一 workspace（template+当前 delta，可跑，51857）；每版本代码增量归档 `history/<sessionId>/<versionId>/code/`；切版本=覆盖 delta+重启 dev；LLM 轮走 workspace 覆盖+重启、用户属性编辑走数据推送（详见第七节） | UXAI + 3d-templete | 模板拷→workspace 物化→版本归档→切版本覆盖+重启 跑通，历史可回溯 | ✅ 运行时验证通过（materialize→51857 起→iframe 渲染 mock 场景；5 运行时 bug 已修） |
| 7 | 改 pages/3d 生成逻辑：3-agent handler 代码生成替换 8-agent JSON；写文件到 workspace handlers/；预览 + postMessage 桥 | UXAI | NL prompt → 生成 handler → 预览 | ✅ 代码落地+运行时验证通过（5-type 场景生成成功，~18min 待 Step 8 加速） |
| 8 | **生成加速**（保守路线，照抄 make ①②③ 不照抄④单 agent）：①plan 工具调用改静态注入（零运行时工具+预注入缓存，复用 `3d_components_docs.ts` docCache + `proto/index.ts` formatPrompt）；②合并 triage+plan（单 agent 内 routing+types+选型，routing=chat 早退）；③runChildSession 改流式消费（照抄 make `session.prompt`）。**保留 plan→codegen 两步分离**（3D TS+Three.js 不容错，契约出错无门控兜底=空场景，等 Step 9 门控后再评估激进合并成单 agent） | UXAI + opencode | 生成耗时 18min→~12min；plan 零工具调用；triage+plan 合并；流式消费 | ①✅ 运行时验证通过（机房 11:35→7s、热力图 1:30，远超预期）；②③⬜ 暂缓（主瓶颈转 codegen，②③ 不碰 codegen，留待 Step 9 后按需捡回） |
| 9 | 有界循环 + 门控：9a 确定性结构健全性门控（编译+运行时+完整性+结构核对，零模型依赖）+ 9b 截图+VLM 审美评审（暂缓，见第六节）；refine-code | UXAI | 9a 跑通挡硬伤；9b 暂缓（收益不大） | 9a ✅ 代码落地（三仓 typecheck 0 错；e2e 运行时待验证） / 9b ⬜ 暂缓 |
| 10 | dataSchema / mock 接线 + export-project 改注入 handler 代码 + mock-data + 注册行 + README | UXAI + 3d-templete | 导出 zip 可 `npm install && npm run dev` 二次开发 | ✅ e2e 验证通过（注入 codeDir 生成代码 + vendor 3d-components + @a3d 名统一；typecheck/lint 0 错） |

## 九、当前进度

- **Step 0 ✅**：三仓库均切到 `dev_cyc1`（基于 dev_cyc / main）。思维导图 `new3d-plan.html`。本文档已按"manager 保留 + handler 代码化 + 分组数据"融合方案更新。
- **Step 1 ⚠️（重定位）**：3d-templete 已新增 `src/scenes/registry.ts`、`src/scenes/example/build.ts`、`src/views/CodeScene.vue`、`/code-scene` 路由。**经评估，主路径直接走 manager + handler，预览走 Embed + 分组 mock-data，不需要 SceneFactory/CodeScene 这套并行路径。** Step 2 时：example/build.ts 改写成 handler 示例挂 manager；CodeScene.vue / registry.ts / /code-scene 路由砍掉（dataSchema 思想已被 handler 契约吸收，不浪费）。
- **Step 2 ✅**：3d-templete 引擎落地——砍 adapters 配置层（整目录+4 孤儿 base handler），换分组扁平 TreeScene（{id,params,parentId}）+ 树原生厚 handler（buildings/roads/water/example），manager 只分发根节点、handler 拥有子树（ctx.getChildren 递归建），update 全量不 diff + remove:[ids]，vue-tsc `src/` 0 错误。mock-tree*.json 改新格式。**host(UXAI) 衔接留 Step 7**（改 scene-config.ts 类型级联断 14 个 agent 文件）。待运行时验证（`?scene=mock-tree.json` + `?update=mock-tree-update1.json`）。
- **Step 3 ✅ 运行时验证通过**：资源库基础落地——新建 `assets-library/`（`manifest.ts`：`AssetEntry`/`AssetSearchResult` 类型 + `ASSET_MANIFEST` + `searchAssetEntries` 纯函数；`example.glb` 从 `src/3d/assets/models/` 移入 `assets-library/models/`）；`registerModels.ts` 重写为 manifest 驱动批量注册（`setAssetManifest` + 遍历 `registerModel`）；`ResourceManager` 加 `setAssetManifest` + `searchAssets`（注入模式对齐 `setHunyuanGenerator`）；`resources/index.ts` 补导出；`ComponentContext` 加 `ctx.loadModel` 便捷方法（对齐文档 API，委托 `shared.resources.cloneModel`）+ `objects.ts` 两处 ctx 构造点接上。底座（`AssetCache` + `asset:` 解析 + `cloneModel`）Step 2 已就绪不改。`search_assets` LLM 工具 + `SCENE_SEARCH_ASSETS` postMessage + host 接线留 Step 7。`vue-tsc -b` 0 错；运行时 `?scene=mock-tree.json` 渲染 example.glb + `searchAssets` 检索 example 条目（剥 src）验证通过。
- **Step 4 ✅ 运行时验证通过**：组件文档预处理 + `list_3d_components`/`get_3d_component_doc` 两工具落地（UXAI/opencode 仓库）。新建 `packages/opencode/src/tool/proto_tool/3d_components/`（10 个 `.json`：wall/shape/grid/path/outlines/wireframe/bitmaptext/html/sky/instancedmesh2，从 3d-components 的 JSDoc + `docs/components/*/index.html` 手工提取成结构化 JSON——name/summary/importPath/extends/constructor/options+默认值/properties/methods/examples/notes；不改 3d-components 源码）；新建 `proto_tool/3d_components_docs.ts`（镜像 `load_components_docs`：fs 扫描+缓存 `scanDocIndex`、按名查 `findDocFile`、markdown 格式化 `formatDoc`、两个 `Tool.define`——list 返 `name — summary` 目录+OR 过滤、get 返全文 markdown，未知组件给建议）；`registry.ts` 5 处注册（import/yield*/Tool.init/builtin 数组/builtinToolNamespaces）。tsgo `--noEmit` 0 错；prettier 合规；直接调 `scanDocIndex`/`findDocFile`/`formatDoc` 验证 10 组件齐全 + Grid 全文含 Options/Methods/Examples + 未知组件正确未命中。**agent 接线（scene_3d_planner permission allow + prompt 工具指引）留 Step 7**（仿 Step 3 searchAssets 不动现有 8-agent 流水线）。
- **Step 5 ✅ 代码落地+验证（真实混元待密钥）**：混元 3D GLB 生成接入 + low-poly 兜底。**片A 兜底链路（无密钥端到端验）**：新建 `src/3d/resources/lowPolyFallback.ts`（语义化低模——风机/树/楼/车/默认方盒，按 prompt 关键词首命中形状，three 原语+MeshStandardMaterial PBR，GLTFExporter→GLB bytes；hashString(prompt) 确定性配色）+ `src/3d/resources/hunyuan.ts`（`hunyuanGenerator`：dev `fetch('/hunyuan/generate?prompt=...')`，prod `!import.meta.env.DEV` 直接兜底——host IPC 中转留 TODO；任意失败 catch 回落 `lowPolyGlbBytes`，绝不 rethrow）+ `registerModels.ts` 删占位 throw 接真 generator + `handlers/model/model.ts`（确定性 modelHandler：读 `params.src`→`ctx.loadModel`→挂 group，异步先返回；delete 跳过 dispose 因几何/材质共享）+ `handlers/index.ts` 注册 `{type:'model'}` + `public/test-hunyuan.json`（分组扁平契约，3 节点覆盖 asset:/hunyuan:风机/hunyuan:松树）。**片B 真实混元 middleware（待密钥验）**：新建 `vite/hunyuanDevServer.ts`（vite dev 中间件 `/hunyuan/generate`：node 侧 TC3-HMAC-SHA256 v3 签名+SubmitHunyuanTo3DProJob 提交+QueryHunyuanTo3DProJob 轮询(5s/180s 超时/≤2 次重试)+下载按 magic bytes 判 zip/GLB+AdmZip 解压取 .glb+prompt→GLB 内存缓存；密钥从 .env.local 读**严禁 VITE_ 前缀**；无密钥→503 NO_CREDENTIALS→前端兜底）+ `vite.config.ts` 注册插件+`tsconfig.node.json` include `vite/**/*.ts`+`eslint.config.mjs` globalIgnores 加 `vite/**/*.ts`+`.env.example`+adm-zip/@types/adm-zip devDep。**验证**：vue-tsc -b 0 错；lint 改动文件 0/0；vite build exit 0（插件 config 阶段加载）；dev middleware curl→503 `{"error":"NO_CREDENTIALS"}` ✅ 插件挂载+兜底路径成立。**待用户**：写 .env.local 真实密钥→重载→首次 30s–2min 真实 GLB，二次命中缓存秒回。**架构修正**：low-poly helper 落 3d-templete 资源层（非原设 3d-components，更近消费方）。**不 commit 待 review**。
- **Step 6 ✅ 运行时验证通过**：模板/工作空间/历史机制落地（见第七节）。Electron 主进程 5 个 IPC（materialize-workspace / overlay-workspace-files / start-workspace-dev / stop-workspace-dev / delete-path-recursive）+ preload 镜像 + DesktopApi；`utils/workspace.ts` 编排器（materialize/overlayVersionCode/startDev/stopDev/switchVersion，**switchVersion 用 switchChain 串行化**）；`version-history.ts` 扩 code 维度（codeDir 指针 + append/switch/delete）；`index.tsx` 动态 previewSrc（51857 workspace vs 5173 母版）+ wsNonce 强制 iframe 重载 + handleSelectVersion/会话恢复 codeDir 分支 + onCodeVersionReady stub + dev-only 验证按钮。tsgo -b（desktop + app）0 错。spawn vite 用 `bun`（非 `process.execPath`——Electron 里那是 electron.exe），`OCTO_3D_DEV_RUNTIME` env 可切 node。**运行时验证**：materialize（拷贝+junction+vite.config 别名重写）→ startDev（51857 ready）→ iframe 加载 → SCENE_READY 握手 → SCENE_UPDATE 发送 → 3d-templete 引擎运行（libraryBridge 注册组件、manager 分发）全通；`?scene=mock-tree.json` 渲染 mock 场景正常（host 老格式 scene_objects 空背景属 Step 7 衔接，非 Step 6 bug）。**5 个运行时 bug 修复**：① `spawn bun ENOENT`——Windows 下 bun 是 .cmd shim，spawn 不解析 PATHEXT，改 `resolveDevRuntime()` 定位 bun.exe 绝对路径；② `EBUSY rmdir workspace`——killWorkspaceDev 的 taskkill 异步回调没 await，stopDev 立即返回致 rm 抢跑，改 async + await child exit + 150ms grace，rm 加 5 次重试；③ vite.config 别名引号语法错——split/join 串末尾多带 `'` 致 `src'` 提前闭合，去掉末尾引号（闭引号由剩余 `/<suffix>')` 提供）；④ `vite 退出(code null)`——进页面恢复 effect 与按钮点击并发 switchVersion，后者 stopDev 杀前者未 settled 的 vite 致 reject，加 `switchChain` 串行化（后者等前者 ready settled 后才 stopDev）；⑤ ready 正则不匹配致 30s 超时——vite 彩色输出 ANSI 码插在 `127.0.0.1:` 与端号间破坏 `\d+`，且单 chunk `s.match` 怕 url 被拆断，改 `NO_COLOR=1` 禁色 + 累积 `buf` 上 strip ANSI match + `"ready in Nms"` 兜底（端口用已知 args.port）。

- **Step 7 ✅ 代码落地（待运行时验证）**：3-agent handler 代码生成替换 8-agent JSON 流水线。**架构**：`scene_3d_triage`（改 schema：routing=create/modify/chat + types:{create,modify} + reply/reason/attachment_description，删 section_id/element_id）→ `scene_3d_plan`（新，调 list_3d_components/get_3d_component_doc 选型 + 定 camera/lights/scene，schema 约束 plan JSON）→ `scene_3d_codegen`（新，写 handler `.ts` + 全量 `index.ts` + 全量 `live-data.json`，Markdown 代码块输出，schema=undefined 跳过 validateSchema）→ host `parseCodeFiles` 解析 → `onCodeVersionReady` 物化+预览。**全砍暂停点**：删首次创建的 intent_confirm + 线框审查两暂停，NL→triage→plan→codegen→预览，代码先行。**prompt 设计**：system prompt 全静态（`{HANDLER_CONTRACT}{TREE_SCENE_FORMAT}{REGISTRATION_PATTERN}` 3 静态片段，formatPrompt 插值）；运行时数据（[PLAN_JSON]/[USER_REQUEST]/[CURRENT_HANDLERS]/[CURRENT_LIVE_DATA]）放 user message（buildHumanMessage 拼接，不走 `{{}}` 占位——formatPrompt 的 `\{(\w+)\}` 正则会绞坏注入的 JSON/TS 代码）。**落地文件**（UXAI）：`utils/parse-code-files.ts`（parseCodeFiles: `## file:<path>`+fenced code→{path,content}[]；extractSceneData: 取 live-data.json 分组 TreeScene）+ `agents/scene-plan/{schema,index}.ts`（runChildSession+buildHumanMessage，schema 约束）+ `agents/scene-codegen/index.ts`（runChildSession schema=undefined，输出原始 Markdown）+ `workflow/codegen-scene.ts`（编排：loadCurrentTypes→triage→plan→loadCurrentCode(modify)→codegen→parseCodeFiles→onCodeReady；`loadCurrentCode` 片D 读 codeDir 全部 .ts 源码 + state.mergedSceneConfig 注入 [CURRENT_HANDLERS]/[CURRENT_LIVE_DATA]）+ `agents/scene-triage/{schema,index}.ts`（schema 改 routing+types；delete/add/modify 留空数组供孤儿 modify-scene-ai.ts 兼容）+ `index.tsx`（handleSubmit 重写调 codegen_scene；onCodeVersionReady 扩 sceneData 参数：先 setPendingPreviewData+setHasPreviewContent+mergedSceneConfig+lastSceneObjects 哨兵，再 wsNonce++）。**落地文件**（opencode）：`prompt/stastics/{HANDLER_CONTRACT,TREE_SCENE_FORMAT,REGISTRATION_PATTERN}.txt`（3 静态片段）+ `prompt/scene_3d/{scene_3d_plan,scene_3d_codegen}.txt`（2 prompt）+ `proto/index.ts`（import+注册 3 static + formatPrompt 2 prompt）+ `agent.ts`（注册 scene_3d_plan/scene_3d_codegen，permission deny * + allow list_3d_components/get_3d_component_doc/read）。**发送层渐进迁移**：pendingPreviewData 存分组 TreeScene（loose cast `as unknown as SceneConfig`），不碰 14 个平铺 SceneConfig 文件（成孤儿保留）；SCENE_PATCH 属性编辑迁移留 Step 8。**modify 策略**：整体重写受影响 type handler + 全量重生 index/live-data（非 patch）；host 从 codeDir 读当前 handler 源码注入 codegen。**验证**：tsgo EXIT=0 + prettier All PASS（片 A/B/C/D 逐片验证）。**运行时验证通过**：真实 LLM（GLM）5-type 场景（sportsField/buildings/trees/paths/grass）端到端生成成功——triage→plan→codegen→parseCodeFiles→onCodeVersionReady→workspace 物化→51857→iframe 渲染场景。修复历程：①统一 `getResultFromMessagesLoose` 收集 reasoning（修 plan「模型未返回有效内容」）；②`extractJson` 取最后一个 ```json 代码块（避免 reasoning 草稿干扰）；③`OUTPUT_TOKEN_MAX` 32000→64000（修 codegen reasoning 吃满 token 代码块未产）；④plan 加 `build_detail` 字段（schema+接口+returnValue+plan/codegen prompt）让 codegen 照抄不重新设计尺寸/材质。**已知问题**：生成耗时 ~18 分钟（plan 多轮 `get_3d_component_doc` 工具调用 + codegen 64000 token 串行输出 + 3 agent 串行子 session），待 Step 8 加速。**不 commit 待 review**。

- **Step 8 🔄 进行中（①✅ 落地+验证，②③⬜ 待做）**：照抄 make 加速模式 ①②③，**不照抄④单 agent 直出**。

  **① ✅ 已落地+验证（plan 工具改静态注入）**：`3d_components_docs.ts` 加 `formatCatalog()`（精简目录：name+summary+构造+Options+DataTypes，跳过 methods/examples/properties 省 token）；预烘 `prompt/stastics/COMPONENT_CATALOG.txt`（11889 字符/10 组件）；`proto/index.ts` 静态 import + 注册 `_staticData`；`scene_3d_plan.txt` 删 `# Tools` 工具段改 `{COMPONENT_CATALOG}` 注入（4 处引用改"上方组件目录"）；`agent.ts` plan permission `*:deny`（删 list_3d_components/get_3d_component_doc/read allow）；`script/gen-component-catalog.ts` + `npm run gen:component-catalog` 重跑入口。**关键发现**：运行时烘（method A，proto import 时调 formatCatalog）有**循环依赖 TDZ**——`3d_components_docs`→`Tool`→`proto`→`formatCatalog`→`loadDocs`→`docCache` 在 `let` 初始化前被访问。改预烘 .txt（method B，同 `HANDLER_CONTRACT` 模式）规避：proto 只静态 import .txt 不调函数，无环。**验证**：tsgo EXIT=0 + gen 脚本可重跑 + 端到端 `PROMPT_SCENE_3D_PLAN` 含目录（16308 字符）、无 `{COMPONENT_CATALOG}` 占位符残留、无 `list_3d_components` 工具引用残留。**运行时验证通过（效果远超预期）**：机房场景 11:35→7s（plan 从 3-7 轮工具往返→1 轮直出 JSON，之前 11:35 基本全耗在 plan 工具往返上）、热力图 1:30。**瓶颈转移**：① 后主瓶颈从 plan 转到 codegen（64000 token 串行输出，热力图 90s 大头是 codegen 而非 plan/triage/session）。

  **②③ 暂缓决策（2026-08-19）**：②（合并 triage+plan，省 ~5-15s）+ ③（runChildSession 流式，省 ~10-15s 体感）合计对热力图 90s 省 ~20-30s，但都不碰 codegen（真瓶颈）；③ 动 session 消费层（之前出过竞态，见 3d-first-create-blank-race）有风险。① 已把"不可用"变"可用"（机房 695s→7s）。**下一步转 Step 9 门控循环**（tsc/运行时门控 + 截图 + VLM 打分 + refine）——提质量 + 为 codegen 激进优化（换非 reasoning 模型 / 并行分 type，见分析「九」）铺路。②③ 是独立改动，随时"继续第 8 步"捡回：Step 9 后若实测 triage/session 成新瓶颈再做。

  **为什么不能全照抄 make**：make 产物=单 HTML（浏览器容错，LLM 写的 HTML 有瑕疵也能渲染）；3D 产物=5 个 .ts handler + index.ts + live-data.json（TS 要 tsc 过 + Three.js 运行时严格 + 框架契约：`ComponentHandler` 签名 / import 路径 `../../../../components` / registration pattern，契约出错 = tsc 崩 / 运行时崩 / 空场景）。且 3D 有**选型+代码分离需求**（native/component/model + 组件/资源选型→再写代码）+ triage 路由（create/modify/chat），make 无。**三方案**：①plan 工具调用改静态注入——把组件目录（名+用途）+ 高频组件 doc 预烘成静态 txt（同 `MESH_GEOMETRY_CATALOG` 模式），`formatPrompt` 注入 plan prompt，删 plan 的 `list_3d_components`/`get_3d_component_doc` 工具权限（codegen 走 `createComponentObject` 黑盒不按 doc 写，plan 查 doc 价值有限）。省 2-5min（最大头）。②合并 triage+plan——routing+types 判定并入 plan 第一步，routing=chat 早退，省 1 轮 + session 开销 30-60s。③runChildSession 改流式消费——照抄 make `session.prompt`（SDK 流式），替代 `promptAsync`+轮询同步式，首屏体感快。**保留 plan→codegen 两步分离**（降低契约出错率，等 Step 9 门控兜底后再评估激进合并成单 agent）。完成标志：18min→~12min、plan 零工具调用、triage+plan 合并、流式消费。

- **Step 9 🔄（9a ✅ 代码落地+三仓 typecheck 0 错，e2e 待验证 / 9b ⬜ 暂缓，见§六）**：门控 + 有界循环（本轮不做自动 refine 循环——动 session 竞态层有风险，见 3d-first-create-blank-race）。**9a ✅ 代码落地（2026-08-19）**——本轮落地范围 = **完整性 + 编译(tsc) + 运行时(console)** 三检（**结构核对 Y非负/重叠/对齐本轮未做**：需 dump-graph 几何回传，用户定冗余已砍）：`utils/scene-gate.ts` 新增（checkCompleteness+runSceneGate+parseTscErrors+formatGateFindingsForCodegen，零模型依赖）；codegen-scene 透传 sceneData + 灾难短路（无 live-data 不物化）+ priorGateFindings 注入；scene-codegen buildHumanMessage 拼`## 上一轮门控失败清单`；3d-templete Embed.vue 装 window error/unhandledrejection + 包 console.error → SCENE_CONSOLE_ERROR 转发（onUnmounted 恢复）；preview/index.tsx SCENE_ERROR 去 toast 改 onConsoleError 持久化通道（修消失-toast 坑）；index.tsx handleSubmit codegen 成功后 runGateAndPersist（三检，vue-tsc 与 console-settle 并行）+ saveProtoError/clearProtoError 持久化 + codegenResult.error 补 saveProtoError（修扛 reload 坑）；handleRetry 加 codegen 分支（unified checkpoint 加 `codegen` stage，handleSubmit 存档，retryCodegen 喂回 lastGateFindings→priorGateFindings，让 codegen 照着修）；desktop 加 run-workspace-tsc IPC（spawn bun vue-tsc.js --noEmit -p tsconfig.app.json，OCTO_3D_DEV_RUNTIME 可切 node）。**三仓 typecheck 0 错**（app tsgo -b --force / desktop tsgo -b / 3d-templete vue-tsc -b + --noEmit -p tsconfig.app.json——后者即门控 IPC 实跑命令）+ 纯函数自测 8 项过（no-live-data/missing-type/empty-type/pass + formatGateFindingsForCodegen）。**e2e 运行时验证待跑**（需 desktop + 真实 LLM 生成：完整性缺 type / tsc 错 / 运行时 console 三失败路径 + 全过 + 重试喂回）。不 commit（留 review）。**9b** 截图+VLM 审美评审**暂缓**（材质颜色才属审美，主观且难自动闭环，收益不大；布局/像机房的结构面已由 9a 确定性核对覆盖，VLM 无额外价值）。9b 模型独立于 codegen 主模型，换文本模型仍可行（另挂多模态评审即可）。决策与用户判断一致。

- **Step 10 ✅ e2e 验证通过（typecheck/lint 0 错）**：导出工程供二次开发——导出 zip 可 `npm install && npm run dev` 开 `/` 渲染**生成的场景**（带生成 handler + live-data，无需 host）。**两个致命 gap 修复**：① 生成 handler 代码没注入（原 export 只导母版基础 handler）→ `export-project.ts` opts 加 `codeDir`，`index.tsx handleDownload` 调 `loadCurrentSceneState(sceneHistoryDir(),sid)` 取当前版本 codeDir → `listDirectory`+`readFileBuffer` 读全部文件注入 injectFiles（复用 `workspace.ts overlayVersionCode` 读法），过滤 `live-data.json`（sceneConfig 注入为权威）。② 3d-components 没 vendor + 包名错（原加 `@cyc` dep 但从不复制 vendor、且 @cyc 是死名实为 `@a3d`）→ desktop `exportProjectZip` IPC 加 `copyDirs:{from,to}[]`（`cp` 复制 3d-components/dist → vendor/3d-components/dist）+ 注入精简 vendor package.json（仅 runtime 字段 name=@a3d/a3d-components/main/module/types/exports/peerDeps，剥 prepare/husky/scripts 防 npm install 跑它）+ package.json dep 改 `@a3d/a3d-components: file:./vendor/3d-components` + vite.config 过滤改查 `@a3d/a3d-components`（原查 @cyc 不命中）。**已具备无需改**：3d-templete `/` 路由 `Scene3D.vue` 调 `loadLiveDataConfig()`（`loader.ts:138` 默认 `live-data.json`）独立加载、3d-components dist 已 build、母版 dependencies 已含 gsap/three/three-bvh-csg/three-mesh-bvh（=peerDeps）。改动文件：UXAI（`export-project.ts` 重写、`index.tsx` handleDownload、`desktop-api.ts` 类型）+ desktop（`ipc.ts` copyDirs、`preload/types.ts` 类型）；不碰 3d-templete/3d-components。三仓 typecheck 0 错（app/desktop tsgo -b）+ oxlint 0 错。**e2e ✅ 通过（2026-08-20）**：生成场景→下载→解压→`npm install`（vendor 解析到、无 missing module）→`npm run dev`→开 `/` 渲染生成场景（非空、带生成 handler 物体）。**踩坑+已修**：首次导出炸 `material.js does not provide an export named 'applySyncProps'`——根因导出复制的是 stale dist（加该 barrel 导出前 build 的；dev 走 vite alias 读 src 故 dev 不炸只炸导出），修=重 build 3d-components dist（lib build 在 dts/api-extractor 阶段非零退出但 JS 在 dts 前已写出=fresh，.d.ts 不影响 vite dev）。规律：改库源后必重 build lib dist 再导出。不 commit（留 review，见 sync-branch-no-auto-commit）。

## 十、已知问题与 gap

1. **数据格式迁移**：3d-templete 引擎已一刀切到分组扁平（Step 2 ✅）。host(UXAI) 侧 scene_objects 平铺 → 分组扁平留 Step 7（改类型会级联断 14 个 agent 文件，随 Step 7 agent 产出自带分组扁平时一起改）。Step 2 完成到 Step 7 前，host 真实 agent 产出（平铺）发给引擎会渲染空白——预览暂用 mock-tree.json。
2. ~~low-poly 兜底缺失~~ **已补（Step 5 ✅）**：low-poly 生成器落在 3d-templete `src/3d/resources/lowPolyFallback.ts`（语义化：风机/树/楼/车/默认方盒，按 prompt 关键词命中；非原设 3d-components——更近资源层消费方）。
3. **库无 primitive 组件**：box / sphere / cone 用原生 THREE，文档需明示。
4. **3d-components 既有 TS 错误**：~~24 个 noUnusedLocals 错误挡 `npm run build`~~ **已修（Step 6 期间）**：8 个文件 TS6133/18047/2345/2532 修复，`vue-tsc -b --force` 0 错误。
5. **包名统一**：~~libraryBridge 用 `@cyc/3d-components`（dev alias）~~ **更正**：libraryBridge 实际 import `@a3d/a3d-components`（库真名，见 `libraryBridge.ts:18-20`），vite.config alias 亦是 `@a3d/a3d-components`（非 @cyc）；@cyc 是早期设想的死名、无任何代码用。Step 10 导出统一用 `@a3d/a3d-components`（vendor package.json 原名，无需改名）。
6. **handler 代码化后卡片 / 选区 / 增量更新接线**：CardHost / CardManager / SelectionService / `handle.update` 走 Embed + createScene3D 路径，handler 要支持这些需在 manager/handler 层接线（CodeScene 砍掉后不涉及）。
7. 老 8-agent JSON 流水线（`create-scene.ts`/`modify-scene-ai.ts`/`merge.ts` 等 14 个平铺 SceneConfig 文件）在 Step 7 后**已成孤儿**——handleSubmit 不再调用它们，改走 `codegen-scene.ts` 3-agent 流。保留不删（Step 8/9 清理）；TriageResult 的 delete/add/modify 字段留空数组供 `modify-scene-ai.ts` 孤儿不崩。
8. **workspace 机制**：~~未落地~~ **已落地（Step 6 ✅ 运行时验证通过）**：模板拷贝 / 全局 workspace 物化（node_modules junction + vite.config 别名重写）/ 版本 code 归档 / 切版本覆盖+重启 dev 均已实现并运行时验证（51857 起 + mock 渲染）。LLM 生成路径 Step 7 起改写 workspace（onCodeVersionReady hook 已 stub）。
9. **adm-zip 的 zip 前提未验证（Step 5 遗留）**：middleware 用 adm-zip 解混元 `QueryHunyuanTo3DProJob` 返回的 `ResultFile3Ds[].Url`（设计阶段资料称是 .zip 内含 .glb），但"返回 zip"前提**未用真实密钥验证**——若实际直接返回 GLB，zip 分支永不执行、adm-zip 即冗余。adm-zip 带 2 个 dev-only high vuln（仅 vite dev middleware 用，不进前端 bundle/生产，输入受信 zip 非用户上传，风险极低）。**用户决定保留现状到验证后**：写 .env.local 真实密钥验证返回格式——若返 GLB 则删 adm-zip+zip 分支（最简）；若返 zip 则保留或换 `node:zlib`（注：zlib 单独不认 ZIP 容器，须配手写 ZIP 容器解析 ~35 行）。`extractGlbFromBuffer` 已用 magic bytes 兼容 GLB/zip 两种。

## 十一、文件清单（按仓库）

**3d-templete（dev_cyc1）**：
- 已有（Step 1，待重定位）：`src/scenes/registry.ts`、`src/scenes/example/build.ts`、`src/views/CodeScene.vue`、`/code-scene` 路由——Step 2 砍 CodeScene/registry，example 改写为 handler 示例
- 框架保留（已有，Step 2 升级）：`src/3d/managers/component/ComponentManager.ts`、`handlers/index.ts`、`handlers/base/*`、`src/3d/components/libraryBridge.ts`
- 待新增（Step 4-5）：`handlers/<type>/`（LLM 生成目标，Step 7 起写 workspace）、ResourceManager 混元生成器 **已新增（Step 5 ✅）**——`src/3d/resources/{lowPolyFallback,hunyuan}.ts` + `handlers/model/model.ts`
- 已新增（Step 3 ✅）：`assets-library/`（`manifest.ts` + `models/example.glb`）
- Step 6 起：LLM 生成目标改为 workspace 工程内（不写母版），母版仅作 template-base 拷贝源

**3d-components（dev_cyc1）**：Step 4 落地——`scripts/gen-component-docs.mjs`（零依赖 HTML 解析器，按 allowlist 解析 10 个 Object3D 组件的 `docs/components/*/index.html`→`docs/components.json`）+ `package.json` 加 `./docs`→`./docs/components.json` 导出 + `files` 加 `docs/components.json` + `gen:component-docs` 脚本。Step 5 ~~加 low-poly helper~~ **无新增**（low-poly helper 落 3d-templete 资源层，非 3d-components）。

**UXAI（dev_cyc1）**：Step 4 已落地 packages/opencode（组件文档工具，非 pages/3d）；Step 7-9 改 pages/3d
- Step 4 ✅（架构修订：源迁 3d-components + 包导出消费，删手写 JSON，砍 overlay）：`packages/opencode/package.json` 加 `@a3d/a3d-components` 依赖（file:link）+ 重写 `3d_components_docs.ts`（`createRequire(import.meta.url).resolve("@a3d/a3d-components/docs")`→readFileSync→JSON.parse 单份 JSON；scanDocIndex/findDoc/formatDoc + dataTypes 段 + 两 Tool.define）+ `registry.ts` 注册（5 处，不变）；删 `src/tool/proto_tool/3d_components/` 10 份手写 JSON（原 Step 4 快照，被包导出取代）；overlay/caveats 砍（构造签名是组件事实已在 JSON；libraryBridge 单参不兼容属 3d-templete 集成后果且 codegen 直构不经它→moot；余属 Step 7 prompt 引导）。tsgo 0+prettier 合规+运行时 require.resolve+数据层验证（10 组件/Grid 全文含 Options+Methods+Examples/InstancedMesh2 位置参数 ctor/大小写不敏感/未命中）PASS。**不 commit 待 review**。
- Step 6：`pages/3d/utils/version-history.ts` 扩 code 维度（codeDir 指针 / 覆盖 workspace / 重启 dev）；新增模板拷贝 + workspace 物化逻辑

## 十二、恢复说明

对话中断后，新会话发一句即可继续：
- 「继续第 4 步」/「现在做第 4 步」→ 已完成（组件文档预处理 + list_3d_components/get_3d_component_doc 工具，仅参考）
- 「继续第 5 步」/「现在做第 5 步」→ 已完成（混元集成 + low-poly 兜底，代码落地+验证；真实混元待密钥，仅参考）
- 「继续第 6 步」/「现在做第 6 步」→ 从模板/工作空间/历史机制开始（已完成，仅参考）
- 「继续第 7 步」/「现在做第 7 步」→ 已完成（3-agent handler 代码生成替换 8-agent JSON，代码落地+tsgo/prettier 0 错+运行时验证通过；5-type 场景生成成功 ~18min，仅参考）；计划文件 `joyful-toasting-valley.md`
- 「继续第 8 步」/「现在做第 8 步」→ ①✅ 已落地+验证（plan 工具改静态注入，预烘 COMPONENT_CATALOG.txt），②③⬜ 待做（合并 triage+plan + runChildSession 流式）；详见「当前进度」Step 8 节
- 「继续第 9 步」/「现在做第 9 步」→ 9a 已代码落地（三仓 typecheck 0 错；e2e 运行时验证待跑：完整性缺 type / tsc 错 / 运行时 console 三失败路径 + 全过 + 重试喂回 priorGateFindings）；9b 截图+VLM 审美评审暂缓（见§六）
- 「继续第 10 步」/「现在做第 10 步」→ 代码已落地（export-project 注入 codeDir 生成代码 + vendor 3d-components + @a3d 名统一 + README；typecheck/lint 0 错）；e2e 待跑（生成场景→下载→解压→`npm install && npm run dev`→开 / 渲染生成场景）
- 「3d codegen 现在到哪了」→ 读本文档「当前进度」节

每步完成后更新本文档「当前进度」+「步骤总览」状态列。
