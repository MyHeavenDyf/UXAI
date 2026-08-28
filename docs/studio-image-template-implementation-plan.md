# Studio 图片模板新功能实现文档

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录“图片模板”功能的已确认需求、现有架构分析、推荐实现方案、边界场景和后续待补充细节。
- 最后更新：2026-08-25。

## 2. 背景

Studio 需要在 `studio-composer-toolbar-items` 中增加一个“图片模板”入口。

用户点击入口后，右侧 Studio 工作区需要：

1. 在 `studio-canvas-header` 中打开并激活一个标题为“图片模板”的 `studio-canvas-tab`。
2. 在 `studio-canvas-body` 中显示图片模板页面内容。
3. 当前图片模板页面的具体业务内容暂未确定，第一阶段先预留独立占位内容。

## 3. 已确认的产品规则

### 3.1 文案

- 正确名称为“图片模板”。
- toolbar 按钮、canvas tab、tooltip、无障碍标签等位置统一使用“图片模板”。

### 3.2 toolbar 展示范围

- “图片模板”按钮只在当前能力为“图片生成”时显示，即 `capability === "image.generate"`。
- 视频生成和图片编辑能力下不显示该入口。

### 3.3 toolbar 样式与响应式规则

- 按钮布局遵循现有 `.studio-composer-toolbar-item` 体系。
- 按钮需要参与 `studio-composer-toolbar-items` 的宽度测量和 overflow 计算。
- 中心栏空间不足时，按钮需要和现有工具项一样收纳到 `.studio-composer-toolbar-more` 菜单中。
- toolbar 主区域和“更多”菜单中的入口行为必须一致。
- 点击任一入口都只打开或激活同一个图片模板 tab，不重复创建 tab。

### 3.4 canvas tab

- tab 标题为“图片模板”。
- tab 复用现有 `.studio-canvas-tab` 视觉体系。
- tab 需要关闭按钮，复用 `.studio-canvas-tab-close`。
- 图片模板 tab 是单例 tab。
- tab 已存在时再次点击 toolbar 入口，只激活该 tab。

### 3.5 canvas body

- 图片模板激活时，`studio-canvas-body` 显示独立的图片模板内容区域。
- 第一阶段只实现占位内容，不接业务接口、不创建模拟模板数据。
- 图片模板内容与文件管理、图片预览画布互斥显示。
- 第一阶段即创建独立的图片模板组件文件，不把占位内容直接写在 `StudioResultCanvas` 或 `studio-page.tsx` 中。
- 独立组件后续用于承载创建图片模板的完整业务区域，预期内容较多，应提前保持清晰的组件边界。

## 4. 本阶段目标

- 完成 toolbar 入口及其响应式收纳。
- 完成图片模板 tab 的打开、激活、切换和关闭。
- 创建独立图片模板组件，并完成 body 的独立占位区域。
- 支持有会话、无会话、无生成结果和小屏 workspace overlay 场景。
- 保证现有文件管理、图片 tab、生成结果预览和图片编辑器行为不回归。

## 5. 本阶段非目标

- 不实现模板列表、分类、搜索、筛选、分页或详情。
- 不接入图片模板后端接口。
- 不实现选择模板后的生成或编辑流程。
- 不修改 Studio 生成请求和结果数据结构。
- 不把图片模板加入 `StudioCapability`。
- 不把图片模板加入 `StudioMode`。
- 不将图片模板视图写入现有持久化的 `studio.view.preference`。
- 暂不确定最终埋点字段，待具体业务内容补充后统一设计。

## 6. 现有架构分析

### 6.1 Composer toolbar

关键文件：

```text
packages/app/octoapp/pages/studio/studio-composer.tsx
```

当前图片生成 toolbar item 顺序由 `toolbarItemKeys` 描述：

```ts
["capability", "style", "settings", "reverse", "material"]
```

toolbar 的响应式逻辑包括：

1. 从 DOM 中读取带有 `data-toolbar-item` 的节点宽度。
2. 计算所有 item 是否能放入 `.studio-composer-toolbar-items`。
3. 空间不足时，从数组尾部开始把 item 放入 `toolbarOverflow`。
4. 主 toolbar 根据 `toolbarOverflow` 隐藏对应节点。
5. `.studio-composer-toolbar-more` 根据相同 key 渲染收纳后的入口。

