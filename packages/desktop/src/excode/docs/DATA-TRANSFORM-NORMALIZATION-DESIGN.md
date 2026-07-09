# excode 数据转换架构 — 归一化设计

> 本文档为设计讨论的整理稿，核心设计哲学是**归一化与统一化**。
> 历史参考：[DATA-TRANSFORM-DESIGN.md](./DATA-TRANSFORM-DESIGN.md) — 已废弃的早期头脑风暴记录。

---

## 1. 设计核心思想

整个设计围绕**归一化**展开：

> **任何"内容"（纯数据 / JSX / 渲染函数 / slot 节点 / 数据转换产物）都走同一套机制来决定产出位置和变量命名。**

把当前散落在多个概念（`stateData` / `componentData` / `__varRef` / `__deleteFields` / 分散的 `DataRef`）中的"内容路由"职责**统一抽象为一个通用机制**。

---

## 2. 三种 path 绑定场景（已确认）

| 场景 | A2UI 形态 | 取值上下文 |
|------|----------|-----------|
| 绝对路径 | `{ path: "/systemName" }` | state 根节点 |
| 相对路径 | `{ path: "col1Top" }` | 循环 item（局部上下文） |
| 循环 children | `children: { path: "/listItems", componentId: "mCnListItem" }` | 数据源 = state 根 / item 上的数组字段 |

循环中也可以出现绝对路径（同一模板内同时引用 item 字段和 state 根数据）。

---

## 3. 设计关键决策

### 3.1 两阶段处理：判断 vs 执行

```
阶段一：transform 阶段（编译时）
  - 节点解析、绑定标记、子树解析（resolveNode）
  - 看到 path 绑定 → 拿到原始值（预取值）
  - 判断"要不要转换" → 声明"怎么转换"（返回 DataRef 描述符）
  - **不在 transform 内当场转换数据**

阶段二：集中收集阶段（所有节点 transform 完毕后）
  - 递归遍历所有节点树（children / slot / renderFn body / loop template body / wrapper）
  - 收集所有 DataRef 描述符
  - 根据去重规则统一调用转换函数
  - 生成新的 outputState
  - 按产物类型自动路由（state.js / 模块常量 / 组件内）
```

### 3.2 transform 预取值的核心价值

当前痛点：transform 内 props 是 `{ __binding: true, path: '/xxx' }`，看不到实际值。

新设计：在 transform 执行前，管线根据 `__binding.path` 从 rawState 预解析出值，**把实际值放到节点上**。transform 运行时直接能看到值，能判断"这个 string 要不要转成图标组件"。

### 3.3 新的 transform 返回形态

**`stateData` 字段被吸收掉**（自动路由代替手动声明）。

**`componentData` 字段被吸收进通用内容路由机制**（不再作为独立概念）。

**核心返回字段**：

```ts
{
  props: {
    [propKey]: PropValue  // 字面量 | binding | DataRef 描述符
  },
  children?: ...
  wrapper?: ...
  selfClosing?: ...
}
```

---

## 4. 统一的内容路由机制

### 4.1 核心抽象

**任何需要"提升到某处"的内容**都走同一套机制：

| 内容类型 | 路由目标 | 典型场景 |
|---------|---------|---------|
| DataRef 转换结果 | state.js / 组件函数内部 | 表格 columns 转换 |
| `__slotNode` | 模块常量 / 组件内 | Carousel 的 CarouselItem 提升 |
| `__rawExpr`（`() => {}`） | 模块常量 | 自定义事件处理函数 |
| `renderFn` 抽取 | 模块常量 | columns 中 render 函数 |
| Loop 数据源转换结果 | state.js / 组件函数内部 | 循环数据源的转换 |

### 4.2 描述符统一结构

不同内容类型的描述符略有不同（因为语义不一样）：

