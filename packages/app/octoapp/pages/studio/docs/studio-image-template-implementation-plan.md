# Studio 风格模板与模板创建功能实现文档

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 Studio“风格模板”浮窗和“创建模板”工作区的需求、架构分析、实现方案、边界场景和验收标准。
- 最后更新：2026-08-26。
- 本次修订：toolbar“图片模板”改为“风格模板”；点击后先打开模板浮窗，只有点击浮窗中的“创建模板”按钮才打开右侧工作区；右侧 canvas tab 标题改为“创建模板”。

## 2. 背景与目标

Studio 需要在 `studio-composer-toolbar-items` 中增加“风格模板”入口。

完整交互分为两个层级：

1. 点击 toolbar“风格模板”，在 Composer 上方显示浮窗。
2. 浮窗 header 左侧显示“创意广场”和“我的模板”，默认选中“创意广场”。
3. 浮窗 header 右侧显示“创建模板”按钮。
4. 点击“创建模板”后关闭浮窗，在右侧 Studio 工作区打开并激活标题为“创建模板”的 `studio-canvas-tab`。
5. 激活该 tab 时，`studio-canvas-body` 显示独立的模板创建视图。

第一阶段只实现结构和状态链路：浮窗内容区域留白，不实现创意广场、我的模板和模板创建业务内容。

## 3. 已确认的产品规则

### 3.1 用户可见文案

| 位置 | 文案 |
|---|---|
| Composer toolbar 按钮 | 风格模板 |
| toolbar tooltip / `aria-label` | 风格模板 |
| 浮窗默认 tab | 创意广场 |
| 浮窗第二个 tab | 我的模板 |
| 浮窗右侧按钮 | 创建模板 |
| 右侧 `studio-canvas-tab` | 创建模板 |
| tab 关闭按钮 tooltip / `aria-label` | 关闭创建模板 |

内部命名建议使用 `style-template` 表达浮窗入口，使用 `template-creator` 表达右侧创建视图，避免将两个层级混成同一个状态。

### 3.2 toolbar 展示和响应式

- “风格模板”只在 `capability === "image.generate"` 时显示。
- 视频生成和图片编辑能力下不显示。
- busy 时 disabled 行为与相邻 toolbar item 一致。
- 按钮遵循 `.studio-composer-toolbar-item` 体系并参与宽度测量。
- “风格模板”按钮固定放在“图片设置”按钮后面，即 `settings` 之后、“图文反推”之前。
- 空间不足时进入 `.studio-composer-toolbar-more`。
- 主 toolbar 和“更多”菜单入口打开同一个浮窗。
- “更多”菜单中的入口保留文案前置图标槽位，第一阶段图标内容留白，不引入临时图标资源。
- dropdown 的锚点、展开方向和 overflow 场景定位参考现有“词书”菜单。
- 打开风格模板浮窗时，参数、风格模型、词书等其他菜单应关闭。

图片生成 toolbar 的目标顺序为：

```ts
["capability", "style", "settings", "style-template", "reverse", "material"]
```

当前 overflow 算法从数组尾部开始收纳，因此空间不足时会优先收纳 `material`，然后是 `reverse`，再是 `style-template`；`capability` 和 `style` 仍按现有逻辑保留。

### 3.3 风格模板浮窗

```text
风格模板浮窗
├── header
│   ├── tabs
│   │   ├── 创意广场（默认选中）
│   │   └── 我的模板
│   └── 创建模板按钮
└── content
    └── 留白
```

- 点击 toolbar“风格模板”只打开或关闭浮窗，不改变右侧工作区。
- “创意广场”和“我的模板”支持 active 状态切换。
- 两个 tab 的内容均留白，不显示卡片、空状态、模拟数据或 loading。
- 浮窗尺寸固定为宽 `408px`、高 `388px`，圆角 `12px`。
- 点击浮窗外部时关闭，行为与现有 Composer 菜单一致。
- 点击“创建模板”时关闭浮窗并进入右侧模板创建工作区。

### 3.4 创建模板 canvas tab

- 标题为“创建模板”。
- 复用 `.studio-canvas-tab` 和 `.studio-canvas-tab-close`。
- tab 是单例；重复点击“创建模板”只激活已有 tab。
- 点击 tab 只切换 canvas 一级视图，不清空图片或文件管理详情状态。

### 3.5 创建模板 canvas body

