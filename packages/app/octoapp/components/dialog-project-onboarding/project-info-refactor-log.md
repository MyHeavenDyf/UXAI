# Project Info Refactor Log

## 改动文件

### 1. `components/dialog-project-onboarding.tsx`

- 保持原来自绘样式（`fixed inset-0 z-50` overlay + 白色卡片），不使用 `Dialog` UI 组件
- 蒙层背景 `rgba(0, 0, 0, 0.5)`
- 卡片样式保持原样：`width: 400px`、`height: 520px`、`background: white`、`border-radius: 8px`、`padding: 40px`、`box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15)`
- 将 `ProjectInfoDialogContent` 作为表单项嵌入弹窗内容，表单项标题为"选择项目&版本"
- 确认按钮调用 `props.onSelect(dir)`（无 `dialog.close()`，因为不再使用 dialog 系统）

### 2. `pages/cowork/components/project-info.tsx`

- 不再使用 `dialog.show()`，改为 `createSignal` + `<Show>` 控制弹窗显隐
- 点击区域 `onClick={() => setVisible(true)}`
- `<Show when={visible()}>` 渲染 `DialogProjectOnboarding`，`onSelect` 回调为 `() => setVisible(false)`
- 导入从 `./project-info-dialog` 改为 `@/components/dialog-project-onboarding`

### 3. `octo.tsx`

- `OnboardingLayer` 恢复为 `<Show>` 内联渲染方式（与原来一致）
- 移除 `useDialog` 和 `createEffect` 导入（不再需要）

---

## 追加改动

### 4. `style/dialog.css`

- 尝试新增 CSS 规则覆盖蒙层背景色，但因 `@layer` 层级和 DOM 结构问题未生效，已移除
- 最终方案：保持原来自绘样式，不使用 `Dialog` UI 组件，无需额外 CSS

### 5. `pages/cowork/components/project-product-select.tsx`

- Popover 加 `portal={false}` 使下拉面板内联渲染，避免与 dialog overlay 的 z-index 冲突导致定位不准和无法点击
- style 中新增 `"max-width": "560px"` 覆盖 CSS 默认的 `max-width: 320px` 限制

---

## 第二轮改动（样式 + 数据流 + 缓存）

### 6. Popover 定位修复

- `project-product-select.tsx` — 添加 `portal={false}` + `placement="bottom-start"`，下拉面板在 dialog overlay 的 containing block 内内联渲染，避免 portal 渲染到 body 层级后与 `fixed inset-0 z-50` overlay 之间的 floating-ui 定位偏差和事件冲突
- `dialog-project-onboarding.tsx` — dialog box 添加 `overflow: "visible"`，确保 560px popover 内容不被 400px dialog 边界裁剪

### 7. 弹窗样式调整（对话框布局）

| 元素 | 样式规格 |
|------|----------|
| Splash 图标 | `w-[80px] h-[80px]`，距弹窗顶部 40px（padding-top） |
| "Octo Agent ." | `font-size: 24px`，居中，上边距 20px |
| 副标题 "您的全能设计与调研专家" | `font-weight: 500, font-size: 16px, line-height: 24px, letter-spacing: 2px, color: rgba(110,115,122,1), 居中, 上边距: 4px` |
| "选择项目&版本" | `font-weight: 500, font-size: 16px, line-height: 19px, 左对齐, 上边距: 40px` |
| ProjectInfoDialogContent | `width: 100%, height: 40px, 上边距: 4px` |
| "关联本地文件夹" | `font-weight: 500, font-size: 16px, line-height: 19px, 左对齐, 上边距: 16px` |

- 移除所有 `mb-5` Tailwind class，改为各元素独立 `margin-top` 控制间距
- dialog padding 从 `"32px"` 改为 `"40px 32px 32px 32px"`

### 8. ProjectProductSelect trigger 样式

- `width: 220px, height: 40px, border-radius: 8px, background: white`
- `justify-content: flex-start`（文本左对齐）
- 右侧 chevron-down SVG 下拉图标（`viewBox 0 0 16 16`）
- 文本 overflow 时 `text-overflow: ellipsis` truncate

### 9. Select 版本下拉样式

- `triggerStyle: { width: "110px", height: "40px", border-radius: "8px", border: 1px solid rgba(0,0,0,0.15), background: white }`

### 10. 版本数据动态获取

- `project-product-select-panel.tsx` — 新增 `fetchVersions(productId)` async 函数，按产品 ID 返回版本列表
- `project-info-dialog-content.tsx` — 使用 `createResource(() => store.product?.id, fetchVersions)` 动态获取版本
- 版本自动选中逻辑：版本列表加载后，若当前 version 在新列表中存在则保留，否则选中第一项
- 产品切换时版本自动跟随更新

### 11. 数据流：确定按钮 → project-info.tsx

新增类型和接口（`project-product-select-panel.tsx`）：
- `Version = { value: string; label: string }`
- `ProjectSelection = { directory, domain?, productLine?, product?, version? }`

数据流链路：
```
ProjectProductSelect (onSelectionChange: domain/productLine/product)
  → ProjectInfoDialogContent (onSelectionChange: domain/productLine/product/version)
    → DialogProjectOnboarding (selections store)
      → onSelect(data: ProjectSelection)
        → project-info.tsx (setSelection + saveCachedSelection)
```

- `ProjectProductSelect` 新增 `onSelectionChange` prop，内部 `createEffect` 回调
- `ProjectInfoDialogContent` 新增 `onSelectionChange` prop，内部 store 同步 product + version 并回调
- `DialogProjectOnboarding` 新增 `selections` store，confirm 时将 selections + directory 组合为 `ProjectSelection` 传给 `onSelect`
- `project-info.tsx` 接收 `ProjectSelection`，动态显示：产品名称 / 题域/产品线 / 版本

### 12. 默认值 + 缓存机制

- `project-product-select-panel.tsx` — 新增 `saveCachedSelection()` / `loadCachedSelection()`，基于 localStorage 持久化
- `ProjectProductSelect` — 新增 `defaultDomain/defaultProductLine/defaultProduct` props，store 初始化使用传入默认值（而非 undefined）
- `ProjectInfoDialogContent` — 新增 `defaults` prop，store 初始化使用默认值，传递给 `ProjectProductSelect`
- `DialogProjectOnboarding` — 新增 `defaults` prop（类型 `ProjectSelection`），selections store 初始化使用默认值，传递给 `ProjectInfoDialogContent`
- `project-info.tsx` — 页面加载时 `loadCachedSelection()` 优先恢复缓存；无缓存时用 fallback（ICT/CANN/PYPTO/v2612304）。确认时 `saveCachedSelection` 写入缓存，下次打开对话框 defaults 传入当前选中值

### 13. octo.tsx 适配

- `handleOnboardingSelect` 签名从 `(directory: string)` 改为 `(data: { directory: string })`，内部改为 `data.directory`

---

## 第三轮改动（选中高亮修复）

### 14. Column 组件 `.map()` → `<For>` 替换

- `project-product-select-panel.tsx` 的 `Column` 组件中，`props.items.map()` 替换为 SolidJS 的 `<For each={props.items}>`
- 原因：`.map()` 不是 SolidJS 的响应式列表渲染方式，`selectedId` 变化时旧 DOM 节点的 style 不会重新计算，导致旧选中项的高亮不会取消
- `<For>` 是 SolidJS 的响应式列表原语，callback 中 `item` 是值本身（不是 getter），直接用 `item.id` / `item.label`
- 修正：首次修改误写 `item()`（getter 调用方式），导致运行时报错，已改为 `item` 直接访问
- 新增 `import { For } from "solid-js"`

但泛型函数组件 `Column<T>` 的 `props` 可能未被 SolidJS 正确创建为响应式代理，`props.selectedId` 变化时 DOM style 不更新，高亮仍不切换。最终方案：

- 移除泛型 `Column<T>` 组件，将三列渲染（领域、产品线、产品）内联到 `ProjectProductSelectPanel` 的 JSX 中
- 每列使用 `<For each={...}>`，选中判断 `item.id === props.domain?.id` / `props.productLine?.id` / `props.product?.id` 直接在面板组件的响应式 JSX 内，确保 `props` 变化时 style 能正确更新

内联后高亮仍不切换，原因是 style 对象中直接写 `item.id === props.xxx?.id` 三元表达式不被 SolidJS 编译器识别为动态依赖。参考项目中 `tab-bar.tsx` 的模式：

- 每个 `<For>` 回调内声明 **derived signal**：`const isSelected = () => item.id === props.productLine?.id`
- style 中使用 `isSelected()` 调用 derived signal，SolidJS 编译器才能正确追踪 `props.productLine?.id` 的变化并创建响应式 effect
- onClick 中也使用 `if (isSelected()) return` 替代 `if (item.id === props.productLine?.id) return`

derived signal 模式测试后仍有两个选项同时高亮。改为更直接的方案：

- 每个 `<For>` 回调内使用 `createEffect` + `ref={el}` 手动更新 DOM style
- `createEffect` 中显式访问 `item.id === props.productLine?.id` 并直接操作 `el.style.background` / `el.style.color`
- 静态 style 只设置 `font-size` / `padding` / `cursor` / `border-radius`
- 绕过 SolidJS JSX style 编译，`createEffect` 显式追踪 `props.productLine?.id` 的变化并手动更新 DOM

`createEffect` + `ref` 方案测试后仍然两个高亮，说明 `props.productLine?.id` 本身不响应 `setStore` 的变化。根因推断：SolidJS JSX 编译器对 `store.productLine` 不识别为动态表达式，`productLine={store.productLine}` 传入的是静态值。

### 16. `project-product-select.tsx` 从 `createStore` 改为 `createSignal`

- `domain` / `productLine` / `product` / `hideClosed` / `search` 各自独立 `createSignal`
- JSX 传参改为 `domain={domain()}` / `productLine={productLine()}` 等 — `signal()` 是 SolidJS 编译器明确识别的动态调用，确保 props 传入的是 getter 而非静态值
- `onDomainChange` / `onProductLineChange` / `onProductChange` 等回调直接传 signal setter（`setDomain` / `setProductLine` / `setProduct`），无需包装 `(v) => setStore("xxx", v)`
- `onSelectionChange` effect 改为读取 `domain()` / `productLine()` / `product()`
- `selectedLabel` 改为 `domain()?.label` / `productLine()?.label` / `product()?.label`

`createSignal` 解决了双高亮问题，但点击切换回之前的选项（如产品线从第二项切回第一项）时选中不生效。原因是 `props.productLine?.id` 在 `<For>` 的 `createEffect` 中仍不被正确追踪（`props` 是组件代理，`?.id` 在代理返回值上访问静态属性）。

### 17. 面板内部本地 `createSignal` 管理选中 ID

- `ProjectProductSelectPanel` 内新增三个本地 signal：`selectedDomainId` / `selectedProductLineId` / `selectedProductId`（类型 `string | undefined`）
- 三个 `createEffect` 从 props 同步到本地 signal：`setSelectedDomainId(props.domain?.id)` 等
- `<For>` item 的 `createEffect` 改为追踪本地 signal：`item.id === selectedProductLineId()`
- onClick 中同时更新本地 signal 和调用 props 回调：`setSelectedProductLineId(item.id)` + `props.onProductLineChange(item)`
- 移除 onClick 的 `if (item.id === props.xxx?.id) return` 提前返回检查（本地 signal 保证即时更新，即使点击同一项也不会产生无效循环）
- `createResource` 的 key 函数改为追踪本地 signal：`() => selectedDomainId()` / `() => selectedProductLineId()`

### 18. 下拉面板闪屏修复 — `createResource` → `createMemo`

- 点击领域/产品线选项时下拉面板闪烁，原因是 `createResource` 在 key 变化时异步重新 fetch，期间 `productLines()` 返回 `undefined`，`<For each={productLines() ?? []}>` 渲染空列表后再重新填充
- 领域、产品线、产品数据都是静态映射，改为 `createMemo` 同步计算，消除异步 fetch 的 pending 空状态
- 移除 `fetchDomains` / `fetchProductLines` / `fetchProducts` 三个 async 函数，数据以 `Record<string, ...[]>` 常量内联到面板组件中
- `domains` memo：默认返回全部领域列表；`productLines` memo：按 `selectedDomainId()` 查表；`allProducts` memo：按 `selectedProductLineId()` 查表
- `filteredProducts` 改为基于 `allProducts()` 而非 `products()`（原 `products` resource 已移除）
- `fetchVersions` 保留（仍由 `project-info-dialog-content.tsx` 的 `createResource` 使用）
- auto-select effect 的 `if (!list) return` 改为 `if (!list?.length) return`（memo 返回空数组而非 undefined）