```ts
// DataRef 描述符 — 转换函数产出不确定是否含 JSX
interface DataRef {
  __type: 'dataRef'
  key: string                        // state 顶层 key（第一段）
                                     // 绝对路径 '/a/b' → key='a'
                                     // 绝对路径 '/a/c/0' → key='a'
                                     // 相对路径（循环内）→ key=循环数据源顶层 key
  source: string                     // 完整访问路径（accessPath）
                                     // '/a/b' → 'a.b'
                                     // '/a/c/0' → 'a.c[0]'
                                     // 相对路径 → item 字段访问路径
  transform: (rawValue, ctx) => any  // 转换函数（rawValue = source 对应的实际值）
  containsJSX: boolean               // ★ 显性标记产出是否含 JSX
  nameBuilder?: (ctx) => string      // 变量名生成函数
}

// 已知含 JSX 的内容（slot / renderFn / rawExpr 等）— 不需要 containsJSX
interface HoistedContent {
  __type: 'hoisted'
  content: CodeGenNode | any        // 节点树
  destination: 'module' | 'component'  // 仅这两个目标（state 已被排除）
  nameBuilder?: (ctx) => string     // 变量名生成函数
}
```

**关键区别**：
- **DataRef**：转换函数产出可能含 JSX 也可能不含 → 必须有 `containsJSX` 标记来决策路由
- **HoistedContent**：本身就是 JSX（`__slotNode` / `renderFn` / `__rawExpr` 都是 JSX 节点）→ 不需要 JSX 标记，destination 直接是 `'module'` 或 `'component'`

### 4.3 变量名自动生成

- **默认实现**：管线根据 `componentId + propKey + source` 组合生成唯一变量名
- **可覆盖**：transform 作者可以提供 `nameBuilder` 函数
- 函数签名统一：`nameBuilder: (ctx) => string`

### 4.4 路由决策规则

DataRef 路由决策（根据 `containsJSX`）：

| `containsJSX` | 实际产物位置 |
|---------------|-------------|
| `false` | state.js（纯数据，可序列化） |
| `true` | 组件函数内部（hooks 后、return 前） |

HoistedContent 路由决策（直接根据 `destination`）：

| `destination` | 实际产物位置 |
|--------------|-------------|
| `'module'` | 模块文件顶层 const 声明 |
| `'component'` | 组件函数内部 |

JSX 标记是**结构性判断**——DataRef 一旦标了 `containsJSX: true`，管线保证它不进 state.js。HoistedContent 本身就是 JSX，destination 不可能是 state。

---

## 5. 循环场景的特殊处理

### 5.1 循环的"特殊处理"是收集层面的事

DataRef 自身**不需要**加循环标识字段。循环结构是 TreeBuilder 阶段识别出来的（`children: { path, componentId }`），收集阶段自然知道：

- 这是循环结构
- 模板子树里所有相对路径 DataRef 要按"逐 item 应用"处理
- 收集模板子树里所有 DataRef
- 对原数组每个 item 逐一应用

### 5.2 循环数据转换的处理流程

```
1. 识别循环结构（TreeBuilder 已做）
2. 收集模板子树里的所有 DataRef（按相对路径针对 item 字段）
3. 转换：
   - 取原数组 = rawState[loopPath]
   - 对每个 item，逐一应用收集到的 DataRef 转换函数
   - 产出新数组
4. 路由：
   - 任何 item 的转换结果含 JSX → 整个新数组走模块常量
   - 否则走 state.js
5. 变量名：自动生成（或 nameBuilder 覆盖）
6. JSX 生成：
   - 数据源 prop 替换为 { __varRef: 'auto_generated_name' }
   - 模板渲染 `xxx.map((item, idx) => ...)`
```

### 5.3 循环数据源统一规则

**循环内只要有任何一项的数据转换包含 JSX，整个循环数据源就不进 state.js**。这是设计模式的统一（避免逐项判断的复杂性）。

---

## 6. 数据转换函数去重

### 6.1 相同组件 + 相同 prop + 相同 path

去重依据：`componentName + propName + path`（三元素组合）。

```
两个 Menu 都 bind 到 /menuItems
→ 转换函数定义一次（transform 中）
→ 数据转换执行一次
→ 共享同一个新 key
```

### 6.2 不同组件绑定到同一 path

