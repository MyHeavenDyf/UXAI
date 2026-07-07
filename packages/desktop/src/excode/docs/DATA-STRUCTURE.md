# 数据结构说明

> 本文档定义管线核心数据结构的完整规范，涵盖代码生成器消费的节点结构、包裹层声明、Props 值类型体系和标记字段。

---

## 1. CodeGenNode — 代码生成器消费的标准节点

管线经过解析、绑定解析、映射变换后，最终交给 `JsxSerializer` 渲染的节点结构。

```typescript
interface CodeGenNode {
  // ── 标识字段 ──
  tag:        string    // 组件或元素名称
                        // 组件示例: 'Carousel', 'Tag', 'Button'
                        // HTML 示例: 'div', 'span', 'p'
  import?:    string    // 组件导入路径，仅组件有
                        // 示例: '@nce/eview-react/Carousel'
                        // HTML 元素无此字段
  importMode?: 'default' | 'named'
  // 导入模式（可选，默认 'default'）
  // 'default' → import Tag from 'source'
  // 'named'   → import { Tag } from 'source'
  // 典型场景：@hui/icon-plus 使用命名导出
  // 示例: import { IconPlusIcIctHome } from '@hui/icon-plus'

  // ── 节点类型（显式标识）──
  __nodeType: 'component' | 'html'
  // 'component' → 组件节点（有 tag/import），JsxSerializer 渲染
  // 'html'      → HTML DOM 节点（小写 tag），JsxSerializer 渲染 + value→children 下沉

  // ── 核心数据 ──
  props:    Record<string, PropValue>  // 处理后的 props
  children: Array<CodeGenNode | string | LoopNode> // 子节点数组（含 loop 表达式）

  // ── 包裹层（可选）──
  wrapper?: WrapperDecl  // 渲染时在当前节点外层套一层 wrapper
  // 示例: <CarouselItem wrapper_tag><Carousel>...</Carousel></CarouselItem>

  // ── 编译期数据转换（transform 产出 stateData/componentData） ──
  stateData?: Record<string, any>     // 纯数据，合并到页面的 initialState
                                      // 示例: { tableColumns: [{ key: 'name', title: '姓名' }] }
  componentData?: Record<string, any> // 含 JSX 表达式，路由到所属模块顶部的 const 声明
                                      // 示例: { tableColumnsJsx: [{ title: '姓名', render: (v, r) => <span>...</span> }] }

  // ── 代码生成标记（可选）──
  _inlineVarProps?: string[]  // 需提取为模块级变量的 prop key 列表
  selfClosing?: boolean       // 强制自闭合（默认由 children 自动推断）

  // ── 管线内部标记（上游步骤设置，映射文件不操作）──
  _isLoop?: boolean           // 是否循环渲染（由 _deepResolve 转换为 __type: 'loop'）
  _loopBinding?: object       // 循环绑定信息
  _loopTemplate?: object      // 循环模板节点（CodeGenNode 树）
}
```

### 1.1 WrapperDecl — 包裹层声明

```typescript
interface WrapperDecl {
  tag: string                          // 包裹组件名，如 'CarouselItem', 'div'
  import?: {                           // import 信息（可选，HTML 无 import）
    source: string                     // 导入路径，如 '@nce/eview-react/Carousel'
    specifier: string                  // 导出名
                                       // 'default' → 默认导出
                                       // 其他字符串 → 命名导出
  }
  props?: Record<string, PropValue>    // 包裹层自身的 props（可选）
}
```

**import 合并规则**：
```
wrapper.import.source === tag 所在文件的 import.source
  → 合并到同一个 import 语句
  → import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'

wrapper.import.source !== tag 所在文件的 import.source
  → 生成单独的 import 语句
  → import { PanelWrapper } from 'other-lib/panels'
```

**渲染逻辑**：
```
使用 wrapper                 不使用 wrapper
─────────────────            ─────────────────
<wrapper.tag ...>            <tag ...>
  <tag ...>children...</tag>   children...
</wrapper.tag>
```

