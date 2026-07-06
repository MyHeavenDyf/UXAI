# 管线流程说明

---

## 管线总图

```
A2UI JSON 数据（API 模式）
      │  或 pages-source/ 目录文件（CLI 模式）
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  RegisterComponents      加载组件映射文件到注册表                   │
│  • 通过 mappingRegistry 静态导入加载映射                          │
│  • 注入 ComponentRegistry                                        │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  ReadPages               读取 A2UI JSON 源数据                    │
│  • API 模式：从 ctx.pagesSourceData（内存）解析                    │
│  • CLI 模式：扫描 pages-source/ 目录，读取各页面的 JSON 文件      │
│  • 输出原始 A2UI 节点数据到 ctx.pagesData                         │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  BuildTrees              建树 + 绑定解析 + 样式转换（三步合一）    │
│  • TreeBuilder.buildTree 构建节点树                                │
│  • BindingResolver 解析 props 中的 path 绑定                      │
│  • TailwindConverter 将 className → LESS/CSS                    │
│  • 一次性写入 ctx.resolvedPages + ctx.styleResults                │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  GenerateComponents      组件代码生成（核心步骤）                  │
│  对每个页面，分 7 阶段：                                         │
│  1. deepResolve 模块节点树（registry.transform + _isLoop 转换）   │
│  2. deepResolve 页面根树（slot 根截断 + _isLoop 转换）            │
│  3. _collectDataFromNode 提取 stateData + componentData           │
│  4. collectStateRefs 收集 state 引用                              │
│  5. 生成 state.js                                                │
│  6. 对每个模块：ImportCollector + JsxSerializer 渲染 +            │
│     StateTransformer 生成 const 声明                              │
│  7. 生成页面主组件 index.jsx                                     │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  GenerateRoutes         生成路由配置                              │
│  • 根据 generatedPages 生成 React Router 路由文件                │
│  • 可配置 prefix、homeRedirect                                    │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  WriteOutput            收集产出文件                              │
│  • 收集模板文件 + 路由 + 样式 + 页面组件到 ctx.outputFiles        │
│  • 不直接写入磁盘，由调用方决定：                                  │
│      - API 模式 → 返回 { files } 数组由调用方自行写入             │
│      - CLI 模式 → 写入 output/ 目录                               │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  GenerateReport         生成报告                                  │
│  • 输出转换统计、组件使用情况等                                    │
│  • API 模式下不写磁盘，仅将报告内容存入 ctx.generationReport      │
│  • CLI 模式下写入 output/generation-report.md                     │
└──────────────────────────────────────────────────────────────────┘
```

> **命名说明**：步骤文件使用纯语义命名（无数字序号前缀），与 `index.ts` 中的 `stepMap` 对应。
> 执行顺序由 `config` 对象中的 `steps` 数组（或 `index.ts` 中的默认数组）控制。

---

## 2. 步骤详述

### 2.1 RegisterComponents — 加载组件映射

**输入**：`config/mappings/index.ts`（通过 mappingRegistry 静态导入）
**输出**：`ctx.registry`（ComponentRegistry 实例，已注入加载的映射定义）

**处理逻辑**：
1. 从 `mappingRegistry` 中根据 `ctx.targetLib` 获取对应组件库的映射表
2. 将映射表注入 `ctx.registry`
3. 映射文件格式见 [COMPONENT-MAPPING-GUIDE.md](./COMPONENT-MAPPING-GUIDE.md)

**设计要点**：
- 通过 `mappingRegistry` 静态 ESM 导入，无运行时 IO，类型安全
- 不再使用运行时动态 `import()` 和文件系统扫描

### 2.2 ReadPages — 读取页面源数据

**输入**（取决于模式）：
- **API 模式**：`ctx.pagesSourceData`（`[{merger, planner}]` 内存数据）
- **CLI 模式**：`pages-source/` 目录下的 A2UI JSON 文件

**输出**：`ctx.pagesData`（解析后的标准页面数据数组）

ReadPages 支持两种数据来源，优先使用 API 注入的内存数据：

```
API 模式（downloadHuiCode() 调用）：
  外部传入 [{mergedA2UI, planner}, ...]
    → ReadPages 检测到 ctx.pagesSourceData 存在
    → PageReader.readFromData(pages) 解析
    → 输出 ctx.pagesData

CLI 模式（node cli.ts）：
  pages-source/{pageName}/
    ├── merger_xxx.json         → { genui_json: { state, rootId, elements } }
    └── planner_create_xxx.json → { layout_planner: { slots } }
    → PageReader.readAll(pagesDir) 读取
    → 输出 ctx.pagesData
```

