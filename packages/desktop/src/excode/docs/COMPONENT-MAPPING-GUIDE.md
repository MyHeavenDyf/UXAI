# 组件映射指南

> 本文档指导如何为 A2UI → eview-react 的组件映射文件。
>
> **核心思想**：映射文件将 A2UI 节点的 `props` 和 `children` 转换为代码生成器消费的标准 Node 结构，**只做数据格式转换，不涉及 JSX 拼接**。

---

## 1. 映射文件规范

### 1.1 文件位置

```
config/mappings/{targetLib}/
├── index.ts          ← 入口，集中导出所有组件映射
├── Tag.ts            ← 每个组件一个文件，按字母顺序
├── Button.ts
├── Carousel.ts
├── Table.ts
└── ...
```

### 1.2 导出字段总表

```ts
export default {
  // ── 必填字段 ──
  tag:    'Tag',                  // 目标组件名
  import: '@nce/eview-react/Tag', // 目标组件导入路径

  // ── 可选声明式字段（仅操作 props 层，按固定顺序执行）──
  propsMap: {
    icon: 'iconName',             // prop 改名
    unnecessary: '__drop__',      // 删除（value = '__drop__'）
    'arr.subfield': 'targetName', // 嵌套路径改名
  },
  valueMap: {
    color: { processing: 'primary', error: 'danger' }, // 枚举值映射
    items: 'firstOfArray',        // 数组取首项
  },
  defaults: {
    closable: false,              // 默认值，transform 前后均会兜底注入
  },

  // ── 可选 transform（最高优先级，处理声明式无法表达的逻辑）──
  transform(node, context) {
    // node = { __nodeType: 'unresolved', component, props, children }
    // context = { rawState, resolveNode }
    // 返回 { props, children?, _inlineVarProps?, selfClosing?,
    //        stateData?, componentData? }
    // stateData     → 纯数据，合并到页面 initialState
    // componentData → 含 JSX，路由到所属模块顶部 const 声明
    // 注意：不返回 tag/import，管线自动使用顶层导出的值
    // 完整类型体系见 DATA-STRUCTURE.md
  },
}
```

### 1.3 字段执行顺序（关键！）

```
1. defaults   ← 填充默认值（仅 prop 不存在时，注入到 node.props）
2. propsMap   ← prop 改名/删除（原名 → 目标名）
3. valueMap   ← 枚举值映射（key 使用【改名后的目标 prop 名】！不是原名）
4. transform  ← 任意复杂逻辑（props 结构重组、children 包裹、绑定升级等）
5. defaults（二次兜底）← transform **返回后**再次合并 defaults 中尚未出现在最终 props 中的字段
```

**第 5 步说明**：transform 返回后，管线会将 `defaults` 中最终 props 仍缺失的字段再次注入。这意味着**无论 transform 是否透传 `node.props`，defaults 声明一定会出现在生成的目标组件 props 中**。映射文件作者无需关心 transform 是否完全重组 props，defaults 始终是安全的兜底。

**⚠️ 重要规则**：

**规则 1：valueMap 的 key 永远是目标 prop 名**（即 propsMap 改名后的名字）

```ts
// A2UI: count={5}, status="processing"
// eview-react: content={5}, status="default"

propsMap: {
  count: 'content',           // 原名 → 目标名
},
valueMap: {
  // key 必须用目标名 'status'（不是原名，因为 status 没改名）
  // 如果 status 也改名了（如 color→tone），valueMap 的 key 要用 'tone'
  status: { processing: 'default' },
},
```

**规则 2：`propsMap` 中不允许 `value → children` 这样的改名**
因为 `children` 是节点的结构字段（决定子节点内容），不是 prop 属性。将 prop 值转为子节点内容需在 `transform` 中处理。

```ts
// ❌ 错误：propsMap 中不应出现 children
propsMap: { value: 'children' }

// ✅ 正确：transform 中处理 value → children
transform(node) {
  const p = { ...(node.props || {}) };
  const children = p.value ? [String(p.value)] : node.children;
  delete p.value;
  return { props: p, children };
}
```

---

## 2. 声明式字段详解

### 2.1 propsMap — prop 改名

| 规则 | 写法 | 效果 |
|------|------|------|
| 基本改名 | `{ count: 'content' }` | A2UI `count` → eview-react `content` |
| 整 prop 删除 | `{ useless: '__drop__' }` | 删除 `useless` prop |
| 嵌套路径改名 | `{ 'rowSelection.selectedRowKeys': 'checkedRows' }` | 对数组每项改该子字段名 |