**典型场景**：
| 场景 | wrapper 位置 | 说明 |
|------|-------------|------|
| Carousel 子节点 | 每个 child 上加 `wrapper: { tag: 'CarouselItem', import: { source: '@nce/.../Carousel', specifier: 'CarouselItem' } }` | 子节点渲染时自动被 CarouselItem 包裹 |
| 自身包裹 | 节点自身加 `wrapper: { tag: 'div' }` | 组件外再套一层 div |

### 1.2 使用 `__nodeType` 替代隐式推断

`__nodeType` 让管线显式标识节点类型，避免以下问题：
- 大小写推断不可靠：`divider` 是组件名但小写开头，`Map` 是 HTML 元素但大写开头
- transform 构造的包裹节点需要明确标识
- 显式优于隐式：管线处理逻辑完全基于声明字段而非命名约定

### 1.3 tag/import 字段规则

| __nodeType | tag 示例 | import | 说明 |
|---|---|---|---|---|
| `'component'` | `'Carousel'`, `'Tag'`, `'Button'` | `'@nce/eview-react/...'` | 组件节点，有 import 路径 |
| `'html'` | `'div'`, `'span'`, `'p'` | 无 | HTML 元素，无 import |

### 1.4 children 的形态与渲染规则

```
children 值                        JSX 渲染结果
──────────────────────────────────────────────────────────
undefined                          <Tag />（自闭合）
[]                                 <Tag />（自闭合）
['文本']                           <Tag>文本</Tag>
[{ tag: 'div', ... }]             <Tag><div>...</div></Tag>
['文本', { tag: 'span', ... }]    <Tag>文本<span>...</span></Tag>
[{ __type: 'loop', ... }]         <Tag>{(data || []).map(...)}</Tag>
```

**children 中的字符串被视为文本节点**，直接输出到 JSX 子节点位置。

---

## 2. 节点处理管线中的两种形态

节点在管线中有两种形态，用 `__nodeType` 区分：

### 2.1 `UnresolvedNode` — 未解析节点（管线中间态）

```typescript
interface UnresolvedNode {
  component:  string    // A2UI 组件名（原始 JSON）或 transform 构造的目标组件名
  props:      object    // 原始 A2UI props（含 path 绑定）
  children:   Array<UnresolvedNode | string>  // 子节点（同是未解析态）

  // ── 显式标识 ──
  __nodeType: 'unresolved'
  // 管线看到此字段 → 走完整映射流程：
  //   1. 查 registry（以 component 为 key）
  //   2. 执行声明式字段（defaults → propsMap → valueMap）
  //   3. 执行 transform
  //   4. 若 transform 返回 stateData/componentData，附在 CodeGenNode 上
  //   5. 递归处理 transform 返回的 children（仅 unresolved 走映射）

  // ── 可选：transform 可在 child 上设 wrapper（走映射前）──
  wrapper?: WrapperDecl
}
```

**使用场景**：
| 来源 | 说明 |
|------|------|
| 解析阶段（BuildTrees） | A2UI 原始 JSON 解析而来，`__nodeType: 'unresolved'` |
| transform 返回 children 时 | 透传原始 child 保持 unresolved，可附加 `wrapper` 标记 |

### 2.2 `CodeGenNode` — 已解析节点（管线最终态）

```typescript
interface CodeGenNode {
  tag:        string    // 目标组件名
  import?:    string    // 导入路径
  props:      object    // 处理后的 props（已改名、已映射值、已绑定标记）
  children:   Array<CodeGenNode | string | LoopNode>  // 子节点

  // ── 显式标识 ──
  __nodeType: 'component' | 'html'
  // 'component' → 组件节点
  // 'html'      → HTML DOM 节点

  // ── 包裹层 ──
  wrapper?: WrapperDecl  // 渲染时在当前节点外层套一层 wrapper

  // ── 编译期数据转换结果（transform 产出）──
  stateData?: Record<string, any>     // 纯数据 → 合并到 initialState
  componentData?: Record<string, any> // 含 JSX → 模块顶部 const 声明

  // ── 可选标记 ──
  _inlineVarProps?: string[]
  selfClosing?: boolean

  // ── 循环标记（仅上游 BuildTrees 设置，_deepResolve 转换后清除）──
  _isLoop?: boolean
  _loopBinding?: object
  _loopTemplate?: object
}
```