| 情况 | 第一个组件 | 第二个组件 | 第三个组件 |
|------|----------|----------|----------|
| 全部有转换 | 保留原 key | 新 key `xxx_transform_1` | 新 key `xxx_transform_2` |
| 部分有转换 | 原 key（不转换） | 新 key | 新 key |

如果任一转换含 JSX，对应的新 key 走模块常量，否则走 state.js。

---

## 7. 嵌套子树的内容路由

### 7.1 关键约束：节点树必须预解析

renderFn.body / `__slotNode` / loop template body 中的子节点树**必须在 transform 阶段就通过 `resolveNode` 预解析为完整的 CodeGenNode 树**。数据转换函数不执行 resolveNode，只把预解析好的节点树嵌入新数据结构。

### 7.2 后续处理一致性

预解析好的节点树不管从哪里来（transform 内部 / DataRef 转换结果 / hoisted 内容），后续 ImportCollector、JsxSerializer、StateTransformer 都能照常处理。**管线不感知"这段内容是从哪来的"**，只处理节点树。

### 7.3 递归收集

收集阶段需要递归遍历所有嵌套结构收集 DataRef：

```ts
collect(node) {
  // 1. 当前节点 props 中的 DataRef
  // 2. 递归 children
  // 3. 递归 __slotNode
  // 4. 递归 renderFn.body
  // 5. 递归 loop template.body
  // 6. 递归 wrapper
}
```

---

## 8. 与现有架构的对比

| 概念 | 当前设计 | 新设计 |
|------|---------|--------|
| stateData | 手动声明纯数据 | 取消（自动路由） |
| componentData | 手动声明 + `__varRef` 配对 | 吸收进统一路由机制 |
| `__deleteFields` | 事后打扫 | 取消（outputState 声明式构建） |
| DataRef 字段 | 包含 outputMeta | 简化为 containsJSX + destination |
| 变量名 | 手动 `__varRef` | 自动生成 + nameBuilder 覆盖 |
| 循环数据 | `_loopPath` + `_loopBinding` + 包装为 `__type: 'loop'` | 同上，但数据转换统一在集中阶段处理 |
| `__slotNode` / `__rawExpr` 提升 | 散落在各 transform | 统一走内容路由机制 |

---

## 9. 待进一步讨论的点（细节落地清单）

### 设计层

1. **nameBuilder 的具体签名** — ctx 传什么字段，按节点类型（DataRef / HoistedContent / slot / renderFn）如何区分
2. **binding 表与 DataRef 的统一** — binding 表本质上是一个隐式 DataRef（useState + changeEvent），未来是否扩展支持 `containsJSX`、`transform`、`nameBuilder` 等字段；收集阶段两者如何统一处理
3. **输出新 state 后**，原始 rawState 中**未被任何 DataRef 引用的字段**是否保留？还是只保留 DataRef 产生的 + 被引用的 path 对应的字段？
4. **DataRef 的 transform 隔离约束** — transform 函数的执行环境中不应该有 `resolveNode`（因为收集阶段已经不在节点解析上下文中），需要明确 transform 的 ctx 入参能传什么、不能传什么
5. **HoistedContent 中 destination: 'component' vs 'module'** — 具体什么场景用 component 内部，什么场景用 module 顶层？是否只需要 'component' 就够了？

### 实现层

6. **预取值挂载方式** — 在 transform 执行前，具体怎么把 path 对应的值挂到节点上？是替换 `{ __binding: true, ... }` 为实际值，还是新增 `_resolvedValue` 字段？
7. **DataRef 在 props 中的形态变化时机** — transform 返回 `{ __type: 'dataRef', ... }` 后，什么时候替换为 `{ __varRef: 'autoName' }`？在收集阶段替换还是 transform 返回时替换？
8. **收集阶段的执行顺序** — 多个不同 key 的 DataRef 是否并行处理？是否存在依赖关系需要串行？
9. **去重规则细化** — 去重依据 `componentName + propName + path` 三元素组合是否足够？path 深层时（如 `/a/b` 和 `/a/c`）key 相同但 source 不同，是否仍视为不同 DataRef？
10. **相同 key、相同组件、不同 prop 的场景** — 如 `/menuItems` 被 Menu 的 `items` 和 `selectedKeys` 同时绑定，分别如何生成新 key？