**API 模式入参格式**：

```ts
[
  {
    merger: {
      genui_json: { state: {...}, rootId: "...", elements: [...] }
      // 或直接是 a2uiDoc: { state, rootId, elements }
    },
    planner: {
      layout_planner: { slots: [...] }
      // 或直接是 { slots: [...] }
    }
  }
]
```

**标准页面数据格式**（两种模式产出一致）：

```
{
  pageName: string,        // 路由名（API 模式使用 rootId 自动生成）
  a2uiDoc: {
    state: object,         // 页面状态定义
    rootId: string,        // 根节点 ID
    elements: Array,       // 节点数组
  },
  splitMeta: Array,        // layout_planner 的 slots 信息
}
```

### 2.3 BuildTrees — 建树 + 绑定解析 + 样式转换（三步合一）

**输入**：`ctx.pagesData`（原始 JSON，含 children ID 引用）
**输出**：`ctx.resolvedPages` + `ctx.styleResults`

**处理逻辑**（对每个页面）：

```
1. TreeBuilder.buildTree(rootId, elements, { splitMeta, moduleRoots })
   → 构建完整节点树，同时通过 slotMap 为 slot 根节点打 _isSlotRoot 标记

2. BindingResolver.resolveNode(node, registry, skipIds, loopCtx, bindings, resolveFn)
   → 递归遍历节点树：
     • 识别 props 中的 path 绑定，打 __binding 标记
       { __binding: true, stateKey, accessPath, pathType, bindMode }
     • 检测循环模式，设置 _isLoop、_loopBinding
     • 设置 loopDepth 控制循环层级
     • 收集 bindings 数组（所有绑定的平铺列表）
     • skipIds 参数跳过已处理的 slot 根节点

3. TailwindConverter.convertPage(resolvedTree, resolvedModules, pageName)
   → 递归遍历树提取 className → tw-to-css → .nodeId_style { ... }
   → 每个模块生成 .less 文件 + 页面骨架样式
```

**状态绑定示例**（绑定解析后的 props）：
```ts
{
  value: {
    __binding: true,
    stateKey: 'name',
    accessPath: 'state.name',
    pathType: 'absolute',
    bindMode: 'readonly',
  }
}
```

**样式产出示例**（每个模块一个 .less 文件）：
```less
// Auto-generated by a2ui-transformer
@import '../../../styles/variables.less';

.nodeId_style {
  color: #333;
  font-size: 14px;
}
.nodeId_style:hover {
  color: #666;
}
```

### 2.4 GenerateComponents — 组件代码生成（核心）

**输入**：`ctx.resolvedPages` + `ctx.styleResults`
**输出**：`ctx.generatedPages`（含生成的代码文件列表）

**处理逻辑**：

#### 2.4.1 节点处理流程（关键路径 — deepResolve）

`GenerateComponents._deepResolve` 对每个节点执行递归解析，按以下分支处理：

