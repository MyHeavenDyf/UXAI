# Agent Guide — A2UI → React 代码生成管线

> 本文档供 LLM/Agent 阅读，理解项目架构和代码生成规范。

---

## 1. 项目简介

**excode** 是一个 TypeScript 管线，将 A2UI 设计规范 JSON 文件转换为 React 前端代码（目标库：eview-react）。

**两种运行模式**：
- **CLI 模式**：从 `pages-source/` 目录读取 JSON 文件，写入 `output/` 目录（开发/调试用）
- **API 模式**：从内存接收 `[{mergedA2UI, planner}]` 数据，返回 `{ files }` 文件列表（Electron 集成用）

**项目性质**：纯库（library），入口 `index.ts` 导出 `downloadHuiCode()` 函数，不做任何 IO。写入磁盘由调用方负责（如 `cli.ts` 或 Electron desktop 中的 `desktopApi.exportZip`）。

**集成环境**：现已作为 `packages/desktop/src/excode/` 集成到 UXAI Desktop 工程中，Electron 通过预加载桥调用 `downloadHuiCode()` 获取文件列表，再由 `exportZip` 压缩导出。

---

## 2. 管线总览（7 步）

```
A2UI JSON 数据（API 模式）
      │  或 pages-source/ 目录文件（CLI 模式）
      ▼
RegisterComponents    — 通过 mappingRegistry 静态导入加载组件映射
ReadPages            — 读取 A2UI JSON 源数据（API 模式从内存、CLI 模式从文件系统）
BuildTrees           — 构建节点树 + 绑定解析 + 样式转换（三步合一）
GenerateComponents   — 组件代码生成（核心步骤）
GenerateRoutes       — 生成路由配置
WriteOutput          — 收集产出文件到 ctx.outputFiles（不直接写入磁盘）
GenerateReport       — 生成报告（API 模式仅存内存，CLI 模式写磁盘）
```

### 文件结构

```
excode/
├── index.ts                   ← 管线 / API 入口（导出 downloadHuiCode()）
├── cli.ts                     ← CLI 调试入口（独立于 API 入口）
├── config.ts                  ← 管线默认配置（ESM 模块）
├── config.json                ← 保留向后兼容
├── dev/
│   └── tailwind.config.ts     ← 开发调试用的 Tailwind 配置（local adapter 直接 import）
├── config/
│   └── mappings/
│       └── index.ts           ← mappingRegistry — 组件映射统一注册表
│       └── eview-react/       ← eview-react 组件映射文件目录
│           └── index.ts       ← 入口，手动 import 每个组件映射
│           └── Table.ts
│           └── ...
├── pages-source/              ← A2UI JSON 源文件（仅 CLI 模式用）
├── output/                    ← 生成结果（仅 CLI 模式用）
├── src/
│   ├── core/
│   │   ├── Step.ts            ← 步骤基类
│   │   └── ComponentRegistry.ts ← 组件注册表（映射解析引擎）
│   ├── codegen/
│   │   ├── JsxSerializer.ts    ← 核心 JSX 渲染引擎
│   │   ├── ImportCollector.ts  ← 导入声明收集器
│   │   ├── StateStrategy.ts    ← 状态管理策略（state.js / hooks）
│   │   └── StateTransformer.ts ← JSX 表达式变量序列化
│   ├── parser/
│   │   └── TreeBuilder.ts     ← 节点树构建器
│   ├── pipeline/
│   │   ├── Pipeline.ts        ← 管线调度器
│   │   └── PipelineContext.ts ← 管线上下文
│   ├── reader/
│   │   └── PageReader.ts      ← 页面 JSON 读取器（支持文件 + 内存）
│   ├── resolver/
│   │   └── BindingResolver.ts ← 绑定解析器（path → __binding）
│   ├── steps/
│   │   ├── RegisterComponents.ts  ← 使用 mappingRegistry 加载映射
│   │   ├── ReadPages.ts
│   │   ├── BuildTrees.ts
│   │   ├── GenerateComponents.ts  ← 组件代码生成（核心）
│   │   ├── GenerateRoutes.ts
│   │   ├── WriteOutput.ts
│   │   └── GenerateReport.ts      ← API 模式不写磁盘
│   ├── style/
│   │   └── TailwindConverter.ts ← Tailwind → LESS 转换器
│   └── tailwind/
│       ├── index.ts            ← 工厂函数入口
│       ├── adapter.ts          ← 适配器创建（local / desktop）
│       └── converters/
│           ├── local.ts        ← 本地版：直接 import dev/tailwind.config.ts
│           └── desktop.ts      ← desktop 集成版：调用 desktop 主进程 convertTailwindToCSS
└── templates/                 ← 输出项目模板
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
```