**已解析节点 = 不再需要走映射流程，直接交给 JsxSerializer 渲染**。
**wrapper 在渲染时生效**：代码生成器先生成 wrapper 标签，再生成节点自身 JSX。

### 2.3 stateData / componentData 数据路由

当 `transform` 在返回中包含 `stateData` / `componentData` 时，`GenerateComponents._collectDataFromNode` 提取这些数据：

```
transform 返回：
  { props, children, stateData?, componentData? }
                           │
                           ├── stateData ───── 纯数据
                           │     路由 → 合并到页面的 initialState
                           │     适用：配置项、列定义、静态数据
                           │     示例：
                           │       { tableColumns: [{ key: 'name', title: '姓名' }] }
                           │       { paginationConfig: { pageSize: 20 } }
                           │
                           └── componentData ── 含 JSX 表达式
                                 路由 → 模块组件文件顶部 const 声明
                                 适用：render 函数（__type: 'renderFn'）、
                                       循环表达式（__type: 'loop'）、
                                       动态 JSX 片段
                                 示例：
                                   { tableColumnsJsx: [{
                                       title: '姓名',
                                       render: {
                                         __type: 'renderFn',
                                         params: '(cellValue, rowData)',
                                         body: { __nodeType: 'html', tag: 'span', props: { value: { __binding: true, path: 'name' } } }
                                       }
                                     }]
                                   }
```

**为什么要区分两者？**
- `stateData` 是纯 JSON 数据，可以直接序列化到 `state.js` 的 `initialState` 中，不依赖 React
- `componentData` 包含 JSX 表达式（如 render 函数中的 `__type: 'renderFn'`），必须放置在 React 组件文件中，在编译期完成 const 声明
- 这种分离保证了 `state.js` 文件保持纯数据（不含 JSX），避免模块间耦合
- 零 runtime 开销：所有数据转换在编译期完成

### 2.4 两态转换图（完整管线流程）

```
A2UI JSON
   │
   ▼
UnresolvedNode { __nodeType: 'unresolved', component, props, children }
   │
   │  管线：查 registry → 声明式字段 → transform
  │  transform 返回中包含：
  │    • props（处理后的目标组件 props）
  │    • tag（可选，动态覆盖目标组件名，默认使用映射文件顶层 tag）
  │    • import（可选，动态覆盖导入路径，默认使用映射文件顶层 import）
  │    • children（可选），每项可以是：
  │        - UnresolvedNode（管线递归映射）
  │        - CodeGenNode（直接透传）
  │        - 文本字符串
  │    • stateData / componentData（可选，附在 CodeGenNode 上）
  │    • wrapper（包裹标记，附加到子节点上）
   │
   ▼
CodeGenNode { __nodeType: 'component', tag, import, props, children,
               wrapper?, stateData?, componentData?,
               _isLoop?, _loopBinding?, _loopTemplate? }
   │
   │  _deepResolve 阶段2（处理 _isLoop → __type: 'loop'）：
   │    当节点的 _isLoop === true 且 _loopTemplate 存在：
   │      children → [{ __type: 'loop',
   │                     data: _loopBinding,
   │                     template: { __type: 'renderFn', params: '(item, idx)', body: _loopTemplate }
   │                   }]
   │      清除 _isLoop / _loopPath / _loopTemplate / _loopBinding
   │
   ▼
CodeGenNode（最终形态，children 中含 LoopNode / RenderFnNode）
   │
   │  JsxSerializer 渲染（按节点类型分支）：
   │    1. __nodeType: 'component'/'html' → 渲染 <tag ...>...</tag>
   │    2. __type: 'loop' → 渲染 {(data || []).map(...)}
   │    3. __type: 'renderFn' → 渲染 (params) => (body)
   │    4. wrapper 存在 → 外层包裹 <wrapper.tag>...</wrapper.tag>
   │
   │  GenerateComponents._collectDataFromNode（数据提取）：
   │    1. 遍历所有 CodeGenNode 树（含 loop.template.body / renderFn.body）
   │    2. 收集 stateData → 合并到 mergedState
   │    3. 收集 componentData → 按模块路由到 componentVars
   │
   ▼
最终产出文件：
  state.js         ← initialState（含 stateData）
  components/Xxx.jsx ← 模块组件（含 componentVars const 声明 + renderFn 抽取 + JSX 代码）
  index.jsx        ← 页面主组件
```