改为 `createMemo` 后闪屏仍存在，原因是 Popover `portal={false}` 将面板内联渲染在 trigger button 的 DOM 树内，点击面板选项时 click 事件冒泡到 trigger button，导致 Popover 关闭再打开。

### 19. 阻止 click 事件冒泡

- 所有 `<For>` item 的 onClick 加 `e.stopPropagation()`
- 防止点击面板内的选项时冒泡到 Popover trigger button，避免 Popover 关闭再打开的闪屏

### 15. 产品选择框与版本选择框间距调整

- `project-info-dialog-content.tsx` — flex 容器 `gap` 从 `"12px"` 改为 `"4px"`

---

## 第四轮改动（面板样式重构 - 按设计图）

### 20. `project-product-select-panel.tsx` 面板样式重构

- 外层容器新增白色背景、圆角 `12px`、阴影 `0 4px 16px rgba(0,0,0,0.12)`
- 顶部工具栏：`padding: 12px 16px`，底部分隔线 `1px solid rgba(0,0,0,0.08)`
- "全部项目" 标签：灰色背景 `rgba(0,0,0,0.04)`，圆角 `4px`，内边距 `2px 8px`
- "隐藏已结项" 文字 + Switch 组合，文字颜色 `rgba(0,0,0,0.5)`
- 搜索框：背景 `rgba(0,0,0,0.02)`，边框 `rgba(0,0,0,0.1)`，圆角 `6px`，右侧内嵌搜索图标 SVG
- 列标题（领域/产品线/产品）：`font-weight: 600`，`font-size: 13px`，`margin-bottom: 8px`
- 选中项样式：背景 `rgba(37, 99, 235, 0.08)`（浅蓝），文字颜色 `#2563EB`（蓝色）
- 未选中项：文字颜色 `#191919`，背景透明
- 列分隔线：`1px solid rgba(0,0,0,0.08)`
- 列表项间距：`margin-bottom: 2px`，圆角 `6px`，padding `6px 8px`
- 高亮逻辑改用 `createEffect` + `ref` 手动操作 DOM style（绕过 SolidJS JSX style 编译限制）

### 21. `project-product-select.tsx` Popover 容器样式调整

- 宽度从 `522px` 改为 `560px`
- 高度从 `400px` 改为 `420px`
- 背景设为 `transparent`，阴影和圆角移除（由面板自身提供）

### 22. 领域列表始终展示全部数据

- `project-product-select-panel.tsx` — `domains` memo 改为固定返回全部领域列表（ICT / 云计算 / AI），不再根据选中状态过滤

### 23. Switch 开关样式定制

- `project-product-select-panel.tsx` — Switch 外层包裹 `<div class="panel-switch">`
- `style/switch.css` — 新增 `.panel-switch` 样式覆盖：
  - 外框：宽 26px、高 14px、圆角 7px、背景 `rgba(194, 194, 194, 1)`、无边框
  - 内开关：宽 12px、高 12px、圆角 7px、背景白色、`translateX(1px)`（未选中）/ `translateX(13px)`（选中）
  - 选中态外框背景 `#0A59F7`

### 24. 修复切换领域/产品线时双高亮问题

- `project-product-select-panel.tsx` — 移除 `createEffect` + `ref` 手动更新 DOM style 的方案，改用 SolidJS 原生 `classList` 指令
- 新增 `<style>` 块定义 `.panel-item` 基础样式和 `.panel-item-selected` 选中样式（浅蓝背景 + 蓝色文字）
- `classList={{ "panel-item": true, "panel-item-selected": item.id === selectedXxxId() }}` 由编译器直接追踪信号变化，自动清理旧状态，彻底解决双高亮

### 25. 搜索功能重构 — 调用后台接口 + 平铺结果

- `project-product-select-panel.tsx` — 新增 `searchProducts(keyword)` async 函数，搜索所有领域下的产品，返回 `{ domain, productLine, product }` 平铺结果
- 新增 `createResource(() => props.search, searchProducts)` 响应式搜索
- 使用 `<Show when={isSearching()}>` 条件渲染：有搜索词时隐藏三列，展示平铺搜索结果；无搜索词时恢复三列模式
- 搜索结果项显示 `领域 / 产品线 / 产品` 层级路径，点击直接选中完整链路（domain + productLine + product）
- 无结果时显示"未找到匹配的产品"提示

### 26. 搜索框图标交互优化

- `project-product-select-panel.tsx` — 搜索框右侧图标根据 `props.search` 值动态切换：
  - 无内容时：显示搜索图标（放大镜），`pointer-events: none`
  - 有内容时：显示关闭图标（X），`cursor: pointer`，点击调用 `props.onSearchChange("")` 清空搜索内容
- 使用 `<Show when={props.search} fallback={...}>` 条件渲染两种图标

### 27. 搜索结果项显示完整路径

- `project-product-select-panel.tsx` — 搜索结果项内部显示 `领域 / 产品线 / 产品` 完整路径
- 选中样式与三列保持一致（浅蓝背景 + 蓝色文字），路径文字颜色在选中态自动跟随

### 28. 版本选择框样式统一

- 新增 `style/select.css` — 版本选择框自定义样式：
  - Trigger 图标与产品选择框保持一致（chevron-down，16×16px）
  - 下拉面板白色背景、圆角 8px、阴影 `0 4px 16px rgba(0,0,0,0.12)`
  - 下拉项圆角 6px、padding 6px 8px、font-size 13px
  - 选中/高亮态：背景 `rgba(37, 99, 235, 0.08)`、文字 `#2563EB`（与产品下拉一致）
- `project-info-dialog-content.tsx` — 版本 Select 组件添加 `class="version-select-content"` 和 `triggerProps.class="version-select-trigger"`
- `style/index.css` — 导入 `select.css`

### 29. 下拉图标颜色统一

- `project-product-select.tsx` — 产品选择框 SVG `stroke` 直接改为 `rgba(119,119,119,1)`（不再使用 `currentColor`，避免被父级 `color` 覆盖）
- `style/select.css` — 版本选择框图标新增 `svg` 子选择器，强制 `stroke` 和 `fill` 为 `rgba(119,119,119,1)`

### 30. 修复点击选项时下拉面板闪烁

- `project-product-select-panel.tsx` — 最外层 div 添加 `onPointerDown={(e) => e.stopPropagation()}`
- 原因：`portal={false}` 内联渲染时，点击面板选项的 `pointerdown` 事件冒泡到 window，触发 Popover 的 outside click 检测导致关闭再打开
- 阻止 `pointerdown` 冒泡后，Popover 不会误判为外部点击，消除闪烁

---

## 第五轮改动（双高亮 + 点击选中项闪烁修复）

### 31. 双高亮修复 — `class` 模板字符串 → `classList` 响应式指令

- `project-product-select-panel.tsx` — 所有 `<For>` item 的 `class={`panel-item ${item.id === selectedXxxId() ? "panel-item-selected" : ""}`}` 替换为 `classList={{ "panel-item": true, "panel-item-selected": item.id === selectedXxxId() }}`
- 搜索结果项同样替换
- 原因：SolidJS 编译器不将模板字符串中的 `selectedXxxId()` 识别为动态依赖，信号变化时不会重新计算 class 字符串，导致旧选中项的 `panel-item-selected` 不被移除，新旧两个选项同时高亮。`classList` 是 SolidJS 的响应式 class 指令，编译器能正确追踪每个 key 的 signal 变化，自动添加/移除 class

### 32. 点击选中项闪烁修复 — 移除 auto-select `createEffect` + 同步级联选中

- `project-product-select-panel.tsx` — 移除三个 auto-select `createEffect`（领域/产品线/产品），改为在 onClick 中同步计算下级选中值
- **领域 onClick**：`if (item.id === selectedDomainId()) return` 提前跳过（点击已选中项不再触发任何状态变化），然后从 `productLineMap[item.id]` 取第一个 productLine，从 `productMap[nextPL.id]` 取第一个 product，一次性同步设置所有下级 signal
- **产品线 onClick**：`if (item.id === selectedProductLineId()) return`，从 `productMap[item.id]` 取第一个 product 同步设置
- **产品 onClick**：`if (item.id === selectedProductId()) return`
- 原因：原 auto-select `createEffect` 在 signal 变化时异步重新选中，导致面板经历"下级清空 → 重新选中"中间态；点击已选中项时也会触发 signal 写入 → effect 重新计算的无意义循环，产生视觉闪烁。移除 effect 后所有状态变化在同一批次同步完成

---

## 第六轮改动（点击选项闪烁修复）

### 33. 移除 props → 本地 signal 的 `createEffect` 同步回环

- `project-product-select-panel.tsx` — 移除三个 `createEffect`：
  - `createEffect(() => setSelectedDomainId(props.domain?.id))`
  - `createEffect(() => setSelectedProductLineId(props.productLine?.id))`
  - `createEffect(() => setSelectedProductId(props.product?.id))`
- 原因：这三个 effect 在用户点击选项时产生不必要的响应式回环——本地 signal 先由 onClick handler 设置，然后 props 回调更新父组件 signal → props 变化回流 → createEffect 再次设置本地 signal（同值但多一轮 effect 执行）。这增加了响应式系统的处理负担，可能在某些帧产生微小的视觉不一致。本地 signal 初始化已从 props 取值，用户交互也由 onClick handler 直接设置，无需 effect 同步
- 移除 `createEffect` import（面板不再使用）

### 34. 修正 `onPointerDown` 从 `preventDefault()` 改回 `stopPropagation()`

- `project-product-select-panel.tsx` — 最外层 div `onPointerDown` 从 `e.preventDefault()` 改为 `e.stopPropagation()`
- 原因：`preventDefault()` 在 `pointerdown` 上可能阻止浏览器生成后续 `click` 事件（Pointer Events 规范：`pointerdown` 被取消则不触发 `click`），导致部分浏览器/场景下选项无法点击或点击行为异常。`stopPropagation()` 只阻止事件冒泡，不影响 `click` 事件生成，且防止 `pointerdown` 事件到达 Popover trigger button 的 DOM 路径，与日志 #30 的原始修复意图一致

### 35. 移除 `portal={false}` — 消除点击选项闪烁的根本原因

- `project-product-select.tsx` — 移除 `portal={false}`，Popover 内容恢复为默认的 portal 渲染模式（渲染到 `document.body`）
- 保留 `placement="bottom-start"` 用于 floating-ui 定位
- 原因：`portal={false}` 将 Popover 内容内联渲染在 dialog overlay 的 DOM 树内（`fixed inset-0 z-50`），导致点击面板选项时闪烁。根因分析：
  - Popover wrapper 在 `window` 上注册了 capture 阶段的 `pointerdown` handler 做 outside-click 检测，Kobalte 的 `createInteractOutside` 在 `document` 上也注册了 capture 阶段的同名 handler
  - `portal={false}` 时内容在 dialog overlay 的 DOM 子树内，`pointerdown` 事件穿过 overlay 层级冒泡，与两套 outside-click 检测机制产生冲突，导致 Popover 被误判为 outside click 而关闭再打开
  - `portal={true}`（默认值）时内容渲染到 `document.body`，独立于 dialog DOM 树，事件不穿过 overlay 层级，两套检测机制均正确判定 "inside"，Popover 保持打开
  - Popover `style.z-index` 已设为 `"60"`（高于 overlay 的 `z-index: 50`），portal 渲染到 body 后内容仍能正确浮于 dialog 之上
- 此改动同时撤销了日志 #6 中因 `portal={false}` 而需要的 `overflow: "visible"` 修补（dialog card 的 `overflow: "visible"` 保留，不影响 portal 模式）

---

## 第七轮改动（数据获取改为后台接口）

### 36. `project-product-select-panel.tsx` — 静态数据 → `createResource` 后台接口

