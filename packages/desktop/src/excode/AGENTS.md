# AGENTS.md — excode 管线 Agent 指南

> 本文档面向 LLM/Agent，提供 excode 工程的精简结构化概览。
> 详细的人类可读介绍请看同目录下的 [README.md](./README.md)。
> 组件映射编写规范见 [docs/COMPONENT-MAPPING-GUIDE.md](./docs/COMPONENT-MAPPING-GUIDE.md)。
> 节点结构与 Props 类型系统见 [docs/DATA-STRUCTURE.md](./docs/DATA-STRUCTURE.md)。

---

## 1. 项目本质

**excode** 是一个 TypeScript 管线，将 A2UI 设计规范 JSON 转换为 React 前端代码（目标库：`eview-react`）。

- **位置**：`packages/desktop/src/excode/`，集成于 UXAI Desktop 工程
- **性质**：纯库（library），入口 `index.ts` 导出 `downloadHuiCode()`，不做任何 IO
- **写入由调用方决定**：
  - API 模式 → 返回 `{ files }` 数组，由 Electron 调用方自行处理（如 `desktopApi.exportZip`）
  - CLI 模式 → `cli.ts` 将 `files` 写入 `output/` 目录

---

## 2. 两种运行模式

| 模式 | 入口 | 数据源 | 输出 |
|------|------|--------|------|
| **API** | `index.ts` `downloadHuiCode()` | 内存 `Array<{ mergedA2UI, planner }>` | 返回 `{ files: OutputFile[] }` |
| **CLI** | `cli.ts` | `pages-source/{pageName}/*.json` 文件 | 写入 `output/` 目录 |

API 入参格式：

```ts
type HuiCodeInput = {
  mergedA2UI: { rootId, elements, state }   // A2UI 页面描述
  planner:    { rootId, elements, slots }    // 布局规划
}

await downloadHuiCode(Array<HuiCodeInput>, options?)
// → { files: [{ path, content }, ...] }
```

`options` 可覆盖 `config.ts` 中的字段，常用 `targetLib`（默认 `'eview-react'`）。

---

## 3. 8 步管线总览

```
RegisterComponents → ReadPages → BuildTrees → ResolveIcons → GenerateComponents → GenerateRoutes → WriteOutput → GenerateReport
```

| 步骤 | 输入 | 输出 | 职责 |
|------|------|------|------|
| RegisterComponents | mappingRegistry 静态导入 | `ctx.registry` | 加载组件映射到 ComponentRegistry |
| ReadPages | `ctx.pagesSourceData` 或文件系统 | `ctx.pagesData` | 读取 A2UI JSON（双数据源） |
| BuildTrees | `ctx.pagesData` | `ctx.resolvedPages` + `ctx.styleResults` | 建树 + 绑定解析 + 样式转换（三步合一） |
| ResolveIcons | `ctx.resolvedPages` + `ctx.pagesData` | `ctx.iconNameMap` | 收集页面中所有 icon 名称，调用 API 获取 @hui/icon-plus 映射关系 |
| GenerateComponents | `ctx.resolvedPages` + `ctx.styleResults` + `ctx.iconNameMap` | `ctx.generatedPages` | 7 阶段代码生成（核心） |
| GenerateRoutes | `ctx.generatedPages` | `ctx.routeResult` | 生成 React Router 路由 |
| WriteOutput | 各步骤产出 | `ctx.outputFiles` | 仅收集文件列表，不写磁盘 |
| GenerateReport | 各步骤统计 | `ctx.generationReport` | API 模式存内存，CLI 模式写磁盘 |

执行顺序由 `config.steps` 数组控制；步骤名使用纯语义命名（无数字前缀）。

---

## 4. 文件结构