---

## 3. Props 值类型体系

`props` 对象中每个值可以是以下 9 种类型之一：

```typescript
type PropValue = Primitive | Binding | VarRef | RenderFn | Loop | SlotNode | RawExpr | PropObject | PropArray
```

### 3.1 Primitive — 原生值

| JS 类型 | 序列化后 JSX | 示例 |
|---------|-------------|------|
| `string` | `prop="value"` | `size="large"` |
| `number` | `prop={123}` | `max={100}` |
| `boolean` | `prop={true}` | `disabled={true}` |
| `null` | `prop={null}` | `value={null}` |
| `undefined` | 不渲染该 prop | — |

### 3.2 Binding — 数据绑定标记

由 `BindingResolver` 设置，transform 可修改/升级。

```typescript
interface Binding {
  __binding: true               // 类型标记

  stateKey: string              // state 中的字段名
  accessPath?: string           // 完整访问路径, 如 'state.formData.name'

  pathType: 'absolute' | 'relative'
  // absolute → 组件顶部声明的变量，如 {stateKey}
  // relative → 循环体内的 item/subItem 路径

  path?: string                 // 原始路径字符串

  // ── 绑定模式（初始 readonly，transform 可升级为 two-way）──
  bindMode?: 'readonly' | 'two-way'

  // ── two-way 时携带的控制信息（由 transform 设置）──
  control?: {
    changeEvent: string         // 事件名, 如 'onChange', 'onRowCheck'
    valueExtractor: (setFn: string) => string
    // 返回将事件参数转为 setState 调用的代码片段
    // 示例: (val) => setFn(val)
    //       (e) => setFn(e.target.value)
    //       (_row, checkedRows) => setFn(checkedRows)
  }
}
```

### 3.3 VarRef — 变量引用标记

```typescript
interface VarRef {
  __varRef: string      // 变量名, 如 'myTable_columns'
}
```

**序列化**：`prop={myTable_columns}`

**典型用途**：
- 引用模块顶部 const 声明的变量（如经过 `_inlineVarProps` 提取的复杂 prop）
- 引用 `componentData` 产出的变量

### 3.4 RenderFn — 渲染函数

渲染函数是管线的核心类型，用于表达任意 JSX 函数体，支持内联/抽取两种模式。

```typescript
interface RenderFn {
  __type: 'renderFn'            // 类型标记
  params?: string               // 函数参数签名，默认 '()'
                                // 示例: '(cellValue, rowData)', '(item, idx)'
  body?: CodeGenNode            // 函数体节点树（CodeGenNode 或含 loop）

  // ── 抽取模式（可选）──
  extract?: boolean             // true → 抽取为模块顶部 const 函数声明
                                // false/undefined → 内联渲染为箭头函数
  refName?: string              // 抽取模式下的函数引用名
                                // 仅 extract = true 时必需
}
```

**渲染规则**：

| extract 值 | 序列化结果 |
|-----------|-----------|
| `false`（内联） | `(params) => (\n  bodyJSX\n)` — 直接内联到 props 或变量声明 |
| `true`（抽取） | `refName` — 仅输出函数名引用，函数声明由 `StateTransformer.generateComponentVarDecls` 在模块顶部生成 |

**内联示例（extract: false）**：
```js
// transform 返回值
{
  props: {
    render: {
      __type: 'renderFn',
      params: '(cellValue, rowData)',
      body: {
        __nodeType: 'html',
        tag: 'span',
        props: { value: { __binding: true, pathType: 'relative', path: 'name' } },
      }
    }
  }
}

// 序列化结果
render={(cellValue, rowData) => (
  <span>{rowData.name}</span>
)}
```