- 移除 `createMemo` import，面板内 `domains` / `productLines` / `allProducts` 三个 `createMemo` + 内联静态 Map 替换为 `createResource` 异步接口调用
- `domains`：`createResource(fetchDomains)`，无 key 参数（始终请求全量领域列表）
- `productLines`：`createResource(() => selectedDomainId(), fetchProductLines)`，key 为当前选中领域 ID
- `allProducts`：`createResource(() => selectedProductLineId(), fetchProducts)`，key 为当前选中产品线 ID
- `filteredProducts` 中移除本地搜索过滤逻辑（搜索由搜索模式独立处理），仅保留 `hideClosed` 过滤
- onClick handler 中领域/产品线切换不再内联计算下级选中值（原依赖静态 Map），改为清空下级 signal 为 `undefined` 并传 `undefined` 给 props 回调，由 `createResource` 异步加载后用户自行选择

### 37. 新增四个假接口函数（带 TODO 注释，待替换真实路径）

- `fetchDomains()` — `TODO: 替换为真实接口路径 — GET /api/domains`，返回 ICT/云计算/AI 领域列表
- `fetchProductLines(domainId)` — `TODO: 替换为真实接口路径 — GET /api/product-lines?domainId={domainId}`，按领域 ID 返回产品线列表
- `fetchProducts(productLineId)` — `TODO: 替换为真实接口路径 — GET /api/products?productLineId={productLineId}`，按产品线 ID 返回产品列表
- `fetchVersions(productId)` — `TODO: 替换为真实接口路径 — GET /api/versions?productId={productId}`，按产品 ID 返回版本列表（原已为独立函数，追加 TODO 注释）
- 各函数内部暂用硬编码 Map 模拟返回数据，后续对接时只需替换函数体为真实 fetch 调用

### 38. 搜索接口 `searchProducts` 改为调用假接口

- `searchProducts(keyword)` — `TODO: 替换为真实接口路径 — GET /api/products/search?keyword={keyword}`
- 原实现内联全部静态数据做本地搜索，改为调用 `fetchDomains` → `fetchProductLines` → `fetchProducts` 三级假接口遍历匹配
- 后续对接时替换为单次后台搜索 API 调用即可

### 39. 接口函数提取为独立文件 `project-product-select-api.ts`

- 新建 `project-product-select-api.ts`，将 `fetchDomains` / `fetchProductLines` / `fetchProducts` / `fetchVersions` / `searchProducts` 五个函数及 `SearchResult` 类型从 `project-product-select-panel.tsx` 迁移至此文件
- `project-product-select-panel.tsx` — 改为从 `./project-product-select-api` 导入 `fetchDomains` / `fetchProductLines` / `fetchProducts` / `searchProducts`，移除原内联定义
- `project-info-dialog-content.tsx` — `fetchVersions` 导入源从 `./project-product-select-panel` 改为 `./project-product-select-api`
- `SearchResult` 类型定义迁移到 `project-product-select-api.ts`，从 panel 文件导出的类型（`Domain` / `ProductLine` / `Product` / `Version`）由 api 文件反向 import

---

## 第八轮改动（数据持久化 + 下拉交互重构）

### 40. 数据持久化 — localStorage 缓存改为 Persist.global server store

- `project-product-select-panel.tsx` — 移除 `saveCachedSelection()` / `loadCachedSelection()` / `CACHE_KEY`，不再使用 localStorage 直接缓存
- `context/server.tsx` — server persisted store 新增 `lastProjectSelection` 字段（类型 `Record<string, { domain?, productLine?, product?, version? }>`），按 server origin 键存储，与 `lastProject` 同级持久化到 `Persist.global("server", ["server.v3"])`
- `context/server.tsx` — 新增 `lastSelection` memo（读取 `store.lastProjectSelection[origin()]`）和 `saveSelection(data)` 方法（写入 `setStore("lastProjectSelection", origin(), data)`），在 `projects` 对象上导出
- `dialog-project-onboarding.tsx` — 移除 `defaults` prop，`selections` store 初始化改为从 `server.projects.lastSelection()` 读取（而非 `props.defaults`）；`handleConfirm()` 中新增 `server.projects.touch(dir)` + `server.projects.saveSelection()` 写入持久化
- `project-info.tsx` — 移除 `loadCachedSelection` / `saveCachedSelection` / `fallbackSelection`，显示值改为从 `server.projects.lastSelection()` 读取（响应式 memo）；`onSelect` 回调只做 `setVisible(false)`，持久化写入由 dialog 内部完成
- `project-info-dialog-content.tsx` — 移除 `defaults` prop，改为 `domain` / `productLine` / `product` / `version` 四个独立 prop，由父组件直接传入 `lastSelection` 的各字段

### 41. 下拉交互重构 — 点击产品才确认，点击领域/产品线仅面板内操作

- `project-product-select.tsx` — 移除 `defaultDomain` / `defaultProductLine` / `defaultProduct` props 和内部 `domain` / `productLine` / `product` signal；改为接收 `domain` / `productLine` / `product` 三个 prop（直接来自父组件 store），trigger label 由 props 计算
- `project-product-select.tsx` — Popover 改为受控模式：`open={popoverOpen()}` + `onOpenChange={setPopoverOpen}`
- `project-product-select.tsx` — 移除 `onSelectionChange`，新增 `onProductConfirm` prop；点击产品时调用 `onProductConfirm` 并 `setPopoverOpen(false)` 关闭下拉
- `project-product-select-panel.tsx` — 移除 `onDomainChange` / `onProductLineChange` / `onProductChange` / `onHideClosedChange` / `onSearchChange` props，改为 `onProductConfirm` 单一回调
- `project-product-select-panel.tsx` — `hideClosed` / `search` 改为面板内部 `createSignal` 管理，不再从外部传入
- 领域 onClick：设置 `selectedDomainId` + 清空 `selectedProductLineId`，不触碰 `selectedProductId`（产品选中项不变），不调用任何 props 回调
- 产品线 onClick：设置 `selectedProductLineId`，不触碰 `selectedProductId`（产品选中项不变），不调用任何 props 回调
- 产品 onClick：从 `domains()` / `productLines()` 查找当前选中项，调用 `props.onProductConfirm({ domain, productLine, product })` 关闭下拉并更新父组件
- 搜索结果 onClick：同产品 onClick 逻辑，同时设置本地 signal

### 42. 面板初始默认选中值 — 无选择时自动选中第一项

- `project-product-select-panel.tsx` — 新增两个 `createEffect`：
  - `createEffect(() => { const list = domains(); if (!list?.length) return; if (!selectedDomainId()) setSelectedDomainId(list[0].id) })` — 领域列表加载后，若无选中则自动选中第一项
  - `createEffect(() => { const list = productLines(); if (!list?.length) return; if (!selectedProductLineId()) setSelectedProductLineId(list[0].id) })` — 产品线列表加载后，若无选中则自动选中第一项
- 行为规则：下拉面板显示时，默认选中值 = 产品选择框中的值；如果选择框无值，领域=第一项、产品线=第一项、产品=空值
- 领域切换时：清空 `selectedProductLineId` → 产品线 effect 在新数据加载后自动选中第一项；`selectedProductId` 保持不变

### 43. octo.tsx 适配

- `handleOnboardingSelect` 移除 `server.projects.touch(data.directory)` 调用（touch 和 saveSelection 已在 dialog 内部完成）

---

## 第九轮改动（弹窗选中值丢失修复）

### 44. DialogProjectOnboarding 传递 selections 到 ProjectInfoDialogContent

- `dialog-project-onboarding.tsx` — `ProjectInfoDialogContent` 调用新增 `domain={selections.domain}` / `productLine={selections.productLine}` / `product={selections.product}` / `version={selections.version}` 四个 prop
- 原因：弹窗打开时 `selections` store 已从 `server.projects.lastSelection()` 初始化了领域/产品线/产品/版本值，但 `ProjectInfoDialogContent` 未接收这些 props，其内部 store 初始化为全 `undefined`，导致产品选择框和版本选择框无选中值。传递 props 后弹窗打开时立即显示上次选择的产品和版本

---

## 第九轮改动续（文件整理：统一移入 dialog-project-onboarding 目录）

### 45. 移动文件到 `components/dialog-project-onboarding/` 目录

将以下 6 个文件统一移入 `components/dialog-project-onboarding/` 目录：

| 原路径 | 新路径 |
|--------|--------|
| `components/dialog-project-onboarding.tsx` | `components/dialog-project-onboarding/dialog-project-onboarding.tsx` |
| `pages/cowork/components/project-info-dialog-content.tsx` | `components/dialog-project-onboarding/project-info-dialog-content.tsx` |
| `pages/cowork/components/project-product-select-api.ts` | `components/dialog-project-onboarding/project-product-select-api.ts` |
| `pages/cowork/components/project-product-select-panel.tsx` | `components/dialog-project-onboarding/project-product-select-panel.tsx` |
| `pages/cowork/components/project-product-select.tsx` | `components/dialog-project-onboarding/project-product-select.tsx` |
| `pages/cowork/components/project-info-refactor-log.md` | `components/dialog-project-onboarding/project-info-refactor-log.md` |

### 46. 新增 `index.tsx` 统一导出

- `components/dialog-project-onboarding/index.tsx` — 新建，`export { DialogProjectOnboarding } from "./dialog-project-onboarding"`
- 原因：`octo.tsx` 和 `project-info.tsx` 的 import 路径为 `@/components/dialog-project-onboarding`，移动后该路径变为目录，TypeScript 模块解析会自动查找 `index.tsx`，无需修改外部 import

### 47. 内部 import 路径更新

- `dialog-project-onboarding.tsx` — `ProjectInfoDialogContent` import 从 `@/pages/cowork/components/project-info-dialog-content` 改为 `./project-info-dialog-content`
- 其余内部文件（`project-info-dialog-content.tsx` / `project-product-select.tsx` / `project-product-select-panel.tsx` / `project-product-select-api.ts`）的相对 import（`./project-product-select` / `./project-product-select-panel` / `./project-product-select-api`）路径不变，因文件仍在同一目录

---

### 48. 移动 `project-info.tsx` 到 `components/` 作为公共组件

- `pages/cowork/components/project-info.tsx` → `components/project-info.tsx`
- `pages/make/sidebar.tsx` — import 从 `@/pages/cowork/components/project-info` 改为 `@/components/project-info`
- `pages/_shell/sidebar.tsx` — import 从 `@/pages/cowork/components/project-info` 改为 `@/components/project-info`
- `project-info.tsx` 内部 import `@/components/dialog-project-onboarding` 不变（目录移入后 `index.tsx` 导出，路径仍有效）

---

## 第十轮改动（弹窗头部 Splash 图标 + 文字替换为图片）

### 49. `dialog-project-onboarding.tsx` — "Octo Agent ." 文字替换为图片，保留 Splash 图标

- 保留 `<Splash class="w-[80px] h-[80px]" />` 组件
- 移除 `<div>Octo Agent .</div>` 文字，替换为 `<img src="/octo-agent.png" alt="Octo Agent" style={{ width: "80px", height: "80px" }} />`
- 图片尺寸：`width: 212px, height: 42px`
- `import { Splash } from "@opencode-ai/ui/logo"` 保留

---

## 第十一轮改动（接口替换为真实后台 API）

### 50. `project-product-select-api.ts` — 假接口替换为真实 Octo Pipeline API

- 移除所有硬编码 mock 数据（`Domain[]`/`ProductLine[]`/`Product[]`/`Version[]` Map）
- 移除 `searchProducts` 的本地遍历搜索逻辑
- 类型从 `id: string; label: string` 改为与后台 API 响应一致的完整类型：
  - `Domain`: `{ id: number; name: string; industryId: number | null; parentId: number; enableView: boolean; sort: number; visibleDeptCodes: string | null }`
  - `ProductLine`: `{ id: number; name: string; industryId: number | null; parentId: number; enableView: boolean; sort: number; visibleDeptCodes: string | null }`
  - `Product`: `{ id: number; name: string; parentId: number; industryId: number | null; enableView: boolean; sort: number; visibleDeptCodes: string | null; isEnd: boolean; isSecret: boolean; isTop: boolean; isProductMember: boolean; deliveryTypeId: number; commonTeam: number; commonType: string | null; count: number | null; enableDesignReserve: boolean; enableProductCommon: boolean }`
  - `Version`: `{ id: number; name: string; productId: number; productName: string; deliveryTypeId: number; industryId: number | null; isEnd: boolean; isTop: boolean; modelId: number; permissionFlag: boolean; baseTeam: number; sort: number; spaceId: number; userTeamType: number | null; workflowRoleList: number[] }`
  - `SearchResult`: `{ productId: number; name: string; deliveryTypeId: number; isEnd: boolean; isProductMember: boolean; isSecret: boolean; isTop: boolean; count: number | null; userTeamType: number | null }`
  - `DomainInfoByProduct`: `{ domain: Domain; subDomain: ProductLine; product: Product }`