```
excode/
├── index.ts                   ← API 入口（导出 downloadHuiCode）
├── cli.ts                     ← CLI 调试入口
├── config.ts                  ← 默认配置（ESM 模块）
├── config.json                ← CLI 兼容配置（可由 --config 覆盖）
├── AGENTS.md                  ← 本文件（Agent 指南）
├── README.md                  ← 人类可读工程介绍
├── dev/
│   └── tailwind.config.ts     ← 开发调试用 Tailwind 配置（local adapter 直接 import）
├── config/
│   └── mappings/
│       ├── index.ts           ← mappingRegistry（组件映射统一注册表）
│       └── eview-react/       ← eview-react 组件映射文件目录
│           ├── index.ts       ← 入口，手动 import 每个组件映射
│           ├── Tag.ts
│           ├── Table.ts
│           └── ...
├── pages-source/              ← A2UI JSON 源文件（CLI 模式用）
├── output/                    ← 生成结果（CLI 模式用）
├── src/
│   ├── core/
│   │   ├── Step.ts            ← 步骤基类
│   │   ├── ComponentRegistry.ts ← 组件注册表（映射解析引擎）
│   │   └── stateUtils.ts      ← state 工具函数（resolveBindingValue）
│   ├── codegen/
│   │   ├── JsxSerializer.ts   ← JSX 渲染引擎
│   │   ├── ImportCollector.ts ← import 收集器（同源合并，支持 named import）
│   │   ├── StateStrategy.ts   ← 状态策略（state.js / hooks）
│   │   └── StateTransformer.ts ← JSX 表达式变量序列化
│   ├── parser/
│   │   └── TreeBuilder.ts     ← 节点树构建器
│   ├── pipeline/
│   │   ├── Pipeline.ts        ← 管线调度器
│   │   └── PipelineContext.ts ← 管线上下文
│   ├── reader/
│   │   └── PageReader.ts      ← 页面 JSON 读取（文件 + 内存）
│   ├── resolver/
│   │   └── BindingResolver.ts ← 绑定解析器（path → __binding）
│   ├── steps/
│   │   ├── RegisterComponents.ts
│   │   ├── ReadPages.ts
│   │   ├── BuildTrees.ts      ← 三步合并：建树 + 绑定 + 样式
│   │   ├── ResolveIcons.ts    ← icon 名称收集与 API 映射
│   │   ├── GenerateComponents.ts ← 代码生成（核心）
│   │   ├── GenerateRoutes.ts
│   │   ├── WriteOutput.ts
│   │   └── GenerateReport.ts
│   ├── style/
│   │   └── TailwindConverter.ts ← Tailwind → LESS 转换器
│   └── tailwind/
│       ├── index.ts           ← 工厂函数入口
│       ├── adapter.ts         ← local / desktop 适配器创建
│       └── converters/        ← local.ts / desktop.ts 实现
├── templates/                 ← 输出项目模板（index.html、vite.config、package.json）
└── docs/
    ├── COMPONENT-MAPPING-GUIDE.md ← 组件映射编写规范
    └── DATA-STRUCTURE.md      ← 节点结构与 Props 类型系统
```

---

## 5. API 入口

### `downloadHuiCode(input, options?)`

```ts
import { downloadHuiCode } from './index';

const { files } = await downloadHuiCode(
  [{ mergedA2UI: { rootId, elements, state }, planner: { rootId, elements, slots } }],
  { targetLib: 'eview-react' }
);
// files: [{ path: 'src/pages/orderAdmin/index.jsx', content: '...' }, ...]
```

**关键行为**：
- 校验 input 为非空数组
- 合并默认配置（`config.ts`）与 `options`
- 自动将 `templateDir` 转为绝对路径，构建后回退到 `../../src/excode/templates`
- 删除 `options.outputDir`，**绝不在此函数内写磁盘**
- 返回 `{ files: ctx.outputFiles }`

---

## 6. 关键设计模式

### 6.1 步骤模式（Step Pattern）

每个步骤继承 `Step` 基类，实现 `async execute(ctx)`，从 `ctx` 读输入、写输出：

```ts
class MyStep extends Step {
  async execute(ctx: PipelineContext) {
    const input = ctx.someData;
    ctx.someResult = transform(input);
  }
}
```

`Pipeline.run()` 按顺序调用各步骤的 `execute`。

### 6.2 双数据源（ReadPages）

- **API 模式**：`PipelineContext` 构造函数第三参传入 `pagesSourceData`，ReadPages 调用 `PageReader.readFromData`
- **CLI 模式**：`ctx.pagesSourceData` 为 null，ReadPages 调用 `PageReader.readAll(pagesDir)`