因此新增图片模板入口不能只增加 JSX，还必须同步修改：

- `toolbarItemKeys`。
- 主 toolbar 的 `data-toolbar-item`。
- `toolbarOverflow().includes(...)` 显示条件。
- “更多”菜单中的对应入口。

### 6.2 Studio 页面状态

关键文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

当前右侧区域存在两类不同状态：

- `StudioMode`：控制 `preview`、变清晰、抠图、智能重绘、扩图等编辑器模式。
- `showFileManager`：控制普通预览模式下显示文件管理还是图片画布。

图片模板不是一种生成能力，也不是图片编辑器，因此不应放入上述 `StudioCapability` 或 `StudioMode`。它应作为与文件管理、图片预览并列的 canvas 一级视图。

### 6.3 Canvas header 和 body

关键文件：

```text
packages/app/octoapp/pages/studio/studio-conversation.tsx
```

`StudioResultCanvas` 当前负责：

- 渲染固定的“文件管理”tab。
- 渲染动态图片 tab。
- 在 body 中切换文件管理网格和图片预览。
- 渲染图片操作栏、下载、AI 修图入口和右侧详情内容。

当前 `shouldShowCanvas()` 只有在以下情况才为真：

- 当前有可显示的图片或视频。
- 当前正在显示文件管理，并且不处于文件管理详情加载状态。

如果只添加图片模板 tab，而不扩展该判断，在无图片场景中组件会提前进入 fallback，canvas header 不会出现。

### 6.4 空白 Studio

`studio-page.tsx` 中存在两处 `StudioComposer`：

1. 没有会话内容时的空白 Studio composer。
2. 已有会话时中心栏底部的 composer。

两处都必须接入图片模板点击回调。

同时，当前 `hasStudioConversation()` 不会因为打开普通 canvas 页面而变为真。若用户在空白 Studio 点击“图片模板”，必须让图片模板打开状态参与布局判断，否则右侧 workspace 不会挂载。

### 6.5 小屏 workspace overlay

窗口宽度小于 1228px 时，右侧 workspace 默认隐藏，并通过 `studioWorkspaceOverlayOpen` 以悬浮抽屉方式打开。

图片模板入口需要复用现有编辑工具的行为：

```text
点击图片模板
  -> 打开并激活图片模板 tab
  -> 如果右侧 workspace 当前不可见
  -> setStudioWorkspaceOverlayOpen(true)
```

## 7. 推荐状态模型

### 7.1 当前激活视图

建议用互斥联合类型描述当前 canvas 一级视图：

```ts
type StudioCanvasView = "canvas" | "file-manager" | "image-template"
```

建议的页面状态：

```ts
const [canvasView, setCanvasView] = createSignal<StudioCanvasView>("file-manager")
const [imageTemplateTabOpen, setImageTemplateTabOpen] = createSignal(false)
```

两者职责不同：

| 状态 | 职责 |
|---|---|
| `canvasView` | 决定当前激活哪个一级视图以及 body 显示什么 |
| `imageTemplateTabOpen` | 决定 header 中是否存在“图片模板”tab |

不建议新增 `showImageTemplate` 并继续与 `showFileManager` 并列控制 body。多个布尔状态可能产生“文件管理和图片模板同时激活”等非法组合。

### 7.2 与现有持久化偏好的关系

现有 `studio.view.preference` 只持久化：

```ts
"canvas" | "file-manager"
```

图片模板第一阶段建议保持临时状态：

- 打开图片模板时不写入 `studio.view.preference`。
- 从图片模板切回图片或文件管理时，继续维护现有偏好。
- 切换 Studio session 时关闭图片模板 tab，并按现有规则恢复图片或文件管理视图。

这样可以避免用户进入另一会话时自动落入一个与会话数据无关的临时页面。

## 8. 交互状态流

### 8.1 从 toolbar 打开