- `SearchResult` 类型不再包含嵌套的 `domain/productLine/product` 对象，改为扁平结构（与后台搜索接口返回一致）
- 新增 `BASE_URL` 常量：`/pipeline/rest.root/workflow`（通过 Vite proxy 转发到 `https://octo.hdesign.huawei.com`，避免浏览器 CORS 限制）
- 新增通用 `request<T>(url)` 函数：`fetch → 检查 HTTP status → JSON → 检查 errorCode → 返回 content`
- 五个接口函数替换为真实路径：
  - `fetchDomains()` → `GET .../domain/getDomains`
  - `fetchProductLines(domainId: number)` → `GET .../domain/getSubDomains?domainId={domainId}`
  - `fetchProducts(subDomainId: number)` → `GET .../product/getProducts?subDomainId={subDomainId}`
  - `fetchVersions(productId: number)` → `GET .../version/getversionByProduct?productId={productId}`
  - `searchProducts(searchKey: string)` → `GET .../product/search?searchKey={searchKey}`
- 新增 `fetchDomainInfoByProduct(productId: number)` → `GET .../domain/getDomainInfoByproduct?productId={productId}`
- 类型定义从 `project-product-select-panel.tsx` 迁移到 `project-product-select-api.ts`（与 API 响应结构对齐）
- `project-product-select-api.ts` 不再从 panel 文件 import 类型，改为自行定义并 export

### 51. `project-product-select-panel.tsx` — 类型 + 字段名适配

- `Domain/ProductLine/Product/Version` 类型改为从 `./project-product-select-api` import（不再本地定义和 export）
- 重新 export `Domain/ProductLine/Product/Version` 类型供外部文件 import（`project-product-select.tsx` → `project-info-dialog-content.tsx`）
- 显示文字从 `item.label` 改为 `item.name`（与 API 响应字段名一致）
- `ProjectSelection` interface 中 `Domain/ProductLine/Product/Version` 类型改为新完整类型
- `filteredProducts` 中 `!x.closed` 改为 `!x.isEnd`（与 API 响应字段名一致）
- 搜索结果项的 `selectedProductId` 检查改为 `result.productId === selectedProductId()`
- 搜索结果 onClick 改为调用 `fetchDomainInfoByProduct(result.productId)` 获取完整领域/产品线/产品层级，然后 `onProductConfirm` 传入完整对象
- 搜索结果项显示改为只显示产品名称（后台搜索接口不返回领域/产品线信息），不再显示 `领域/产品线/产品` 路径

### 52. `project-product-select.tsx` — 类型 import 来源变更

- `Domain/ProductLine/Product` import 从 `./project-product-select-panel` 改为 `./project-product-select-api`
- `selectedLabel()` 中 `props.domain.label` / `props.productLine.label` / `props.product.label` 改为 `.name`

### 53. `project-info-dialog-content.tsx` — 类型 + Select 适配

- `Domain/ProductLine/Product/Version` import 从 `./project-product-select-panel` 改为 `./project-product-select-api`
- `fetchVersions` import 来源不变（`./project-product-select-api`）
- `createResource(() => store.product?.id, fetchVersions)` — `id` 从 `string` 变为 `number`
- 版本自动选中逻辑：`v.value === current.value` 改为 `v.id === current.id`
- `Select` 的 `value` prop：`(o) => o.value` 改为 `(o) => String(o.id)`（id 为 number，需转 string）
- `Select` 的 `label` prop：`(o) => o.label` 改为 `(o) => o.name`

### 54. `dialog-project-onboarding.tsx` — 类型 import + saveSelection

- 新增 `import type { Domain, ProductLine, Product, Version } from "./project-product-select-api"`
- `DialogProjectOnboardingProps.onSelect` 类型改为 `(data: { directory: string; domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }) => void`
- `handleConfirm` 中 `server.projects.saveSelection` 直接传 selections store 中的完整对象（不再需要 `toPersisted` 映射）

### 55. `server.tsx` — 持久化类型 import

- 新增 `import type { Domain, ProductLine, Product, Version } from "@/components/dialog-project-onboarding/project-product-select-api"`
- `lastProjectSelection` store 类型从内联 `{ id: string; label: string }` 改为使用完整 `Domain/ProductLine/Product/Version` 类型
- `saveSelection` 参数类型改为 `{ domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }`
- 持久化数据包含所有 API 响应字段（不再只存 `id/name`），下次打开弹窗时可直接恢复完整选中项无需重新 fetch

### 56. `project-info.tsx` — 显示字段名变更

- `selection()?.product?.label` 改为 `.name`
- `s?.domain.label` / `s?.productLine.label` 改为 `.name`
- `selection()?.version?.label` 改为 `.name`

### 57. API 请求方案 — 真实接口 + Mock fallback

- `BASE_URL` 为完整 URL `https://octo.hdesign.huawei.com/pipeline/rest.root/workflow`
- 每个接口函数使用 `mockFallback(fetchFn, mockFn)` 包装：优先请求真实 API，失败时自动 fallback 到 mock 数据
- mock 数据使用与真实 API 一致的类型（`id: number`），数据内容与之前硬编码 Map 相同但适配了新类型结构
- `fetchDomainInfoByProduct` mock fallback 通过遍历 mock 数据查找产品 ID 对应的领域/产品线层级
- `searchProducts` mock fallback 在本地 mock 数据中按产品名称匹配搜索
- `fetchVersions` mock fallback 对无匹配产品的 ID 返回默认版本 `v2612304`
- 此方案确保：公司内网环境（Electron + 系统代理可连接 Octo）走真实接口；开发/外部环境（无法连接 Octo）显示空数据 UI 提示
- Electron `windows.ts` 新增 `Access-Control-Allow-Methods` CORS 头，确保真实接口在公司内网环境下 preflight 通过

### 58. 移除 Mock 数据 + 新增空数据/错误/加载 UI

- `project-product-select-api.ts` — 移除所有 `MOCK_*` 常量和 `mockFallback` 包装函数，接口函数直接调用 `request()`，失败时抛异常（由 `createResource` 捕获为 `error` 状态）
- `project-product-select-panel.tsx` — 新增三种状态 UI：
  - **加载中**：`domains.loading && !domains()` 时显示"加载中..."
  - **错误**：`domains.error || productLines.error || allProducts.error` 时显示"数据加载失败" + "请检查网络连接后重试" + 重新加载按钮
  - **空数据**：各列 `<For>` 列表为空时显示"暂无领域/产品线/产品数据"；未选择上级时显示"请先选择领域/产品线"；搜索无结果时显示"未找到匹配的产品"
- `createResource` 返回的 `[data, actions]` 中使用 `data.loading` / `data.error`（Resource accessor 自带属性）检查状态，`actions.refetch` 用于重新加载按钮

---

## 第十二轮改动（修复点击产品选择框闪现报错页面）

### 59. `project-product-select-api.ts` — `request` 函数改为 throw，不再 catch 返回空数组

- 原 `request<T>()` 在 `fetch` 失败、HTTP 错误、API errorCode 非 0 时 catch 返回 `[] as unknown as T`
- 问题：`[]` 对数组类型（`Domain[]` / `ProductLine[]` / `Product[]`）是合法空数组，但对对象类型（`DomainInfoByProduct`）是非法值——搜索结果 onClick 中 `info.domain.id` 会抛 TypeError
- 更根本的问题：catch 返回 `[]` 让 `createResource` 不设置 `error`（fetcher 正常返回），`hasError()` 永远为 false，报错 UI 不会显示，但面板显示"暂无数据"而非"数据加载失败"
- 改为所有失败场景直接 `throw`（`new Error(message)`），`createResource` 的 fetcher reject → `error` signal 设置为 Error 对象 → `hasError()` 为 true → 显示报错 UI
- `console.error` 改为 `console.error(`Failed to fetch ${url}:`, error)`，更简洁

### 60. `project-product-select-panel.tsx` — 添加 `<ErrorBoundary>` + `<Suspense>` 保护

- **根因分析**：SolidJS `createResource` 的 `read()` 函数中，当 `error !== undefined && !pr` 时直接 `throw err`。`request` 改为 throw 后，`domains()` / `productLines()` / `allProducts()` 在 error 状态下会 throw → 传播到全局 `ErrorBoundary` → ErrorPage 闪现
- 修复方案：面板最外层 `<ErrorBoundary>` 包裹 `<Suspense>` + `<Show>` 条件渲染，捕获 resource accessor throw，fallback 为 `<ErrorContent>` 报错 UI（与原 `hasError()` 报错 UI 一致），避免 throw 传播到全局 ErrorBoundary
- `<Suspense>` 在 resource loading 时显示 "加载中..." fallback，防止 children 中 resource accessor 在 loading 状态下被访问导致中间态问题
- `<ErrorBoundary>` 和 `<Suspense>` 的组合确保：loading → Suspense fallback；error → ErrorBoundary fallback（报错 UI）；正常 → children 渲染

### 61. `project-product-select-panel.tsx` — resource key 函数改为 `?? undefined`

- `searchProducts` key：`() => search()` 改为 `() => search() || undefined` — 空字符串 `""` 不触发 fetcher（SolidJS `createResource` 在 `lookup == null || lookup === false` 时跳过 fetcher，但 `""` 不满足此条件）
- `fetchProductLines` key：`() => selectedDomainId()` 改为 `() => selectedDomainId() ?? undefined` — `undefined` key 不触发 fetcher，避免无意义的 API 请求
- `fetchProducts` key：`() => selectedProductLineId()` 改为 `() => selectedProductLineId() ?? undefined` — 同理

### 62. `project-product-select-panel.tsx` — `safeXxx()` 包装 resource accessor

- 新增四个 safe accessor 函数：`safeDomains()` / `safeProductLines()` / `safeAllProducts()` / `safeSearchResults()`
- 每个函数用 `try { return xxx() ?? [] } catch { return [] }` 包装，防止 resource accessor throw 传播到 `<Show>` 条件判断或 `<For>` 渲染
- 在 `<Show>` 的 fallback（正常面板）中，所有 `<For each={...}>` 改为使用 `safeXxx()` 而非直接 `xxx() ?? []`
- 产品 onClick 中 `domains()` / `productLines()` 改为 `safeDomains()` / `safeProductLines()`

### 63. `project-product-select-panel.tsx` — 搜索结果 onClick 数据校验 + catch

- `fetchDomainInfoByProduct(result.productId).then((info) => ...)` 改为：
  - 新增 `if (!info?.domain || !info?.subDomain || !info?.product) return` — 校验返回数据完整性，防止 `info.domain.id` TypeError（`request` 对对象类型返回非法值已被修复，但增加校验作为防御）
  - `.catch(() => {})` — 捕获 `fetchDomainInfoByProduct` 的网络错误，防止 Promise reject 未处理

### 64. `project-product-select-panel.tsx` — `hasError()` 改为 `!!xxx.error`

- 原 `hasError = () => domains.error || productLines.error || allProducts.error` — `domains.error` 可能是 `undefined`（falsy），也可能抛异常
- 改为 `hasError = () => !!domains.error || !!productLines.error || !!allProducts.error` — `!!` 明确将 `undefined` 转为 `false`，Error 对象转为 `true`

### 65. `project-product-select-panel.tsx` — 移除 `isLoading()` 计算属性

- 原 `isLoading = () => domains.loading && !domains()` — 在 `request` 改为 throw 后，loading 和 error 的组合需要 `<Suspense>` 处理，不再需要手动 `isLoading` 判断
- `<Suspense>` 在 resource loading 时自动显示 fallback，替代了原 `<Show when={!isLoading()}>` 的作用

### 66. `project-product-select-panel.tsx` — `<Show>` 嵌套结构重构

