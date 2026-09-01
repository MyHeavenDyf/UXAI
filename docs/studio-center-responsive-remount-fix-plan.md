# Studio 中心栏重新进入时未及时自适应修复方案

## 1. 问题范围

本方案只处理以下问题：

> 整体窗口处在 Studio 临界宽度时，正常响应式布局应将 `studio-center` 调整为 `360px`，为右侧编辑/详情工作区保留约 `800px`。切换到其他功能再返回 Studio 后，如果窗口没有发生 resize，中心栏可能继续使用默认或持久化的 `468px`，导致右侧工作区被压缩；上传图片进入编辑器后，底部操作内容出现压缩、溢出和重叠。

以下问题不在本次范围内：

- 编辑能力恢复后，本地图片状态没有恢复而显示“待上传”。
- 编辑器内部业务状态持久化。
- 编辑器 UI 的整体重构。
- Studio 会话恢复逻辑调整。

## 2. 当前根因

主要代码位于：

```text
packages/app/octoapp/pages/studio-page.tsx
```

当前存在三层问题。

### 2.1 挂载阶段没有执行中心栏宽度计算

当前自适应 effect 中定义了 `calcCenterWidth()`，但初始化阶段只执行：

```ts
setShowToggleDrawer(mqlMedium.matches)
setWindowWidth(window.innerWidth)
```

没有立即执行：

```ts
calcCenterWidth()
```

因此切换到其他路由再返回 Studio 时，如果窗口尺寸没有变化、媒体查询也没有跨越断点，就不会触发中心栏重新计算。

### 2.2 持久化水合会直接覆盖实时宽度

当前代码直接把持久化值回填到 live signal：

```ts
createEffect(on(() => studioCenterStore.width, (width) => {
  if (!resizingCenter()) setStudioCenterWidth(width)
}))
```

桌面端持久化可能异步完成。即使挂载时先计算出了 `360px`，稍后水合出旧的 `468px`，仍可能再次覆盖响应式结果。

### 2.3 多个入口使用不同的宽度规则

当前存在不同计算路径：

- 窗口 resize：按照 `29%/31%` 和 `[360, 700]` 计算。
- 手动拖动：按照右侧工作区至少 `800px` 计算。
- 页面重新进入：直接使用默认或持久化宽度。
- canvas 的 `ResizeObserver`：只记录 canvas 宽度，不负责调整中心栏。

这些规则没有统一，导致重新进入 Studio 时能够绕过右侧 `800px` 的安全约束。

## 3. 修复目标

修复后需要保证：

1. Studio 首次挂载时主动执行一次完整布局计算，不依赖 resize 事件。
2. 持久化宽度完成异步水合后，也必须经过当前布局的安全约束。
3. 任何情况下，中心栏都不能侵占右侧工作区要求保留的最小宽度。
4. 窗口 resize、媒体查询变化、页面容器变化、持久化水合和手动拖动使用同一个安全收敛函数。
5. 保留现有中心栏手动拖动和宽度持久化能力。
6. 小于 `1228px` 时继续保持现有“隐藏工作区、中心栏铺满、工作区使用抽屉”的逻辑。

## 4. 布局约束

建议统一声明以下常量：

```ts
const STUDIO_CENTER_MIN_WIDTH = 360
const STUDIO_CENTER_MAX_WIDTH = 700
const STUDIO_WORKSPACE_MIN_WIDTH = 800
```

临界宽度的设计关系为：

```text
1228 = 左栏 68 + 中心栏 360 + 右侧工作区 800
```

中心栏最大安全宽度统一按照以下公式计算：

```text
maxSafeCenterWidth
= pageWidth - leftWidth - STUDIO_WORKSPACE_MIN_WIDTH
```

最终中心栏宽度需要同时满足：

```text
360 <= studioCenterWidth <= 700
studioCenterWidth <= pageWidth - leftWidth - 800
```

当页面可用宽度不足以同时容纳这三部分时，不应继续压缩右侧工作区，而应进入现有 `<1228px` 的隐藏/抽屉模式。

## 5. 修改文件

### 必须修改

```text
packages/app/octoapp/pages/studio-page.tsx
```