### 2.2 valueMap — 枚举值映射

| 规则 | 写法 | 效果 |
|------|------|------|
| 枚举值映射 | `{ status: { processing: 'default', error: 'danger' } }` | 值替换 |
| 数组取首项 | `{ items: 'firstOfArray' }` | 如果值为数组，取第一个元素 |

**注意**：valueMap 的 key 使用**目标 prop 名**（propsMap 改名后的名字）。如果 prop 没有改名，则原名就是目标名。

### 2.3 defaults — 默认值

```ts
defaults: {
  closable: false,    // 此 prop 不存在时设为 false
}
```

在管线中经历两种性质的填充：
- **transform 前**（`applySchema` 阶段）：填充到 `node.props`，transform 可以读取和使用
- **transform 后**（二次兜底）：填充到最终输出 props 中尚未出现的字段，确保 defaults 声明不被丢弃

> 映射文件作者无需关心这两种填充的差别。管线保证 `defaults` 字段一定出现在最终生成的目标组件 props 中。

---

## 3. transform 函数

### 3.1 函数契约

```ts
/**
 * 节点变换函数
 *
 * @param {object} node - A2UI 节点（UnresolvedNode）
 *   { __nodeType: 'unresolved',          ← 显式标记未解析态
 *     component: 'Tag',                  ← A2UI 组件名
 *     props: { value, icon },            ← 原始 A2UI props（声明式字段已执行过）
 *     children: [...] }                  ← 子节点数组（也是 UnresolvedNode 或文本）
 *
 * @param {object} context - 上下文
 *   { rawState, resolveNode }
 *
 * @returns {object} transform 结果
 *   { props: { ... },                    ← 处理后的目标组件 props
 *     children: [{...}, '文本'],          ← 子节点数组（可选），每项可以是：
 *                                              UnresolvedNode: { __nodeType: 'unresolved', component, ... }
 *                                              CodeGenNode:    { __nodeType: 'component'|'html', tag, ... }
 *                                              文本字符串
 *     _inlineVarProps: ['columns'],      ← 可选：需提取为模块级变量的 prop key
 *     selfClosing: true,                 ← 可选：强制自闭合
 *     stateData?: { key: value },        ← 可选：纯数据，合并到 initialState
 *     componentData?: { key: value },    ← 可选：含 JSX，模块顶部 const 声明
 *   }
 *   // 注意：transform 不返回 tag 和 import，管线自动使用映射文件的 tag/import
 *   // transform 返回的 children 中的 unresolved 节点，管线会递归映射
 *   // 需要包裹子节点时，在 child 上加 wrapper（看 3.2）
 */
function transform(node, context) {
  // ...
}
```

### 3.2 `wrapper` — 节点包裹层

**用途**：部分组件（如 Carousel）要求每个子节点包裹在 `CarouselItem` 中。transform 为 child 节点添加 `wrapper` 标记，代码生成器在渲染阶段自动完成包裹，无需为包裹组件创建单独的映射文件。

```typescript
interface WrapperDecl {
  tag: string                          // 包裹组件名，如 'CarouselItem'
  import?: {
    source: string                     // 导入路径，如 '@nce/eview-react/Carousel'
    specifier: string                  // 导出名：'default' 或命名导出名
  }
  props?: Record<string, any>          // 包裹层自身的 props（可选）
}
```

**渲染行为**：
```
有 wrapper 的节点渲染:
  <wrapper.tag {...wrapper.props}>
    <节点自身的 tag ...>节点自身 children...</节点自身的 tag>
  </wrapper.tag>
```

**import 合并规则**：wrapper 的 `import.source` 与节点自身 `import` 一致时，合并到同一条 import 语句。

```ts
// 节点: import Carousel from '@nce/eview-react/Carousel'
// wrapper: { import: { source: '@nce/eview-react/Carousel', specifier: 'CarouselItem' } }
// 合并: import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'
```

**用于 children 包裹**：transform 中给每个 child 附加 wrapper。