```
输入节点
      │
      ├── Slot 根截断（cutSlotRoots=true + _isSlotRoot）:
      │     → 返回 { __nodeType: 'component', tag: ModuleName, selfClosing: true }
      │
      ├── 已是 CodeGenNode（__nodeType: 'component'/'html'）:
      │     │
      │     ├── 递归 children（_deepResolve 每个 child）
      │     ├── 递归 props 中的 __slotNode
      │     └── ★ _isLoop 转换：
      │          检测到 _isLoop === true 且 _loopTemplate 存在：
      │            children = [{
      │              __type: 'loop',
      │              data: _loopBinding,
      │              template: { __type: 'renderFn', params: '(item, idx)', body: resolvedTemplate },
      │            }]
      │            清除 _isLoop / _loopBinding / _loopPath / _loopTemplate
      │     → 返回 CodeGenNode
      │
      ├── 未解析节点（__nodeType: 'unresolved' 或 component 字段）:
      │     ├── 已在 registry 中?
      │     │     ↓ 是
      │     │   声明式字段处理（ComponentRegistry.applySchema）:
      │     │     1. defaults 填充默认值（仅 prop 不存在时）
      │     │     2. propsMap 改名/删除
      │     │     3. valueMap 枚举值转换
      │     │         ↓
      │     │   调用 registry.transform（注入 rawState + resolveNode）:
      │     │     1. 传入 node（含已改名后的 props + 可选 wrapper）
      │     │     2. 输出 { props, children?, _inlineVarProps?, selfClosing?,
      │     │               stateData?, componentData? }
      │     │       ★ 不返回 tag/import，管线使用映射文件的 tag/import
      │     │       ★ 可为 child 附加 wrapper 标记
      │     │         ↓
      │     │   组装 CodeGenNode:
      │     │     { __nodeType: 'component', tag, import, props, children, wrapper?,
      │     │       stateData?, componentData? }
      │     │
      │     ├── 不在 registry 中，小写 tag?
      │     │     ↓ 是（HTML DOM 节点）
      │     │   组装 CodeGenNode:
      │     │     { __nodeType: 'html', tag: component, props, children, wrapper? }
      │     │
      │     └── 不在 registry 中，大写 component?
      │           ↓ 警告并跳过
      │     │
      │     ▼
      │   transform 返回的 children 递归处理:
      │     遍历 children 每一项:
      │       ├─ string               → 文本节点，直接透传
      │       ├─ CodeGenNode 节点      → __nodeType 为 'component'|'html'|'loop'|'renderFn'
      │                                  直接透传（不递归解析）
      │       └─ unresolved 节点       → __nodeType: 'unresolved' 或 component 字段存在
      │                                  递归调用 _deepResolve，走全流程映射
      │                                  注意：child 上的 wrapper 标记保留到解析后的 CodeGenNode
      │
      └── 字符串节点 → 直接透传
      │
      ▼
CodeGenNode（最终消费结构，children 可能含 __type: 'loop' / __type: 'renderFn'）
      │
      ▼
JsxSerializer 渲染:
  1. __type: 'loop'     → 渲染 {(dataVar || []).map(...)}
  2. __type: 'renderFn'  → 渲染 (params) => (bodyJSX)
  3. __nodeType 为 'component'/'html' → 渲染 <tag ...>...</tag>
     a. ImportCollector 收集 import（合并 wrapper.import 同源项）
     b. _inlineVarProps 提取（如果有）
     c. Props 序列化（根据 9 种值类型分派）
     d. wrapper 处理：如果节点有 wrapper，先生成 wrapper 开标签
     e. 渲染节点自身 JSX
     f. 递归渲染 children（含 loop/renderFn 子节点）
     g. 关闭节点自身标签
     h. 如果节点有 wrapper，生成 wrapper 关标签
  4. 输出完整 JSX 字符串
```

**Slot 根节点截断机制**：
- `_deepResolve` 在 `cutSlotRoots=true` 时，遇到 `_isSlotRoot` 节点
  返回 `{ __nodeType: 'component', tag: 'ModuleName', selfClosing: true }`
- 模块实际内容在独立组件文件生成，页面骨架只保留组件标签与 import

#### 2.4.2 节点类型处理分支

| 节点类型 | 判断依据 | 处理方 | 处理方式 |
|----------|----------|--------|----------|
| 未解析组件 | `__nodeType: 'unresolved'` + registry 中有 `component` | _deepResolve | 声明式字段 → transform → 递归 children（仅 unresolved） |
| HTML 元素 | `__nodeType: 'unresolved'` + registry 中无 + `component` 小写 | _deepResolve | 组装 HTML CodeGenNode → value→children 下沉 |
| 未知组件 | `__nodeType: 'unresolved'` + registry 中无 + 大写开头 | _deepResolve | 警告并跳过 |
| 已解析组件 | `__nodeType: 'component'` | _deepResolve → JsxSerializer | 递归 children + _isLoop 转换 → 渲染 |
| 已解析 HTML | `__nodeType: 'html'` | _deepResolve → JsxSerializer | 递归 children → 渲染 + value→children 下沉 |
| 文本节点 | `typeof === 'string'` | _deepResolve 透传 → JsxSerializer | 直接输出 |
| 循环表达式 | `__type: 'loop'` | JsxSerializer / StateTransformer | 渲染 `{(dataVar \|\| []).map(...)}` |
| 渲染函数 | `__type: 'renderFn'` | JsxSerializer / StateTransformer | 渲染 `(params) => (bodyJSX)`，支持抽取 |
| 原始表达式 | `__type: 'jsxExpr'`（旧） | StateTransformer | 向后兼容，渲染 `(params) => (bodyJSX)` |
| 携带 wrapper | 任意节点 + `wrapper` 存在 | JsxSerializer | 渲染时外层自动包裹 `<wrapper.tag>...</wrapper.tag>` |
| Slot 根截断 | `_isSlotRoot` + `cutSlotRoots=true` | _deepResolve | 截断为模块组件引用标签 |
| _isLoop 标记 | CodeGenNode 含 `_isLoop: true` | _deepResolve 阶段2 | 转换为 `{ __type: 'loop', template: { __type: 'renderFn', ... } }` |