```text
用户点击“图片模板”
  -> 关闭 toolbar 的更多菜单和互斥弹层
  -> imageTemplateTabOpen = true
  -> canvasView = "image-template"
  -> 确保 Studio workspace 进入可渲染状态
  -> 小屏时打开 studioWorkspaceOverlay
  -> header 激活“图片模板”tab
  -> body 显示图片模板占位内容
```

### 8.2 再次点击 toolbar

```text
图片模板 tab 已存在
  -> 不创建新 tab
  -> canvasView = "image-template"
```

### 8.3 点击图片模板 tab

```text
canvasView = "image-template"
```

不修改当前选中的生成结果和图片 ID，以便切回图片 tab 时恢复原来的预览。

### 8.4 关闭图片模板 tab

关闭未激活的图片模板 tab：

```text
imageTemplateTabOpen = false
当前 canvasView 保持不变
```

关闭当前激活的图片模板 tab：

```text
imageTemplateTabOpen = false
  -> 如果存在图片 tab，切换到 canvas
  -> 如果不存在图片 tab，切换到 file-manager
```

### 8.5 切换到图片 tab

现有 `selectCanvasTab()` 除选中结果和图片外，还需要：

```text
canvasView = "canvas"
```

图片模板 tab 保持打开，但失去 active 状态。

### 8.6 切换到文件管理

点击“文件管理”tab 时：

```text
canvasView = "file-manager"
```

图片模板 tab 保持打开，但失去 active 状态。

现有文件管理详情页的进入、返回和恢复逻辑继续保留。

### 8.7 切换 session

建议在现有 session 变化处理逻辑中：

```text
imageTemplateTabOpen = false
canvasView 按现有 studio.view.preference/session 默认规则恢复
```

## 9. 分文件实现方案

### 9.1 `studio-composer.tsx`

新增 prop：

```ts
onImageTemplateClick?: () => void
```

图片生成模式的 `toolbarItemKeys` 增加稳定 key，例如：

```ts
"image-template"
```

主 toolbar 增加：

- `.studio-composer-toolbar-item` 容器。
- `data-toolbar-item="image-template"`。
- `toolbarOverflow` 显示条件。
- “图片模板”按钮、tooltip 和 `aria-label`。

“更多”菜单增加：

- `toolbarOverflow().includes("image-template")` 条件。
- 与主按钮相同的点击回调。
- 点击后关闭“更多”菜单。

按钮在 toolbar 中的最终排列位置和图标资源待 UI 细节补充。由于 overflow 从尾部开始收纳，排列位置同时决定按钮在窄宽度下的保留优先级。

### 9.2 `studio-page.tsx`

页面层负责持有：

- 当前 canvas 一级视图。
- 图片模板 tab 是否打开。
- toolbar 点击处理函数。
- tab 关闭后的回退策略。
- session 切换时的清理策略。

建议新增统一入口：

```ts
function openImageTemplate() {
  batch(() => {
    setImageTemplateTabOpen(true)
    setCanvasView("image-template")
    setMode("preview")
    setOpenMenu(null)
    if (!showStudioWorkspace()) setStudioWorkspaceOverlayOpen(true)
  })
}
```

需要把该回调同时传给空白页和会话页两处 `StudioComposer`。

`hasStudioConversation()`、workspace 外层 `Show` 和 canvas 内层 `Show` 都需要把图片模板打开状态计入可渲染条件。

### 9.3 `studio-conversation.tsx`

`StudioResultCanvas` 需要接收能表达以下信息的 props：

- 当前 canvas view。
- 图片模板 tab 是否打开。
- 激活图片模板回调。
- 关闭图片模板回调。

header 推荐顺序：

```text
文件管理 | 图片模板 | 动态图片 tabs
```

具体顺序后续可根据 UI 设计调整，但图片模板应与动态图片 tab 使用相同的 active 和 close 交互反馈。

body 必须改为互斥分支：

```text
canvasView === "image-template"
  -> 图片模板内容

canvasView === "file-manager"
  -> StudioFileManager 或文件管理详情

canvasView === "canvas"
  -> 图片/视频预览、操作栏、详情面板
```

图片模板视图激活时不得渲染：