### 建议新增测试

可以选择以下任一位置：

```text
packages/app/octoapp/pages/studio/studio-layout.test.ts
```

或将纯宽度函数放入：

```text
packages/app/octoapp/pages/studio/studio-shared.ts
packages/app/octoapp/pages/studio/studio-shared.test.ts
```

如果宽度计算只服务于 `StudioPage`，优先保留在 `studio-page.tsx`；如果需要单元测试，建议抽到 `studio-shared.ts`。

### 本次不要求修改

```text
packages/app/octoapp/pages/studio/studio-04.css
packages/app/octoapp/pages/studio/studio-05.css
packages/app/octoapp/pages/studio/studio-06.css
packages/app/octoapp/pages/studio/studio-editors-basic.tsx
packages/app/octoapp/pages/studio/studio-inpaint-editor.tsx
packages/app/octoapp/pages/studio/studio-outpaint-editor.tsx
```

编辑器 CSS 的容器级响应式可作为后续防御优化，不应代替本次中心栏修复。

## 6. 具体修改步骤

## 6.1 增加统一宽度常量和纯计算函数

在 `studio-page.tsx` 顶部类型、常量区域增加：

```ts
const STUDIO_CENTER_MIN_WIDTH = 360
const STUDIO_CENTER_MAX_WIDTH = 700
const STUDIO_WORKSPACE_MIN_WIDTH = 800
```

增加自动推荐宽度计算：

```ts
function studioAutoCenterWidth(pageWidth: number) {
  if (pageWidth >= 1920) {
    return Math.round((pageWidth - 296) * 0.29)
  }
  if (pageWidth >= 1228) {
    return Math.round((pageWidth - 296) * 0.31)
  }
  return STUDIO_CENTER_MIN_WIDTH
}
```

增加统一安全收敛函数：

```ts
function resolveStudioCenterWidth(input: {
  preferredWidth: number
  pageWidth: number
  leftWidth: number
}) {
  const maxSafeWidth = Math.min(
    STUDIO_CENTER_MAX_WIDTH,
    input.pageWidth - input.leftWidth - STUDIO_WORKSPACE_MIN_WIDTH,
  )

  if (maxSafeWidth < STUDIO_CENTER_MIN_WIDTH) {
    return STUDIO_CENTER_MIN_WIDTH
  }

  return Math.min(
    maxSafeWidth,
    Math.max(STUDIO_CENTER_MIN_WIDTH, input.preferredWidth),
  )
}
```

说明：

- `preferredWidth` 可以是自动百分比计算值、持久化值、当前 live width 或用户拖动目标值。
- 不同来源最终都经过相同的 `[360, 700]` 和右侧 `800px` 约束。
- `maxSafeWidth < 360` 时返回 `360` 只是中心栏自身的兜底；此时工作区是否显示应由现有窄屏逻辑决定。

## 6.2 获取持久化 ready 状态

当前代码只解构了持久化 store 的前两项：

```ts
const [studioCenterStore, setStudioCenterStore] = persisted(
  Persist.global("studio.center.width"),
  createStore({ width: 468 }),
)
```

改为取得第四项 ready accessor：

```ts
const [studioCenterStore, setStudioCenterStore, , studioCenterReady] = persisted(
  Persist.global("studio.center.width"),
  createStore({ width: 468 }),
)
```

`persisted()` 的 ready 状态已经由以下工具提供：

```text
packages/app/octoapp/utils/persist.ts
```

不需要修改持久化工具本身。

## 6.3 首次 live width 使用安全值

当前：

```ts
const [studioCenterWidth, setStudioCenterWidth] = createSignal(studioCenterStore.width)
```

建议首次渲染时就根据当前 viewport 做安全收敛，避免第一轮布局直接使用 `468px`：

```ts
const initialStudioPageWidth = window.innerWidth
const initialStudioLeftWidth = initialStudioPageWidth <= 1455
  ? 68
  : studioLeftWidth()
const initialStudioCenterPreferredWidth = studioCenterReady()
  ? studioCenterStore.width
  : studioAutoCenterWidth(initialStudioPageWidth)
const [studioCenterWidth, setStudioCenterWidth] = createSignal(
  resolveStudioCenterWidth({
    preferredWidth: initialStudioCenterPreferredWidth,
    pageWidth: initialStudioPageWidth,
    leftWidth: initialStudioLeftWidth,
  }),
)
```