**抽取示例（extract: true）**：
```js
// componentData 中的 renderFn（带 extract）
componentData: {
  columns: [
    {
      title: '姓名',
      render: {
        __type: 'renderFn',
        extract: true,
        refName: 'nameRender',
        params: '(cellValue, rowData)',
        body: { /* CodeGenNode 树 */ },
      }
    }
  ]
}

// 生成代码（模块顶部先声明）
const nameRender = (cellValue, rowData) => (
  <span>{rowData.name}</span>
);

// 主变量声明引用函数名
const columns = [
  { title: '姓名', render: nameRender },
];
```

**渲染上下文注入**：renderFn body 渲染时，上下文注入 `loopVarName: 'rowData'`，使得相对绑定使用 `rowData` 而非默认的 `item`。

### 3.5 Loop — 数据驱动循环

Loop 节点表达从数据源驱动渲染循环，通过 `__type: 'loop'` 标识，通常出现在 children 位置。

```typescript
interface LoopNode {
  __type: 'loop'                // 类型标记
  data?: object                 // 数据源信息
  // 格式：
  //   { __varRef: 'dataVar' }          → 变量引用
  //   { path: '/data/items' }          → 路径（取 'data.items'）
  //   { stateKey: 'items' }            → state key
  //   { __binding: true, ... }         → 绑定对象

  template?: {
    __type: 'renderFn',         // 模板始终是 renderFn 格式
    params?: string,            // 循环参数，默认 '(item, idx)'
    body?: CodeGenNode,         // 循环体节点树
    extract?: boolean,          // 是否抽取（循环模板的抽取模式）
    refName?: string,           // 抽取模式下的函数名
  }

  extract?: boolean             // 是否抽取（节点级别控制）
  // false → 内联：{(data || []).map((item, idx) => (body))}
  // true  → 抽取：{(data || []).map(refName)}
}
```

**渲染规则**：

| extract | template.extract | 序列化结果 |
|---------|-----------------|-----------|
| `false` | — | `{($dataVar \|\| []).map((item, idx) => (bodyJSX))}` |
| `true` | `true` + `template.refName` | `{($dataVar \|\| []).map(refName)}` |

**数据源确定规则**（优先级递减）：
1. `data.__varRef` → 直接使用该变量名
2. `data.path` → 去掉前导 `/` 作为变量名
3. `data.stateKey` → 使用 stateKey
4. 均不存在 → 降级为 `'data'`

**_isLoop → __type: 'loop' 转换**：
`GenerateComponents._deepResolve` 在阶段2检测 CodeGenNode 上的 `_isLoop` 标记，自动转换为 `__type: 'loop'`：
```
_isLoop: true, _loopBinding: { stateKey: 'items', ... }, _loopTemplate: { /* CodeGenNode 树 */ }

  ↓ _deepResolve 转换

children: [{
  __type: 'loop',
  data: { stateKey: 'items', __binding: true },
  template: {
    __type: 'renderFn',
    params: '(item, idx)',
    body: resolvedTemplate,
  },
}]
// 同时清除 _isLoop / _loopBinding / _loopTemplate
```

### 3.6 SlotNode — 子节点引用

```typescript
interface SlotNode {
  __slotNode: CodeGenNode   // 嵌入一个完整的子节点树
}
```

**序列化**：`prop={<div className="xxx">...</div>}`

### 3.7 RawExpr — 原始表达式标记（逃生舱）

```typescript
interface RawExpr {
  __rawExpr: string     // JS 表达式原文
}
```

**序列化**：`prop={(cellValue, rowData) => (<span>{...}</span>)}`

**用途**：当 transform 需要插入一段无法用节点树表达的任意 JS 代码片段时使用。`__rawExpr` 是逃生舱机制，推荐优先使用 `__type: 'renderFn'` 构造渲染函数。

### 3.8 PropObject — 嵌套对象

```typescript
interface PropObject {
  [key: string]: PropValue   // 递归，所有字段值可以是任意 PropValue 类型
}
```

### 3.9 PropArray — 嵌套数组

```typescript
type PropArray = Array<PropValue>  // 递归，每项可以是任意 PropValue 类型
```

---

## 4. 序列化决策流