**Desktop 集成路径**：`packages/desktop/src/excode/` ← 本目录
**Electron preload 调用**：`packages/desktop/src/main/ipc.ts` → `downloadHuiCode()`

---

## 3. API 入口说明

### index.ts — 纯 API 入口

```ts
// index.ts 只导出 downloadHuiCode()，不做任何 IO
// 配置通过 ESM 导入 config.ts
import defaultConfig from './config.js';

export async function downloadHuiCode(input, options = {}) {
  // 合并选项：options 覆盖 defaultConfig
  const config = { ...defaultConfig, ...options };
  // 执行管线
  const ctx = new PipelineContext(config, registry, input, mode);
  await runPipeline(ctx, DEFAULT_STEPS);
  return { files: ctx.outputFiles };
}
```

### downloadHuiCode() 函数

```ts
import { downloadHuiCode } from './index.js';

// 用法：
const { files } = await downloadHuiCode([{ mergedA2UI, planner }], {
  targetLib: 'eview-react',
});
// files: [{ path: 'src/pages/orderAdmin/index.jsx', content: '...' }, ...]
// 调用方自行决定如何写入
```

**入参格式**：

```ts
[
  {
    mergedA2UI: {
      rootId: "...",
      elements: [...],
      state: {...}
    },
    planner: {
      rootId: "...",
      elements: [...],
      slots: [...]
    }
  }
]
```

**options 参数**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| targetLib | string | 'eview-react' | 目标组件库 |

---

## 4. 关键设计模式

### 4.1 步骤模式（Step Pattern）

每个步骤继承 `Step` 基类，实现 `async execute(ctx)` 方法，从 `PipelineContext` 读输入、写输出：

```ts
import { Step } from '../core/Step.js';

export class MyStep extends Step {
  async execute(ctx) {
    const input = ctx.someData;
    const output = transform(input);
    ctx.someResult = output;
  }
}
```

### 4.2 双数据源模式（ReadPages）

ReadPages 步骤优先从 `ctx.pagesSourceData`（API 模式注入的内存数据）读取，不存在时从文件系统读取：

```
API 模式：
  PipelineContext 构造函数第三个参数传入 pages（[{mergedA2UI, planner}]）
    → ctx.pagesSourceData 存在
    → ReadPages 调用 PageReader.readFromData(pages)
    → 输出 ctx.pagesData

CLI 模式：
  config.pagesDir 指向 ./pages-source
    → ctx.pagesSourceData 不存在
    → ReadPages 调用 PageReader.readAll(pagesDir)
    → 输出 ctx.pagesData
```

### 4.3 WriteOutput — 收集模式

WriteOutput 不再直接写入磁盘，改为收集所有产出文件到 `ctx.outputFiles`：

```ts
ctx.outputFiles = [
  { path: 'index.html', content: '<!DOCTYPE html>...' },
  { path: 'src/pages/orderAdmin/index.jsx', content: '...' },
  { path: 'src/styles/orderAdmin.less', content: '...' },
  // ...
];
```

调用方决定如何处理：
- API 模式 → 返回 `{ files }` 数组，调用方自行处理
- CLI 模式 → 逐文件写入 outputDir

### 4.4 节点树遍历模式