```
transform 返回:
  children = [
    child1: { ...原始节点..., wrapper: { tag: 'CarouselItem', import: { ... } } },
    child2: { ...原始节点..., wrapper: { tag: 'CarouselItem', import: { ... } } },
  ]

管线递归解析 child1:
  1. child1 是 unresolved → 走映射流程
  2. 查 registry → 执行 transform → 得到 CodeGenNode
  3. child1 上已有 wrapper 标记 → 保留到 CodeGenNode 上
  4. JsxSerializer 渲染时：
     <CarouselItem>
       <编译后的 child1 JSX>
     </CarouselItem>
```

### 3.3 `__nodeType` 显式标识节点类型

管线用 `__nodeType` 字段显式标识节点类型：

| `__nodeType` | 含义 | 管线行为 |
|---|---|---|
| `'unresolved'` | 未解析节点，有 `component` 字段 | 走完整映射流程（查 registry → 声明式字段 → transform → 递归 children） |
| `'component'` | 已解析组件节点，有 `tag`/`import` | 直接交给 JsxSerializer 渲染（含 wrapper 处理） |
| `'html'` | HTML DOM 节点，小写 `tag` | 直接交给 JsxSerializer 渲染 + value→children 下沉 |

**管线对 transform 输出 children 的递归处理规则**（基于 `__nodeType`）：

| 子节点类型 | 判断依据 | 管线行为 |
|---|---|---|
| 文本 | `typeof === 'string'` | 直接作为文本节点 |
| 未解析节点 | `__nodeType === 'unresolved'` | 走完整映射流程（查 registry → 声明式字段 → transform → 递归 children） |
| 已解析组件 | `__nodeType === 'component'` | 直接交给 JsxSerializer |
| 已解析 DOM | `__nodeType === 'html'` | 直接交给 JsxSerializer + value→children 下沉 |

无论哪种类型，`wrapper` 标记都保留到最终的 CodeGenNode 中，在渲染阶段生效。

### 3.4 transform 的使用时机

**以下场景必须使用 transform**（声明式字段无法表达）：

| 场景 | 说明 | 示例 |
|------|------|------|
| prop 值转为子节点 | 将某个 prop 值移到 children 中 | Tag: `value="文本"` → children: `['文本']` |
| children 包裹 | 为子节点包裹一层新组件（用 wrapper） | Carousel: 子节点加 `wrapper: {CarouselItem}` |
| props → 嵌套对象 | 简单值包装为嵌套对象 | Badge: `color="#333"` → `style={{ background: '#333' }}` |
| props 结构拆分 | 一个对象拆成多个 prop | Table: `rowSelection` 拆为 `checkedRows` + `checkType` |
| 绑定升级 | 将 readonly 升级为 two-way | 任何受控组件 |
| 复杂 Prop 构造 | 含 `__type: 'renderFn'` 的 prop | Table: columns.render 注入 |
| 条件逻辑 | 根据 prop 值不同有不同的转换 | 分支处理 |
| stateData/componentData 产出 | transform 返回值携带 | 列定义数据提取 |

**以下场景使用声明式字段就够**：

| 场景 | 使用字段 | 示例 |
|------|----------|------|
| 纯透传 | 无任何字段 | Button |
| prop 改名 | `propsMap` | Badge: `count→content` |
| 枚举值映射 | `valueMap` | Badge: `processing→default` |
| 默认值填充 | `defaults` | 组件级别的默认值 |
| 改名 + 值映射 | `propsMap` + `valueMap` | 先改名再映射值 |

### 3.5 transform 返回值完整规范

```typescript
interface TransformResult {
  props: Record<string, any>        // 处理后的目标组件 props
  children?: Array<any>             // 子节点数组（可选）
  _inlineVarProps?: string[]       // 需提取为模块级变量的 prop key（可选）
  selfClosing?: boolean            // 强制自闭合（可选）
  stateData?: Record<string, any>  // 纯数据 → 合并到 initialState（可选）
  componentData?: Record<string, any> // 含 JSX → 模块顶部 const 声明（可选）
}
```

**stateData 与 componentData 说明**：
- `stateData` 中的值必须是纯 JSON（不含 JSX/函数），可安全序列化到 `state.js`
- `componentData` 中的值可以包含 JSX 表达式（`__type: 'renderFn'` / `__type: 'loop'`）
- 两者 key 需避免重名（一个走 state.js，一个走模块 const 声明）
- 零 runtime 开销：所有数据转换在编译期完成

### 3.6 常见场景模板