两种模式输出统一的 `ctx.pagesData`，下游步骤无感知。

### 6.3 WriteOutput 收集模式

`WriteOutput` **不直接写磁盘**，将所有产出文件收集到 `ctx.outputFiles`：

```ts
ctx.outputFiles = [
  { path: 'index.html', content: '<!DOCTYPE html>...' },
  { path: 'src/pages/orderAdmin/index.jsx', content: '...' },
  { path: 'src/styles/orderAdmin.less', content: '...' },
];
```

调用方决定如何处理：
- API 模式 → `downloadHuiCode` 直接返回 `{ files }`
- CLI 模式 → `cli.ts` 遍历写入 `outputDir`

### 6.4 节点类型系统

通过 `__nodeType` 显式标识：

| `__nodeType` / `__type` | 含义 | 处理方 |
|---|---|---|
| `unresolved` | 未解析节点（有 `component` 字段） | 走完整映射流程：声明式字段 → transform → 递归 children |
| `component` | 已解析组件（有 `tag`/`import`） | JsxSerializer 渲染 |
| `html` | HTML DOM 节点（小写 `tag`） | JsxSerializer 渲染 + value→children 下沉 |
| `string` | 文本节点 | JsxSerializer 直接输出 |
| `__type: 'loop'` | 数据驱动循环 | 渲染 `{(dataVar \|\| []).map(...)}` |
| `__type: 'renderFn'` | 渲染函数表达式 | 支持内联 / 抽取（`extract: true`） |
| `__type: 'jsxExpr'` | 旧格式 JSX 表达式（向后兼容） | StateTransformer 兜底处理 |
| `__rawExpr` | 原始 JS 表达式（逃生舱） | 直接输出原文 |

详细定义见 [docs/DATA-STRUCTURE.md](./docs/DATA-STRUCTURE.md)。

### 6.5 transform 函数契约

```ts
transform(node, context) → {
  props?, children?, _inlineVarProps?, selfClosing?,
  stateData?, componentData?, wrapper?
}

// context = { rawState, resolveNode, iconNameMap }
//   rawState    — A2UI 原始 state，用于编译期读取实际数据
//   resolveNode — _deepResolve 自身，可手动递归解析任意 A2UI 节点
//   iconNameMap — ResolveIcons 步骤产出的 icon 名称映射表
//                 Record<string, string>，如 { 'home': 'IconPlusIcIctHome' }
//
// stateData      → 纯数据，合并到页面 initialState（state.js）
// componentData  → 含 JSX，路由到所属模块顶部 const 声明（ModuleX.jsx）
//
// 不返回 tag/import，管线使用映射文件顶层导出的 tag/import
```

### 6.6 节点树遍历模式

| 场景 | 位置 | 方法 |
|------|------|------|
| 构建树 | `TreeBuilder.buildTree` | ID 引用解析 + slotMap 打标 |
| 绑定解析 | `BindingResolver.resolveNode` | 递归前序 + path 绑定识别 + 循环标记 |
| 样式收集 | `TailwindConverter.convertPage` | 递归前序 + className 提取 |
| 节点解析 | `GenerateComponents._deepResolve` | 分支处理（slot 截断 / 已解析 / 未解析 / 字符串），注入 iconNameMap |
| icon 收集 | `ResolveIcons._collectIconNames` | 递归前序 + state 递归 + DataBinding 解析 + API 调用 |
| 代码渲染 | `JsxSerializer.renderNode` | 递归后序 + JSX 字符串构建 |
| 数据提取 | `GenerateComponents._collectDataFromNode` | 递归遍历 + stateData/componentData 提取 |

---

## 7. 共享工具函数

### 7.1 `stateUtils` — state 工具函数

`src/core/stateUtils.ts` 导出 **`resolveBindingValue(rawState, binding)`**：

```ts
import { resolveBindingValue } from '../../src/core/stateUtils';

transform(node, { rawState }) {
  const items = resolveBindingValue(rawState, node.props.items);
  // 如 items 是 { __binding: true, accessPath: 'state.tableData' }
  // 将返回 rawState.tableData 的实际值（数组 / 对象 / 原始值）
  // 非 binding 值原样返回
}
```