| 场景 | 位置 | 方法 |
|------|------|------|
| 构建树 | `TreeBuilder.buildTree` | ID 引用解析 + slotMap 打标 |
| 绑定解析 | `BindingResolver.resolveNode` | 递归前序 + path 绑定识别 |
| 样式收集 | `TailwindConverter.collectRules` | 递归前序 + className 提取 |
| 代码渲染 | `JsxSerializer.renderNode` | 递归后序 + JSX 字符串构建 |
| 数据提取 | `GenerateComponents._collectDataFromNode` | 递归遍历 + stateData/componentData 提取 |

### 4.5 节点类型系统

| `__nodeType` / `__type` | 含义 | 处理方 |
|-------------------------|------|--------|
| `unresolved` | 未解析的组件/元素 | registry.transform → CodeGenNode |
| `component` | 已解析的 UI 组件 | JsxSerializer 渲染 |
| `html` | 原生 HTML 元素 | JsxSerializer 渲染 |
| `string` | 文本节点 | JsxSerializer 直接输出 |
| `__type: 'loop'` | 数据驱动循环 | JsxSerializer 渲染 `{(data \|\| []).map(...)}` |
| `__type: 'renderFn'` | 渲染函数表达式 | JsxSerializer/StateTransformer 渲染 `(params) => (bodyJSX)`，支持抽取 |
| `__type: 'jsxExpr'` | 旧格式 JSX 表达式（向后兼容） | StateTransformer 兜底处理 |
| `__rawExpr` | 原始 JS 表达式（逃生舱） | JsxSerializer/StateStrategy 直接输出原文 |

---

## 5. PipelineContext 字段说明

```
PipelineContext (ctx)
├── config                 // 配置对象（ESM 导入 config.ts + options 合并）
├── registry               // ComponentRegistry（映射文件注册表）
├── pagesSourceData        // [API 模式] 外部注入的页面数据 [{mergedA2UI, planner}]
├── pagesData              // [ReadPages] 原始页面 JSON 数据
├── tailwindAdapter        // 样式转换适配器（由 src/tailwind/ 工厂创建）
├── resolvedPages          // [BuildTrees] 建树 + 绑定解析后的页面数据
├── styleResults           // [BuildTrees] 样式转换结果
├── generatedPages         // [GenerateComponents] 代码生成后的页面数据
├── routeResult            // [GenerateRoutes] 路由生成结果
├── outputFiles            // [WriteOutput] 产出文件列表 [{ path, content }]
├── generationReport       // [GenerateReport] 报告内容（API 模式存入此字段）
│
└── report                 // [GenerateReport] 报告数据
```

---

## 6. Config 配置参考

```ts
// config.ts（ESM 模块）
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

> Tailwind 配置已从 config 中移除，由 `dev/tailwind.config.ts` 统一管理，local adapter 直接 import。
> 桌面环境下使用 desktop adapter，直接引用 desktop 主进程的 `convertTailwindToCSS`。

---

## 7. 开发注意事项

1. **所有 TS 文件使用 ESM**（`import`/`export`），项目 `package.json` 含 `"type": "module"`
2. **步骤文件纯语义命名**（无数字前缀），执行顺序由 `config.steps` 数组控制
3. **样式文件采用 LESS**，通过 `@import` 引用全局变量
4. 新增组件映射时，在 `config/mappings/eview-react/` 下创建映射文件（`.ts`），然后在 `config/mappings/index.ts` 的 `mappingRegistry` 中注册
5. **API 模式**调用 `index.ts` 导出的 `downloadHuiCode()`；**CLI 模式**执行 `node cli.ts` 或 `npm run dev`
6. **WriteOutput 步骤不写磁盘**，仅收集文件列表到 `ctx.outputFiles`；写入由调用方统一处理
7. **tailwind 配置**统一在 `dev/tailwind.config.ts`，管线不感知；适配器内部自行加载
8. **桌面集成使用 desktop 适配器**，需确保 desktop 主进程的 `tailwind-to-css.ts` 导出了 `convertTailwindToCSS`
9. **配置使用 config.ts ESM 模块**
10. **GenerateReport 步骤**在 API 模式下不写磁盘，仅将报告内容存入 `ctx.generationReport`