#### 3.6.1 纯透传（无 transform）
```ts
export default {
  tag: 'Button',
  import: '@nce/eview-react/Button',
}
```

#### 3.6.2 声明式字段 + 无 transform
```ts
export default {
  tag: 'Badge',
  import: '@nce/eview-react/Badge',
  propsMap: {
    count: 'content',
    overflowCount: 'max',
  },
  valueMap: {
    // 注意：key 用目标 prop 名（content 已从 count 改名，status 没改名）
    status: { processing: 'default', error: 'danger' },
  },
}
```

#### 3.6.3 props 基本操作 + transform 补充
```ts
export default {
  tag: 'Tag',
  import: '@nce/eview-react/Tag',
  propsMap: {
    icon: 'iconName',
  },
  valueMap: {
    size: { medium: 'normal' },
    color: { processing: 'primary' },
  },

  transform(node) {
    const p = { ...(node.props || {}) };

    // icon → hasIcon 配套开关
    if ('iconName' in p) {
      p.hasIcon = true;
    }

    // HEX 颜色转 style
    if ('color' in p && /^#[0-9a-f]{3,6}$/i.test(p.color)) {
      p.style = { '--background': p.color };
      delete p.color;
    }

    // value → children 文本节点（必须在 transform 中处理，不可用 propsMap）
    const pValue = p.value;
    delete p.value;
    const children = pValue ? [String(pValue)] : node.children;

    return { props: p, children };
  },
}
```

#### 3.6.4 children 包裹（Carousel 模式）
```ts
export default {
  tag: 'Carousel',
  import: '@nce/eview-react/Carousel',

  transform(node) {
    const p = { ...(node.props || {}) };

    // 给每个子节点附加 wrapper 标记
    // 不需要创建 CarouselItem 映射文件
    // import 会被代码生成器自动合并：
    //   import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'
    const children = (node.children || []).map(child => ({
      ...child,                      // 保持 child 原始结构（unresolved）
      wrapper: {
        tag: 'CarouselItem',
        import: {
          source: '@nce/eview-react/Carousel',  // 同源
          specifier: 'CarouselItem',            // 命名导出
        },
      },
    }));

    return { props: p, children };
  },
}
```

**管线递归 + wrapper 渲染流程**：
```
Carousel transform 返回:
  children = [
    { __nodeType: 'unresolved', component: 'img', props: { src: 'a.jpg' },
      wrapper: { tag: 'CarouselItem', import: { source: '@nce/eview-react/Carousel', specifier: 'CarouselItem' } }
    },
    { __nodeType: 'unresolved', component: 'img', props: { src: 'b.jpg' },
      wrapper: { tag: 'CarouselItem', import: { source: '@nce/eview-react/Carousel', specifier: 'CarouselItem' } }
    },
  ]
                     ↓
管线递归处理 children:
  遍历每个 child:
    1. 识别 __nodeType: 'unresolved' → 走映射流程
    2. img 不在注册表中 → HTML 兜底
    3. 输出 CodeGenNode:
       { __nodeType: 'html', tag: 'img', props: { src: 'a.jpg' },
         wrapper: { tag: 'CarouselItem', import: { source: '...', specifier: 'CarouselItem' } }
       }
    4. wrapper 保留在 CodeGenNode 上
                     ↓
JsxSerializer 渲染:
  对 Carousel:
    import 合并 → import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'
    <Carousel {...props}>
      对每个 child:
        有 wrapper → 先生成 CarouselItem:
          <CarouselItem>
            <img src="a.jpg" />
          </CarouselItem>
    </Carousel>
```

#### 3.6.5 __rawExpr 注入 + _inlineVarProps
```ts
export default {
  tag: 'Table',
  import: '@nce/eview-react/Table',

  transform(node) {
    const p = { ...(node.props || {}) };

    // rowSelection 拆分
    if (p.rowSelection && typeof p.rowSelection === 'object') {
      const rs = p.rowSelection;
      if (rs.selectedRowKeys !== undefined) {
        p.checkedRows = rs.selectedRowKeys;
      }
      if (rs.type === 'checkbox') p.checkType = 'multi';
      if (rs.type === 'radio')    p.checkType = 'single';
      delete p.rowSelection;
    }

    // columns render 注入 __rawExpr（逃生舱，推荐优先使用 __type: 'renderFn'）
    if (Array.isArray(p.columns)) {
      p.columns = p.columns.map(col => ({
        ...col,
        render: {
          __rawExpr: `(cellValue, rowData) => (<span>{rowData.name}</span>)`,
        },
      }));
    }

    return {
      props: p,
      children: node.children,
      _inlineVarProps: ['columns'],   // ← 提取到模块顶部
    };
  },
}
```