实际实现时应遵循仓库风格，尽量减少只使用一次的变量，可以适度内联。上面的展开写法主要用于说明数据来源。

临界宽度下，即使同步存储里已经有 `468px`，也会得到：

```text
maxSafeWidth = 1228 - 68 - 800 = 360
effectiveWidth = min(468, 360) = 360
```

## 6.4 提供页面实际宽度和左栏实际宽度函数

在 `StudioPage` 内增加：

```ts
function currentStudioPageWidth() {
  return studioPageRef?.clientWidth || window.innerWidth
}

function currentStudioLeftWidth() {
  return studioLeftCollapsed() ? 68 : studioLeftWidth()
}
```

需要优先使用：

```ts
studioPageRef.clientWidth
```

原因是 Studio 真正分配左右区域的是 `.studio-page` 的可用宽度，而不是抽象的浏览器窗口宽度。

`window.innerWidth` 保留为 DOM 尚未挂载时的 fallback。

## 6.5 增加统一应用函数

在当前响应式逻辑附近增加：

```ts
function applyStudioCenterWidth(preferredWidth: number) {
  const pageWidth = currentStudioPageWidth()
  setWindowWidth(pageWidth)

  if (!showStudioWorkspace()) return

  setStudioCenterWidth(resolveStudioCenterWidth({
    preferredWidth,
    pageWidth,
    leftWidth: currentStudioLeftWidth(),
  }))
}
```

再增加自动布局入口：

```ts
function applyStudioResponsiveLayout() {
  const pageWidth = currentStudioPageWidth()
  applyStudioCenterWidth(studioAutoCenterWidth(pageWidth))
}
```

两个函数的职责分别是：

- `applyStudioCenterWidth(preferredWidth)`：统一处理安全约束。
- `applyStudioResponsiveLayout()`：根据当前页面宽度生成自动推荐宽度。

## 6.6 修改挂载和媒体查询初始化

当前自适应 effect 末尾是：

```ts
setShowToggleDrawer(mqlMedium.matches)
setWindowWidth(window.innerWidth)
mqlWide.addEventListener("change", onMediaChange)
```

这里应恢复为主动执行完整初始化：

```ts
onMediaChange()
mqlWide.addEventListener("change", onMediaChange)
```

`onMediaChange()` 内改为统一调用：

```ts
const onMediaChange = () => {
  setShowToggleDrawer(mqlMedium.matches)
  if (mqlWide.matches || mqlMedium.matches) {
    if (!studioLeftCollapsed()) setStudioLeftWidth(296)
  }
  applyStudioResponsiveLayout()
}
```

窗口 resize 也改为：

```ts
window.addEventListener("resize", applyStudioResponsiveLayout)
```

cleanup 对应移除同一个函数引用。

完成后，路由重新进入本身就会触发布局计算，不再等待第一次 resize。

## 6.7 修改中心栏持久化水合回填

删除或替换当前无条件回填逻辑：

```ts
createEffect(on(() => studioCenterStore.width, (width) => {
  if (!resizingCenter()) setStudioCenterWidth(width)
}))
```

改为持久化值必须经过安全收敛：

```ts
createEffect(
  on(
    () => [studioCenterReady(), studioCenterStore.width] as const,
    ([ready, width]) => {
      if (!ready || resizingCenter()) return
      applyStudioCenterWidth(width)
    },
  ),
)
```

这会同时覆盖：

- Web 同步持久化。
- Desktop 异步持久化。
- 用户手动拖动完成后写入 store。

在临界宽度下，持久化的 `468px` 会再次被收敛为 `360px`，不会覆盖正确布局。

需要注意函数声明位置：

- `applyStudioCenterWidth()` 必须在 effect 可安全调用的位置定义。
- 如果因代码顺序不方便，可以把中心栏水合 effect 移到响应式辅助函数之后。
- 不建议通过 `queueMicrotask()` 或 `setTimeout()` 规避声明顺序，这只会重新引入时序问题。