- 图片预览 stage。
- 再次生成、视频生成、AI 修图、下载等浮动操作。
- `StudioDetails` 详情面板。
- 图片生成中 fallback。

`shouldShowCanvas()` 需要把图片模板视图作为有效内容，否则无图片时 header 和 body 无法显示。

### 9.4 独立图片模板组件

新增组件文件：

```text
packages/app/octoapp/pages/studio/studio-image-template.tsx
```

第一阶段该组件只负责渲染图片模板 body 的占位内容，但文件和组件边界需要直接建立。后续创建图片模板所需的表单、配置、预览和操作区域都在该组件内继续扩展，避免 `StudioResultCanvas` 和 `studio-page.tsx` 因业务内容增长而继续膨胀。

建议组件入口：

```ts
export function StudioImageTemplate(): JSX.Element
```

第一阶段没有业务状态和事件时不预设 props；后续根据真实数据流逐步增加，避免为尚未确定的功能设计空接口。

`StudioResultCanvas` 只负责根据当前一级视图挂载该组件：

```tsx
<Show when={props.canvasView === "image-template"}>
  <StudioImageTemplate />
</Show>
```

### 9.5 样式文件

预计涉及：

```text
packages/app/octoapp/pages/studio/studio-02.css
packages/app/octoapp/pages/studio/studio-03.css
```

样式职责：

- 图片模板 toolbar 图标及按钮内容布局。
- “更多”菜单中的图片模板图标。
- 图片模板 body 占位容器。

tab、active、close 和 header 布局优先复用现有样式，不新增重复规则。

## 10. 占位内容建议

在正式模板业务方案补充前，建议使用最小占位内容：

```text
studio-image-template-placeholder
└── 文案：图片模板内容待补充
```

占位内容只用于验证 tab 和视图状态链路，不包含：

- 假模板卡片。
- 模拟筛选器。
- 临时接口。
- 与最终功能可能冲突的复杂布局。

占位内容必须放在第一阶段创建的独立组件中：

```text
packages/app/octoapp/pages/studio/studio-image-template.tsx
```

不把占位内容直接内联到 `StudioResultCanvas`。这样后续补充创建图片模板的完整内容时，不需要再次迁移 DOM、状态和样式职责。

## 11. 关键边界与风险

### 11.1 空白页无法挂载 workspace

风险：空白 Studio 点击按钮后，`hasStudioConversation()` 仍为 false，右侧 canvas 不出现。

处理：图片模板打开状态必须参与页面布局判断，两处 composer 都要接入事件。

### 11.2 `StudioResultCanvas` 提前 fallback

风险：无图片且未显示文件管理时，`shouldShowCanvas()` 返回 false，导致 header 被跳过。

处理：图片模板激活时必须视为有效 canvas 内容。

### 11.3 多个布尔状态互相冲突

风险：`showFileManager` 和新增的 `showImageTemplate` 同时为 true，出现多个 active tab 或 body 重叠。

处理：使用 `StudioCanvasView` 互斥状态。

### 11.4 toolbar overflow 漏接

风险：只添加主 toolbar 节点，没有把 key 加入测量和“更多”菜单，窄中心栏下按钮会被裁剪或消失。

处理：主区域、key 数组和“更多”菜单使用同一稳定 key。

### 11.5 overflow 优先级变化

风险：当前算法从 `toolbarItemKeys` 尾部开始收纳；新增 item 的位置会改变现有“图文反推”和“词书”的收纳顺序。

处理：实现前确认最终排列顺序，并针对多个中心栏宽度验证。

### 11.6 文件管理详情恢复

风险：从文件管理详情切到图片模板后，再切回文件管理时丢失原来的详情选中项。

处理：图片模板切换不清空现有 `fileManagerDetailResultId`、`fileManagerDetailImageId` 和 `fileManagerDetailView`，沿用当前恢复逻辑。

### 11.7 图片选择状态丢失

风险：打开图片模板时清空 `selectedResultId` 或 `selectedImageId`，导致切回图片 tab 后无法恢复原图。

处理：打开图片模板只切换一级 view，不清空图片选择状态。