#### 3.6.6 two-way 绑定升级
```ts
export default {
  tag: 'TextField',
  import: '@nce/eview-react/TextField',

  transform(node) {
    const p = { ...(node.props || {}) };

    // BindingResolver 已打了 __binding 标记（bindMode: 'readonly'）
    // 升级为 two-way
    if (p.value && p.value.__binding) {
      p.value = {
        ...p.value,
        bindMode: 'two-way',
        control: {
          changeEvent: 'onChange',
          valueExtractor: (setFn) => `(e) => ${setFn}(e.target.value)`,
        },
      };
    }

    return { props: p, children: node.children };
  },
}
```

#### 3.6.7 stateData / componentData 数据转换
```ts
export default {
  tag: 'Table',
  import: '@nce/eview-react/Table',

  transform(node, { rawState }) {
    const p = { ...(node.props || {}) };

    const columns = (rawState && rawState.tableColumns) || p.columns || [];

    // 构造纯数据 stateData（列定义，不含 JSX）
    const stateData = {
      tableColumns: columns.map(col => ({
        key: col.key,
        title: col.title,
        dataIndex: col.dataIndex || col.key,
      })),
    };

    // 构造含 JSX 的 componentData（render 函数用 __type: 'renderFn'）
    const componentData = {
      tableColumnsJsx: columns.map(col => ({
        ...col,
        render: col.render ? {
          __type: 'renderFn',
          extract: true,
          refName: `${col.key}Render`,
          params: '(cellValue, rowData)',
          body: col.render.body || {
            __nodeType: 'html',
            tag: 'span',
            children: [col.dataIndex || col.key],
          },
        } : undefined,
      })),
    };

    return {
      props: { ...p, columns: { __varRef: 'tableColumnsJsx' } },
      children: node.children,
      _inlineVarProps: ['columns'],
      stateData,
      componentData,
    };
  },
}
```

**生成的代码**：
```jsx
// state.js
export const initialState = {
  tableColumns: [
    { key: 'name', title: '姓名', dataIndex: 'name' },
    { key: 'age', title: '年龄', dataIndex: 'age' },
  ],
};

// ModuleX.jsx
const nameRender = (cellValue, rowData) => (
  <span>{rowData.name}</span>
);

const tableColumnsJsx = [
  { key: 'name', title: '姓名', render: nameRender },
  { key: 'age', title: '年龄' },
];

<Table columns={tableColumnsJsx} />
```

#### 3.6.8 renderFn 抽取模式（extract: true）与内联模式对比
```ts
// 内联模式（extract: false 或不设置）：
// render 函数直接作为 props 的值序列化
render: {
  __type: 'renderFn',
  params: '(cellValue, rowData)',
  body: { __nodeType: 'html', tag: 'span', children: ['{rowData.name}'] },
}
// 序列化结果：render={(cellValue, rowData) => (<span>{rowData.name}</span>)}

// 抽取模式（extract: true）：
// render 函数提取为模块顶部 const 声明，主变量引用函数名
render: {
  __type: 'renderFn',
  extract: true,
  refName: 'nameRender',
  params: '(cellValue, rowData)',
  body: { __nodeType: 'html', tag: 'span', children: ['{rowData.name}'] },
}
// 序列化结果：
//   顶部：const nameRender = (cellValue, rowData) => (<span>{rowData.name}</span>);
//   主变量：{ title: '姓名', render: nameRender }
```

| 模式 | extract | 序列化 | 适用场景 |
|------|---------|--------|----------|
| 内联 | `false` | `render={(cellValue, rowData) => (<span>...</span>)}` | render 函数小且简单、只在 single 位置使用 |
| 抽取 | `true` | 顶部 `const nameRender = ...;` + `render={nameRender}` | render 函数复杂、在多个位置引用、变量结构中需要间接引用 |

---

## 4. Props 值类型参考（transform 中构造）

在 transform 中构造 props 值时，可用以下类型：

