# excode — A2UI → React 代码生成管线

> **excode**（extract-code）是一个 TypeScript 代码生成管线，将 A2UI 设计规范 JSON 转换为以 `eview-react` 为目标组件库的 React 前端代码。

---

## 目录

- [1. 项目简介](#1-项目简介)
- [2. 快速开始](#2-快速开始)
- [3. 整体架构](#3-整体架构)
- [4. 管线步骤详述](#4-管线步骤详述)
  - [4.1 RegisterComponents — 加载组件映射](#41-registercomponents--加载组件映射)
  - [4.2 ReadPages — 读取页面源数据](#42-readpages--读取页面源数据)
  - [4.3 BuildTrees — 建树 / 绑定解析 / 样式转换](#43-buildtrees--建树--绑定解析--样式转换)
  - [4.4 ResolveIcons — 收集并映射 icon 名称](#44-resolveicons--收集并映射-icon-名称)
  - [4.5 GenerateComponents — 组件代码生成](#45-generatecomponents--组件代码生成)
  - [4.6 GenerateRoutes — 生成路由](#46-generateroutes--生成路由)
  - [4.7 WriteOutput — 收集产出文件](#47-writeoutput--收集产出文件)
  - [4.8 GenerateReport — 生成报告](#48-generatereport--生成报告)
- [5. 核心数据流](#5-核心数据流)
- [6. 关键模块](#6-关键模块)
- [7. 配置参考](#7-配置参考)
- [8. 目录结构](#8-目录结构)
- [9. 集成方式](#9-集成方式)

---

## 1. 项目简介

**excode** 将 A2UI（一种设计规范描述格式）的 JSON 文件，通过一系列可配置的步骤（管线），转换为可运行的 React 前端代码。它是 UXAI Desktop 工程中的一部分，通过 Electron preload 桥被调用。

### 项目定位

- **纯库（library）**：不做任何 IO 操作，只做数据转换
- **可嵌入**：可以集成到 Electron 应用（API 模式）或独立调试运行（CLI 模式）
- **声明式映射**：组件转换规则通过映射文件声明，无需修改管线代码即可适配新的组件库

### 两种运行模式

| 模式 | 入口 | 数据来源 | 输出 | 用途 |
|------|------|---------|------|------|
| **API 模式** | `index.ts` 导出 `downloadHuiCode()` | 内存传入 `Array<{ mergedA2UI, planner }>` | 返回 `{ files: OutputFile[] }` | Electron 集成、服务器调用 |
| **CLI 模式** | `cli.ts` | `pages-source/` 目录下的 JSON 文件 | 写入 `output/` 目录 | 本地开发调试 |

---

## 2. 快速开始

### CLI 模式（本地开发调试）

```bash
# 进入 excode 目录
cd packages/desktop/src/excode

# 运行 CLI
node cli.ts

# 指定页面源和输出目录
node cli.ts --pages ./custom-pages --output ./dist
```

CLI 模式从 `pages-source/` 目录读取 A2UI JSON 文件，生成代码后写入 `output/` 目录。

### API 模式（程序调用）

```ts
import { downloadHuiCode } from './index';

const { files } = await downloadHuiCode([
  {
    mergedA2UI: {
      rootId: 'root',
      elements: [/* A2UI 节点数组 */],
      state: { /* 页面状态 */ },
    },
    planner: {
      rootId: 'root',
      elements: [/* planner 节点 */],
      slots: [/* 布局插槽 */],
    },
  },
], {
  targetLib: 'eview-react',
});

// files 可直接传给 desktopApi.exportZip({ defaultName, files })
```

---

## 3. 整体架构

### 管线总图

```
A2UI JSON 数据（API 模式）
      │  或 pages-source/ 目录文件（CLI 模式）
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  RegisterComponents      加载组件映射文件到注册表                  │
│  • 通过 mappingRegistry 静态 ESM 导入加载映射                     │
│  • 注入 ComponentRegistry                                         │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  ReadPages                读取 A2UI JSON 源数据                   │
│  • API 模式：从 ctx.pagesSourceData（内存）解析                    │
│  • CLI 模式：扫描 pages-source/ 目录，读取各页面的 JSON 文件      │
│  • 输出原始 A2UI 节点数据到 ctx.pagesData                         │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  BuildTrees               建树 + 绑定解析 + 样式转换（三步合一）    │
│  • TreeBuilder.buildTree 构建节点树                                │
│  • BindingResolver 解析 props 中的 path 绑定                      │
│  • TailwindConverter 将 className → LESS/CSS                     │
│  • 一次性写入 ctx.resolvedPages + ctx.styleResults                │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  ResolveIcons             收集并映射 icon 名称                    │
│  • 遍历节点树 + state 数据，收集所有 A2UI icon name              │
│  • 调用外部 API 批量查询英文组件名映射                           │
│  • 结果存入 ctx.iconNameMap，供 Icon/Menu 等 mapping 使用        │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  GenerateComponents       组件代码生成（核心步骤）                  │
│  对每个页面，分 7 阶段：                                         │
│  1. 解析模块节点树（_deepResolve）                                 │
│  2. 解析页面根树（slot 根截断）                                    │
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
│  GenerateRoutes          生成路由配置                              │
│  • 根据 generatedPages 生成 React Router 路由文件                │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  WriteOutput              收集产出文件                              │
│  • 收集模板文件 + 路由 + 样式 + 页面组件到 ctx.outputFiles        │
│  • 不直接写入磁盘，由调用方决定：                                  │
│      - API 模式 → 返回 { files } 数组由调用方自行写入             │
│      - CLI 模式 → 写入 output/ 目录                               │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  GenerateReport           生成报告                                  │
│  • 输出转换统计、组件使用情况等                                    │
│  • API 模式下不写磁盘，仅将报告内容存入 ctx.generationReport      │
│  • CLI 模式下写入 output/generation-report.md                     │
└──────────────────────────────────────────────────────────────────┘
```

> 执行顺序由 `config.ts` 中的 `steps` 数组控制，步骤使用纯语义命名（无数字前缀）。

---

## 4. 管线步骤详述

### 4.1 RegisterComponents — 加载组件映射

**输入**：`config/mappings/` 目录下的组件映射文件（通过 mappingRegistry 静态 ESM 导入）
**输出**：`ctx.registry`（ComponentRegistry 实例，已注入加载的映射定义）

**处理逻辑**：
1. 从 `mappingRegistry` 中根据 `ctx.targetLib` 获取对应组件库的映射表
2. 调用 `registry.loadMappings(mappings)`，注册所有组件的声明式字段（propsMap / valueMap / defaults）和 transform 函数
3. 映射文件格式详解见 [docs/COMPONENT-MAPPING-GUIDE.md](./docs/COMPONENT-MAPPING-GUIDE.md)

**设计要点**：
- 通过 `mappingRegistry` 静态 ESM 导入，无运行时 IO，类型安全
- 每个组件映射文件只负责"数据格式转换"，不涉及 JSX 拼接

### 4.2 ReadPages — 读取页面源数据

**输入**（取决于模式）：
- **API 模式**：`ctx.pagesSourceData`（`[{ mergedA2UI, planner }]` 内存数据）
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

**标准页面数据格式**（两种模式产出一致）：
```ts
{
  pageName: string,        // 路由名（API 模式使用 rootId 自动生成）
  a2uiDoc: {
    state: object,         // 页面状态定义
    rootId: string,        // 根节点 ID
    elements: Array,       // 节点数组（children 通过 ID 引用关联）
  },
  splitMeta: Array,        // layout_planner 的 slots 信息
}
```

### 4.3 BuildTrees — 建树 / 绑定解析 / 样式转换

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
     • 收集 bindings 数组（所有绑定的平铺列表）

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
// Auto-generated by excode
@import '../../../styles/variables.less';
.nodeId_style { color: #333; font-size: 14px; }
.nodeId_style:hover { color: #666; }
```

> **注意**：BuildTrees 内部通过 `createTailwindAdapter('desktop')` 自动创建 Tailwind 适配器。若 `config` 中预置了 `tailwindAdapter`，则优先使用预置实例。

### 4.4 ResolveIcons — 收集并映射 icon 名称

**输入**：`ctx.resolvedPages`（节点树 + state 数据）
**输出**：`ctx.iconNameMap`（A2UI name → @nce/icon-plus 组件名映射表）

**处理逻辑**：

在 BuildTrees 之后、GenerateComponents 之前执行，集中收集所有 A2UI icon 名称并调用外部 API 批量映射。

**收集范围**（覆盖 A2UI 中所有可能出现的 icon 名称）：

| 来源 | 场景 | 示例 |
|------|------|------|
| 节点树 | `Icon` 组件的 `props.name` | `{ component: "Icon", props: { name: "globe" } }` |
| 节点树 | 任意节点 `props.icon` 字面量 | `{ component: "Button", props: { icon: "help-circle" } }` |
| 节点树 | `props.items[].icon` 字面量数组 | `{ props: { items: [{ icon: "home" }] } }` |
| 节点树 | `props.items` 是 DataBinding | 从 state 中按 accessPath 取实际数组再收集 |
| 节点树 | 递归 children / slot / loop | 所有子节点 |
| state 数据 | 递归遍历 state 中所有对象/数组的 `icon` 字段 | `state.menuItems[0].icon` |
| 树形嵌套 | `items[].children[].icon` 递归 | 嵌套多层的 menu/tree 结构 |

**API 调用**：

```ts
// 接口协议：GET /api/icons/search?keyword={names}&topK=2
// 返回 Array<{ icons: Array<{ name: string, group?: string[] }> }>
// 优先取 group 包含"系统图标"的 icon name，否则取第一个 icon name
```

- 每批 6 个 name，并发请求所有批次
- 返回结果按 names 顺序一一对应（未匹配项为 null）
- 未映射的 name 使用占位图标 `IconPlusIcPublicTransverseRectangleTemplate`

**设计要点**：
- API 调用集中在编译期单步完成，避免 transform 内同步阻塞
- 一次性批量查询所有 name，减少 API 请求次数
- 占位图标保证未映射 name 仍能生成可运行代码
- state 数据递归收集：保证 DataBinding 引用的树形数据中的 icon 不会遗漏

### 4.5 GenerateComponents — 组件代码生成

**输入**：`ctx.resolvedPages` + `ctx.styleResults`
**输出**：`ctx.generatedPages`（含生成的代码文件列表）

这是管线的核心步骤，对每个页面分 7 阶段执行：

#### 阶段 1：解析模块节点树（_deepResolve）

对每个模块的节点树执行 `_deepResolve`，将 `UnresolvedNode` 通过注册表查找、声明式字段处理、transform 调用，转换为 `CodeGenNode`。transform 可返回 `stateData`（纯数据）和 `componentData`（含 JSX 表达式）。

#### 阶段 2：解析页面根树

对页面根树执行 `_deepResolve`（`cutSlotRoots=true`），遇到 `_isSlotRoot` 的节点截断为模块组件引用标签（`<ModuleName />`），模块实际内容在独立组件文件中渲染。

#### 阶段 3：_collectDataFromNode

递归遍历所有已解析的节点树，提取 `stateData` 和 `componentData`：

- **stateData**：纯 JSON 数据，合并到页面级 `initialState`（产出到 `state.js`）
- **componentData**：含 JSX 表达式（`__type: 'renderFn'` / `__type: 'loop'`），路由到所属模块的 const 声明

`stateData` 支持 `__deleteFields` 特殊字段，可从 `mergedState` 中删除不再需要的 state。

#### 阶段 4：collectStateRefs

收集每个模块和页面根树的 state 引用，区分：
- `readonly` / `loop` binding → 模块级 const 声明（组件函数外部）
- `two-way` binding → 组件函数体内 `useState` 声明

#### 阶段 5：生成 state.js

使用 `StateStrategy.generateStateFile()`，生成页面的数据源文件。

#### 阶段 6：生成模块组件文件

对每个模块：
1. `ImportCollector.collect()` — 遍历节点树收集所有组件 import（含同源合并）
2. `JsxSerializer.renderNode()` — 递归渲染 CodeGenNode 树为 JSX 字符串
3. `StateTransformer.generateComponentVarDecls()` — 生成 componentVars 的 const 声明（含 renderFn 抽取）
4. 组装完整的模块组件文件（`ModuleX.jsx`）

#### 阶段 7：生成页面主文件

组装页面主组件 `index.jsx`，引用所有模块组件。

#### 每页面产出结构

```
{pageName}/
├── state.js              ← 页面级 state（含 initialState + stateData 合并结果）
├── components/
│   ├── ModuleA.jsx       ← 模块 A 的组件文件（含 componentData const 声明 + JSX）
│   ├── ModuleB.jsx       ← 模块 B 的组件文件
│   └── ...
└── index.jsx             ← 页面主组件
```

#### 节点类型处理分支

`_deepResolve` 在整个解析过程中处理以下节点类型：

| 节点类型 | 判断依据 | 处理方式 |
|----------|----------|----------|
| Slot 根截断 | `cutSlotRoots=true` + `_isSlotRoot` | 返回 `{ __nodeType: 'component', tag: ModuleName, selfClosing: true }` |
| 已解析组件 | `__nodeType: 'component'` | 递归 children + _isLoop 转换 |
| 已解析 HTML | `__nodeType: 'html'` | 递归 children + value→children 下沉 |
| 未解析节点 | `__nodeType: 'unresolved'` 或 `component` 字段 | 查 registry → 声明式字段 → transform → 递归 children |
| HTML 兜底 | 未注册组件 + 小写开头 | 组装 HTML CodeGenNode |
| 默认组件兜底 | 未注册组件 + 大写开头 | `@/components/${componentName}` |
| 文本节点 | `typeof === 'string'` | 直接透传 |
| 字符串节点 | 透传 | 直接输出到 children |

### 4.6 GenerateRoutes — 生成路由

**输入**：`ctx.generatedPages`
**输出**：`ctx.routeResult`（路由文件）

生成 `router/index.jsx`（React Router 配置）：
```tsx
import { createBrowserRouter } from 'react-router-dom';
import OrderAdminPage from '../pages/orderAdmin/index';

export default createBrowserRouter([
  { path: '/orderAdmin', element: <OrderAdminPage /> },
  // ...每页面一条路由
]);
```

### 4.7 WriteOutput — 收集产出文件

**输入**：`ctx.generatedPages` + `ctx.routeResult` + 模板文件
**输出**：`ctx.outputFiles`（文件列表，每项 `{ path, content }`）

**关键原则**：此步骤**不直接写入磁盘**，仅将文件列表收集到 `ctx.outputFiles`。写入由调用方决定。

```
WriteOutput 内部流程:
  1. 复制模板文件（index.html, vite.config.js, package.json 等）
  2. 写入路由文件（src/routes/ 下）
  3. 写入页面样式文件（src/styles/ 下）
  4. 写入页面组件文件（src/pages/ 下）
     → 所有文件收集到 ctx.outputFiles

API 模式:
  → downloadHuiCode() 返回 { files } 数组
  → 调用方自行处理（如 desktopApi.exportZip）

CLI 模式:
  → cli.ts 将 ctx.outputFiles 写入 outputDir
```

### 4.8 GenerateReport — 生成报告

**输入**：`ctx.*`（各步骤的统计信息）
**输出**：报告文本

**API/CLI 模式差异**：
- CLI 模式：写入 `output/generation-report.md`
- API 模式：仅将报告内容存入 `ctx.generationReport`，供外部按需消费

---

## 5. 核心数据流

### PipelineContext 数据流转

整个管线的状态通过 `PipelineContext` 传递，各步骤按顺序读写：

```
PipelineContext (ctx)
├── config                 // 配置对象（ESM 模块 config.ts + options 合并）
├── registry               // ComponentRegistry（映射文件注册表）
├── targetLib              // 目标组件库名（默认 'eview-react'）
├── tailwindAdapter        // Tailwind 转换适配器实例（{ convert } 接口）
├── pagesSourceData        // [API] 外部注入的页面数据
│
├── pagesData              // [ReadPages] 原始页面 JSON 数据
├── resolvedPages          // [BuildTrees] 建树 + 绑定解析后的页面数据
├── styleResults           // [BuildTrees] 样式转换结果（含 lessFiles, globalLess, pageRules）
├── iconNameMap            // [ResolveIcons] A2UI icon name → @nce/icon-plus 组件名映射表
├── generatedPages         // [GenerateComponents] 代码生成后的页面数据
├── routeResult            // [GenerateRoutes] 路由生成结果
├── outputFiles            // [WriteOutput] 产出文件列表 [{ path, content }]
└── generationReport       // [GenerateReport] 报告内容（API 模式存入此字段）
```

### 节点类型系统

| `__nodeType` / `__type` | 含义 | 处理方 |
|-------------------------|------|--------|
| `unresolved` | 未解析节点（有 `component` 字段） | 走完整映射流程：声明式字段 → transform → 递归 children |
| `component` | 已解析 UI 组件（有 `tag`/`import`） | JsxSerializer 渲染 |
| `html` | HTML DOM 节点（小写 `tag`） | JsxSerializer 渲染 + value→children 下沉 |
| `string` | 文本节点 | JsxSerializer 直接输出 |
| `__type: 'loop'` | 数据驱动循环 | 渲染 `{(dataVar \|\| []).map(...)}` |
| `__type: 'renderFn'` | 渲染函数表达式 | 支持内联/抽取模式 |
| `__type: 'jsxExpr'` | 旧格式 JSX 表达式（向后兼容） | StateTransformer 兜底处理 |
| `__rawExpr` | 原始 JS 表达式（逃生舱） | 直接输出原文 |

完整节点结构和 Props 类型系统见 [docs/DATA-STRUCTURE.md](./docs/DATA-STRUCTURE.md)。

### 编译期数据转换

`transform` 可返回 `stateData` 和 `componentData`，实现零 runtime 开销的编译期数据转换：

- **stateData**：纯 JSON 数据 → 合并到 `state.js` 的 `initialState`（不含 React 依赖）
- **componentData**：含 JSX 表达式 → 路由到模块组件顶部 const 声明

两者 key 需避免重名，分别输出到各自的目标文件。

---

## 6. 关键模块

### `src/core/`

| 文件 | 职责 |
|------|------|
| `Step.ts` | 步骤基类，所有步骤继承此类 |
| `ComponentRegistry.ts` | 组件注册中心，管理映射文件的注册与查询。提供 `register()`、`loadMappings()`、`transform()`、`applySchema()`、`getBinding()` 等接口 |
| `Icon.ts` | Icon 组件映射，同时导出 `resolveIcon(iconName, iconNameMap, extraProps?)` 和 `PLACEHOLDER_ICON`，用于在 mapping transform 中将 A2UI icon 名称转换为 @nce/icon-plus 组件的 CodeGenNode |
| `stateUtils.ts` | state 工具函数，导出 `resolveBindingValue(rawState, binding)` 用于在 mapping transform 中从原始 state 按绑定路径提取实际数据 |

### `src/codegen/`

| 文件 | 职责 |
|------|------|
| `JsxSerializer.ts` | JSX 渲染引擎，将 CodeGenNode 树渲染为 JSX 字符串 |
| `ImportCollector.ts` | import 收集器，支持同源合并（如 `import Carousel, { CarouselItem } from '...'`） |
| `StateStrategy.ts` | 状态管理策略（生成 `state.js` 和组件中的 state 引用） |
| `StateTransformer.ts` | JSX 表达式变量序列化，处理 `__type: 'renderFn'` / `__type: 'loop'` 的 const 声明生成 |

### `src/parser/`

| 文件 | 职责 |
|------|------|
| `TreeBuilder.ts` | 节点树构建器，将扁平的 elements 数组通过 ID 引用构建为树结构，同时识别 slot 根节点 |

### `src/pipeline/`

| 文件 | 职责 |
|------|------|
| `Pipeline.ts` | 管线调度器，按顺序执行步骤 |
| `PipelineContext.ts` | 管线上下文，保存所有步骤共享的数据 |

### `src/reader/`

| 文件 | 职责 |
|------|------|
| `PageReader.ts` | 页面 JSON 读取器，支持 API 模式（内存数据）和 CLI 模式（文件系统） |

### `src/resolver/`

| 文件 | 职责 |
|------|------|
| `BindingResolver.ts` | 绑定解析器，识别 props 中的 path 绑定标记，检测循环模式 |

### `src/style/`

| 文件 | 职责 |
|------|------|
| `TailwindConverter.ts` | Tailwind → LESS 转换器，递归遍历节点树提取 className 并转换为 LESS 样式 |

### `src/tailwind/`

| 文件 | 职责 |
|------|------|
| `index.ts` | 工厂函数入口，导出 `createTailwindAdapter` |
| `adapter.ts` | 适配器创建，支持 `'local'` 和 `'desktop'` 两种模式 |
| `converters/local.ts` | 本地版，直接 import `dev/tailwind.config.ts` |
| `converters/desktop.ts` | desktop 集成版，调用 desktop 主进程的 `convertTailwindToCSS` |

---

## 7. 配置参考

### config.ts（ESM 模块）

```ts
export interface TransformerConfig {
  pagesDir: string;         // CLI 模式页面源目录（默认 './pages-source'）
  outputDir: string;        // CLI 模式输出目录（默认 './output'，API 模式被忽略）
  templateDir: string;      // 模板路径（默认 './templates'，API 模式自动转绝对路径）
  preserveOutput: boolean;  // 保留输出目录（暂未使用）
  steps: string[];          // 执行步骤顺序
  targetLib?: string;       // 目标组件库（默认 'eview-react'）
  tailwindAdapter?: any;    // 外部注入的 Tailwind 适配器
}
```

**默认配置**：
```ts
const defaultConfig = {
  pagesDir: './pages-source',
  outputDir: './output',
  templateDir: './templates',
  preserveOutput: false,
  steps: ['RegisterComponents','ReadPages','BuildTrees','GenerateComponents','GenerateRoutes','WriteOutput','GenerateReport'],
};
```

### config.json（CLI 兼容）

CLI 模式支持通过 `--config` 指定 JSON 配置文件，也支持读取默认的 `config.json`。当前 `config.json` 已保留为向后兼容。

### Options 覆盖

`downloadHuiCode(input, options)` 的 `options` 参数可覆盖默认配置中的任意字段。`downloadHuiCode` 内部会删除 `options.outputDir`，确保 API 模式下绝不会写入磁盘。

---

## 8. 目录结构

```
excode/
├── index.ts                   ← API 入口（导出 downloadHuiCode()）
├── cli.ts                     ← CLI 调试入口
├── config.ts                  ← 管线默认配置（ESM 模块）
├── config.json                ← 保留向后兼容（CLI 模式可选使用）
├── AGENTS.md                  ← Agent 指南（供 LLM 阅读）
├── README.md                  ← 本文档（工程介绍）
├── dev/
│   └── tailwind.config.ts     ← 开发调试用 Tailwind 配置（local adapter 直接 import）
├── config/
│   └── mappings/
│       ├── index.ts           ← mappingRegistry（组件映射统一注册表）
│       └── eview-react/       ← eview-react 组件映射文件目录
│           ├── index.ts       ← 入口，手动 import 每个组件映射
│           ├── Tag.ts, Table.ts, Button.ts, Carousel.ts ...
├── pages-source/              ← A2UI JSON 源文件（仅 CLI 模式用）
├── output/                    ← 生成结果（仅 CLI 模式用）
├── src/
│   ├── core/
│   │   ├── Step.ts
│   │   ├── ComponentRegistry.ts
│   │   └── stateUtils.ts
│   ├── codegen/
│   │   ├── JsxSerializer.ts
│   │   ├── ImportCollector.ts
│   │   ├── StateStrategy.ts
│   │   └── StateTransformer.ts
│   ├── parser/
│   │   └── TreeBuilder.ts
│   ├── pipeline/
│   │   ├── Pipeline.ts
│   │   └── PipelineContext.ts
│   ├── reader/
│   │   └── PageReader.ts
│   ├── resolver/
│   │   └── BindingResolver.ts
│   ├── steps/
│   │   ├── RegisterComponents.ts
│   │   ├── ReadPages.ts
│   │   ├── BuildTrees.ts
│   │   ├── ResolveIcons.ts           ← icon 名称收集与 API 映射
│   │   ├── GenerateComponents.ts
│   │   ├── GenerateRoutes.ts
│   │   ├── WriteOutput.ts
│   │   └── GenerateReport.ts
│   ├── style/
│   │   └── TailwindConverter.ts
│   └── tailwind/
│       ├── index.ts
│       ├── adapter.ts
│       └── converters/
│           ├── local.ts
│           └── desktop.ts
├── templates/                 ← 输出项目模板
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
└── docs/
    ├── COMPONENT-MAPPING-GUIDE.md   ← 组件映射编写规范
    └── DATA-STRUCTURE.md            ← 节点结构与 Props 类型系统
```

---

## 9. 集成方式

### Electron 集成

excode 已作为 `packages/desktop/src/excode/` 集成到 UXAI Desktop 工程。调用链路如下：

```
Electron preload
  → ipc.ts
    → downloadHuiCode(input, { targetLib: 'eview-react' })
      → { files: [{ path, content }, ...] }
        → desktopApi.exportZip({ defaultName, files })
```

### 独立集成

任何 Node.js 环境均可独立调用：

```ts
const { files } = await import('./path/to/excode/index').then(
  m => m.downloadHuiCode(input, options)
);
```

### 模板路径说明

API 模式下，`templateDir` 自动处理：
1. 先尝试 `config.templateDir` 的相对路径（相对于 `index.ts` 所在目录）
2. 如果 `./templates` 不存在（electron-vite 构建后），回退到 `../../src/excode/templates`
3. 确保构建后版本也能找到模板文件

---

> 相关文档：
> - [AGENTS.md](./AGENTS.md) — LLM/Agent 阅读的精简版本
> - [docs/COMPONENT-MAPPING-GUIDE.md](./docs/COMPONENT-MAPPING-GUIDE.md) — 组件映射编写规范
> - [docs/DATA-STRUCTURE.md](./docs/DATA-STRUCTURE.md) — 数据结构完整定义