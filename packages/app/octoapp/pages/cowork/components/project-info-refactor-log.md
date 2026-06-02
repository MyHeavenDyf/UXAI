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