- 原：三层 `<Show>` 嵌套（`isSearching` → `hasError` → `isLoading`），fallback 和 children 交替嵌套，中间态可能导致闪现
- 改为：`<ErrorBoundary>` + `<Suspense>` + `<Show>` 组合：
  - `<ErrorBoundary>` — 捕获 resource throw，fallback 为 `<ErrorContent>`
  - `<Suspense>` — loading 时显示 "加载中..."，release 后渲染 children
  - `<Show when={isSearching()}>` + `<Show when={!isSearching()}>` — 搜索模式和正常模式分离
  - `<Show when={hasError()}>` — error 状态显示 `<ErrorContent>`，fallback 为正常三列面板

### 67. `project-product-select-panel.tsx` — 产品线/产品列 `<Show>` 简化

- 原 `<Show when={selectedDomainId() && !productLines.loading}>` — `productLines.loading` 在 key 为 undefined 时为 false，条件始终为 true（误导性）
- 改为 `<Show when={selectedDomainId()}>` — 只检查是否有选中的领域 ID，不再手动检查 loading 状态（`<Suspense>` 已处理）

### 68. `project-info-dialog-content.tsx` — 版本 Select 添加 `<ErrorBoundary>` + `<Suspense>` 保护

- `versionOptions()` 在 `createResource` error 状态下会 throw（同面板 resource accessor 问题）
- `<ErrorBoundary>` 包裹 `<Suspense>` + `<Select>`，fallback 为空 options 的 placeholder Select
- `<Suspense>` 在版本 loading 时显示空 placeholder Select，release 后渲染版本列表 Select
- `safeVersionOptions()` — `try { return versionOptions() ?? [] } catch { return [] }` 包装 resource accessor
- `createResource` key：`() => store.product?.id` 改为 `() => store.product?.id ?? undefined` — undefined key 不触发 fetcher

### 69. `project-product-select-panel.tsx` — `<ErrorContent>` 提取为独立组件

- 原 `hasError()` 报错 UI 内联在 `<Show>` children 中（30+ 行 SVG + 样式）
- 提取为独立 `ErrorContent(props: { onRetry: () => void })` 函数组件
- `errorPageStyle` 也提取为独立常量

---

## 第十三轮改动（增加 Mock Server 用于外网调试接口）

### 70. 创建 Mock 数据文件 `mock/octo-pipeline-mock.ts`

- 新建 `packages/app/mock/octo-pipeline-mock.ts`，定义全部 Mock 数据和辅助函数
- `MOCK_DELAY_MS = 300` — 模拟网络延迟（毫秒）
- `MOCK_DOMAINS` — 3 个领域：ICT (id:1)、云计算 (id:2)、AI (id:3)
- `MOCK_PRODUCT_LINES: Record<number, ...>` — 每个领域下 2 条产品线（ICT→CANN+网络安全、云计算→云服务+云平台、AI→ModelArts+AI引擎）
- `MOCK_PRODUCTS: Record<number, ...>` — 每个产品线下 2-3 个产品（含 isEnd 已结项标记）
- `MOCK_VERSIONS: Record<number, ...>` — 每个产品下 2 个版本（含 isEnd 标记）
- `mockSearchProducts(searchKey)` — 在全部 Mock 产品中按名称模糊匹配，返回 `SearchResult[]`
- `mockDomainInfoByProduct(productId)` — 查找产品的领域/产品线层级，返回 `DomainInfoByProduct | null`

### 71. 创建 Vite Mock 插件 `mock/vite-mock-plugin.ts`

- `viteMockPlugin()` — Vite 插件，`configureServer` 中间件拦截 API 请求
- 拦截路径前缀 `/pipeline/rest.root/workflow`
- 6 个路由匹配：
  - `/domain/getDomains` → `MOCK_DOMAINS`
  - `/domain/getSubDomains?domainId=X` → `MOCK_PRODUCT_LINES[X]`
  - `/product/getProducts?subDomainId=X` → `MOCK_PRODUCTS[X]`
  - `/version/getversionByProduct?productId=X` → `MOCK_VERSIONS[X]`
  - `/product/search?searchKey=X` → `mockSearchProducts(X)`
  - `/domain/getDomainInfoByproduct?productId=X` → `mockDomainInfoByProduct(X)`
- 响应格式：`{ data: { errorCode: 0, errorMessage: "", content: [...] } }` — 与真实 API 一致
- CORS 头设置：`Access-Control-Allow-Origin: *` 等，确保浏览器跨域请求通过
- `MOCK_DELAY_MS` 延迟模拟真实网络请求耗时
- 环境变量 `MOCK_API` 控制开关：
  - `MOCK_API !== "false"`（默认）→ 返回 Mock 数据
  - `MOCK_API === "false"` → 跳过中间件，请求走 proxy 到真实后端

### 72. 更新 `vite.js` — 导入 Mock 插件

- 新增 `import { viteMockPlugin } from "./mock/vite-mock-plugin"`
- 插件数组新增 `viteMockPlugin()`

### 73. 更新 `vite.config.ts` — 添加 proxy 配置

- `server.proxy` 新增：
  - `/pipeline/rest.root/workflow` → `https://octo.hdesign.huawei.com`
  - `changeOrigin: true`，`secure: true`
- Mock 模式下中间件拦截请求，proxy 不生效；`MOCK_API=false` 时请求走 proxy 到真实后端
- 切换方式：`MOCK_API=false bun dev` 或修改 `.env` 文件

### 74. `project-product-select-api.ts` — BASE_URL 改为相对路径

- `BASE_URL` 从 `"https://octo.hdesign.huawei.com/pipeline/rest.root/workflow"` 改为 `"/pipeline/rest.root/workflow"`
- 原因：外网开发时浏览器直接请求真实 URL 会 CORS 失败；改为相对路径后请求走 Vite dev server（Mock 中间件或 proxy），无需跨域

### 75. `project-product-select-api.ts` — 修复 `request` 函数 throw error

- catch 块中 `// throw error` 注释取消，改为 `throw error`
- 原因：注释掉 `throw error` 后 catch 块无 return 也无 throw，`request` 返回 `undefined`；`createResource` 不设置 `error` 状态，`hasError()` 永远为 false，报错 UI 不显示，面板显示空数据而非"数据加载失败"

### 使用方式

- **外网开发（Mock 模式）**：直接 `bun dev`，默认 `MOCK_API` 未设置，mock 中间件拦截 API 请求返回 mock 数据
- **内网对接（真实 API）**：`MOCK_API=false bun dev`，mock 中间件跳过，Vite proxy 将请求转发到真实 Octo 后端

---

## 第十四轮改动（点击领域自动选中第一项产品线）

### 76. `project-product-select-panel.tsx` — 产品线自动选中 effect 条件修复

- 原 `createEffect` 条件：`if (!selectedProductLineId()) setSelectedProductLineId(list[0].id)` — 仅在 `selectedProductLineId()` 为 undefined/falsy 时自动选中第一项
- 问题：点击领域切换时，`setSelectedProductLineId(undefined)` + `setSelectedDomainId(newId)` 同时执行，但 `productLines` resource 在 key 变化后仍可能返回旧列表数据（stale data），effect 用旧列表第一项 ID 设置 `selectedProductLineId`；新列表到达后 `selectedProductLineId()` 已有值（非 undefined），effect 条件不满足，不会更新为新列表第一项
- 修复：条件改为 `if (!list.some(item => item.id === selectedProductLineId()))` — 检查当前选中 ID 是否存在于新列表中，不存在则自动选中第一项
- 行为：领域切换后旧产品线 ID 不在新列表中 → 自动选中第一项；同一领域内手动切换产品线 → 选中 ID 在列表中 → 保持手动选中；初始加载无选中 → undefined 不在列表中 → 自动选中第一项

---

## 第十五轮改动（下拉面板加载状态改为每列独立）

### 77. `project-product-select-panel.tsx` — `<Suspense>` 从顶层全局改为每列独立

- 移除顶层 `<Suspense fallback={<div>加载中...</div>}>` 包裹（原来所有列共享一个 loading fallback，领域/产品线/产品任何一个在 loading 都会整体显示"加载中..."）
- 搜索模式保留独立的 `<Suspense>` 包裹搜索结果
- 三列各自包裹 `<Suspense fallback={<div>加载中...</div>}>`：
  - **领域列**：`<Suspense>` 包裹 `<Show when={safeDomains().length > 0}>` 及内部 `<For>`，loading 时该列显示"加载中..."
  - **产品线列**：`<Show when={selectedDomainId()}>` 外层不变（未选领域仍显示"请先选择领域"），内层 `<Suspense>` 包裹 `<Show when={safeProductLines().length > 0}>` 及 `<For>`，loading 时该列显示"加载中..."
  - **产品列**：`<Show when={selectedProductLineId()}>` 外层不变（未选产品线仍显示"请先选择产品线"），内层 `<Suspense>` 包裹 `<Show when={...}>` 及 `<For>`，loading 时该列显示"加载中..."
- 行为：领域加载中时领域列显示"加载中..."，产品线和产品列显示"请先选择领域"/"请先选择产品线"；领域加载完成后产品线开始加载，产品线列显示"加载中..."，产品列仍显示"请先选择产品线"；各列独立显示加载状态，不影响其他列

---

## 第十六轮改动（版本选择框空数据下拉提示）

### 78. `packages/ui/src/components/select.tsx` — 新增 `emptyContent` prop + placeholder option hack

- `SelectProps<T>` 新增 `emptyContent?: JSX.Element` 属性
- `splitProps` 新增 `"emptyContent"` 到提取列表
- 新增 `import { Show } from "solid-js"`
- 新增 `isEmpty` memo：`local.options.length === 0`
- `grouped` memo 新增空 options 分支：当 `local.options.length === 0 && local.emptyContent` 时返回 `[ { category: "", options: [{} as T] } ]`（一个 placeholder option，让 Kobalte `open()` 的 `options.length <= 0` 检查通过，Popover 可以正常打开）
- `<Kobalte.Content>` 内渲染逻辑改为 `<Show when={!isEmpty()} fallback={local.emptyContent}>` 包裹 `<Kobalte.Listbox>`：空 options 时渲染 `emptyContent`，非空时渲染正常 Listbox
- 原因：Kobalte `Select` 的 `open()` 函数在 `local.options.length <= 0` 时直接 `return` 不打开 Popover（源码第 459 行），无法通过 prop 绕过。hack 方案：传入一个 placeholder option 使 `options.length > 0`，Kobalte 可以正常打开面板；Content 内用 `<Show>` 判断真实 options 是否为空，空时渲染 `emptyContent` 替代 Listbox

### 79. `project-info-dialog-content.tsx` — 版本选择框传入 `emptyContent`

- 新增 `emptyVersionContent` 常量：`<div>无数据</div>`（居中、灰色文字、13px）
- 所有 `Select` 组件（ErrorBoundary fallback / Suspense fallback / 正常渲染）均传入 `emptyContent={emptyVersionContent}`
- 行为：版本数据为空时点击版本选择框，下拉面板打开显示"无数据"；版本数据非空时正常显示选项列表

---

## 第十七轮改动（Mock 版本数据补全）

### 80. `mock/octo-pipeline-mock.ts` — `MOCK_VERSIONS` 补全所有产品的版本数据

- 原 `MOCK_VERSIONS` 只有 5 个产品（111/112/121/211/311）的版本数据，缺少 4 个产品（212/221/312/321）
- 补全后每个产品都有至少一条版本数据：
  - 212 (OBS): v3.0
  - 221 (Kubernetes): v1.28
  - 312 (训练平台): v2.0
  - 321 (NLP引擎): v3.5
- 211 (ECS) 新增第二条版本 v4.0，311 (推理服务) 新增第二条版本 v0.9

---

## 第十八轮改动（弹窗选中值只在确定后显示到 project-info）

### 81. `project-info.tsx` — 显示值改为本地 signal，弹窗确定后才更新（第一版，已废弃）

- 新增 `displaySelection` signal + `createEffect` 条件同步方案，但测试后问题仍存在
- 原因推测：SolidJS `createEffect` 内读取 `server.projects.lastSelection()` 仍建立响应式依赖，即使条件分支不执行 `setDisplaySelection`，effect re-run 时可能触发不必要的响应式传播
- 已改为 #82 方案

### 82. `project-info.tsx` — 冻结/解冻方案替代 createEffect 条件同步（第一版，已改进）

- 移除 `displaySelection` signal 和 `createEffect`
- 新增 `frozen` signal（类型 `SelectionData | undefined`，初始值 `undefined`）
- `selection()` 改为 `frozen() ?? server.projects.lastSelection()`：
  - `frozen` 有值时（弹窗打开期间）使用冻结值，断开与 server store 的响应式连接
  - `frozen` 无值时（弹窗关闭后）使用 `server.projects.lastSelection()`，正常响应式更新