| 类型 | 标记/方式 | 示例 | 序列化结果 |
|------|-----------|------|-----------|
| 字符串 | 直接赋值 | `p.label = '名称'` | `label="名称"` |
| 数字 | 直接赋值 | `p.max = 100` | `max={100}` |
| 布尔 | 直接赋值 | `p.disabled = true` | `disabled={true}` |
| 表达式 | `__rawExpr` | `p.render = { __rawExpr: '(v)=>...' }` | `render={(v)=>...}` |
| 数据绑定 | 透传 `__binding` 对象 | `p.value = originalBinding` | `value={state.name}` |
| 变量引用 | `__varRef` | `p.columns = { __varRef: 'myVar' }` | `columns={myVar}` |
| 渲染函数 | `__type: 'renderFn'` | `p.render = { __type: 'renderFn', params: '(v, r)', body: { ... } }` | `render={(v, r) => (<span>...</span>)}` |
| 抽取渲染函数 | `__type: 'renderFn'` + `extract: true` | `p.render = { __type: 'renderFn', extract: true, refName: 'myRender', params: '...', body: { ... } }` | `render={myRender}`（顶部 const 声明） |
| 循环 | `__type: 'loop'` | `p.items = { __type: 'loop', data: {...}, template: {...} }` | `{(items \|\| []).map(...)}` |
| 对象 | 直接赋值 | `p.style = { color: 'red' }` | `style={{color:"red"}}` |
| 数组 | 直接赋值 | `p.items = ['a', 'b']` | `items={["a","b"]}` |
| null | 直接赋值 | `p.value = null` | `value={null}` |

完整类型体系见 [DATA-STRUCTURE.md](./DATA-STRUCTURE.md)。

---

## 5. index.ts 注册

```ts
// config/mappings/eview-react/index.ts
import { default as Badge } from './Badge.ts';
import { default as Button } from './Button.ts';
import { default as Carousel } from './Carousel.ts';
import { default as Table } from './Table.ts';
import { default as Tag } from './Tag.ts';

export default {
  Badge,
  Button,
  Carousel,
  Table,
  Tag,
  // ... 按字母顺序排列
};
```

**注意**：CarouselItem 不需要单独的映射文件，也不需要出现在注册表中。其 import 信息由 Carousel 的 transform 通过 `wrapper.import` 提供。

---

## 6. 组件映射决策流程

```
A2UI 组件
  │
  ▼
A2UI 组件名 → 在 eview-react 中找到对应组件
  │
  ├─ 同名映射     → 仅 tag + import（如 Button → Button）
  ├─ 改名映射     → tag 指向目标名（如 Progress → ProgressBar）
  └─ 多对一映射   → 多个 A2UI 组件映射到同一目标（如 Input + InputNumber → TextField）
  │
  ▼
逐项对比 A2UI props 与 eview-react props
  │
  ├─ 同名 prop     → 直接透传（无需处理）
  ├─ 改名 prop     → propsMap（如 count → content）
  ├─ 枚举值不同    → valueMap（如 processing → default）
  │                 注意：valueMap 的 key 用目标 prop 名（改名后的）
  ├─ 需要默认值    → defaults（如 closable: false）
  ├─ 值→嵌套对象   → transform（如 color → badgeStyle.bg）
  ├─ prop→children → transform（如 value 变为子节点文本，不可用 propsMap）
  ├─ 含函数/表达式 → transform + __type: 'renderFn'（如 columns.render）
  └─ 结构拆分      → transform（如 rowSelection 拆开）
  │
  ▼
children 处理（transform 返回）
  │
  ├─ 无特殊处理     → 透传 node.children（UnresolvedNode，管线递归映射）
  ├─ 需要包裹       → 给每个 child 附加 wrapper 标记
  │                   管线递归解析 child 后，wrapper 保留到 CodeGenNode
  │                   代码生成器渲染时自动包裹
  └─ 无 children    → 不返回/返回 undefined → 自闭合
  │
  ▼
绑定处理
  │
  ├─ 受控组件       → transform 将 readonly 升级为 two-way + control
  └─ 展示组件       → 不做绑定处理
  │
  ▼
数据转换
  │
  ├─ 纯数据产出     → transform 返回 stateData（合并到 initialState）
  ├─ 含 JSX 产出    → transform 返回 componentData（模块顶部 const 声明）
  └─ render 函数    → 使用 __type: 'renderFn'（优先于 __rawExpr）
  │
  ▼
代码生成提示
  │
  ├─ 含复杂 prop    → 返回 _inlineVarProps
  └─ 强制自闭合     → 返回 selfClosing: true
```