### 循环层

11. **嵌套循环中的 DataRef** — item 上的子数组作为循环数据源，内层循环的 DataRef 如何处理？变量名如何生成避免冲突？
12. **相对路径 DataRef 与循环数据源的关联** — 收集阶段如何知道一个 `source: 'col1Top'`（相对路径）属于哪个循环数据源？通过 TreeBuilder 阶段的循环上下文链来推导？
13. **循环数据源本身的 DataRef** — 循环数据源的 path 如果是 `/listItems`，它本身是否需要 DataRef 转换？还是只对模板内的相对路径字段做转换？

### 迁移层

14. **现有映射文件的迁移策略** — Menu.ts（stateData + componentData + __deleteFields）、Table.ts（renderFn + _inlineVarProps + componentData）、Input.ts（binding 表 + two-way）、Tabs.ts（binding + _isLoop 检测）等核心映射文件的迁移示例和步骤
15. **过渡期兼容策略** — 新旧 transform 返回格式能否共存？还是需要一次性迁移？
16. **stateData / componentData / __deleteFields 等废弃字段的兼容处理** — 收集阶段是否兼容旧格式？

### 验证层

17. **测试策略** — 如何验证新架构的正确性？与当前产出的 diff 对比方式？有哪些边界 case 需要覆盖？
18. **现有 pages-source/orderAdmin 的端到端验证** — 用真实的 A2UI JSON 跑通全管线，对照产物

### 扩展示例

19. **两层嵌套循环的 DataRef 处理示例** — 外层 `/menuGroups`，内层相对路径 `children`，相互独立的转换函数如何收集、命名、路由
20. **同时包含纯数据 + JSX 转换的示例** — 同一个组件（如 Table）的 `columns` 含 JSX render 和 `dataSource` 纯数据转换，在同一个 transform 中如何表达

---

## 10. 文件影响

### 核心改动

| 文件 | 改动 |
|------|------|
| `src/core/ComponentRegistry.ts` | TransformContext 调整，移除 rawState；transform 返回字段调整 |
| `src/steps/GenerateComponents.ts` | 新增内容路由阶段（DataRef 收集 + 集中转换 + 新 outputState 构建） |
| `src/resolver/BindingResolver.ts` | 预取值挂载到节点（transform 阶段可见） |
| `src/codegen/JsxSerializer.ts` | 处理统一的内容路由产物 |
| `src/codegen/StateTransformer.ts` | 处理统一的内容路由产物 |
| `src/codegen/StateStrategy.ts` | 取消 stateData 合并逻辑，按新策略构建 initialState |
| `src/core/stateUtils.ts` | `resolveBindingValue` 标记 deprecated |

### 文档更新

| 文件 | 改动 |
|------|------|
| `docs/DATA-STRUCTURE.md` | 更新节点结构和 Props 值类型 |
| `docs/COMPONENT-MAPPING-GUIDE.md` | 更新 transform 写法 |
| `docs/DATA-TRANSFORM-DESIGN.md` | 标记废弃（保留作为历史） |

### 映射文件迁移

| 文件 | 改动 |
|------|------|
| `config/mappings/eview-react/Menu.ts` | 迁移到新设计 |
| `config/mappings/eview-react/Table.ts` | 迁移到新设计 |
| 其他映射文件 | 按需迁移 |

---

## 11. 设计优势

1. **归一化**：所有内容路由走同一套机制，不再有 `stateData` / `componentData` / `__varRef` 等散落概念
2. **零 runtime 开销**：所有数据转换在编译期完成（现有架构已具备）
3. **transform 作者负担降低**：不用关心命名、destination 路径、__deleteFields 等细节
4. **冲突自动避免**：管线自动生成唯一变量名
5. **可扩展性强**：新增内容类型只需支持统一描述符
6. **类型清晰**：`containsJSX` 显性标记，路由决策不再隐式推导

---

> **文档版本**：v0.3（设计讨论整理稿）
> **状态**：设计讨论阶段（主要决策已确定，待细节落地）
> **日期**：2026-07-08