- 与文件管理、图片/视频预览互斥显示。
- 使用独立组件，不直接写在 `StudioResultCanvas` 或 `studio-page.tsx` 中。
- 第一阶段不接接口、不造模拟数据。
- 激活时不显示图片 stage、下载、AI 修图、浮动操作栏或 `StudioDetails`。

## 4. 本阶段范围

### 4.1 目标

- 完成“风格模板”入口和 overflow 收纳。
- 完成浮窗 shell、两个 tabs、“创建模板”按钮及留白 content。
- 完成“创建模板”tab 的打开、激活、切换和关闭。
- 建立独立模板创建组件并接入 canvas body。
- 支持有/无 session、无结果和小屏 workspace overlay。
- 保证文件管理、动态图片 tab、生成预览和编辑器不回归。

### 4.2 非目标

- 不实现模板列表、分类、搜索、筛选、分页或详情。
- 不实现“我的模板”管理功能。
- 不接入模板后端接口。
- 不实现模板选择后的生成或编辑流程。
- 不实现模板创建表单、预览、保存和发布。
- 不修改 Studio 生成请求和结果结构。
- 不把该功能加入 `StudioCapability` 或 `StudioMode`。
- 不写入现有 `studio.view.preference`。
- 暂不设计埋点。

## 5. 现有 Studio 架构分析

### 5.1 页面级状态

关键文件：

```text
packages/app/octoapp/pages/studio-page.tsx
```

该文件负责 session、生成/编辑状态、center/workspace 布局、动态图片 tab、文件管理、当前选中图片和页面级 `openMenu`。

现有右侧区域主要由以下状态控制：

- `StudioMode`：preview、变清晰、抠图、智能重绘和扩图等编辑器。
- `showFileManager`：文件管理和图片 canvas 的切换。
- `showStudioCanvas`：普通 canvas 是否挂载。

模板创建不是生成能力或编辑器，应作为与文件管理、图片预览并列的 canvas 一级视图。

### 5.2 Composer toolbar 和菜单

关键文件：

```text
packages/app/octoapp/pages/studio/studio-composer.tsx
```

图片生成 toolbar 当前由以下 key 描述：

```ts
["capability", "style", "settings", "reverse", "material"]
```

响应式逻辑会测量 `data-toolbar-item` 节点，从尾部将放不下的 item 收入 `toolbarOverflow`，再由“更多”菜单渲染相同入口。

新增“风格模板”必须同步处理：

- `toolbarItemKeys`。
- 主 toolbar 的 `data-toolbar-item`、ref 和显示条件。
- “更多”菜单入口。
- dropdown anchor 和定位 key。

修改后的图片生成 toolbar key 顺序为：

```ts
["capability", "style", "settings", "style-template", "reverse", "material"]
```

`style-template` 紧跟在图片设置 `settings` 后面。主 toolbar 和 overflow 菜单共用该稳定 key，dropdown 定位复用“词书”的 anchor/`positionDropdown()` 路径；当入口进入“更多”菜单后，浮窗参考词书从更多菜单侧边展开并与菜单底部对齐。

当前 `openMenu` 是页面级共享状态，适合加入 `"style-template"`，不应再增加一个与其他菜单互不知情的布尔值。

### 5.3 两处 Composer

`studio-page.tsx` 有两处互斥渲染的 `StudioComposer`：空白 Studio Composer 和会话页底部 Composer。两处都要传入相同的创建模板回调。

### 5.4 Canvas header/body

关键文件：

```text
packages/app/octoapp/pages/studio/studio-conversation.tsx
```

`StudioResultCanvas` 当前负责固定“文件管理”tab、动态图片 tab、文件管理/预览切换、操作栏和详情内容。

当前 `shouldShowCanvas()` 只有在存在可显示媒体，或文件管理可显示时才为 true。若不扩展判断，无图片场景会提前进入 fallback，创建模板 header/body 无法出现。

### 5.5 空白 Studio 的多层门控

空白 Studio 创建模板时，以下门控都必须允许临时模板视图渲染：

- `hasStudioConversation()`。
- workspace 外层 `Show`。
- `.studio-canvas` 内层 `Show`。
- `StudioResultCanvas.shouldShowCanvas()`。

只调用 `setShowStudioCanvas(true)` 不够，现有 effect 在无会话数据和无图片时会再次把它设为 false。

### 5.6 小屏 overlay

窗口宽度小于 1228px 时，workspace 通过 `studioWorkspaceOverlayOpen` 显示。

- 点击 toolbar“风格模板”不打开 overlay。
- 点击浮窗“创建模板”后，如果 workspace 不可见，则打开 overlay。

## 6. 推荐组件边界