用途：在 mapping transform 编译期，从原始 state 中按绑定路径取实际数据，用于生成静态 `stateData` / `componentData`。

### 7.2 `Icon.ts` — icon 工具函数

`config/mappings/eview-react/Icon.ts` 导出 **`resolveIcon(iconName, iconNameMap, extraProps?)`** 和 **`PLACEHOLDER_ICON`**：

```ts
import { resolveIcon, PLACEHOLDER_ICON } from '../../../config/mappings/eview-react/Icon';

transform(node, { iconNameMap }) {
  const iconNode = resolveIcon('home', iconNameMap, { color: '#333' });
  // 返回 CodeGenNode:
  // { __nodeType: 'component',
  //   tag: 'IconPlusIcIctHome',
  //   import: '@hui/icon-plus',
  //   importMode: 'named',
  //   props: { shape: 'outline', color: '#333' },
  //   children: null,
  //   selfClosing: true }
}
```

用途：在 mapping transform 中将 A2UI icon 名称转换为 @hui/icon-plus 组件的 CodeGenNode。未找到映射时返回 PLACEHOLDER_ICON 兜底。

---

## 8. PipelineContext 字段

```
PipelineContext (ctx)
├── config              配置对象（默认 config.ts + options 合并）
├── registry            ComponentRegistry 实例
├── targetLib           目标组件库（默认 'eview-react'）
├── tailwindAdapter     样式转换适配器（{ convert } 接口）
├── pagesSourceData     [API] 外部注入的页面数据
│
├── pagesData           [ReadPages] 原始页面 JSON
├── resolvedPages       [BuildTrees] 建树 + 绑定解析后的页面
├── styleResults        [BuildTrees] 样式转换结果（lessFiles, globalLess, pageRules）
├── iconNameMap         [ResolveIcons] icon 名称映射表（A2UI名 → @hui/icon-plus 组件名）
├── generatedPages      [GenerateComponents] 代码生成后的页面
├── routeResult         [GenerateRoutes] 路由文件
├── outputFiles         [WriteOutput] 产出文件列表 [{ path, content }]
└── generationReport    [GenerateReport] 报告内容（API 模式存此字段）
```

`tailwindAdapter`：若 `config.tailwindAdapter` 未传入，`BuildTrees` 自动通过 `createTailwindAdapter('desktop')` 创建。

`iconNameMap`：由 `ResolveIcons` 步骤填充，`GenerateComponents` 在 `_deepResolve` 时注入到 transform context 的 `iconNameMap` 字段。

---

## 9. 配置参考

```ts
// config.ts（ESM 模块）
export interface TransformerConfig {
  pagesDir: string;         // CLI 模式页面源目录
  outputDir: string;        // CLI 模式输出目录（API 模式被忽略）
  templateDir: string;      // 模板路径（API 模式自动转绝对路径，构建后回退）
  preserveOutput: boolean;  // 保留输出目录（暂未使用）
  steps: string[];          // 执行步骤顺序
  targetLib?: string;       // 目标组件库（默认 'eview-react'）
  tailwindAdapter?: any;    // 外部注入的 Tailwind 适配器
}

const defaultConfig = {
  pagesDir: './pages-source',
  outputDir: './output',
  templateDir: './templates',
  preserveOutput: false,
const defaultConfig = {
  pagesDir: './pages-source',
  outputDir: './output',
  templateDir: './templates',
  preserveOutput: false,
  steps: ['RegisterComponents','ReadPages','BuildTrees','ResolveIcons','GenerateComponents','GenerateRoutes','WriteOutput','GenerateReport'],
};
```

`options` 覆盖默认配置；`downloadHuiCode` 会删除 `options.outputDir`，确保 API 不写磁盘。

---

## 10. 关键行为细节（Agent 注意）