---

## 7. 验证清单

生成映射文件后逐项验证：

### 通用
- [ ] `tag` 是否与 eview-react 组件名一致
- [ ] `import` 路径是否与 `api/eview-react/*.md` 中的 Import 一致
- [ ] `propsMap` 的 key 使用 A2UI 原名，value 使用 eview-react 目标名
- [ ] `propsMap` 中没有 `value → children` 这样的错误映射
- [ ] `valueMap` 的 key 使用**目标 prop 名**（改名后的），不是原名
- [ ] `defaults` 声明是否在最终产物中出现（管线自动在 transform 前后两次兜底注入，无需手动维护）
- [ ] `transform` 已提取为独立顶层函数，不在 `export default` 内联
- [ ] `transform` 不返回 `tag` 和 `import`（管线的固有行为）
- [ ] 涉及 `children` 包裹时，使用 `child.wrapper` 方式（不需要额外的映射文件）
- [ ] `wrapper.import` 正确设置了 `source` 和 `specifier`，同源能与组件自己的 import 合并
- [ ] `_inlineVarProps` 标注了需要提取的复杂 prop
- [ ] 文件头部有组件映射说明的 JSDoc 注释
- [ ] 已在 `index.ts` 中注册

### stateData / componentData（如使用）
- [ ] `stateData` 中的值为纯 JSON（不含 JSX/函数），可序列化
- [ ] `componentData` 中的值含 JSX 时，通过 `__type: 'renderFn'` 或 `__type: 'loop'` 定义
- [ ] `componentData` 的 key 避免与 `stateData` 重名（一个走 state.js，一个走模块 const）
- [ ] 没有将函数/表达式错误地放入 `stateData`
- [ ] `stateData` / `componentData` 不产生副作用，输入相同始终输出相同
- [ ] `renderFn` 的 `extract: true` 配合 `refName` 使用
- [ ] `renderFn` body 是 CodeGenNode 树，不是 `__rawExpr` 字符串

---

## 8. 参考组件场景分类

| 场景 | 映射模式 | 参考组件 |
|------|----------|----------|
| 纯同名映射 | `tag + import` | Button, Panel |
| prop 改名 | `tag + import + propsMap` | Badge(count→content) |
| 枚举值转换 | `tag + import + valueMap` | Rating(emoji→star) |
| 改名+枚举 | `tag + import + propsMap + valueMap` | Variant |
| props 结构重组 | `tag + import + transform` | Badge(color→style) |
| children 包裹 | `tag + import + transform` + `child.wrapper` | Carousel(→CarouselItem) |
| 受控绑定升级 | `tag + import + transform` | Input, Switch, TextField |
| 含函数 prop 提取 | `tag + import + transform + _inlineVarProps` | Table(columns) |
| 数据转换 | `tag + import + transform` + `stateData`/`componentData` | Table(columns+render) |
| renderFn 抽取 | `tag + import + transform` + `__type: 'renderFn'` + `extract: true` | Table(columns.render) |
| 循环渲染 | `tag + import + transform` + `__type: 'loop'` | List, Table(body) |
| icon 组件映射 | `tag + import + transform` + `resolveIcon()` | Icon |
| icon 属性处理 | `tag + import + transform` + `resolveIcon()` | Menu, Tree, List |

---

## 9. Icon 处理

### 9.1 概述

excode 管线通过 **ResolveIcons** 步骤统一收集页面中所有 icon 名称，调用远程 API 获取 @hui/icon-plus 的映射关系，存入 `ctx.iconNameMap`。映射文件在 transform 中通过 `resolveIcon()` 工具函数将 A2UI icon 名称转换为 CodeGenNode。

### 9.2 数据流

```
A2UI JSON 中的 icon 名称
  │
  ▼
ResolveIcons 步骤
  ├─ 从节点树收集: Icon.props.name, *.props.icon, items[].icon, children[].icon
  ├─ 从 state 数据收集: 递归遍历 state 对象（深度 ≤ 20）
  ├─ 从 DataBinding 收集: 解析 __binding 路径，从 rawState 取值后递归
  └─ 调用 API: GET /api/icons/search?keyword={names}&topK=2（batch=6，并发）
  │
  ▼
ctx.iconNameMap: Record<string, string>
  例: { 'home': 'IconPlusIcIctHome', 'menu': 'IconPlusIcIctMenu', ... }
  │
  ▼
映射文件 transform 中:
  import { resolveIcon } from './Icon'
  resolveIcon(iconName, iconNameMap, extraProps?)
  │
  ▼
CodeGenNode: { __nodeType: 'component', tag: 'IconPlusIcIctHome', import: '@hui/icon-plus', importMode: 'named', props: { shape: 'outline' }, selfClosing: true }
```