建议新增：

```text
packages/app/octoapp/pages/studio/studio-style-template-menu.tsx
packages/app/octoapp/pages/studio/studio-template-creator.tsx
```

```ts
export function StudioStyleTemplateMenu(props: {
  onCreateTemplate: () => void
}): JSX.Element

export function StudioTemplateCreator(): JSX.Element
```

- `StudioStyleTemplateMenu`：管理浮窗 header、局部 tab 状态、创建按钮和留白 content。
- `StudioTemplateCreator`：作为右侧创建模板内容的稳定边界。

浮窗 tab 状态不提升到页面层。右侧创建模板 tab 的打开和激活状态必须由页面层持有。

## 7. 推荐状态模型

### 7.1 Composer 菜单

```ts
type StudioComposerMenu =
  | "capability"
  | "style"
  | "settings"
  | "material"
  | "style-template"
  | null
```

浮窗是否打开由 `props.openMenu === "style-template"` 唯一决定。

### 7.2 Canvas 一级视图

```ts
type StudioCanvasView = "canvas" | "file-manager" | "template-creator"

const [canvasView, setCanvasView] = createSignal<StudioCanvasView>("file-manager")
const [templateCreatorTabOpen, setTemplateCreatorTabOpen] = createSignal(false)
```

| 状态 | 职责 |
|---|---|
| `canvasView` | 决定 active tab 和 body 的互斥分支 |
| `templateCreatorTabOpen` | 决定 header 中是否存在“创建模板”tab |

不建议增加 `showTemplateCreator` 与 `showFileManager` 并列渲染。现有 `showFileManager` 修改点较多，可渐进迁移，但最终 body 必须由单一互斥视图决定。

### 7.3 持久化

- 模板创建视图不写入 `studio.view.preference`。
- 切回图片或文件管理时继续维护原偏好。
- 切换 session 时关闭创建模板 tab。
- 不持久化浮窗中“创意广场/我的模板”的选择。

## 8. 交互状态流

### 8.1 打开浮窗

```text
点击“风格模板”
  -> openMenu 在 "style-template" 和 null 间切换
  -> 关闭其他 Composer 菜单
  -> 不修改 templateCreatorTabOpen
  -> 不修改 canvasView
  -> 不打开 workspace overlay
```

### 8.2 切换浮窗 tab

只修改 `StudioStyleTemplateMenu` 内部 active tab；content 保持留白，不影响右侧 workspace。

### 8.3 创建模板

```ts
function openTemplateCreator() {
  batch(() => {
    setOpenMenu(null)
    setTemplateCreatorTabOpen(true)
    setCanvasView("template-creator")
    setShowStudioCanvas(true)
    setMode("preview")
    if (!showStudioWorkspace()) setStudioWorkspaceOverlayOpen(true)
  })
}
```

不得清空 `selectedResultId`、`selectedImageId`、`canvasTabImages`、文件管理详情 ID 或 `fileManagerDetailView`。

### 8.4 再次创建或点击 tab

tab 已存在时不重复创建，只设置 `canvasView = "template-creator"`，并在需要时重新打开小屏 overlay。

### 8.5 切换图片/文件管理

- 图片 tab：`canvasView = "canvas"`。
- 文件管理：`canvasView = "file-manager"`。
- 创建模板 tab 保持打开但失去 active；原选择状态继续保留。

### 8.6 关闭创建模板 tab

- 关闭未激活 tab：只设置 `templateCreatorTabOpen = false`。
- 关闭激活 tab：有动态图片 tab 时回到 canvas；有 session 数据时回到 file-manager；否则回到空白 Studio。
- 空白 Studio 中关闭唯一临时 tab 后，不强行显示无数据文件管理。

### 8.7 切换 session

```text
openMenu = null
templateCreatorTabOpen = false
canvasView 按现有 session / studio.view.preference 规则恢复
```

## 9. 分文件实现方案

### 9.1 `studio-composer.tsx`

新增：

```ts
onCreateTemplate?: () => void
```

修改内容：

1. `openMenu` 类型加入 `"style-template"`。
2. 图片生成 `toolbarItemKeys` 加入同名稳定 key。
3. 将 key 放在 `settings` 后、`reverse` 前，主 toolbar 按相同顺序添加“风格模板”item、`data-toolbar-item` 和 button ref。
4. 根据 `toolbarOverflow` 隐藏主入口。
5. “更多”菜单增加同一入口，复用 `.studio-composer-toolbar-more-item-icon` 的前置图标占位尺寸，但第一阶段不渲染图标资源。
6. 增加 dropdown anchor 和 `StudioStyleTemplateMenu`，定位行为参考“词书”。
7. 点击“创建模板”先关闭菜单，再调用 `props.onCreateTemplate?.()`。