**示例：Carousel 子节点处理（wrapper 方案）**

```
Carousel 原始节点:
  { __nodeType: 'unresolved', component: 'Carousel', props: { autoplay: true }, children: [
      { __nodeType: 'unresolved', component: 'img', props: { src: 'a.jpg' } },
      { __nodeType: 'unresolved', component: 'img', props: { src: 'b.jpg' } },
    ] }

执行 Carousel 的映射文件 transform:
  ↓
  返回 { props: { autoplay: true }, children: [
    { __nodeType: 'unresolved', component: 'img', props: { src: 'a.jpg' },
      wrapper: { tag: 'CarouselItem', import: { source: '@nce/eview-react/Carousel', specifier: 'CarouselItem' } }
    },
    { __nodeType: 'unresolved', component: 'img', props: { src: 'b.jpg' },
      wrapper: { tag: 'CarouselItem', import: { source: '@nce/eview-react/Carousel', specifier: 'CarouselItem' } }
    },
  ] }

管线 children 递归处理:
  遍历到 { component: 'img', ...wrapper }
    ↓ __nodeType: 'unresolved', registry 中无 'img'
    ↓ component 小写 → HTML 兜底
    ↓ wrapper 保留
    → 输出 CodeGenNode:
      { __nodeType: 'html', tag: 'img', props: { src: 'a.jpg' },
        wrapper: { tag: 'CarouselItem', import: { ... } } }

JsxSerializer 渲染:
  1. ImportCollector:
       主 import: import Carousel from '@nce/eview-react/Carousel'
       wrapper import (同源合并):
         + { CarouselItem } → import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'
  2. 渲染 Carousel:
     <Carousel autoplay={true}>
       渲染 children[0]:
           检测到 wrapper → <CarouselItem><img src="a.jpg" /></CarouselItem>
       渲染 children[1]:
           检测到 wrapper → <CarouselItem><img src="b.jpg" /></CarouselItem>
     </Carousel>
```

#### 2.4.3 产出的 import 合并规则

生成模块的 import 语句时，ImportCollector 遵循以下规则：

```
1. 每个组件的 import 只出现一次（去重）
2. 同源合并：同一个 source 可以同时有 default 和 named 导出
   → import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'
3. wrapper.import 与节点自身 import 同源时合并
   否则单独生成一条 import
4. 多个命名导出同源时合并
   → import { CarouselItem, CarouselControl } from '@nce/eview-react/Carousel'
```

#### 2.4.4 编译期数据转换（stateData / componentData）

transform 可在返回值中可选地携带 `stateData` 和 `componentData`：

```
transform 返回：
  { props, children, stateData?, componentData? }

stateData      → 纯数据，合并到页面级别的 initialState
                 适用：列定义、分页配置、静态配置等纯 JSON 数据
                 产出文件：state.js → initialState

componentData  → 含 JSX 表达式，路由到所属模块顶部 const 声明
                 适用：render 函数（__type: 'renderFn'）、
                       循环表达式（__type: 'loop'）、
                       动态 JSX 片段
                 产出文件：components/ModuleX.jsx → 模块顶部 const 声明
```

**数据提取流程**（`_collectDataFromNode`，GenerateComponents 阶段3）：

```
对所有已解析的 CodeGenNode 树做深度递归遍历（含以下子节点）：

递归进入：
  • children 数组中的每个 child
  • __type: 'loop' 的 template / template.body
  • __type: 'renderFn' 的 body
  • wrapper 节点
  • props 中的 __slotNode

对每个节点：
  1. 存在 node.stateData     → Object.assign(mergedState, node.stateData)
  2. 存在 node.componentData  → Object.assign(moduleVars, node.componentData)

最终输出：
  state.js：
    export const initialState = {
      ...rawInitialState,     // A2UI 原始 state
      ...nodeA.stateData,     // 所有 stateData 合并
      ...nodeB.stateData,
    };

  ModuleX.jsx（经 StateTransformer.generateComponentVarDecls）：
    // 先声明所有 extract: true 的 renderFn（抽取模式）
    const nameRender = (cellValue, rowData) => (
      <span>{rowData.name}</span>
    );

    // 再声明主变量（引用抽取函数名或含内联 renderFn）
    const tableColumnsJsx = [
      { title: '姓名', render: nameRender },
      { title: '年龄', render: (cellValue) => (<span>{cellValue}</span>) },
    ];

    // JSX 中通过 __varRef 引用
    <Table columns={tableColumnsJsx} />
```