- 弹窗打开：`setFrozen(server.projects.lastSelection())` → `setVisible(true)`
- 弹窗确定：`setFrozen(undefined)` → `setVisible(false)`
- 测试后问题仍存在，原因：`server.projects.lastSelection()` 返回 SolidJS store reactive proxy 对象，存入 `frozen` signal 后，读取 `frozen()?.product?.name` 仍追踪 server store 的 `product.name` 依赖 → proxy 属性变更时 `productName()` 仍响应式重算
- 已改为 #83 方案

### 83. `project-info.tsx` — `unwrap()` 深拷贝断开 store proxy 响应式连接

- `setFrozen(server.projects.lastSelection())` 改为 `setFrozen(unwrap(server.projects.lastSelection()) as SelectionData)`
- `unwrap()` 来自 `solid-js/store`，将 SolidJS store reactive proxy 递归转换为普通对象
- 新增 `import { unwrap } from "solid-js/store"`
- 行为：`frozen` signal 持有普通对象（无 reactive proxy），读取 `frozen()?.product?.name` 是普通属性访问，SolidJS 不追踪 server store 依赖 → 弹窗期间 `productName()` / `domainProductLine()` / `versionLabel()` 仅依赖 `frozen` signal → 不随 server store 变化重算 → project-info 显示不变
- 弹窗确定后 `setFrozen(undefined)` → `selection()` 恢复读 `server.projects.lastSelection()`（reactive proxy）→ 显示更新为新确认值

---

## 第十九轮改动（octo.tsx 弹窗选中值实时同步 project-info 修复）

### 84. `project-info.tsx` — octo.tsx 弹窗打开时冻结显示值

- 问题：`octo.tsx` 通过 `OnboardingLayer` 打开 `DialogProjectOnboarding` 弹窗时，`project-info.tsx` 的 `frozen` signal 为 `undefined`，`selection()` 直接读取 `server.projects.lastSelection()`（reactive proxy），弹窗内选中产品/版本的变更实时反映到 sidebar 显示，应在点击确定后才同步
- 修复：新增 `useLayout` 导入和 `createEffect`，监听 `layout.onboarding.show()` 和 `visible()`：
  - `layout.onboarding.show()` 变为 true（octo.tsx 弹窗打开）且 `frozen()` 为 undefined → `setFrozen(unwrap(server.projects.lastSelection()) as SelectionData)` 冻结当前显示值
  - `layout.onboarding.show()` 变为 false 且 `visible()` 为 false（无弹窗打开）→ `setFrozen(undefined)` 解冻，`selection()` 恢复读取 `server.projects.lastSelection()` 最新值
  - `visible()` 为 true（project-info.tsx 自己的弹窗打开）时 createEffect 不介入，冻结/解冻由 onClick 和 onSelect 回调控制
- 行为：octo.tsx 弹窗打开期间 project-info.tsx 显示冻结值（不随弹窗内选中变化），确定后 server store 更新 + layout.onboarding.show() 变 false → createEffect 解冻 → 显示新确认值

---

## 第二十轮改动（打包后 Mock API 请求报错修复）

### 85. 问题根因

- `viteMockPlugin` 使用 Vite `configureServer` 中间件，只在 `vite dev` 开发模式生效
- 打包后 Electron 加载 `oc://renderer/` 自定义协议，前端 `fetch("/pipeline/rest.root/workflow/...")` 解析为 `oc://renderer/pipeline/rest.root/workflow/...`
- `protocol.handle` 只做本地文件服务 → API 路径返回 404 → `request()` throw → 面板显示"数据加载失败"

### 86. 新增 `packages/desktop/src/main/mock.ts`

- Mock 数据与 `packages/app/mock/octo-pipeline-mock.ts` 一致（MOCK_DOMAINS / MOCK_PRODUCT_LINES / MOCK_PRODUCTS / MOCK_VERSIONS）
- 路由匹配逻辑与 `vite-mock-plugin.ts` 一致（6 个路由：domains / productLines / products / versions / search / domainInfoByProduct）
- `wrapResponse()` / `parseQuery()` 函数与 Vite mock 插件共用逻辑
- `isApiPath(pathname)` — 判断 URL 路径是否为 API 请求（前缀 `/pipeline/rest.root/workflow`）
- `mockEnabled()` — 读取 `process.env.MOCK_API`，默认 `"false"` 以外值启用 mock（与 Vite 插件逻辑一致）
- `handleMockApi(pathname, search)` — 路由匹配 + 返回 `new Response(wrapResponse(content))`（含 CORS 头），不匹配返回 `null`

### 87. 修改 `packages/desktop/src/main/windows.ts` — `protocol.handle` 拦截 API 路径

- 导入 `isApiPath` / `mockEnabled` / `handleMockApi` from `./mock`
- `registerRendererProtocol()` 的 `protocol.handle` 中，URL host 校验之后新增 API 路径拦截：
  - `if (isApiPath(url.pathname))` → API 请求分支
  - `mockEnabled()` → 调用 `handleMockApi` 返回 Mock Response；不匹配路由时 `handleMockApi` 返回 `null`，fall through 到代理
  - `!mockEnabled()` → 用 `net.fetch` 代理到真实后端 `https://octo.hdesign.huawei.com${url.pathname}${url.search}`，Electron 主进程有完整网络访问权限，不受 CORS 限制
  - 非 API 路径 → 保持原本地文件服务逻辑
- 行为：打包后 Mock 模式（默认）→ API 请求由 `oc://` 协议 handler 返回 Mock 数据；`MOCK_API=false` → 代理到真实后端

### 使用方式

- **打包后 Mock 模式（默认）**：直接打包运行，`MOCK_API` 未设置 → mock handler 在 `protocol.handle` 中拦截 API 请求返回 mock 数据
- **打包后真实 API**：设置环境变量 `MOCK_API=false` → mock handler 不启用 → `net.fetch` 代理到真实 Octo 后端
- **开发模式**：仍使用 Vite `configureServer` 中间件，不受此改动影响

---

## 第二十一轮改动（产品/版本选项：置顶图标 + 保密图标 + 已结项标签 + 置顶/取消置顶操作）

### 88. `project-product-select-api.ts` — 新增 `postRequest` + 4 个置顶/取消置顶 API 函数

- 新增 `postRequest(url: string): Promise<void>` — POST 请求通用函数，与 `request` 类似但使用 `method: "POST"`，不返回 content
- 新增 `topProduct(productId: number): Promise<void>` — POST `.../product/top?productId={productId}`
- 新增 `cancelTopProduct(productId: number): Promise<void>` — POST `.../product/cancelTop?productId={productId}`
- 新增 `topVersion(teamId: number): Promise<void>` — POST `.../version/top?teamId={teamId}`
- 新增 `cancelTopVersion(teamId: number): Promise<void>` — POST `.../version/cancelTop?teamId={teamId}`
- 版本 API 使用 `baseTeam` 字段作为 `teamId` 参数（Version 类型中 `baseTeam` 是团队 ID）

### 89. `project-product-select-panel.tsx` — 产品列选项布局重构

- `.panel-item` CSS 新增 `display: flex; align-items: center; gap: 4px`
- 新增 `.panel-item .pin-action` 样式（`visibility: hidden; margin-left: auto`）+ `.panel-item:hover .pin-action` 样式（`visibility: visible`）
- 新增 `.closed-label` 样式（`font-size: 11px; color: rgba(0,0,0,0.45); background: rgba(0,0,0,0.04)`）
- 新增 `.secret-icon svg` 样式（`color: #E53E3E`），选中态改为 `color: #2563EB`
- 产品选项从左到右显示：**置顶图标**（isTop, 16×16, SVG 向上箭头）→ **产品名称** → **保密项目图标**（isSecret && !isProductMember, 16×16, SVG 锁图标, 红色）→ **已结项标签**（isEnd, closed-label）→ **置顶/取消置顶操作图标**（hover 态显示, 居右, 16×16）
- 置顶操作图标：isTop=false 时显示向上箭头（置顶），isTop=true 时显示向下箭头（取消置顶）
- 操作图标 `onClick` 使用 `e.stopPropagation()` 防止触发产品选中，`onPointerDown` 同样 `stopPropagation()` 防止 pointer 事件传播
- 调用 `topProduct/cancelTopProduct` 后 `refetchProducts()` 更新数据；搜索结果中同时 `refetchSearchResults()`
- 搜索结果选项同样应用新布局（SearchResult 有 productId/isTop/isSecret/isProductMember/isEnd 字段）

### 90. `project-info-dialog-content.tsx` — 版本选择框选项自定义渲染

- 新增 `Show` import（用于 children 回调内条件渲染）
- 新增 `topVersion`, `cancelTopVersion` import
- `versionOptions` resource 新增 `{ refetch: refetchVersions }` 解构
- 新增 `handleVersionTopToggle(version: Version)` — 根据 isTop 调用 `topVersion/cancelTopVersion` + `refetchVersions()`
- 新增 `versionItemContent(o: Version | undefined)` 函数 — 版本选项自定义 children 回调：
  - 从左到右：**置顶图标**（isTop, 16×16, SVG 向上箭头）→ **版本名称** → **已结项标签**（isEnd, closed-label）→ **置顶/取消置顶操作图标**（hover 态显示, 居右, pin-action-icon）
  - 操作图标 `onClick` + `onPointerDown` 使用 `stopPropagation()` 防止触发版本选中
- 主 Select 组件新增 `children={versionItemContent}` prop，保留 `label={(o) => o.name}` 作为 trigger 显示用

### 91. `style/select.css` — 版本选择框 CSS 新增

- `[data-slot="select-select-item-label"]` 新增 `display: flex !important; align-items: center !important; gap: 4px !important; width: 100% !important`
- `.closed-label` 新增版本选择框内样式
- `.pin-action-icon` 新增样式（`visibility: hidden; margin-left: auto; cursor: pointer; flex-shrink: 0`）
- `[data-slot="select-select-item"][data-highlighted] .pin-action-icon` + `:hover .pin-action-icon` → `visibility: visible`
- `Access-Control-Allow-Methods` 从 `GET, OPTIONS` 改为 `GET, POST, OPTIONS`（支持 POST preflight）

### 92. `mock/octo-pipeline-mock.ts` — 新增 4 个 mock 函数

- `mockProductTop(productId)` — 在 MOCK_PRODUCTS 中找到产品，设 isTop=true，返回 true
- `mockProductCancelTop(productId)` — 设 isTop=false，返回 true
- `mockVersionTop(teamId)` — 在 MOCK_VERSIONS 中找到 baseTeam=teamId 的版本，设 isTop=true，返回 true
- `mockVersionCancelTop(teamId)` — 设 isTop=false，返回 true

### 93. `mock/vite-mock-plugin.ts` — 新增 4 个 POST 路由 + OPTIONS 处理

- 路由匹配新增 `/product/top` → productTop、`/product/cancelTop` → productCancelTop、`/version/top` → versionTop、`/version/cancelTop` → versionCancelTop
- switch 新增 4 个 case，调用 mockProductTop/mockProductCancelTop/mockVersionTop/mockVersionCancelTop
- 新增 OPTIONS 请求处理：`req.method === "OPTIONS"` → 返回 204 + CORS 头（`Access-Control-Allow-Methods: GET, POST, OPTIONS`）
- CORS 头从 `GET, OPTIONS` 改为 `GET, POST, OPTIONS`

### 94. `desktop/src/main/mock.ts` — 新增 4 个 mock 函数 + 4 个路由

- 新增 `mockProductTop/mockProductCancelTop/mockVersionTop/mockVersionCancelTop` 四个函数（逻辑与 app mock 一致）
- 路由匹配新增 4 个 POST 路由
- switch 新增 4 个 case
- 新增 `wrapResponse` 函数（之前被误删，重新恢复）
- CORS 头从 `GET, OPTIONS` 改为 `GET, POST, OPTIONS`

### 95. `desktop/src/main/windows.ts` — `net.fetch` 转发 POST 方法

- `net.fetch` 新增 `method: request.method` 参数，确保 POST 请求以 POST 方法转发到真实后端（原代码只转发 headers，默认 GET）

---

## 第二十二轮改动（置顶操作接口报 404 修复）