主入口建议复用带 caret 的 `ToolButton`，使用现有 active 和 caret 翻转反馈。

### 9.2 `studio-style-template-menu.tsx`

- 默认 active tab 为“创意广场”。
- 支持两个 tab 切换。
- 渲染“创建模板”按钮。
- content 留白。
- 根浮窗尺寸为 `width: 408px; height: 388px; border-radius: 12px;`。
- 不请求接口、不造数据、不直接操作 workspace 状态。

### 9.3 `studio-page.tsx`

- 持有 `canvasView` 和 `templateCreatorTabOpen`。
- 实现 `openTemplateCreator()` 和关闭回退。
- 两处 Composer 都传入 `onCreateTemplate`。
- session 切换时清理临时 tab。
- 把模板状态加入 `hasStudioConversation` 和 workspace/canvas 多层渲染条件。
- 不清空图片、文件管理详情和生成结果状态。

### 9.4 `studio-conversation.tsx`

`StudioResultCanvas` 增加 props：当前 canvas view、创建模板 tab 是否打开、激活和关闭回调。

推荐 header 顺序：

```text
文件管理 | 创建模板 | 动态图片 tabs
```

body 使用互斥分支：

```text
template-creator -> StudioTemplateCreator
file-manager     -> StudioFileManager / 详情
canvas           -> 媒体预览、操作栏和详情
```

模板创建分支应优先于普通生成 fallback，避免被空状态或 loading 覆盖。

### 9.5 `studio-template-creator.tsx`

第一阶段只建立组件边界，不预设无用 props，不创建模拟表单。后续表单、配置、预览和操作区域都在该组件内扩展。

### 9.6 样式

预计涉及：

```text
studio-01.css：toolbar item 尺寸/图标（如需要）
studio-02.css：风格模板浮窗、header tabs、创建按钮和响应式
studio-03.css：创建模板 canvas body 容器（如需要）
```

优先复用 `.studio-menu`、`.studio-composer-dropdown-anchor`、`.studio-canvas-tab`、`.studio-canvas-tab-close` 和 `.studio-canvas-body`。

## 10. 视觉与响应式建议

- 浮窗使用现有 Studio menu 的白色背景和阴影体系，宽 `408px`、高 `388px`、圆角 `12px`。
- header 左侧为 segmented tabs，右侧为“+ 创建模板”。
- content 保留可见空白区域，不展示占位文字。
- dropdown 位置参考“词书”：主 toolbar 场景锚定对应按钮；进入“更多”菜单后从菜单侧边展开并与菜单底部对齐。
- 常规场景使用上述固定尺寸；极窄 viewport 可通过 `max-width` 限制到可用宽度，避免浮窗越出窗口。
- 浮窗挂在 toolbar 外层 anchor 下，避免被 `.studio-composer-toolbar-items { overflow: hidden; }` 裁剪。
- 不提前臆造卡片区域或临时图标资源。

## 11. 关键风险

### 11.1 toolbar 错误直达工作区

toolbar 只修改 `openMenu`；只有浮窗“创建模板”调用页面级 handler。

### 11.2 空白页无法挂载

`templateCreatorTabOpen` 必须参与页面布局判断，两处 Composer 都接入回调。

### 11.3 Canvas 提前 fallback

模板创建视图必须被 `shouldShowCanvas()` 视为有效内容，并优先渲染。

### 11.4 多布尔状态冲突

使用 `StudioCanvasView` 保证文件管理、图片 canvas 和模板创建互斥。

### 11.5 overflow 漏接或优先级变化

key、DOM 测量、主入口、“更多”入口和 anchor 使用同一稳定 key；实现后验证多个 center 宽度。

### 11.6 原视图状态丢失

模板切换不清空图片选择、动态 tabs、文件管理详情 ID 和详情视图。

### 11.7 被生成状态覆盖

明确 `template-creator` 的渲染优先级，生成状态只影响普通 canvas 分支。

### 11.8 关闭最后临时 tab

根据动态图片 tab 和 session 数据回退到 canvas、file-manager 或空白 Studio。

## 12. 验收清单

### 12.1 toolbar