## 6.8 修改手动拖动逻辑

当前拖动逻辑单独计算：

```ts
const pageWidth = studioPageRef?.clientWidth ?? window.innerWidth
const leftW = studioLeftCollapsed() ? 68 : studioLeftWidth()
const minCanvas = 800
const maxCenter = Math.min(700, pageWidth - leftW - minCanvas)
setStudioCenterWidth(Math.min(maxCenter, Math.max(360, resizeState.startWidth + delta)))
```

改为复用统一函数：

```ts
setStudioCenterWidth(resolveStudioCenterWidth({
  preferredWidth: resizeState.startWidth + delta,
  pageWidth: currentStudioPageWidth(),
  leftWidth: currentStudioLeftWidth(),
}))
```

这样手动拖动和自动响应式不会再使用两套边界规则。

`onPagePointerUp()` 仍然保存最终安全宽度：

```ts
setStudioCenterStore("width", studioCenterWidth())
```

不需要改变拖动交互本身。

## 6.9 增加 `.studio-page` 的 ResizeObserver

建议新增一个页面容器观察器，以覆盖“window 未 resize，但页面实际可用宽度发生变化”的场景。

示意实现：

```ts
onMount(() => {
  const observer = new ResizeObserver(() => {
    applyStudioCenterWidth(studioCenterWidth())
  })

  observer.observe(studioPageRef)
  applyStudioResponsiveLayout()

  onCleanup(() => observer.disconnect())
})
```

这里 ResizeObserver 使用当前 live width 作为 preferred width：

```ts
applyStudioCenterWidth(studioCenterWidth())
```

这样容器尺寸变化时只负责保证安全约束，不会无条件覆盖用户刚刚手动拖动的宽度。

窗口 resize 和 media query 变化仍调用：

```ts
applyStudioResponsiveLayout()
```

它们可以继续执行现有的 `29%/31%` 自动推荐规则。

需要避免 observer 回调形成无意义循环：

- 观察对象是 `.studio-page`，不是宽度会被回调修改的 `.studio-center`。
- 更新中心栏通常不会改变 `.studio-page` 自身宽度，因此不会持续递归。

## 6.10 统一 `canvasWidth` 的数据来源

当前：

```ts
const canvasWidth = createMemo(() => {
  const leftW = studioLeftCollapsed() ? 68 : studioLeftWidth()
  const centerW = studioCenterWidth()
  return windowWidth() - leftW - centerW
})
```

逻辑可以保留，但 `windowWidth` 应当由 `currentStudioPageWidth()` 更新，实际含义更接近 `studioPageWidth`。

如允许做小范围命名整理，建议将：

```ts
windowWidth
setWindowWidth
```

改名为：

```ts
studioPageWidth
setStudioPageWidth
```

这不是必需修改，但可以避免后续开发继续误用 `window.innerWidth`。

## 7. 修改后的完整时序

### 7.1 首次进入 Studio

```text
创建 StudioPage
→ live center width 使用当前 viewport 的安全值
→ DOM 挂载
→ onMediaChange 主动执行
→ 使用页面实际宽度再次计算
→ ResizeObserver 开始观察 studio-page
```

### 7.2 Desktop 持久化异步完成

```text
持久化读出 center width = 468
→ studioCenterReady 变为 true
→ 水合 effect 调用 applyStudioCenterWidth(468)
→ 临界宽度下 maxSafeWidth = 360
→ 最终仍为 360
```

### 7.3 切换其他功能再返回 Studio

```text
StudioPage 重新创建
→ 不等待 resize
→ 初始化和 onMediaChange 都主动计算
→ center 立即收敛为 360
→ 右侧继续保留约 800px
```

### 7.4 手动拖动

```text
pointermove
→ 拖动目标宽度作为 preferredWidth
→ resolveStudioCenterWidth 统一限制
→ pointerup 保存最终安全宽度
```

## 8. 不推荐的修法

### 8.1 只在初始化补 `calcCenterWidth()`

问题：Desktop 异步水合完成后，旧持久化值仍可能再次覆盖响应式结果。