**stateData / componentData 分离原因**：
- stateData 是纯 JSON，可安全放在 state.js 中，不引入 React 依赖
- componentData 含 JSX（`__type: 'renderFn'` / `__type: 'loop'`），必须在 React 组件文件中声明（编译期的 const 不随 state 变化）
- 零 runtime 开销：所有数据转换在编译期完成
- extract: true 的 renderFn 会提前抽取为模块顶部 const 函数声明，主变量引用函数名，避免重复渲染

#### 2.4.5 页面的文件产出

每页面产出以下文件：
```
{pageName}/
├── state.js              ← 页面级 state（含 initialState + stateData 合并结果）
├── components/
│   ├── ModuleA.jsx       ← 模块 A 的组件文件（含 componentData const 声明 + JSX）
│   ├── ModuleB.jsx       ← 模块 B 的组件文件
│   └── ...
└── index.jsx             ← 页面主组件
```

### 2.5 GenerateRoutes — 生成路由

**输入**：`ctx.generatedPages`
**输出**：`ctx.routeResult`（路由文件）

```
生成 router/index.jsx：
- createBrowserRouter
- 每个页面一条路由
- 可配置 homeRedirect
```

### 2.7 WriteOutput — 收集产出文件

**输入**：`ctx.generatedPages` + `ctx.routeResult` + 模板文件  
**输出**：`ctx.outputFiles`（文件列表，每项 `{ path, content }`）

WriteOutput 步骤的职责是"收集产出文件到 ctx.outputFiles 数组"，不直接写入磁盘。
实际写入由调用方决定：

```
WriteOutput 内部流程:
  1. 复制模板文件（index.html, vite.config.js, package.json 等）
  2. 写入路由文件（src/routes/ 下）
  3. 写入页面样式文件（src/styles/ 下）
  4. 写入页面组件文件（src/pages/ 下）
     → 所有文件收集到 ctx.outputFiles

API 模式:
  → index.ts 的 downloadHuiCode() 函数只返回 { files } 数组
  → 调用方自行处理写入（如通过 desktopApi.exportZip）

CLI 模式:
  → cli.ts 将 ctx.outputFiles 写入 outputDir
```

### 2.8 GenerateReport — 生成报告

**输入**：`ctx.*`（各步骤的统计信息）
**输出**：报告文本

**API/CLI 模式差异**：
- CLI 模式：写入 `output/generation-report.md`
- API 模式：仅将报告内容存入 `ctx.generationReport`，供外部按需消费

---

## 3. 数据流上下文

整个管线的状态通过 `PipelineContext` 传递：

```
PipelineContext (ctx)
├── targetLib              // 目标组件库名（默认 'eview-react'）
├── config                 // 配置对象（ESM 模块 config.ts）
├── pagesSourceData        // [API] 外部注入的页面数据
│
├── registry               // ComponentRegistry（映射文件注册表）
│
├── tailwindAdapter        // 样式转换适配器（由 src/tailwind/ 工厂创建）
│
├── pagesData              // [ReadPages] 原始页面 JSON 数据
├── resolvedPages          // [BuildTrees] 建树 + 绑定解析后的页面数据
├── styleResults           // [BuildTrees] 样式转换结果（含 lessFiles, globalLess, pageRules）
├── generatedPages         // [GenerateComponents] 代码生成后的页面数据
├── routeResult            // [GenerateRoutes] 路由生成结果
├── outputFiles            // [WriteOutput] 产出文件列表
├── generationReport       // [GenerateReport] 报告内容（API 模式，CLI 模式直接写磁盘）
│
└── report                 // [GenerateReport] 报告数据
```

---

## 4. 配置文件

`config.ts`（ESM 模块）控制管线行为：

```ts
// config.ts — ESM 模块
export default {
  pagesDir: './pages-source',
  outputDir: './output',
  templateDir: './templates',
  preserveOutput: false,
  steps: [
    'RegisterComponents',
    'ReadPages',
    'BuildTrees',
    'GenerateComponents',
    'GenerateRoutes',
    'WriteOutput',
    'GenerateReport',
  ],
}
```

通过 `downloadHuiCode(input, options)` 的 `options` 参数可覆盖默认配置。

`steps` 数组控制哪些步骤参与执行及执行顺序，可以移除以跳过特定步骤。
步骤名使用**不含编号**的短名称（如 `BuildTrees`），与 `index.ts` 中的 `stepMap` 对应。

> **注意**：
> 1. Tailwind 配置已移至 `dev/tailwind.config.ts`，仅供开发调试使用
> 2. 桌面环境下 Tailwind 转换使用 desktop 适配器，直接引用 desktop 主进程的 `convertTailwindToCSS`