- [ ] 文案为“风格模板”，且仅 `image.generate` 显示。
- [ ] 主 toolbar 中位于图片设置之后、图文反推之前。
- [ ] 点击只打开浮窗，不直接改变 workspace。
- [ ] busy、hover、active 行为正确。
- [ ] 主 toolbar 和“更多”入口行为一致。
- [ ] overflow 收纳和 dropdown 定位正确。
- [ ] “更多”菜单入口保留前置图标空白槽位，没有临时图标。
- [ ] dropdown 在主 toolbar 和“更多”场景下均按词书的方式定位。
- [ ] 与其他 Composer 菜单互斥。

### 12.2 浮窗

- [ ] 显示“创意广场”“我的模板”和“创建模板”。
- [ ] 默认选中“创意广场”。
- [ ] 两个 tab 可切换 active。
- [ ] content 留白，无卡片、模拟数据或占位文案。
- [ ] 常规场景尺寸为 `408px × 388px`，圆角为 `12px`。
- [ ] 点击外部关闭；窄视口不裁切。
- [ ] 点击“创建模板”后浮窗关闭。

### 12.3 创建模板 tab/body

- [ ] tab 标题为“创建模板”且为单例。
- [ ] 可激活、切换和关闭，关闭按钮阻止冒泡。
- [ ] 使用独立 `StudioTemplateCreator`。
- [ ] 激活时不显示文件管理、媒体预览、操作栏或详情。
- [ ] 切回图片/文件管理后恢复原状态。
- [ ] 关闭后按 canvas、file-manager 或空白 Studio 规则回退。

### 12.4 页面场景

- [ ] 无 session、无图片和已有图片场景均可创建模板。
- [ ] 文件管理详情切换后可恢复。
- [ ] 小于 1228px 时创建模板自动打开 workspace overlay。
- [ ] 仅打开浮窗时不打开 overlay。
- [ ] overlay 关闭后可再次打开。
- [ ] 切换 session 后临时 tab 关闭。

### 12.5 质量验证

- [ ] 从 `packages/app` 运行 `bun typecheck`。
- [ ] 浏览器验证多种 toolbar/center 宽度。
- [ ] 验证图片生成、视频生成和编辑能力的入口差异。
- [ ] 验证空白和会话两处 Composer。
- [ ] 验证文件管理、动态图片 tab 和编辑器无回归。

## 13. 建议实施顺序

1. 扩展 Composer menu 类型，加入 `"style-template"`。
2. 创建 `StudioStyleTemplateMenu`。
3. 接入主 toolbar、overflow、“更多”菜单和 dropdown 定位。
4. 页面层增加 `StudioCanvasView` 和 `templateCreatorTabOpen`。
5. 接通两处 Composer 的 `onCreateTemplate`。
6. 创建 `StudioTemplateCreator`。
7. 在 `StudioResultCanvas` 增加“创建模板”tab。
8. 将 body 调整为三个互斥分支。
9. 补齐空白 Studio、session、关闭回退和小屏 overlay。
10. 完成 typecheck 和浏览器交互验证。

## 14. 待后续确认

- “风格模板”主 toolbar 按钮的最终图标资源（“更多”菜单前置图标第一阶段已确认留白）。
- 浮窗内部 header/content 的精确 padding。
- 创建模板 tab 与动态图片 tabs 的最终顺序。
- 右侧模板创建页面的正式结构和视觉稿。
- 创意广场/我的模板接口、缓存和使用流程。
- 创建模板表单、保存、发布及状态持久化需求。
- 埋点事件和字段命名。

## 15. 变更记录

### 2026-08-26

- toolbar 文案由“图片模板”改为“风格模板”。
- 确认按钮位于图片设置之后、图文反推之前，并明确 overflow 优先级。
- 确认“更多”菜单入口的前置图标槽位第一阶段留白。
- 确认 dropdown 定位参考“词书”。
- 确认浮窗尺寸为 `408px × 388px`、圆角 `12px`。
- 增加带“创意广场”“我的模板”和“创建模板”的浮窗。
- 明确浮窗默认选中“创意广场”，第一阶段 content 留白。
- toolbar 点击不再直接打开右侧工作区。
- 右侧 canvas tab 标题改为“创建模板”。
- 拆分 `StudioStyleTemplateMenu` 和 `StudioTemplateCreator` 组件边界。
- 补充浮窗、空白 Studio、overlay、关闭回退和渲染优先级分析。

### 2026-08-25

- 创建初版文档。
- 完成 Composer、页面布局和 canvas 架构分析。
- 确认仅图片生成显示入口。
- 确认 overflow、单例临时 tab、session 清理和独立组件边界。