### 8.2 用 `setTimeout()` 延迟计算

问题：无法确定持久化和 DOM 布局完成的真实时间，只会把稳定 bug 变成竞态 bug。

### 8.3 只修改编辑器 CSS

问题：可以减轻重叠，但右侧工作区仍然被错误压缩，详情区、画布、文件管理等其他模块仍可能异常。

### 8.4 删除 `min-width: 360px`

问题：会允许中心栏继续压缩，掩盖右侧空间不足，同时破坏中间对话区自身布局。

### 8.5 只依赖 canvas ResizeObserver

问题：当前 canvas observer 只更新 `studioCanvasWidth`，没有反向修正 `studioCenterWidth`；并且编辑器待上传阶段和部分工作区状态不一定经过相同 canvas 内容结构。

## 9. 测试建议

## 9.1 纯函数单元测试

至少覆盖：

```ts
expect(resolveStudioCenterWidth({
  preferredWidth: 468,
  pageWidth: 1228,
  leftWidth: 68,
})).toBe(360)
```

```ts
expect(resolveStudioCenterWidth({
  preferredWidth: 700,
  pageWidth: 1456,
  leftWidth: 296,
})).toBe(360)
```

```ts
expect(resolveStudioCenterWidth({
  preferredWidth: 468,
  pageWidth: 1600,
  leftWidth: 296,
})).toBe(468)
```

```ts
expect(resolveStudioCenterWidth({
  preferredWidth: 900,
  pageWidth: 2200,
  leftWidth: 296,
})).toBe(700)
```

```ts
expect(resolveStudioCenterWidth({
  preferredWidth: 320,
  pageWidth: 1600,
  leftWidth: 296,
})).toBe(360)
```

## 9.2 页面场景验证

1. 把窗口调整到约 `1228px`。
2. 确认左栏折叠为 `68px`。
3. 将 `studio.center.width` 持久化值准备为 `468px`。
4. 进入 Studio，确认中心栏直接为 `360px`。
5. 不改变窗口尺寸，切换到 Make、Insight 或其他功能。
6. 再次返回 Studio，确认中心栏仍为 `360px`。
7. 等待桌面端持久化完全水合，确认不会跳回 `468px`。
8. 进入编辑能力并上传图片。
9. 确认右侧编辑区底部按钮、输入区和控制区没有重叠。
10. 轻微缩放窗口，确认中心栏和右侧区域连续更新。

## 9.3 回归验证

- `<1228px`：右侧工作区仍隐藏，编辑入口仍通过抽屉展示。
- `1228–1455px`：左栏折叠，中心栏不会侵占右侧 `800px`。
- `1456–1919px`：左栏正常恢复，中心栏遵循 `31%` 推荐规则和安全限制。
- `>=1920px`：中心栏遵循 `29%` 推荐规则和 `[360, 700]` 限制。
- 手动拖动中心栏后，松开可以正常保存。
- 页面重新进入后，持久化宽度只能在安全范围内恢复。
- 详情面板展开/折叠逻辑不受影响。
- 文件管理视图不受影响。

测试不能从仓库根目录运行。应按照仓库约束，在对应 package 目录执行。

## 10. 验收标准

修复可以通过以下标准验收：

1. 不触发 window resize，仅通过路由切走再返回 Studio，中心栏也能立即得到正确宽度。
2. 临界宽度下，无论持久化值是 `468px`、`600px` 还是 `700px`，最终中心栏都被限制为 `360px`。
3. 持久化异步水合不能覆盖当前安全布局。
4. 右侧工作区显示时，中心栏不能把其压缩到设计最小宽度以下。
5. 上传图片后编辑器底部内容不再因中心栏残留宽度而重叠。
6. 无需通过用户手动拖动窗口触发布局修正。

## 11. 后续可选防御优化

主问题修复后，可以单独考虑把编辑器内部的：

```css
@media (max-width: 799px)
```

调整为基于编辑器工作区实际宽度的 container query。

这能提高编辑器在异常嵌入尺寸下的防御能力，但属于第二阶段优化。即使实施 container query，也不能删除本方案中的中心栏安全宽度约束。