1. **transform 不会自动递归 children**：transform 返回的 children 中，仅 `__nodeType: 'unresolved'` 的子节点会被管线递归映射；已 resolve 的（component/html/loop/renderFn）直接透传。需要手动递归可调用 `context.resolveNode(childNode)`。
2. **Transform 兜底逻辑**：未注册的组件名以小写开头 → HTML 兜底；大写开头 → 默认 A2UI 组件兜底（`@/components/${componentName}`）。
3. **stateData 支持 `__deleteFields`**：`transform` 可在 `stateData` 中设置 `__deleteFields: ['key.path']`，从 `mergedState` 中删除指定字段（支持嵌套路径），用于清理不再使用的 state 字段。
4. **Wrapper import 同源合并**：`wrapper.import.source` 与节点自身 `import` 一致时，ImportCollector 合并到同一语句：`import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'`。
5. **`_isLoop` 转换**：`BuildTrees` 在绑定解析阶段设置 `_isLoop` / `_loopBinding` / `_loopTemplate`；`GenerateComponents._deepResolve` 阶段2自动转换为 `__type: 'loop'` 后清除标记。
6. **Slot 根截断**：`_deepResolve` 在 `cutSlotRoots=true` 时遇到 `_isSlotRoot` 截断为模块组件引用（`<ModuleName />`），模块实际内容由独立组件文件渲染。
7. **reactFn 抽取模式**：`__type: 'renderFn'` + `extract: true` + `refName` → 模块顶部 `const refName = (params) => (bodyJSX)`，主变量引用函数名。内联模式直接渲染箭头函数。
8. **零 runtime 开销**：所有数据转换在编译期完成，`state.js` 永远不出现 JSX 代码，JSX 中的 const 声明也不依赖运行时 state。
9. **Icon 处理流程**：
   - `ResolveIcons` 步骤从节点树（`Icon.props.name`、`*.props.icon`、`items[].icon`、`children[].icon`）+ state 数据 + DataBinding 中收集所有 icon 名称
   - 调用 `GET /api/icons/search?keyword={names}&topK=2`（batch=6，并发请求）获取映射
   - 结果存入 `ctx.iconNameMap`，`GenerateComponents` 注入到 transform context 的 `iconNameMap` 字段
   - 映射文件通过 `resolveIcon(iconName, iconNameMap)` 将 A2UI icon 名称转换为 CodeGenNode
   - `resolveIcon` 返回的 CodeGenNode 带 `importMode: 'named'`，ImportCollector 生成 `import { IconName } from '@hui/icon-plus'`
10. **Named import 支持**：`importMode: 'named'` 字段控制 ImportCollector 使用命名导入语法。多个同源 named import 自动合并为同一条 import 语句。

---

## 11. 开发注意事项

1. **所有 TS 文件使用 ESM**（`import`/`export`），`package.json` 含 `"type": "module"`
2. **步骤纯语义命名**（无数字前缀），顺序由 `config.steps` 控制
3. **样式文件采用 LESS**，通过 `@import` 引用全局变量
4. 新增组件映射 → 在 `config/mappings/eview-react/` 创建 `.ts` 文件，在 `config/mappings/index.ts` 注册
5. **API 模式**调用 `index.ts` 的 `downloadHuiCode()`；**CLI 模式**执行 `node cli.ts` 或 `npm run dev`
6. **WriteOutput** 仅收集文件列表，不写磁盘；写入由调用方统一处理
7. **Tailwind 配置**统一在 `dev/tailwind.config.ts`，管线不感知；适配器内部自行加载
8. **GenerateReport** 在 API 模式下不写磁盘，仅将报告内容存入 `ctx.generationReport`
9. **cherrio / tw-to-css** 等依赖只在 `tailwind/converters/` 内部使用，管线其他部分不直接 import
10. **Icon 映射**：新增含 icon 属性的组件映射时，在 transform 中调用 `resolveIcon()` 处理 icon 字段；Icon 组件本身使用 `resolveIcon(props.name, iconNameMap)` 生成 CodeGenNode

---

## 12. 相关文档

| 文档 | 用途 |
|------|------|
| [README.md](./README.md) | 给人看的工程详细介绍 |
| [docs/COMPONENT-MAPPING-GUIDE.md](./docs/COMPONENT-MAPPING-GUIDE.md) | 组件映射文件编写规范（含 Icon 处理章节） |
| [docs/DATA-STRUCTURE.md](./docs/DATA-STRUCTURE.md) | 节点结构与 Props 类型系统完整定义（含 importMode 字段） |
| [docs/agent.md](./docs/agent.md) | Agent 辅助文档 |