### 96. `mock/octo-pipeline-mock.ts` — 移除重复的 mock 函数定义

- 文件中 `mockProductTop` / `mockProductCancelTop` / `mockVersionTop` / `mockVersionCancelTop` 四个函数被定义了两次（原 lines 121-163 和 165-207），重复的 `export function` 声明在 ES module 规范下是 SyntaxError，会导致模块加载失败
- 模块加载失败 → `viteMockPlugin` 无法从 `./octo-pipeline-mock` 导入 → mock 中间件未注册 → 所有 API 请求（包括 POST）不被拦截，直接穿透到 Vite 内置 middleware → POST 请求无匹配静态文件 → 返回 404
- GET 请求如果正常是因为 Vite `historyApiFallback` 将 GET 404 重定向到 index.html，浏览器实际看到的"正常"可能是 SPA 路由渲染而非真正的 mock 数据返回；也可能 Bun 对重复 export 做了容错处理（取最后定义），GET mock 能工作但 POST 仍因某种原因未被拦截
- 移除重复的第二组定义（lines 165-207），保留第一组（lines 121-163）
- `desktop/src/main/mock.ts` 无此问题（已确认）

### 97. `mock/vite-mock-plugin.js` — 删除旧的编译缓存文件（根因）

- `mock/` 目录下存在一个 Jun 6 创建的 `vite-mock-plugin.js` 旧编译文件，比 `.ts` 源文件更早
- `vite.js` 中 import 为 `import { viteMockPlugin } from "./mock/vite-mock-plugin.js"`（显式 `.js` 扩展名）
- Vite/Bun 模块解析优先匹配实际存在的 `.js` 文件（而非 TypeScript module resolution 规则将 `.js` 重映射到 `.ts`），导致加载旧版而非新版
- 旧版 `vite-mock-plugin.js` 缺失的内容：
  - 4 个 POST 路由（productTop / productCancelTop / versionTop / versionCancelTop）
  - OPTIONS preflight 处理（`req.method === "OPTIONS"` → 204 + CORS 头）
  - CORS `Access-Control-Allow-Methods` 只有 `GET, OPTIONS`（缺少 `POST`）
  - 4 个 mock 函数（mockProductTop / mockProductCancelTop / mockVersionTop / mockVersionCancelTop）
- POST 请求路径 `/product/top` 在旧版 route 匹配中找不到 → `return next()` → Vite 内置 middleware 不处理 → 404
- 首次修复：删除 `mock/vite-mock-plugin.js` → 导致 `npm run dev:desktop` 报错 `ERR_MODULE_NOT_FOUND`（`vite.js` 用 `.js` 扩展名 import，Node.js ESM 不做 `.js` → `.ts` 重映射）
- 最终修复：重新生成 `mock/vite-mock-plugin.js`，包含当前 `.ts` 源文件的全部内容（10 个路由 + 4 个 POST mock 函数 + OPTIONS 处理 + `GET, POST, OPTIONS` CORS 头）
- 旧版 `.js` 缺失内容对比：
  - 路由：只有 6 个 GET 路由 → 现有 10 个（新增 productTop / productCancelTop / versionTop / versionCancelTop）
  - CORS：`Access-Control-Allow-Methods: GET, OPTIONS` → `GET, POST, OPTIONS`
  - OPTIONS 处理：无 → 有（`req.method === "OPTIONS"` → 204 + CORS 头）
  - Mock 函数：无 mockProductTop / mockProductCancelTop / mockVersionTop / mockVersionCancelTop → 有

### 98. `project-info-dialog-content.tsx` — 版本置顶操作改为 `on:pointerdown` 原生事件触发

- Kobalte `SelectItem` 在 `onPointerDown` 中调用 `e.preventDefault()`，阻止浏览器生成后续 `mousedown` / `mouseup` / `click` 兼容事件
- 即使 pin action icon 的 `onPointerDown` 用 `stopPropagation()` 阻止事件冒泡到 Item，Kobalte Listbox 容器层面可能在 capture 阶段先处理 `pointerdown` 并调用 `preventDefault()`，导致 `click` 事件不被浏览器生成 → `onClick` handler 永远不触发
- 修复：将 pin action icon 的事件处理从 `onClick` + `onPointerDown`（SolidJS 委托事件）改为 `on:pointerdown`（原生事件）
  - `on:pointerdown` 注册原生 handler 直接在 DOM 元素上，绕过 SolidJS 委托系统
  - 在 `pointerdown` 阶段同时执行 `stopPropagation()` + `preventDefault()` + `handleVersionTopToggle(o)`
  - `preventDefault()` 阻止浏览器生成 `click`（不再需要 `click`，操作已在 `pointerdown` 完成）
  - `stopPropagation()` 阻止 `pointerdown` 继续冒泡到 Kobalte Item → Item 不执行选中逻辑 → 下拉面板不关闭

### 99. `packages/ui/src/components/select.tsx` — Select itemComponent 覆盖 onPointerDown + onClick，阻止 pin-action-icon 触发选中

- **根因**：Kobalte `createSelectableItem` 在 `onPointerDown`（SolidJS 委托事件，capture 阶段在 document root 处理）中立即调用 `onSelect()` 选中项；pin action icon 的 `on:pointerdown`（原生事件，bubble 阶段）晚于委托事件，`stopPropagation()` 无法阻止已执行的选中
- **修复**：在 Select 组件的 `itemComponent` 中，`Kobalte.Item` 从 `{...itemProps}` 改为显式覆盖 `onPointerDown` 和 `onClick`：
  - 新增 `isPinAction(e)` 函数：检查 `e.target.closest(".pin-action-icon")` 判断点击目标是否在置顶操作图标内
  - `onPointerDown`：如果是 pin-action 目标 → `stopPropagation()` + `preventDefault()` + `return`（跳过选中）；否则 → `(itemProps as any).onPointerDown?.(e)`（正常选中）
  - `onClick`：如果是 pin-action 目标 → `stopPropagation()` + `return`；否则 → `(itemProps as any).onClick?.(e)`
  - 显式 prop 覆盖 `itemProps` 中的委托 handler，SolidJS 只调用覆盖后的版本
- `project-info-dialog-content.tsx` pin action icon 改回 `onPointerDown` + `onClick`（SolidJS 委托事件），不再需要 `on:pointerdown` 原生事件

---

## 第二十三轮改动（版本置顶操作仍触发选中 + 下拉面板收起修复）

### 100. 根因分析

- Kobalte Select 组件使用 `shouldSelectOnPressUp=true`，配合 `shouldFocusOnHover=true`，`allowsDifferentPressOrigin=true`
- `createSelectableItem` 中三个选中触发点：
  - **鼠标**：选中在 `onPointerUp` 触发（`e.pointerType === "mouse" && shouldSelectOnPressUp && allowsDifferentPressOrigin` 满足 → 触发选中）
  - **触摸/触控笔**：选中在 `onClick` 触发（`pointerDownType !== "mouse"` → onClick 分支）
  - **键盘**：选中在 `onKeyDown` 触发（Enter/Space）
- 前一轮修复 #99 只拦截了 `onPointerDown` 和 `onClick`，遗漏了 `onPointerUp` — 鼠标点击置顶图标时，`onPointerUp` 不被拦截 → Kobalte 在 `onPointerUp` 中调用 `onSelect()` 选中版本项

### 101. `packages/ui/src/components/select.tsx` — itemComponent 新增 `onPointerUp` 拦接

- `isPinAction` 检查新增 `onPointerUp` 覆盖：
  - `onPointerUp`：如果是 pin-action 目标 → `stopPropagation()` + `return`（跳过选中）；否则 → `(itemProps as any).onPointerUp?.(e)`（正常选中）
- 三个事件覆盖顺序：`onPointerDown` → `onPointerUp` → `onClick`

### 102. `project-info-dialog-content.tsx` — .pin-action-icon 新增 `onPointerUp`

- `.pin-action-icon` span 新增 `onPointerUp={(e) => e.stopPropagation()}`
- 三个委托事件拦截：`onPointerDown` → `onPointerUp` → `onClick`
- SolidJS 委托事件从 target 向上遍历，`.pin-action-icon` 的 `onPointerUp` 先于 `Kobalte.Item` 的 `onPointerUp` 执行，`stopPropagation()` 阻止遍历继续到 `<li>` 元素

### 103. 版本下拉面板不应收起 — `refetchVersions()` 导致 `<Suspense>` 切换 fallback

- **根因**：`handleVersionTopToggle` 调用 `refetchVersions()` → `createResource` 进入 loading 状态 → `<Suspense>` 检测到 loading 切换到 fallback（placeholder Select，options=[]）→ 原 Select 及其 Popover DOM 被移除 → 下拉面板消失
- `createResource` 的 `[data, { mutate }]` 解构新增 `mutateVersions`
- `handleVersionTopToggle` 改为本地更新数据（`mutate` + `setStore`），不再调用 `refetchVersions()`：
  - `setStore("version", "isTop", newIsTop)` — 更新当前选中版本
  - `mutateVersions(prev => prev?.map(v => v.id === version.id ? { ...v, isTop: newIsTop } : v))` — 更新版本列表中对应版本的 isTop 状态
  - 不触发 resource loading → `<Suspense>` 保持显示内容（real Select）→ Popover DOM 不被移除 → 下拉面板保持打开

### 104. `.pin-action-icon` 事件处理优化 — `preventDefault()` + 操作移至 `onPointerUp`

- `onPointerDown` 改为 `e.stopPropagation()` + `e.preventDefault()` — 阻止 SolidJS 委托遍历 + 阻止浏览器默认行为（focus shift + click 事件生成）
- `onPointerUp` 改为 `e.stopPropagation()` + `handleVersionTopToggle(o)` — 阻止 Kobalte 通过 `onPointerUp` 触发选中 + 执行置顶操作
- 移除 `onClick` — `preventDefault()` 在 `pointerdown` 上阻止浏览器生成 `click` 事件，`onClick` 不会触发，操作已移至 `onPointerUp`

---

## 第二十四轮改动（版本置顶操作仍触发选中 + 下拉面板收起 — 三层防御机制）

### 105. `isPinAction` 修复 — `HTMLElement` → `Element` 支持 SVG 元素

- `select.tsx` 的 `isPinAction(e)` 原检查 `e.target instanceof HTMLElement`，SVG `<path>` 是 `SVGElement`（非 `HTMLElement`）→ 检查返回 false → `isPinAction` 认为点击不在 pin-action 区域 → 不拦截 → Kobalte 选中触发
- 改为 `e.target instanceof Element` — `SVGElement` 继承自 `Element`，`<path>` 元素通过检查 → `closest(".pin-action-icon")` 正确找到父级 span → 拦截生效

### 106. 版本 Select 受控 Popover 模式 — 防止下拉面板收起

- 新增 `versionPopoverOpen` signal（`createSignal(false)`）— 控制 Popover 开关状态
- 新增 `pinActionActive` 标志（`let` 变量）— 标记正在执行置顶操作
- 版本 Select 新增 `open={versionPopoverOpen()}` prop — Kobalte 进入受控模式，Popover 由外部 signal 控制
- 版本 Select 新增 `onOpenChange={(open) => { if (pinActionActive && !open) return; setVersionPopoverOpen(open) }}` — 置顶操作期间阻止 Popover 关闭
- 版本 Select `onSelect` 改为 `(o) => { if (pinActionActive) return; o && setStore("version", o) }` — 置顶操作期间跳过选中
- `handleVersionTopToggle` 在开始时设置 `pinActionActive = true`，API 完成后设置 `pinActionActive = false`（`.then()` 和 `.catch()` 中）
- 触发样式提取为 `versionSelectTriggerStyle` 常量（三处 Select 共用，减少重复）
- 三层防御机制：
  1. **`.pin-action-icon` 委托事件拦截**（primary）：`onPointerDown` / `onPointerUp` 的 `stopPropagation()` 阻止 SolidJS 委托遍历到达 `<li>`
  2. **`isPinAction` 检查**（backup）：`<li>` 上的 `onPointerDown` / `onPointerUp` / `onClick` 覆盖检查 `e.target.closest(".pin-action-icon")`，拦截 pin-action 区域的点击
  3. **受控 Popover + 选中跳过**（ultimate backup）：`pinActionActive` 标志阻止 `onOpenChange(false)` 和 `onSelect` 生效

---