```
PropValue
  │
  ├─ undefined            → 跳过，不渲染此 prop
  ├─ null                 → prop={null}
  ├─ __binding === true   → prop={accessPath} [+ control 相关事件]
  ├─ __varRef 存在        → prop={varName}
  ├─ __type === 'renderFn' → 
  │   ├─ extract + refName → prop={refName}
  │   └─ 否则 → prop={(params) => (bodyJSX)}
  ├─ __type === 'loop'    → prop={(dataVar || []).map(...)}
  ├─ __slotNode 存在      → prop={slotJSX}
  ├─ __rawExpr 存在       → prop={rawExpr}
  ├─ 字符串               → prop="转义后的值"
  ├─ 数字 / 布尔          → prop={value}
  ├─ 普通对象             → prop={{递归序列化每字段}}
  └─ 数组                → prop=[递归序列化每项]
```

**JsxSerializer 渲染阶段特殊处理**：
- children 中遇到 `__type: 'loop'` → 渲染为 `{(dataVar || []).map(...)}` JSX 表达式
- children 中遇到 `__type: 'renderFn'` → 渲染为 `{(params) => (body)}`（用 `{}` 包裹）
- props 中遇到 `__type: 'renderFn'` → 直接渲染 prop 值

---

## 5. 标记字段说明

### 5.1 `_inlineVarProps`

```typescript
_inlineVarProps?: string[]   // 需提取为模块级变量的 prop key 列表
```

**示例**：
```js
// transform 返回 { props: { columns: [...] }, _inlineVarProps: ['columns'] }

// 生成代码：
// const myTable_columns = [{ title: '姓名', render: (v) => ... }];
// <Table columns={myTable_columns} />
```

### 5.2 `selfClosing`

```typescript
selfClosing?: boolean   // 是否强制自闭合
```

自动判断规则：
- `children` 为 `undefined` 或 `[]` → 自闭合
- `children` 有内容 → `<Tag>...</Tag>`

### 5.3 `wrapper` — 包裹层

```typescript
wrapper?: WrapperDecl   // 渲染时在当前节点外层套一层
```

**wrapper 与 import 的协同**：
```
wrapper 的 import 与节点自身 import 相同源 → 合并 import 语句
示例：
  节点:   import Carousel from '@nce/eview-react/Carousel'
  wrapper: import { CarouselItem } from '@nce/eview-react/Carousel'
  合并:  import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'
```

### 5.4 `_isLoop` — 循环标记（管线内部标记）

```typescript
_isLoop?: boolean           // 由 BuildTrees 设置，_deepResolve 转换为 __type: 'loop'
_loopBinding?: object       // 循环数据源绑定信息
_loopTemplate?: object      // 循环模板节点树（CodeGenNode）
```

**处理流程**：
1. BuildTrees 在绑定解析阶段设置这些标记（判断依据：节点绑定到数组类型的 state）
2. GenerateComponents._deepResolve 在阶段2检测 `_isLoop`，转换为 `__type: 'loop'` 节点
3. 转换后 `_isLoop` / `_loopBinding` / `_loopTemplate` 被删除
4. 下游 JsxSerializer 只消费 `__type: 'loop'`，不识别 `_isLoop`

### 5.5 `importMode` — 导入模式

```typescript
importMode?: 'default' | 'named'   // 导入模式，默认 'default'
```

**影响 ImportCollector 的 import 语句生成**：

| importMode | 生成的 import 语句 |
|-----------|-------------------|
| `'default'`（默认） | `import IconPlusIcIctHome from '@hui/icon-plus'` |
| `'named'` | `import { IconPlusIcIctHome } from '@hui/icon-plus'` |

**典型场景**：@hui/icon-plus 组件库使用命名导出，每个 icon 是一个独立的命名导出。`resolveIcon()` 返回的 CodeGenNode 自动设置 `importMode: 'named'`。

**合并规则**：当多个同源组件使用 `importMode: 'named'` 时，ImportCollector 合并为同一条 import 语句：
```ts
// 多个 icon 组件
{ tag: 'IconPlusIcIctHome', import: '@hui/icon-plus', importMode: 'named' }
{ tag: 'IconPlusIcIctMenu', import: '@hui/icon-plus', importMode: 'named' }

// 合并结果
import { IconPlusIcIctHome, IconPlusIcIctMenu } from '@hui/icon-plus'
```