## 12. 验收清单

### 12.1 toolbar

- [ ] “图片模板”文案正确，不存在错误写法。
- [ ] 仅图片生成模式显示入口。
- [ ] 主 toolbar 样式与现有 toolbar item 一致。
- [ ] 宽度充足时显示在主 toolbar。
- [ ] 中心栏变窄时正确进入“更多”菜单。
- [ ] 从“更多”菜单点击后菜单关闭。
- [ ] disabled/busy 行为与相邻工具项保持一致。

### 12.2 tab

- [ ] 首次点击打开一个图片模板 tab。
- [ ] 重复点击不创建重复 tab。
- [ ] 点击 toolbar 可以重新激活已存在 tab。
- [ ] 点击 tab 可以激活图片模板 body。
- [ ] tab active 样式正确。
- [ ] tab 关闭按钮可用，并阻止点击事件冒泡。
- [ ] 关闭非激活 tab 不影响当前视图。
- [ ] 关闭激活 tab 后按图片 tab/文件管理规则回退。

### 12.3 body

- [ ] 已创建独立的 `studio-image-template.tsx`，占位内容不内联在 `StudioResultCanvas` 或 `studio-page.tsx`。
- [ ] 图片模板激活时显示独立占位内容。
- [ ] 不同时显示文件管理内容。
- [ ] 不同时显示图片预览和浮动操作栏。
- [ ] 不显示图片详情面板。
- [ ] 从图片模板切回图片后恢复原选中图片。
- [ ] 从图片模板切回文件管理后保持文件管理原有行为。

### 12.4 页面场景

- [ ] 空白 Studio 无 session 时可以打开。
- [ ] 已有会话但无图片时可以打开。
- [ ] 已有图片 tab 时可以打开、切换和关闭。
- [ ] 文件管理详情页场景切换后可以恢复。
- [ ] 小于 1228px 时自动打开 workspace overlay。
- [ ] overlay 关闭后再次点击可以重新打开。
- [ ] 切换 session 后图片模板 tab 按约定关闭。

### 12.5 质量验证

- [ ] 从 `packages/app` 运行项目规定的 typecheck。
- [ ] 对 toolbar overflow 的多个宽度进行浏览器验证。
- [ ] 验证图片生成、视频生成和图片编辑模式的显示差异。
- [ ] 验证文件管理、动态图片 tab 和编辑器模式没有回归。

## 13. 建议实施顺序

1. 在页面层引入 `StudioCanvasView` 和图片模板 tab 打开状态。
2. 接通两处 composer 的 toolbar 点击事件。
3. 完成主 toolbar 和“更多”菜单入口及 overflow key。
4. 在 `StudioResultCanvas` 中增加 tab。
5. 创建独立的 `studio-image-template.tsx` 组件文件。
6. 把 body 重构为三个互斥一级视图分支，并在图片模板分支挂载独立组件。
7. 在独立组件中增加最小占位内容和必要样式。
8. 补齐 session、关闭回退和小屏 overlay 行为。
9. 完成 typecheck、浏览器交互和响应式验证。

## 14. 待后续补充

- 图片模板按钮的最终图标资源。
- toolbar 中的最终排列位置及 overflow 优先级。
- 图片模板 tab 与动态图片 tab 的最终排列顺序。
- 图片模板 body 的产品结构和视觉稿。
- 模板数据来源、接口协议和缓存策略。
- 模板分类、搜索、筛选、分页等交互。
- 点击模板后的后续动作。
- 是否需要埋点以及事件命名。
- 是否需要 URL、session 或全局级别的状态持久化。

## 15. 变更记录

### 2026-08-25

- 创建实现文档。
- 确认功能名称为“图片模板”。
- 确认 toolbar 入口仅在图片生成模式显示。
- 确认按钮遵循现有 toolbar item 和“更多”菜单收纳逻辑。
- 确认图片模板 tab 带关闭按钮。
- 完成现有代码结构、状态模型和关键边界分析。
- 确认第一阶段即创建独立的 `studio-image-template.tsx`，为后续较大规模的图片模板创建内容预留稳定组件边界。