### 9.3 resolveIcon() 工具函数

**位置**：`config/mappings/eview-react/Icon.ts`

```ts
import { resolveIcon, PLACEHOLDER_ICON } from './Icon';

/**
 * 将 A2UI icon 名称转换为 @hui/icon-plus 的 CodeGenNode
 *
 * @param iconName    - A2UI icon 名称（如 'home', 'menu'）
 * @param iconNameMap - ResolveIcons 步骤产出的映射表（ctx.iconNameMap）
 * @param extraProps  - 可选额外 props（如 { color, className, shape }）
 * @returns CodeGenNode | null
 *
 * 返回的 CodeGenNode:
 *   { __nodeType: 'component',
 *     tag: 'IconPlusIcIctHome',
 *     import: '@hui/icon-plus',
 *     importMode: 'named',
 *     props: { shape: 'outline', ...extraProps },
 *     children: null,
 *     selfClosing: true }
 *
 * 未找到映射时返回 PLACEHOLDER_ICON（避免生成失败）
 */
```

### 9.4 在映射文件中使用

#### 场景 A：Icon 组件（直接渲染 icon）

```ts
// config/mappings/eview-react/Icon.ts
import { resolveIcon, PLACEHOLDER_ICON } from './Icon';

export default {
  tag: 'IconPlusIcIctHome',    // 动态 tag，实际由 resolveIcon 决定
  import: '@hui/icon-plus',     // 动态 import，实际由 resolveIcon 决定

  transform(node, { iconNameMap }) {
    const p = { ...(node.props || {}) };
    const iconName = p.name || '';
    delete p.name;

    // 使用 resolveIcon 生成 CodeGenNode
    const iconNode = resolveIcon(iconName, iconNameMap, {
      color: p.color,
      className: p.className,
      shape: p.shape || 'outline',
    });

    // 将 icon 作为 componentData 返回，主变量引用
    return {
      props: { ...p, icon: { __varRef: 'pageIcon' } },
      children: node.children,
      componentData: { pageIcon: iconNode },
    };
  },
};
```

#### 场景 B：Menu 等组件（items 数据中的 icon 字段）

```ts
// config/mappings/eview-react/Menu.ts
import { resolveIcon } from './Icon';

export default {
  tag: 'Accordion',
  import: '@nce/eview-react/Accordion',

  transform(node, { rawState, iconNameMap }) {
    const p = { ...(node.props || {}) };

    // 处理 items 中的 icon
    if (Array.isArray(p.items)) {
      p.items = p.items.map(item => {
        if (item.icon) {
          const iconNode = resolveIcon(item.icon, iconNameMap);
          if (iconNode) {
            return { ...item, icon: iconNode };
          }
        }
        return item;
      });
    }

    return { props: p, children: node.children };
  },
};
```

### 9.5 importMode: 'named' 说明

@hui/icon-plus 使用命名导出（named export），每个 icon 是一个独立的命名导出：

```ts
import { IconPlusIcIctHome, IconPlusIcIctMenu } from '@hui/icon-plus';
```

映射文件中通过 `importMode: 'named'` 告知 ImportCollector 使用命名导入语法。该字段在 `resolveIcon()` 返回的 CodeGenNode 中自动设置。

### 9.6 验证清单

- [ ] Icon 组件映射使用 `resolveIcon()` 而非手动构造 CodeGenNode
- [ ] 含 icon 属性的组件（Menu, Tree, List 等）在 transform 中调用 `resolveIcon()`
- [ ] `resolveIcon()` 从 `./Icon` 导入
- [ ] `iconNameMap` 从 transform context 获取
- [ ] 未找到映射时使用 `PLACEHOLDER_ICON` 兜底
- [ ] ResolveIcons 步骤在 BuildTrees 之后、GenerateComponents 之前执行
- [ ] ResolveIcons 覆盖了节点树 + state 数据 + DataBinding 中的 icon 名称