## 第二十五轮改动（选择项 hover 态背景色调整）

### 107. `project-product-select-panel.tsx` — 领域/产品线/产品选择项 hover 态背景色

- `<style>` 块新增 `.panel-item:not(.panel-item-selected):hover { background: #f3f3f3 }` — 非选中项 hover 时显示灰色背景
- 选中项（`.panel-item-selected`）hover 时保持蓝色背景 `rgba(37, 99, 235, 0.08)`，`:not(.panel-item-selected)` 排除选中项避免 hover 灰色覆盖选中蓝色

### 108. `style/select.css` — 版本下拉面板选项 hover 态背景色

- `[data-highlighted]` / `:hover` 的 `background` 从 `rgba(37, 99, 235, 0.08)` 改为 `#f3f3f3`
- 移除 `[data-highlighted]` / `:hover` 的 `color: #2563EB`（hover 态不再改变文字颜色）
- 新增 `[data-selected][data-highlighted]` / `[data-selected]:hover` 规则：`background: rgba(37, 99, 235, 0.08)` + `color: #2563EB` — 选中项 hover 时保持蓝色样式，优先级高于 hover 灰色

---

## 第二十六轮改动（保密产品选择项禁用）

### 109. `project-product-select-panel.tsx` — 保密产品（isSecret && !isProductMember）选择项禁用

- `<style>` 块新增 `.panel-item-disabled` 样式：`color: rgba(0,0,0,0.3); cursor: not-allowed` — 文字变灰、鼠标禁用指针
- `.panel-item-disabled:hover { background: transparent }` — 禁用项 hover 时无背景变化（不显示 #f3f3f3）
- `.panel-item-disabled .pin-action { visibility: hidden !important }` — 禁用项隐藏置顶操作图标
- 产品列 `<For>` item 新增 `isSecretDisabled` 计算：`item.isSecret && !item.isProductMember`
- `classList` 新增 `"panel-item-disabled": isSecretDisabled`；选中项逻辑改为 `!isSecretDisabled && item.id === selectedProductId()`（保密产品不显示选中高亮）
- `onClick` 新增 `if (isSecretDisabled) return` — 保密产品点击无效
- 搜索结果 `<For>` result 同样新增 `isSecretDisabled` 计算：`result.isSecret && !result.isProductMember`
- 搜索结果 `classList` 和 `onClick` 同样处理

---

## 第二十八轮改动（request + postRequest 合并为统一函数 + uiplustoken 请求头）

### 111. `project-product-select-api.ts` — `request` / `postRequest` 合并为 `request<T>(url, method)`

- `request<T>(url: string, method: string = "GET"): Promise<T>` — method 参数默认 `"GET"`，POST 调用传入 `"POST"`
- 新增 `uiplustoken` 请求头：从 `localStorage.getItem("uiplustoken")` 读取，非空时添加到 `headers: { uiplustoken: ... }`
- 移除 `postRequest` 函数（已合并）
- `topProduct` / `cancelTopProduct` / `topVersion` / `cancelTopVersion` 四个 POST 函数改为 `request<void>(url, "POST")`
- GET 函数（`fetchDomains` / `fetchProductLines` / 等）无需改动，method 默认 `"GET"`
- console.error 改为 `Failed to ${method} ${url}` 区分 GET/POST

---

## 第二十九轮改动（面板三列间距调整）

### 112. `project-product-select-panel.tsx` — 领域/产品线/产品三列 padding 调整

- 领域列 padding 从 `"12px 8px"` 改为 `"0px 8px 0 0"` — 右侧留 8px 内边距，上下和左侧无边距，与分隔线对齐
- 产品线列 padding 从 `"12px 8px"` 改为 `"0 8px"` — 上下无边距，左右 8px 内边距
- 产品列 padding 从 `"12px 8px"` 改为 `"0 0 0 8px"` — 左侧留 8px 内边距，上下和右侧无边距
- 三列 padding 调整使列内容与分隔线间距更紧凑，列标题行与内容对齐

---

## 第三十轮改动（产品选择框/版本选择框禁用）

### 113. `project-product-select.tsx` — 新增 `disabled` prop

- `ProjectProductSelectProps` 新增 `disabled?: boolean`
- Popover `onOpenChange` 改为 `if (!props.disabled) setPopoverOpen(open)` — 禁用时阻止打开下拉面板
- trigger button style 条件化：`disabled` 时 `color: rgba(0,0,0,0.3)` / `background: rgba(0,0,0,0.04)` / `cursor: not-allowed`；非禁用时保持原样式
- triggerProps 新增 `disabled: true`（HTML button disabled 属性）

### 114. `project-info-dialog-content.tsx` — 新增 `disabled` prop + 版本 Select 禁用

- `ProjectInfoDialogContentProps` 新增 `disabled?: boolean`
- `ProjectProductSelect` 传入 `disabled={props.disabled}`
- `versionSelectTriggerStyle` 条件化：`disabled` 时 `background: rgba(0,0,0,0.04)` / `color: rgba(0,0,0,0.3)` / `cursor: not-allowed`
- 三个 `Select` 组件（ErrorBoundary fallback / Suspense fallback / 主 Select）均传入 `disabled={props.disabled}`
- 主 Select `onOpenChange` 新增 `if (props.disabled) return` — 禁用时阻止打开下拉面板

### 115. `dialog-project-onboarding.tsx` — `ProjectInfoDialogContent` 传入 `disabled`

- `<ProjectInfoDialogContent>` 新增 `disabled` prop（布尔值，无条件设为 true）

---

## 第三十一轮改动（Select 组件复制到 dialog-project-onboarding 目录）

### 116. 复制 `packages/ui/src/components/select.tsx` → `components/dialog-project-onboarding/select.tsx`

- 文件内容完全复制，仅修改 import 路径：
  - `import { Button, ButtonProps } from "./button"` → `import { Button, ButtonProps } from "@opencode-ai/ui/button"`
  - `import { Icon } from "./icon"` → `import { Icon } from "@opencode-ai/ui/icon"`
- 原因：后续可独立修改此 Select 组件的版本选项渲染逻辑，不影响全局 Select 组件

### 117. `project-info-dialog-content.tsx` — Select import 改为本地文件

- `import { Select } from "@opencode-ai/ui/select"` 改为 `import { Select } from "./select"`

---

## 第三十二轮改动（图标升级为 1024×1024 精细 SVG + 面板布局细节调整）

### 118. `project-info-dialog-content.tsx` — 置顶/取消置顶 SVG 图标升级 + span flex 移除

- 所有 SVG viewBox 从 `0 0 16 16` 改为 `0 0 1024 1024`，使用精细矢量路径
- 置顶图标（isTop）新增 `class="top-mark"`，fill 从 `currentColor` 改为 `#E53E3E`（红色），路径为完整向上箭头
- 取消置顶图标（fallback）路径改为新的 1024×1024 向下箭头（带斜线穿过，表示取消置顶）
- 产品名称 `<span>` 移除 `flex: "1"` 属性，仅保留 `overflow/text-overflow/white-space`

### 119. `project-product-select-panel.tsx` — 面板样式 + 布局 + 图标全面升级

- 新增 `.panel-item-list` CSS 类：`max-height: 240px; overflow-y: auto; scrollbar-gutter: stable` + 自定义滚动条样式（宽度 8px、thumb 灰色/hover 更深灰色、圆角 4px）
- `.panel-item` 字号从 13px 改为 14px，新增 `line-height: 22px`，padding 从 `6px 8px` 改为 `4px 8px`
- 新增 `.panel-label` 类：`overflow:hidden; text-overflow:ellipsis; white-space:nowrap` — 领域/产品线/产品名称统一使用此 class 替代 inline style
- `.pin-action` 新增 `fill: #191919`
- `.closed-label` 字号从 11px 改为 12px
- `.panel-item-disabled` 从 `color: rgba(0,0,0,0.3); cursor: not-allowed` 改为 `opacity: 0.5; cursor: not-allowed`（整行半透明，更一致的视觉禁用态）
- 移除 `.panel-item-disabled:hover { background: transparent }` 和 `.panel-item-disabled .pin-action { visibility: hidden !important }`（opacity: 0.5 自动降低视觉权重）
- 移除 `.secret-icon svg { color: #E53E3E }` 和 `.panel-item-selected .secret-icon svg { color: #2563EB }`（保密图标颜色由 SVG 自身 fill 控制）
- 新增 `.panel-item-selected .pin-action { color: #191919 }` — 选中项置顶操作图标颜色
- 三列布局从 `flex: 1`（等分弹性）改为固定宽度 `calc(33.33% - 3px)` / `calc(33.33% + 5px)` / `calc(33.33% - 4px)`（精确三等分，补偿分隔线和 padding）
- 领域列移除 padding `0px 8px 0 0`，改为仅 `border-right` 分隔线
- 产品线列 padding 改为 `0 0 0 8px`（左侧补偿分隔线间距）
- 产品列 padding 保持 `0 0 0 8px`，新增 `margin-right: -8px`（补偿滚动条 gutter）
- 列标题字号从 13px 改为 14px，与 `.panel-item` 字号统一
- 列表容器全部改用 `.panel-item-list` class 替代 inline style `max-height/overflow`
- 搜索结果容器同样改用 `.panel-item-list` class，`margin-right: -8px` 补偿滚动条
- 搜索标题字号从 13px 改为 14px
- 置顶/取消置顶 SVG viewBox 全部从 `0 0 16 16` 改为 `0 0 1024 1024`，使用精细矢量路径（同 #118）
- 保密项目图标 SVG 升级：从简单矩形+弧线锁图标（viewBox 16×16）改为完整 1024×1024 精细锁图标路径，fill 使用 `currentColor` + `fill-rule="nonzero"`
- 领域/产品线名称改用 `<span class="panel-label">` 替代 inline style
- 产品名称改用 `<span class="panel-label">` 替代 inline style

### 120. `style/select.css` — 版本下拉面板样式升级

- `.version-select-content` 新增 `width: 200px !important` — 固定下拉面板宽度
- 新增滚动条样式：`.version-select-content [data-slot="select-select-content-list"]::-webkit-scrollbar` 系列（8px 宽、灰色 thumb / hover 更深、圆角 4px），与面板滚动条统一
- `[data-slot="select-select-item"]` padding 从 `6px 8px` 改为 `4px 8px`、字号从 13px 改为 14px、新增 `line-height: 22px`、margin-bottom 从 2px 改为 4px
- `.closed-label` 字号从 11px 改为 12px
- `.pin-action-icon` 新增 `color: #191919 !important`

---

## 第三十三轮改动（下拉箭头图标统一升级为 1024×1024 精细 SVG）

### 121. `project-product-select.tsx` — 产品选择框下拉箭头图标升级

- chevron-down SVG 从 `viewBox 0 0 16 16` + stroke 绘制（`stroke="rgba(119,119,119,1)" stroke-width="1.5"`）改为 `viewBox 0 0 10.0034 10` + fill 精细路径（`fill="rgb(119,119,119)" fill-rule="evenodd"`）
- SVG 尺寸从 `width="16" height="16"` 改为 `width="10" height="10"`

### 122. `dialog-project-onboarding.tsx` — 目录选择按钮新增下拉箭头图标

- 目录路径显示按钮新增与产品选择框一致的 chevron-down SVG（`width="10" height="10" viewBox="0 0 10.0034 10"`、`fill="rgb(119,119,119)" fill-rule="evenodd"`、`style={{ "flex-shrink": "0", "margin-left": "auto" }}`）
- 箭头图标居右（`margin-left: auto`），与目录路径文字形成下拉按钮视觉

### 123. `select.tsx` — 版本选择框下拉图标从 Icon 组件改为 SVG

- `Kobalte.Icon` 内从 `<Icon name="chevron-down" size="small" />` 改为内联 SVG（与产品选择框一致的 chevron-down 路径：`width="10" height="10" viewBox="0 0 10.0034 10"`、`fill="rgb(119,119,119)" fill-rule="evenodd"`）

### 124. `style/select.css` — 版本选择框图标样式覆盖

- 新增 `.version-select-content [data-slot="select-select-trigger-icon"] { font-weight: normal !important }` — 清除 Icon 组件残留的 font-weight
- 新增 `.version-select-content [data-slot="select-select-trigger-icon"] svg { stroke: unset !important }` — 清除原 `chevron-down` Icon 的 stroke 样式，避免与 fill 冲突