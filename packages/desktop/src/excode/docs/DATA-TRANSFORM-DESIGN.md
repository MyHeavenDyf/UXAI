# 数据转换架构设计

> 本文档描述管线中数据转换的统一架构方案。涵盖两个核心改动：
> 1. **新 State 输出策略**：从"修补" rawState 变为"声明式构建" outputState
> 2. **统一 DataRef 机制**：将页面级和循环级的数据转换统一为一个概念
>
> 本文档的目标读者：开发者和 LLM Agent。阅读本文档后应能理解设计意图并修改代码实现。

---

## 目录

1. [背景与问题](#1-背景与问题)
2. [设计原则](#2-设计原则)
3. [改动一：新 State 输出策略](#3-改动一新-state-输出策略)
4. [改动二：统一 DataRef 机制](#4-改动二统一-dataref-机制)
5. [DataRef 的两种 Scope](#5-dataref-的两种-scope)
6. [变量命名规则](#6-变量命名规则)
7. [管线处理流程](#7-管线处理流程)
8. [代码生成示例](#8-代码生成示例)
9. [映射文件迁移指南](#9-映射文件迁移指南)
10. [需要改动的文件清单](#10-需要改动的文件清单)

---

## 1. 背景与问题

### 1.1 当前状态的问题

**问题 A — State 输出策略**：

当前管线将 `stateData` 合并到 rawState 的浅拷贝上：

```ts
// 当前做法
const mergedState = { ...rawState };       // 浅拷贝原始 A2UI state
Object.assign(mergedState, node.stateData); // 合并 stateData
// __deleteFields 从 mergedState 中删除过期字段
```

问题：
- rawState 是 A2UI 设计态的数据，不是 target 组件库需要的数据格式
- 多个 transform 操作同源字段时清理逻辑复杂
- `__deleteFields` 是"事后打扫"，不直观
- rawState 中不被任何 transform 引用的字段也出现在 outputState 中

**问题 B — 数据转换不统一**：

当前 transform 处理数据绑定的方式：

```ts
// 当前做法 — 每个映射都要重复
transform(node, { rawState, iconNameMap }) {
  // 1. 判断 prop 是否是 DataBinding
  // 2. 手动调 resolveBindingValue 取值
  // 3. 手动转换数据
  // 4. 手动构造 stateData/componentData
  // 5. 手动记下 stateKey 放进 __deleteFields
  const [rawItems, itemsStateKey] = resolveValue(rawState, props.items);
  if (itemsStateKey) deleteFields.push(itemsStateKey);
  // ...
}
```

问题：
- BindingResolver 只做了一半工作（打 metadata 标记），transform 要自己补完"取值并转换"
- 循环体内相对路径绑定的数据完全没有转换机制
- 页面级和循环级的数据转换逻辑是割裂的，transform 要写两套处理

### 1.2 核心问题根因

A2UI 的 path 绑定是一个统一的协议标准：

```
{ path: "/menuItems" }   → 绝对路径，引用 state 中的顶层字段
{ path: "children" }     → 相对路径，引用循环 item 内的字段
```

但管线只解析了绑定 metadata（`__binding`、`accessPath`、`pathType`），没有统一处理"取值并转换"这一层。这个职责被推给了每个 transform 函数。

---

## 2. 设计原则

1. **数据转换的统一**：不管数据来自绝对路径还是相对路径，不管在页面级还是循环级，transform 只需要回答"要不要转换"和"怎么转换"，不需要关心数据从哪来
2. **声明式 State 输出**：outputState 只包含 transform 显式贡献的字段，rawState 是只读参考
3. **零 Runtime 开销**：所有数据转换在编译期完成，生成的代码不含转换函数
4. **向后兼容**：不需要数据转换的场景保持现有行为

---

## 3. 改动一：新 State 输出策略

### 3.1 核心变化

```
当前: outputState = { ...rawState } + Object.assign(stateData) + __deleteFields
改为: outputState = {} + 收集所有 stateData 贡献
```

rawState 从 outputState 的"基底"变为**只读参考**。outputState 完全由各 transform 的 `stateData` 声明式构建。

### 3.2 数据流对比

```
当前:
  rawState = { menuItems: [...], formData: {...}, theme: 'dark' }
  transform Menu 产出 stateData = { selectedValue: 'home' }, __deleteFields = ['menuItems']
  transform ThemePicker 产出 stateData = { theme: 'light' }
  ↓
  mergedState = { ...rawState }  →  { menuItems: [...], formData: {...}, theme: 'dark' }
  + Object.assign(stateData)     →  { menuItems: [...], formData: {...}, theme: 'dark', selectedValue: 'home' }
  - __deleteFields               →  { formData: {...}, theme: 'dark', selectedValue: 'home' }
  // menuItems 被删是因为 transform 已将其转换为 menuData（componentData）
  // theme 被保留但不是因为 transform 需要它，而是因为它在 rawState 中

新策略:
  rawState = { menuItems: [...], formData: {...}, theme: 'dark' }  // 只读，不进入 output
  transform Menu 产出 stateData = { selectedValue: 'home' }
  transform ThemePicker 产出 stateData = { theme: 'light' }
  ↓
  outputState = {} + stateData = { selectedValue: 'home', theme: 'light' }
  // 只有 transform 显式贡献的字段出现在 outputState 中
  // menuItems 不在 outputState 中，因为 Menu 的 transform 已通过 componentData 产出 menuData
  // theme 在 outputState 中，因为 ThemePicker 的 transform 显式贡献了它
  // formData 不在 outputState 中（除非某个 transform 显式贡献它）
```

### 3.3 好处

1. **可预测** — outputState 完全由"哪些 transform 贡献了什么字段"决定
2. **无冲突** — 每个 transform 只声明自己产出的字段，不需要管别人删了什么
3. **自文档** — 查看 outputState 就能知道哪些字段被哪些组件消费
4. **无需 `__deleteFields`** — 字段出现在 outputState 中因为有 transform 贡献它，不出现因为没人贡献它

### 3.4 页面级数据源的引用

对于不需要数据转换的路径绑定（如 `<span>{{ path: "/systemName" }}</span>`），transform 不处理后直接透传 Binding。

Binding 的绝对路径引用会在 `collectStateRefs` 阶段收集，在 `state.js` 生成时自动保留对应字段：

```ts
// state.js
export const initialState = {
  systemName: '后台管理系统',  // ← Binding 引用了 systemName，自动保留
  theme: 'light',              // ← ThemePicker 显式贡献
  selectedValue: 'home',       // ← Menu 显式贡献
  // menuItems 没有出现在这里，因为被 Menu.transform 转换为了 componentData
};
```

**具体逻辑**：`collectStateRefs` 阶段收集所有 `__binding` 的 `accessPath`，在最终构建 outputState 时，确保这些被引用的字段出现在 outputState 中（如果它们没有被任何 stateData 覆盖的话）。

---

## 4. 改动二：统一 DataRef 机制

### 4.1 DataRef 类型定义

新增一种 PropValue 类型，作为数据转换的统一描述：

```typescript
interface DataRef {
  __type: 'dataRef'                     // 类型标记

  // ── 数据源描述 ──
  source: string                        // 数据来源
  // scope: 'page' 时: 绝对路径 key，如 'menuItems'
  // scope: 'loop' 时: item 上的字段名，如 'children'

  // ── 编译期转换函数（可选）──
  // 如果不提供，表示不需要数据转换，管线直接引用 source
  transform?: (rawValue: any, ctx: { iconNameMap?: Record<string, string> }) => {
    stateData?: Record<string, any>
    componentData?: Record<string, any>
  }

  // ── 产出描述（当 transform 存在时必需）──
  outputMeta?: {
    stateData?: string[]        // transform 产出中哪些是纯数据字段
    componentData?: string[]    // transform 产出中哪些是含 JSX 的字段
  }
}
```

### 4.2 transform 中的使用方式

```ts
// Menu.ts — 统一的 DataRef 用法（不关心 scope，不关心 rawState）
transform(node, { iconNameMap }) {
  const props = node.props || {};

  // 情况 1: items 是字面量 → 不需要数据转换，原地处理
  if (Array.isArray(props.items)) {
    const menuData = convertMenuItems(props.items, openKeySet, iconNameMap);
    return {
      props: { data: { __varRef: 'menuData' } },
      componentData: { menuData },
      stateData: { selectedValue: 'home' },
    };
  }

  // 情况 2: items 是 path 绑定（绝对或相对）→ 需要数据转换
  if (props.items?.__binding) {
    return {
      props: {
        data: {
          __type: 'dataRef',
          source: props.items.pathType === 'relative'
            ? props.items.path           // 相对路径: 'children'
            : props.items.accessPath,    // 绝对路径: 'menuItems'
          transform: (rawVal, ctx) => ({
            menuData: convertMenuItems(rawVal, openKeySet, ctx.iconNameMap),
          }),
          outputMeta: {
            componentData: ['menuData'],
          },
        },
      },
      stateData: { selectedValue: 'home' },
    };
  }

  // 情况 3: items 不存在 → 不输出 data prop
  return { props: {}, children: null };
}
```

### 4.3 关键设计要点

1. **transform 不再接收 rawState**：数据取值由管线统一处理，transform 只关注"把原始值转成目标格式"
2. **scope 由管线推断**：`resolveNode` 在 `_deepResolve` 时注入 `isInLoop` 标记，transform 不需要自己判断 scope
3. **`source` 字段统一表达"从哪取数据"**：page scope 取 absolute path，loop scope 取 relative path
4. **`transform` 是编译期 TS 函数引用**：管线在生成代码时逐个 item 调用，结果序列化为纯数据/含 JSX 的 const 声明

---

## 5. DataRef 的两种 Scope

管线在 `_deepResolve` 中根据是否在循环体中，自动将 DataRef 解析为两种 scope 的行为。

### 5.1 Page Scope（不在循环中）

```
scene: 页面级 Menu, props.data = { __type: 'dataRef', source: 'menuItems', ... }

处理:
  1. 管线从 rawState 按 source = 'menuItems' 取值
     → rawVal = rawState.menuItems = [{ title: '首页', key: 'home', icon: 'home' }, ...]
  2. 调 transform(rawVal, { iconNameMap })
     → 返回 { menuData: [{ title: '首页', value: 'home', icon: <IconPlusHome /> }] }
  3. 按 outputMeta.componentData = ['menuData'] 路由
     → menuData 成为模块顶部 const 声明
  4. 原 dataRef prop 替换为 { __varRef: 'menuData' }

生成代码:
  const menuData = [
    { title: '首页', value: 'home', icon: <IconPlusHome /> },
    { title: '配置', value: 'settings', icon: <IconPlusSettings /> },
  ];
  <Accordion data={menuData} selectedValue={selectedValue} />
```

### 5.2 Loop Scope（在循环中）

```
scene: 循环内的 Menu, props.data = { __type: 'dataRef', source: 'children', ... }

处理:
  1. 管线知道当前在循环中，数据源的每个 item 上有 source = 'children' 字段
  2. 从预解析的循环数据源（_loopBinding.value）取值
     → loopDataSource = [{ children: [...], title: '组1' }, { children: [...], title: '组2' }]
  3. 对 loopDataSource 的每个 item:
     item.children → 调 transform(item.children, ctx) → { menuData: [...] }
  4. 汇总所有 item 的转换结果 → 数组
  5. 按 outputMeta 路由:
     - componentData: 生成 const itemsLoopData = [...]
     - stateData: 合并到 mergedState
  6. 原 dataRef prop 替换为 { __varRef: 'item.menuData' }
     （因为每个 item 转换后有了 menuData 字段）

生成代码:
  const itemsLoopData = [
    { menuData: [{ title: '首页', value: 'home', icon: <IconPlusHome /> }] },
    { menuData: [{ title: '配置', value: 'settings', icon: <IconPlusSettings /> }] },
  ];
  {(itemsLoopData || []).map((item, idx) => (
    <Accordion data={item.menuData} selectedValue={selectedValue} />
  ))}
```

### 5.3 不需要转换的场景

当 transform 发现不需要数据转换时（如无 transform 的 HTML 兜底，或 transform 决定保持原始数据），不产出 DataRef，管线保持现有行为：

```
scene: 循环内的 <span>{{ path: "col1Top" }}</span>（HTML 兜底，无 transform）

处理:
  1. JsxSerializer 遇到 pathType: 'relative' 的 Binding
  2. 渲染为 <span>{item.col1Top}</span>

scene: 页面级 <Tag>{{ path: "/systemName" }}</Tag>（无 transform 的组件）

处理:
  1. JsxSerializer 遇到 pathType: 'absolute' 的 Binding
  2. 渲染为 <Tag>{systemName}</Tag>
```

---

## 6. 变量命名规则

| 场景 | 变量名 | 示例 |
|------|--------|------|
| 页面级，不需要转换 | `{stateKey}`（透传 Binding） | `{systemName}` |
| 页面级，DataRef 产出 componentData | 由 `outputMeta.componentData` 的 key 决定 | `const menuData = [...]` |
| 循环级，不需要转换 | `{item.field}`（透传相对 Binding） | `{item.col1Top}` |
| 循环级，循环数据源直接使用 | `{stateKey}`（不加后缀） | `{(listItems \|\| []).map((item) => ...)}` |
| 循环级，DataRef 产出 componentData | `${sourceKey}LoopData` | `const listItemsLoopData = [...]` |

**循环数据源直接使用 vs 转换后的判断依据**：
- 如果循环模板的所有子节点遍历后，没有收集到任何 DataRef → 不需要转换 → `{stateKey}.map(...)`
- 如果收集到了 DataRef → 需要转换 → 生成 `const ${sourceKey}LoopData = [...]`

---

## 7. 管线处理流程

### 7.1 整体流程变化

```
改动前:                                  改动后:
                                          ↓
GenerateComponents                       GenerateComponents
  ├─ _deepResolve                          ├─ _deepResolve
  │   ├─ transform (传 rawState)            │   ├─ transform (不传 rawState)
  │   ├─ children 递归                      │   ├─ children 递归
  │   └─ _isLoop → loop                     │   └─ _isLoop → loop
  ├─ _collectDataFromNode                   │       └─ 阶段2.5: 收集 DataRef（新增）
  ├─ collectStateRefs                       │           ├─ 从 loop template 树中收集所有 dataRef
  ├─ state.js                               │           ├─ 按 scope 处理: 取值 → 调 transform → 汇总
  ├─ 模块组件                               │           └─ 替换 dataRef prop → __varRef
  └─ 页面主文件                             ├─ _collectDataFromNode（不变）
                                           ├─ collectStateRefs（不变）
                                           ├─ state.js（按新策略构建）
                                           ├─ 模块组件（不变）
                                           └─ 页面主文件（不变）
```

### 7.2 新增阶段：DataRef 收集与处理（在 `_collectDataFromNode` 之前）

```
Function: _resolveDataRefs(nodeTree, rawState, loopDataSource?)

输入:
  - resolved 后的 CodeGenNode 树（loop 节点中的 template.body）
  - rawState（只读参考）
  - loopDataSource（循环时才提供，_loopBinding.value）

输出:
  - 修改 nodeTree 中的 dataRef prop 为 __varRef
  - 收集到的 stateData / componentData 用于后续生成

步骤:
  1. 遍历节点树（递归进入 children / loop.template.body）
  2. 遇到 props 中有 __type: 'dataRef' 的 prop → 收集
  3. 按 scope 处理:
     a. 页面级: source 从 rawState 取值 → 调 transform → 按 outputMeta 路由
     b. 循环级: source 从 loopDataSource 每个 item 取值 → 逐个调 transform → 汇总
  4. 替换 dataRef prop 为 { __varRef: '变量名' }
  5. 返回收集到的 stateData / componentData
```

### 7.3 与现有机制的融合

| 现有机制 | 如何融合 |
|---------|---------|
| `_collectDataFromNode` | 不变。DataRef 处理后的产出（stateData/componentData）直接写入节点或 moduleVars |
| `StateTransformer.generateComponentVarDecls` | 不变。componentData 含 JSX，生成 const 声明 |
| `StateStrategy.generateStateFile` | 新策略 outputState 从 stateData + Binding references 构建 |
| `JsxSerializer` | 新增 `__type: 'dataRef'` 分支（处理未解析的 dataRef prop）+ `__type: 'loopItemRef'` 分支 |
| `ImportCollector` | 不变。组件 import 收集逻辑不变 |
| `collectStateRefs` | 不变。仍收集所有 `__binding` 引用 |

---

## 8. 代码生成示例

### 8.1 页面级 Menu — DataRef 转换

**映射文件**：
```ts
// Menu.ts
export default {
  tag: 'Accordion',
  import: '@nce/eview-react/Accordion',
  transform(node, { iconNameMap }) {
    return {
      props: {
        data: {
          __type: 'dataRef',
          source: 'menuItems',
          transform: (rawVal, ctx) => ({
            menuData: convertMenuItems(rawVal, new Set(), ctx.iconNameMap),
          }),
          outputMeta: { componentData: ['menuData'] },
        },
      },
      stateData: { selectedValue: 'home' },
    };
  },
};
```

**生成代码**（state.js）：
```js
export const initialState = {
  selectedValue: 'home',
};
```

**生成代码**（Module.jsx）：
```jsx
import Accordion from '@nce/eview-react/Accordion';

const menuData = [
  { title: '首页', value: 'home', icon: <IconPlusIcIctHome /> },
  { title: '配置', value: 'settings', icon: <IconPlusIcIctSetting /> },
];

export default function OrderAdminContent() {
  return (
    <Accordion data={menuData} selectedValue={selectedValue} />
  );
}
```

### 8.2 循环内 Table — DataRef 转换

**映射文件**：
```ts
// Table.ts 中 transform 处理 columns
transform(node, { iconNameMap }) {
  return {
    props: {
      columns: {
        __type: 'dataRef',
        source: 'columns',
        transform: (rawCols, ctx) => ({
          tableColumns: convertColumns(rawCols, ctx.iconNameMap),
        }),
        outputMeta: { componentData: ['tableColumns'] },
      },
      dataSource: {
        __type: 'dataRef',
        source: 'rows',
        transform: (rawRows, ctx) => ({
          tableDataSource: convertRows(rawRows),
        }),
        outputMeta: { componentData: ['tableDataSource'] },
      },
    },
  };
}
```

**生成代码**（循环外，数据在页面级直接转换）：
```jsx
const tableColumns = [
  { title: '姓名', key: 'name', render: (v) => <span>{v}</span> },
  { title: '年龄', key: 'age' },
];
const tableDataSource = [
  { name: '张三', age: 25 },
  { name: '李四', age: 30 },
];

<Table columns={tableColumns} dataSource={tableDataSource} />
```

### 8.3 循环内 Menu — 相对路径 DataRef 转换

**A2UI 循环结构**：
```json
{
  "state": {
    "menuGroups": [
      { "title": "组1", "children": [{ "title": "首页", "key": "home", "icon": "home" }] },
      { "title": "组2", "children": [{ "title": "配置", "key": "settings", "icon": "setting" }] }
    ]
  },
  "elements": [
    {
      "component": "List",
      "props": { "dataSource": { "path": "/menuGroups" } },
      "children": [
        {
          "component": "Menu",
          "props": { "items": { "path": "children" } }
        }
      ]
    }
  ]
}
```

**Menu.transform**（在循环内，isInLoop=true）：
```ts
transform(node, { iconNameMap, isInLoop }) {
  // 相同 transform 函数，管线根据 isInLoop 自动处理 scope
  return {
    props: {
      data: {
        __type: 'dataRef',
        source: 'children',
        transform: (rawVal, ctx) => ({
          menuData: convertMenuItems(rawVal, new Set(), ctx.iconNameMap),
        }),
        outputMeta: { componentData: ['menuData'] },
      },
    },
  };
}
```

**生成代码**：
```jsx
// 编译期转换完成，无转换函数调用
const menuGroupsLoopData = [
  { menuData: [{ title: '首页', value: 'home', icon: <IconPlusIcIctHome /> }] },
  { menuData: [{ title: '配置', value: 'settings', icon: <IconPlusIcIctSetting /> }] },
];

<List>
  {(menuGroupsLoopData || []).map((item, idx) => (
    <Accordion data={item.menuData} />
  ))}
</List>
```

### 8.4 循环内纯文本 — 不需要 DataRef

**A2UI 结构**：
```json
{
  "state": {
    "users": [{ "name": "张三" }, { "name": "李四" }]
  },
  "elements": [
    {
      "component": "List",
      "props": { "dataSource": { "path": "/users" } },
      "children": [
        {
          "component": "Text",
          "props": { "value": { "path": "name" } }
        }
      ]
    }
  ]
}
```

**生成代码**（不需要转换，保持现有行为）：
```jsx
<List>
  {(users || []).map((item, idx) => (
    <Text value={item.name} />
  ))}
</List>
```

---

## 9. 映射文件迁移指南

### 9.1 改动汇总

| 事项 | 当前写法 | 新写法 |
|------|---------|--------|
| rawState 入参 | `transform(node, { rawState, ... })` | `transform(node, { ... })`（删除 rawState） |
| 手动数据转换 | `resolveBindingValue(rawState, prop)` + `__deleteFields` | DataRef transform 函数 |
| __deleteFields | `stateData.__deleteFields = [...]` | 不再需要，outputState 从 stateData 声明式构建 |

### 9.2 Menu.ts 迁移示例

```ts
// ── 迁移前 ──
export default {
  tag: 'Accordion',
  transform(node, { rawState, iconNameMap }) {
    const props = node.props || {};
    const deleteFields: string[] = [];

    // 手动取值 + 转换
    const [rawItems, itemsStateKey] = resolveValue(rawState, props.items);
    if (itemsStateKey) deleteFields.push(itemsStateKey);
    const menuData = convertMenuItems(rawItems, openKeySet, iconNameMap);

    // 处理 selectedKeys
    const stateData: Record<string, any> = {};
    // ...复杂的手动取值逻辑...
    if (hasSelectedKeys) {
      stateData.selectedValue = resolveBindingValue(rawState, props.selectedKeys)?.[0] ?? '';
    }

    if (deleteFields.length > 0) {
      stateData.__deleteFields = deleteFields;
    }

    return {
      props: { data: { __varRef: 'menuData' } },
      componentData: { menuData },
      stateData,
    };
  },
};

// ── 迁移后 ──
export default {
  tag: 'Accordion',
  transform(node, { iconNameMap }) {
    const props = node.props || {};

    // 只需要处理 selectedKeys → selectedValue（纯数据转换）
    const stateData: Record<string, any> = {};
    if (Object.prototype.hasOwnProperty.call(props, 'selectedKeys')) {
      // selectedKeys 是纯数据转换，不涉及组件 props 中的 JSX
      // 所以可以继续用 resolveBindingValue（唯一保留的场景）
      // 或者也统一为 DataRef（纯数据版）
      stateData.selectedValue = resolveBindingValue(props.selectedKeys)?.[0] ?? '';
    }

    // items 绑定 → DataRef 统一处理
    if (props.items?.__binding) {
      return {
        props: {
          data: {
            __type: 'dataRef',
            source: props.items.pathType === 'relative'
              ? props.items.path
              : props.items.accessPath,
            transform: (rawVal, ctx) => ({
              menuData: convertMenuItems(rawVal, openKeySet, ctx.iconNameMap),
            }),
            outputMeta: { componentData: ['menuData'] },
          },
        },
        stateData,
      };
    }

    // 字面量 items → 原地处理（不变）
    if (Array.isArray(props.items)) {
      const menuData = convertMenuItems(props.items, openKeySet, iconNameMap);
      return {
        props: { data: { __varRef: 'menuData' } },
        componentData: { menuData },
        stateData,
      };
    }

    return { props: {}, stateData };
  },
};
```

### 9.3 迁移要点

1. **删除 `rawState` 入参**：不再需要手动从 rawState 取值
2. **删除 `resolveBindingValue` 调用**：DataRef 的 transform 函数接收管线注入的 rawValue
3. **删除 `__deleteFields`**：outputState 从 stateData 声明式构建
4. **将数据转换逻辑移到 DataRef.transform 内部**：统一的函数引用，页面级和循环级共用
5. **纯数据转换保留 `stateData`**：如 selectedKeys → selectedValue 这类纯数据转换

### 9.4 什么场景不需要迁移

- **HTML 兜底组件**（如 div、span）：没有映射文件，不涉及
- **不需要数据转换的组件**（如只透传字符串 prop 的 Text 组件）：不涉及 DataRef
- **字面量 prop**：不需要转换，原地使用

---

## 10. 需要改动的文件清单

### 核心改动

| 文件 | 改动内容 | 优先级 |
|------|---------|--------|
| `src/core/ComponentRegistry.ts` | TransformContext 删除 `rawState`；TransformResult 新增 `outputMeta` 支持 | P0 |
| `src/steps/GenerateComponents.ts` | 新增 `_resolveDataRefs` 阶段；修改 `_collectDataFromNode` 的 state 合并逻辑 | P0 |
| `src/resolver/BindingResolver.ts` | binding 解析时从 rawState 预解析 absolute path 的值挂到 `value` 字段 | P0 |
| `src/codegen/JsxSerializer.ts` | 新增 `__type: 'dataRef'` prop 值处理（透传或替换） | P0 |
| `src/core/stateUtils.ts` | `resolveBindingValue` 保持兼容但标记为 deprecation（仅纯数据场景用） | P1 |

### 数据定义改动

| 文件 | 改动内容 | 优先级 |
|------|---------|--------|
| `docs/DATA-STRUCTURE.md` | 新增 DataRef 类型定义；更新 Binding 字段新增 `value`；更新 state 输出策略 | P0 |
| `docs/COMPONENT-MAPPING-GUIDE.md` | 更新 transform 写法和 DataRef 用法 | P1 |

### 映射文件迁移（示例）

| 文件 | 改动内容 | 优先级 |
|------|---------|--------|
| `config/mappings/eview-react/Menu.ts` | 迁移为 DataRef 模式，删除 rawState 依赖 | P1 |
| `config/mappings/eview-react/Table.ts` | 迁移 columns / dataSource 处理 | P1 |
| 其他映射文件 | 按需迁移 | P2 |

### 非功能性改动

| 文件 | 改动内容 | 优先级 |
|------|---------|--------|
| `src/steps/BuildTrees.ts` | 将 rawState 传入 BindingResolver 的 resolveValue | P1 |
| `src/codegen/StateStrategy.ts` | 按新策略构建 initialState（从 stateData 而非 rawState） | P0 |

---

## 附录 A：核心类型定义变化

### 新增 DataRef 类型

```typescript
// 新增到的类型
interface DataRef {
  __type: 'dataRef'
  source: string
  transform?: (rawValue: any, ctx: { iconNameMap?: Record<string, string> }) => {
    [key: string]: any  // 包含 stateData 和 componentData 字段
  }
  outputMeta?: {
    stateData?: string[]
    componentData?: string[]
  }
}
```

### TransformContext 变化

```typescript
// 当前
interface TransformContext {
  rawState: Record<string, any>
  resolveNode: (child: any) => any
  iconNameMap?: Record<string, string>
}

// 改为
interface TransformContext {
  isInLoop?: boolean              // 新增：标记当前组件是否在循环体内
  resolveNode: (child: any) => any
  iconNameMap?: Record<string, string>
  // rawState 删除
}
```

### PropValue 扩展

```typescript
// 当前 PropValue 类型
type PropValue = Primitive | Binding | VarRef | RenderFn | Loop | SlotNode | RawExpr | PropObject | PropArray

// 扩展后
type PropValue = Primitive | Binding | VarRef | RenderFn | Loop | SlotNode | RawExpr | PropObject | PropArray | DataRef
```

### Binding 变化

```typescript
interface Binding {
  __binding: true
  stateKey: string
  accessPath?: string
  pathType: 'absolute' | 'relative'
  path?: string

  // ── 新增：编译期预解析的值（仅 absolute path）──
  value?: any                    // 编译期从 rawState 中按 accessPath 取到的实际值
  // 用于需要在编译期读取原始数据的场景（如拿长度、取样本值）

  bindMode?: 'readonly' | 'two-way'
  control?: { ... }
}
```

---

> **文档版本**：v0.1
> **状态**：设计中，待实现