### 5.6 `stateData` / `componentData` — 编译期数据转换

```typescript
stateData?: Record<string, any>     // 纯数据，路由到 initialState
componentData?: Record<string, any> // 含 JSX，路由到模块 const 声明
```

**GenerateComponents._collectDataFromNode 的数据提取流程**：
```
遍历所有 CodeGenNode 树（递归进入 children / loop template.body / renderFn body / wrapper）:

对每个节点:
  1. 存在 node.stateData → Object.assign(mergedState, node.stateData)
  2. 存在 node.componentData → Object.assign(moduleVars, node.componentData)
  3. 递归子节点:
     - children 数组中的每个 child
     - __type: 'loop' 的 template / template.body
     - __type: 'renderFn' 的 body
     - wrapper 节点
     - props 中的 __slotNode

最终：
  mergedState → state.js 的 initialState
  moduleVars → StateTransformer.generateComponentVarDecls 生成 const 声明
```

---

## 6. 与 A2UI 原始节点的关系

```
A2UI 原始节点                              CodeGenNode（最终消费）
─────────────────                         ─────────────────────
{                                         {
  component: 'Tag',                          tag: 'Tag',
  props: { value, color },                  import: '@nce/eview-react/Tag',
  children: [...],                           props: { iconName, color },
                                             children: ['标签文本'],
  // A2UI 属性                                wrapper?: { tag, import, props },
}                                           _inlineVarProps: ['columns'],
                                            stateData?: { ... },
                                            componentData?: { ... },
                                          }
```

**关键区别**：
- `component` → `tag`（映射文件提供顶层 tag）
- props 经过 transform 处理（改名、值映射、类型升级）
- `wrapper` 字段在渲染时为节点提供外层包裹（无需额外映射文件）
- `__nodeType` 显式标识节点类型
- `stateData` / `componentData` 是 transform 的产出物，不参与 JSX 渲染但影响代码生成
- `_isLoop` / `_loopBinding` / `_loopTemplate` 是中间标记，最终被替换为 `__type: 'loop'`

---

## 7. 管线中的数据流转路径

```
步骤                              数据结构变化
───────────────────────────────────────────────────
RegisterComponents                加载映射（transform 定义了处理逻辑，含 stateData/componentData 返回）
ReadPages                         原始 A2UI JSON → pagesData
BuildTrees                        节点建树 + 绑定解析 + 样式转换
                                  → resolvedPages（UnresolvedNode 树 + CodeGenNode 标记）
                                  → styleResults（LESS 样式文件）
GenerateComponents                resolvedPages → generatedPages
  ├─ phase1: _deepResolve 模块    UnresolvedNode → CodeGenNode
  │    ├─ registry.transform      调用 transform → 产 CodeGenNode（含 stateData/componentData）
  │    ├─ children 递归           只递归 unresolved 子节点；已 resolve 的直接透传
  │    └─ _isLoop 转换            _isLoop → __type: 'loop'（phase2 完成）
  ├─ phase2: _deepResolve 根树    根树 + slot 根截断 + _isLoop 转换
  ├─ phase3: _collectDataFromNode 遍历节点树提取 stateData + componentData
  │    ├─ stateData               → 合并到 mergedState
  │    └─ componentData           → 按模块路由到 moduleComponentVars
  ├─ phase4: collectStateRefs     收集 state 引用（绝对绑定）
  ├─ phase5: state.js             StateStrategy.generateStateFile(mergedState)
  ├─ phase6: 模块组件             每个模块一个 JSX 文件
  │    ├─ ImportCollector         收集组件 import
  │    ├─ JsxSerializer.renderNode   CodeGenNode 树 → JSX 字符串
  │    └─ StateTransformer        生成 componentVars const 声明（含 renderFn 抽取）
  └─ phase7: 页面主文件           index.jsx（组装所有模块）
GenerateRoutes                    路由配置生成
WriteOutput                       收集文件到 ctx.outputFiles
GenerateReport                    生成报告