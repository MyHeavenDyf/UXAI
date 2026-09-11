# Studio 风格模板编辑与删除实现方案

## 1. 文档状态

- 当前阶段：已完成代码实现，并补充支持多个模板同时打开编辑 tab。
- 文档用途：记录 Studio“我的模板”列表中的编辑、删除入口，以及右侧多模板编辑工作区的实现方案、状态设计、组件改造、文件范围和验收标准。
- 最后更新：2026-09-09。
- 关联前置：
  - `packages/app/octoapp/pages/studio/docs/studio-image-template-implementation-plan.md`：风格模板入口、浮窗和创建模板 tab。
  - `packages/app/octoapp/pages/studio/docs/studio-style-template-list-implementation-plan.md`：创意广场、我的模板和分页列表。
  - `packages/app/octoapp/pages/studio/docs/studio-template-creator-content-implementation-plan.md`：创建模板第 1 步“制作模板”。
  - `packages/app/octoapp/pages/studio/docs/studio-template-publish-implementation-plan.md`：创建模板第 2 步“发布模板”。
  - `packages/app/octoapp/pages/studio/docs/studio-template-examples-implementation-plan.md`：创建模板第 3 步“添加示例”。
- 视觉参考：
  - 我的模板 hover 操作：`https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:504550`
  - 制作模板编辑工作区：`https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:503639`
  - 删除确认弹窗：`https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:504208`
  - 本需求不要求完全复刻 Pixso；交互、内容组织和文案以本文为准。

## 2. 需求范围

### 2.1 本次包含

1. 仅在风格模板浮窗的“我的模板”tab 中，为模板卡片增加 hover 操作。
2. 鼠标 hover 模板封面时显示编辑和删除图标。
3. 点击编辑后关闭风格模板浮窗，在右侧工作区打开标题为“编辑模板-{模板标题}”的 tab。
4. 编辑内容和现有创建模板内容一致，但不再拆为三个步骤，所有内容在同一滚动页面中展示。
5. 原三步骤进度条不在编辑模式中显示，改为普通内容标题和分区标题。
6. 编辑页底部固定显示“取消”和“保存”按钮。
7. 保存按钮复用创建模板全部校验逻辑。
8. 支持使用模板详情初始化编辑表单。
9. 编辑保存通过 Studio 本地代理调用供应商模板更新接口。
10. 点击删除图标后显示带背景遮罩的确认弹窗。
11. 用户确认后通过 Studio 本地代理调用供应商模板删除接口。
12. 支持同时打开多个不同模板的编辑 tab，各 tab 独立保留表单状态。

### 2.2 本次不包含

1. “创意广场”中的编辑、删除入口。
2. 非 hover 场景下的操作入口，包括键盘 focus、触屏、右键菜单、更多菜单和常驻按钮。
3. 未保存修改的离开确认。

## 3. 核心结论

现有 `StudioTemplateCreator` 已经包含完整的字段状态、两种模板类型、图片上传、风格描述生成、指定用户搜索和三段校验逻辑。编辑功能不应复制一套表单，而应把该组件扩展为“创建模式”和“编辑模式”。

页面级状态使用工作区数组和当前激活 key：

```ts
type StudioTemplateWorkspace =
  | {
      key: string
      mode: "create"
    }
  | {
      key: string
      mode: "edit"
      templateID: number
      templateTitle: string
      initialValue?: StudioStyleTemplateListItem
      loading: boolean
    }

const [templateWorkspaces, setTemplateWorkspaces] = createSignal<StudioTemplateWorkspace[]>([])
const [activeTemplateWorkspaceKey, setActiveTemplateWorkspaceKey] = createSignal<string>()
```

工作区 key 规则：

- 创建 tab：`template:create`，最多一个。
- 编辑 tab：`template:edit:${templateID}`，每个模板最多一个。
- `activeTemplateWorkspaceKey` 指向当前展示的工作区。

数组负责保持 tab 顺序并让不同编辑器实例同时挂载；active key 只控制显示，不销毁未激活模板的表单状态。

## 4. 我的模板 Hover 操作

### 4.1 展示条件

编辑和删除图标同时满足以下条件时才渲染或显示：

```text
当前菜单 tab === 我的模板
并且
当前模板卡片处于 hover 状态
```

“创意广场”卡片保持现状，不增加编辑和删除 DOM，也不预留不可见按钮。

如果卡片对应模板已经存在于任一右侧编辑 tab，hover 操作层仍然显示，但编辑和删除图标均置灰且不可点击。鼠标 hover 任一置灰图标时显示 tooltip：`当前模板正在编辑中，请先保存或取消编辑`。

本阶段只处理鼠标 hover，不扩展 `:focus-within`、触屏点击或其他可用性入口。

### 4.2 DOM 调整

当前模板卡片整体是一个 `<button>`。编辑和删除也是按钮，不能直接嵌套在卡片按钮中。需要把卡片结构调整为容器加同级按钮：

```text
模板卡片容器
├── 模板选择按钮
│   ├── 封面
│   ├── 类型标签
│   └── 标题
└── Hover 操作层（仅我的模板）
    ├── 编辑按钮
    └── 删除按钮
```

实现要求：

- 点击封面或标题仍执行现有“选择模板”行为。
- 点击编辑或删除不触发模板选择。
- hover 操作层定位在封面区域内，不改变卡片尺寸和三列网格。
- 图标按钮提供 `aria-label` 和 `title`，文案分别为“编辑模板”和“删除模板”。
- 删除进行中或编辑详情加载中时，避免重复触发同一操作。

### 4.3 图标资源

编辑、删除和删除确认弹窗中的信息图标都使用图片资源，不在 TSX 中临时手写 SVG path。资源统一从以下目录引用：

```text
packages/app/public/studio
```

当前资源检查结果：

- `packages/app/public/studio/studio_delete.svg`：已有垃圾桶图标，可在尺寸、描边和颜色符合 Pixso 时复用于 hover 删除按钮。
- `packages/app/public/studio/studio_risk_info.svg`：已有蓝色信息图标，可复用于删除确认弹窗。
- `packages/app/public/studio/studio_template_brush.svg`：是画笔图标，不等同于 Pixso 中的铅笔编辑图标，不作为默认编辑资源。
- 当前没有名称和视觉都明确匹配设计稿的编辑图标，实施时应从 Pixso 节点导出并新增资源。

建议新增资源名：

```text
packages/app/public/studio/studio_template_edit.svg
```

资源处理规则：

1. 实现前先检查 `packages/app/public/studio` 是否存在视觉一致的资源，避免重复添加。
2. 已有资源与 Pixso 视觉一致时直接复用。
3. 缺少资源或已有资源与设计稿差异明显时，从对应 Pixso 节点导出 SVG 或 PNG，并保存到 `packages/app/public/studio`。
4. 优先使用 SVG；只有原始资源是位图或 SVG 无法保持效果时才使用 PNG。
5. 文件名使用 `studio_template_` 前缀和小写 snake_case，不保留 Pixso 临时文件名或节点编号。
6. TSX 中通过 `/studio/<filename>` 引用，例如 `/studio/studio_template_edit.svg`。
7. 不引用 Pixso 临时 URL、localhost 资源地址或外部 CDN。
8. 导出后检查 viewBox、实际宽高、透明背景、描边颜色和 hover 容器内的对齐效果。
9. 如果现有 `studio_delete.svg` 与设计稿不一致，则另存为 `studio_template_delete.svg`，不要为适配单一场景直接改坏被其他页面复用的资源。

### 4.4 编辑点击行为

```text
点击编辑图标
  -> 关闭风格模板浮窗
  -> 按模板 ID 查找或创建 edit 工作区
  -> 打开并激活右侧“编辑模板-{模板标题}”tab
  -> 展示编辑加载态
  -> 获取模板详情
  -> 使用详情初始化表单
```

详情获取复用现有 `getStudioStyleTemplate(templateID)`。列表项当前虽然声明为完整模板数据，编辑仍以详情结果为准，避免列表字段精简或数据过期。

详情获取失败时：

- 保留右侧工作区并显示明确错误，或关闭工作区并用浮层提示；实现时统一采用一种方式。
- 不使用列表项静默兜底提交，避免编辑过期数据。
- 允许用户取消并关闭 tab。

### 4.5 删除点击行为

```text
点击删除图标
  -> 页面层记录待删除模板
  -> 在 Studio 页面根部显示背景遮罩和确认弹窗
  -> 用户点击取消：关闭弹窗，不发请求
  -> 用户点击确认：调用模板删除接口
  -> 删除成功：关闭弹窗并刷新“我的模板”
```

弹窗按 Pixso 节点 `1081:504208` 实现：

- 弹窗宽 `400px`、高约 `162px`，白色背景，圆角 `8px`，带投影。
- 左侧显示蓝色信息图标。
- 标题为 `确定删除 “${template.title}” 模板吗？`。
- 说明为“删除操作无法撤回，请慎重选择”。
- 底部右侧显示“取消”和“确认”两个按钮，按钮宽 `88px`、高 `32px`。
- “取消”为次按钮，“确认”为蓝色主按钮。
- 弹窗不显示右上角关闭按钮。

背景遮罩的展示方式与 `StudioVideoRiskDialog` 一致：

- `position: fixed` 并覆盖整个窗口。
- 使用与视频风险提示一致的半透明黑色背景。
- 层级高于 Studio 页面、风格模板浮窗和右侧工作区。
- 弹窗出现后背景内容不可操作。
- 弹窗由 `studio-page.tsx` 在页面根部渲染，不放在模板卡片内部，避免受到菜单层级、overflow 或菜单卸载影响。

状态与异常处理：

- 用户取消确认时不改变列表。
- 用户确认后进入删除中状态，“确认”按钮显示“删除中...”并禁用两个按钮，防止重复请求。
- 删除失败时保持弹窗和卡片，恢复按钮，并显示错误提示。
- 删除成功后关闭弹窗，通过列表刷新版本重新请求“我的模板”第一页，而不是由页面层直接修改菜单内部数组。
- 正处于右侧编辑状态的模板不能发起删除；菜单层禁用入口，页面层按模板 ID 再次拦截。
- 如果被删除模板正被 Composer 选中，删除成功后清除当前模板选择和相关草稿状态。
- 删除请求使用 `DELETE /image_template/${templateID}?user_id=${user_id}`，具体调用链见第 10.4 节。

## 5. 页面级模板工作区状态

### 5.1 多工作区状态

`studio-page.tsx` 当前使用：

```ts
const [templateCreatorTabOpen, setTemplateCreatorTabOpen] = createSignal(false)
```

改为能够同时表达多个模式和编辑对象的状态：

```ts
const [templateWorkspaces, setTemplateWorkspaces] = createSignal<StudioTemplateWorkspace[]>([])
const [activeTemplateWorkspaceKey, setActiveTemplateWorkspaceKey] = createSignal<string>()
```

派生状态：

```ts
const templateCreatorTabOpen = () => templateWorkspaces().length > 0
const editingStyleTemplateIDs = () => templateWorkspaces()
  .flatMap((workspace) => workspace.mode === "edit" ? [workspace.templateID] : [])
```

现有关于“模板 tab 是否打开”的 canvas 门控继续使用派生的 `templateCreatorTabOpen()`；左侧列表使用 `editingStyleTemplateIDs()` 禁用所有已打开模板的编辑、删除入口。

### 5.2 打开创建模式

现有 `openTemplateCreator()` 保留创建工作区语义：

```ts
setTemplateWorkspaces((current) => [
  ...current,
  { key: "template:create", mode: "create" },
])
```

重复点击“创建模板”时：

- 如果已经处于创建模式，只激活现有 tab。
- 如果存在编辑 tab，不关闭或替换它们，只激活创建 tab。

### 5.3 打开编辑模式

页面级 `openTemplateEditor(template)`：

1. 关闭 `openMenu`。
2. 按 `template:edit:${templateID}` 查找已有工作区；已存在时直接激活，不重复创建。
3. 不存在时追加 edit loading 工作区。
4. 打开 Studio workspace，保持现有小屏 overlay 逻辑。
5. 调用现有模板详情查询。
6. 请求成功后只更新对应 key 的 `initialValue` 并结束 loading。
7. 请求失败时只写入对应工作区的错误状态。

### 5.4 关闭行为

关闭方法接收工作区 key：

- 创建 tab 的关闭图标调用它。
- 编辑 tab 的关闭图标调用它。
- 编辑页“取消”按钮调用它。
- 关闭非激活 tab 时，当前视图保持不变。
- 关闭激活 tab 时，优先激活相邻模板 tab。
- 只在最后一个模板工作区关闭后，才恢复 canvas、文件管理或空白 Studio，现有优先级逻辑不变。
- 关闭时仅卸载对应表单，并使该模板仍在进行的详情请求失效。

## 6. Tab 与右侧内容

### 6.1 Tab 文案

`StudioResultCanvas` 当前把 tab 文案和关闭提示写死为“创建模板”，需要改为 props 驱动：

| 模式 | tab 文案 | 关闭按钮提示 |
|---|---|---|
| 创建 | 创建模板 | 关闭创建模板 |
| 编辑 | 编辑模板-{模板标题} | 关闭编辑模板-{模板标题} |

不同模板拥有独立 tab；同一模板重复打开时只激活已有 tab。

### 6.2 加载状态

编辑详情返回前，右侧 tab 已打开，内容区显示模板编辑加载状态。不要先等待详情再打开 tab，以免点击后没有即时反馈。

加载状态期间：

- 不渲染空白表单。
- 不允许保存。
- 允许点击 tab 关闭按钮或取消加载。
- 详情请求晚于关闭动作返回时，不应重新打开工作区。

### 6.3 表单实例隔离

不同模板和创建模式分别持有独立的 `StudioTemplateCreator`：

```text
create
edit:template-a
edit:template-b
```

所有工作区通过 keyed 列表同时渲染，非激活实例使用 CSS 隐藏但不卸载，以保留各自未保存内容；关闭对应 tab 时才销毁实例。这样可避免以下状态在模板间泄漏：

- 图片上传错误提示。
- 风格描述流式生成阶段和输出。
- 保存状态和错误提示。
- 用户搜索关键字、下拉结果和 debounce timer。
- 已选描述维度。

## 7. StudioTemplateCreator 组件改造

### 7.1 新增 Props

建议在现有 props 基础上增加：

```ts
type StudioTemplateCreatorProps = {
  mode?: "create" | "edit"
  initialValue?: StudioStyleTemplateListItem
  onCancel?: () => void
  onSaveTemplate?: (
    templateID: number,
    input: StudioTemplatePublishInput,
  ) => Promise<void>
  templateID?: number
  // 保留现有生成风格描述、发布、用户搜索 props
}
```

编辑保存通过 `onSaveTemplate` 进入页面级保存逻辑，再沿用创建模板的分层方式调用 Studio 本地代理和供应商接口。具体调用链见第 10 节。

### 7.2 创建模式保持不变

创建模式继续保留：

- 顶部三步骤进度条。
- 一次只展示当前步骤。
- “上一步 / 下一步 / 发布”footer。
- 现有发布逻辑和成功提示。

本次不因编辑功能重做创建模板交互。

### 7.3 编辑模式合并内容

编辑模式不渲染 `TemplateCreatorSteps`，改为单页结构：

```text
制作模板
  MakeTemplateForm

发布模板
  PublishTemplateForm

添加示例图
  TemplateCreatorExamplesForm
```

具体要求：

- 页面头部显示普通标题“制作模板”，不显示步骤编号、圆点和连接线。
- `MakeTemplateForm` 内容和创建模板第 1 步一致。
- `PublishTemplateForm` 内容和创建模板第 2 步一致。
- `TemplateCreatorExamplesForm` 内容和创建模板第 3 步一致。
- 三块内容之间增加分隔线和分区标题，样式参考 Pixso，但沿用现有 Studio 字体、间距和表单控件。
- 所有字段填写、类别切换、图片上传、图片删除、风格描述生成、权限选择和用户搜索逻辑与创建模式一致。
- `MakeTemplateForm` 和 `PublishTemplateForm` 中的两个标题输入继续绑定同一个 `title` 状态，任一处修改都同步到另一处。

### 7.4 编辑初始值映射

公共字段：

| 表单状态 | 模板详情字段 |
|---|---|
| `title` | `title` |
| `category` | `template_type` |
| `usageDescription` | `usage_instructions` |
| `promptSetting` | `prompt_setting` |
| `referenceMode` | `reference_image_setting` |
| `referenceCount` | `reference_image_count` |
| `visibility` | `permission_type` |
| `exampleImages` | `example_images` |

提取视觉风格：

| 表单状态 | 模板详情字段 |
|---|---|
| `styleKeywords` | `style_keywords` |
| `styleImages` | `style_images` |
| `styleDescriptionOverview` | `style_description.overview` |
| `styleDescriptionDetails` | `style_description` 中除 `overview` 外的维度字段 |
| `selectedDimensions` | `style_description` 中实际存在的维度 key |

预设灵感配方：

| 表单状态 | 模板详情字段 |
|---|---|
| `recipeDescription` | `play_description` |
| `recipeImages` | `fixed_reference_images` |

初始化规则：

- 不属于当前模板类型的字段初始化为空，避免切换类型后出现旧数据。
- `reference_image_count === 0` 时参考模式应保持 `not_supported`。
- 远端已有图片 URL 直接作为 uploader 已有项展示。
- `style_description` 维度按字段是否存在恢复，不能固定使用创建模式的默认四项。

### 7.5 指定用户回填

当前模板详情通过 `allowed_user_ids` 保存 account 字符串，而选择器状态是完整用户对象数组。编辑初始化时需要一个适配层。

本期可按 account 拆分并构造最小对象：

```ts
allowed_user_ids
  ?.split(",")
  .map((account) => account.trim())
  .filter(Boolean)
  .map((account) => ({
    user_id: account,
    account,
  }))
```

这样可以保证：

- 指定用户校验通过。
- 原 account 能在未修改时原样保存。
- 用户可以删除已有项或继续通过现有搜索添加用户。

由于详情中没有中文姓名和部门，初次回填只展示 account。本方案不扩展批量用户详情查询。

### 7.6 已有图片大小

现有上传器使用 `sizeByUrl` 统计新上传图片大小；模板详情中的远端 URL 没有文件大小。编辑初始化时不要为了回填远端图片主动下载文件。

处理建议：

- 已有远端图片视为后端已接受资源，不纳入本地新增文件大小统计。
- 新上传文件继续沿用现有单文件和总大小校验。
- 图片数量校验对已有图片和新增图片一起计算。
- 最终接口仍提交当前表单中的完整图片数组。

## 8. 取消、保存与校验

### 8.1 Footer

编辑模式 footer 固定展示：

```text
[取消] [保存]
```

- 取消使用次按钮样式。
- 保存使用主按钮样式。
- footer 继续固定在右侧工作区底部。
- 错误信息继续复用现有 footer message 区域。

### 8.2 保存可用条件

复用现有三段校验：

```ts
const canSave = createMemo(() =>
  canMakeNext() &&
  canPublishNext() &&
  canPublish() &&
  Boolean(props.onSaveTemplate) &&
  !templateSaving()
)
```

对应规则不变：

- 标题长度为 2～10 字。
- 预设灵感配方必须有玩法描述，固定参考图最多 3 张。
- 提取视觉风格必须有 3～30 张风格图、风格概览，总描述不超过 700 字。
- 使用说明必填。
- 提示词、参考图和权限设置有效。
- 指定用户模式下至少有 1 个用户。
- 示例图数量为 1～20 张。
- 新上传图片继续遵守现有单图和总大小限制。

### 8.3 保存行为

```text
点击保存
  -> 再次检查 canSave
  -> 组装与创建模板相同的完整表单数据
  -> 在请求体中增加 idx，值为当前 templateID
  -> 调用 Studio 模板更新接口
  -> 成功提示
  -> 只关闭当前模板对应的编辑 tab
```

状态要求：

- 保存中按钮显示“保存中...”。
- 保存中禁用重复保存。
- 保存失败保留所有输入并显示错误。
- 保存成功后，下次进入“我的模板”时重新获取列表即可；本方案不引入全局模板缓存。
- 保存接口通过 `onSaveTemplate(templateID, input)` 调用，供应商接口 method、URL 和参数见第 10 节。

### 8.4 取消行为

- 点击“取消”直接关闭当前模板对应的编辑 tab。
- 不保存当前修改。
- 不弹未保存确认。
- 关闭后恢复原 canvas、文件管理或 Studio 空白状态，沿用现有关闭创建模板 tab 的逻辑。

## 9. Props 传递调整

### 9.1 StudioStyleTemplateMenu

新增：

```ts
onEditTemplate?: (item: StudioStyleTemplateListItem) => void
onRequestDeleteTemplate?: (item: StudioStyleTemplateListItem) => void
listRevision?: number
```

职责：

- 仅在 `section() === "mine"` 时渲染 hover 操作层。
- 编辑时把模板 ID 交给页面层。
- 点击删除时把完整模板项交给页面层，由页面层打开确认弹窗。
- `listRevision` 变化且当前为“我的模板”时，重新加载第一页，使删除结果及时反映到列表。
- 不负责打开右侧 workspace，也不持有编辑表单数据。

### 9.2 StudioComposer

新增并向菜单透传：

```ts
onEditStyleTemplate?: (item: StudioStyleTemplateListItem) => void
onRequestDeleteStyleTemplate?: (item: StudioStyleTemplateListItem) => void
styleTemplateListRevision?: number
```

### 9.3 StudioResultCanvas

把只支持创建的 props 扩展为多工作区语义：

```ts
templateWorkspaces: readonly StudioTemplateWorkspace[]
activeTemplateWorkspaceKey?: string
onTemplateWorkspaceClick: (key: string) => void
onTemplateWorkspaceClose: (key: string) => void
onSaveTemplate?: (...) => Promise<void>
```

每个 tab 和内容面板都通过 workspace key 激活或关闭，编辑 tab 文案由 `templateTitle` 生成。

### 9.4 StudioTemplateCreator

创建与编辑继续复用一个组件：

- create 模式调用现有 `onPublishTemplate`。
- edit 模式调用新增 `onSaveTemplate` 回调。
- `onCancel` 只在 edit footer 使用。
- `initialValue` 只在 edit 模式初始化。

## 10. 编辑保存与删除接口

### 10.1 编辑保存供应商接口

编辑保存和创建保存使用同一套模板字段，差异为：

- 请求 method 为 `PUT`。
- 路径中包含当前模板 ID。
- query 中增加当前用户 `user_id`。
- request body 比创建接口多一个 `idx`，其值同样为当前模板 ID。

供应商请求：

```http
PUT /image_template/${templateID}?user_id=${user_id}
Content-Type: application/json
```

其中：

- `templateID` 来源于当前模板的 `idx`。
- URL 中的 `${templateID}` 和 body 中的 `idx` 必须一致。
- `user_id` 由页面层使用 `uiplusUserAccount()` 获取，来源与模板列表、详情查询一致。
- URL 中的模板 ID 和 `user_id` 必须经过 URL 编码。

更新请求类型可以在创建请求类型上增加 `idx`：

```ts
type StudioTemplateUpdateInput = StudioTemplatePublishInput & {
  idx: number
}
```

请求体示意：

```ts
const updateInput: StudioTemplateUpdateInput = {
  ...templatePublishInput,
  idx: templateID,
}
```

除 `idx` 外，其余字段与创建保存完全相同：

- 通用字段继续包含 `allowed_user_ids`、`creator_user_id`、`example_images`、`permission_type`、`prompt_setting`、`reference_image_count`、`reference_image_setting`、`template_type`、`title` 和 `usage_instructions`。
- `extract_style` 继续包含 `style_description`、`style_images` 和 `style_keywords`。
- `preset_recipe` 继续包含 `fixed_reference_images` 和 `play_description`。
- 字段 trim、权限用户拼接、参考图数量归一化等逻辑继续复用创建保存的 `templatePublishInput()`，只在最终请求前追加 `idx`。

### 10.2 调用链

编辑保存沿用创建模板“前端不直连供应商”的结构：

```text
StudioTemplateCreator 点击保存
  -> studio-page.tsx 组装 idx、creator_user_id 和 user_id
    -> PUT Studio 本地模板更新路由
      -> packages/opencode/src/server/routes/instance/studio.ts
      -> packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts
      -> packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts
        -> packages/opencode/src/studio/studio-service.ts
          -> packages/opencode/src/tool/internel_style_template.ts
            -> PUT /image_template/${idx}?user_id=${user_id}
```

建议本地路由使用清晰的更新语义，例如：

```http
PUT /studio/template-update/${templateID}?user_id=${user_id}
```

本地路由需要校验：

- path 中的 `templateID` 可转换为有效数字。
- query 中存在 `user_id`。
- body 满足创建模板原有联合类型校验。
- body 中增加 number 类型的 `idx`。
- path `templateID` 必须与 body `idx` 一致；不一致时返回参数错误，不向供应商发起请求。

工具层在现有三环境模板 endpoint 基础上拼接 `/${encodeURIComponent(input.idx)}`，并写入 `user_id` query；请求 method 使用 `PUT`。供应商响应解析、超时、错误信息和鉴权 header 沿用创建模板接口。

### 10.3 前端保存方法

页面级方法负责注入当前模板 ID 和用户信息：

```ts
async function saveStudioStyleTemplate(
  templateID: number,
  input: StudioTemplatePublishInput,
): Promise<void> {
  // PUT Studio 本地模板更新路由
  // query: user_id = uiplusUserAccount()
  // body: { ...input, idx: templateID, creator_user_id: ... }
}
```

保存成功后：

- 显示“模板保存成功”。
- 只关闭本次保存模板对应的“编辑模板-{模板标题}”tab。
- 其他模板编辑 tab 及其未保存内容保持不变。
- 后续重新打开“我的模板”时按现有列表逻辑重新查询。

保存失败后：

- 保留当前表单数据。
- 解除保存中状态。
- 在 footer message 或统一提示中展示格式化错误。
- 不关闭 tab。

### 10.4 删除供应商接口

用户在确认弹窗中点击“确认”后调用供应商删除接口：

```http
DELETE /image_template/${templateID}?user_id=${user_id}
```

其中：

- `templateID` 来源于待删除模板的 `idx`。
- `user_id` 由页面层使用 `uiplusUserAccount()` 获取。
- 模板 ID 和 `user_id` 必须经过 URL 编码。
- 删除请求没有 request body。
- 鉴权 header、超时、业务响应解析和错误格式沿用模板创建、更新接口。

删除同样通过 Studio 本地代理，不由前端直连供应商：

```text
StudioStyleTemplateDeleteDialog 点击确认
  -> studio-page.tsx 读取待删除模板 idx 和 user_id
    -> DELETE Studio 本地模板删除路由
      -> packages/opencode/src/server/routes/instance/studio.ts
      -> packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts
      -> packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts
        -> packages/opencode/src/studio/studio-service.ts
          -> packages/opencode/src/tool/internel_style_template.ts
            -> DELETE /image_template/${templateID}?user_id=${user_id}
```

建议本地路由：

```http
DELETE /studio/template-delete/${templateID}?user_id=${user_id}
```

本地路由只需要校验 path 和 query，不需要 body schema：

- path 中的 `templateID` 可转换为有效数字。
- query 中存在非空 `user_id`。
- 校验通过后把二者传给 Studio service。

页面级删除方法：

```ts
async function deleteStudioStyleTemplate(
  templateID: number,
): Promise<void> {
  // DELETE Studio 本地模板删除路由
  // query: user_id = uiplusUserAccount()
}
```

### 10.5 删除确认状态流

页面层建议增加：

```ts
const [pendingDeleteTemplate, setPendingDeleteTemplate] =
  createSignal<StudioStyleTemplateListItem>()
const [templateDeleting, setTemplateDeleting] = createSignal(false)
const [styleTemplateListRevision, setStyleTemplateListRevision] = createSignal(0)
```

状态流：

1. 点击卡片删除图标时写入 `pendingDeleteTemplate`，弹窗随即显示。
2. 点击取消时清空 `pendingDeleteTemplate`。
3. 点击确认时使用 `pendingDeleteTemplate().idx` 调用删除方法。
4. 请求过程中保持待删除模板不变并设置 `templateDeleting(true)`。
5. 成功后清空待删除模板、递增 `styleTemplateListRevision`，并处理已选择的同一模板。
6. 失败后保留待删除模板和弹窗，显示错误并恢复按钮。
7. 无论成功或失败，都在请求结束时解除删除中状态。

## 11. 涉及文件

### 11.1 必须修改

#### `packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`

- 为 props 增加编辑和删除回调。
- 增加当前编辑模板 ID 列表，匹配任一已打开模板的编辑、删除按钮置灰并展示 tooltip。
- 调整卡片 DOM，避免 button 嵌套。
- 仅在“我的模板”渲染 hover 操作层。
- 点击删除时把待删除模板交给页面层，不在菜单组件内渲染弹窗。
- 监听列表刷新版本，删除成功后重新加载“我的模板”第一页。

#### `packages/app/octoapp/pages/studio/studio-composer.tsx`

- 增加编辑、删除模板 props。
- 增加模板列表刷新版本 prop。
- 将回调透传给 `StudioStyleTemplateMenu`。

#### `packages/app/octoapp/pages/studio-page.tsx`

- 用工作区数组和 active key 管理创建 tab 与多个编辑 tab。
- 新增打开编辑、加载详情、取消、编辑保存和删除处理。
- 继续复用现有模板详情查询。
- 保存时组装 `idx`、`creator_user_id` 和 `user_id`，调用 Studio 本地模板更新路由。
- 持有待删除模板、删除中状态和模板列表刷新版本。
- 在页面根部渲染删除确认弹窗。
- 用户确认后调用 Studio 本地模板删除路由。
- 保存或删除成功后的页面状态清理。
- 向页面内两处 `StudioComposer` 传递相同回调。
- 向 `StudioResultCanvas` 传递全部工作区、当前 active key 和编辑初始值。

#### `packages/app/octoapp/pages/studio/studio-conversation.tsx`

- 根据 create/edit 模式显示“创建模板”或“编辑模板-{模板标题}”。
- 动态设置关闭按钮提示。
- 编辑详情加载时显示 loading。
- 向 `StudioTemplateCreator` 传递 mode、initialValue、templateID、onCancel 和 onSaveTemplate。
- 同时挂载多个模板工作区，仅显示 active key 对应实例，按模板 ID 隔离并保留表单状态。

#### `packages/app/octoapp/pages/studio/studio-template-creator.tsx`

- 新增 create/edit 模式。
- 增加模板详情到表单状态的初始化映射。
- create 模式保留三步流程。
- edit 模式合并渲染三块表单。
- 编辑模式顶部显示“制作模板”普通标题。
- 编辑 footer 显示“取消 / 保存”。
- 保存可用状态组合现有三段校验。
- 增加保存中和保存失败状态。

#### `packages/app/octoapp/pages/studio/studio-style-template-delete-dialog.tsx`

- 新增模板删除确认弹窗组件。
- 接收待删除模板标题、删除中状态、取消和确认回调。
- 使用 `role="dialog"`、`aria-modal="true"` 和标题关联。
- 渲染信息图标、动态模板标题、不可撤回说明、取消和确认按钮。
- 删除中禁用按钮并把确认文案切换为“删除中...”。
- 参考 `StudioVideoRiskDialog` 处理遮罩、初始焦点和弹窗内焦点约束。

#### `packages/opencode/src/tool/internel_style_template.ts`

- 新增模板更新 body 类型，在创建参数基础上只增加 `idx`。
- 更新方法另外接收 `user_id`，只把它写入 URL query，不写入 request body。
- 新增供应商模板更新方法。
- 使用 `PUT /image_template/${idx}?user_id=${user_id}`。
- 新增供应商模板删除方法。
- 使用 `DELETE /image_template/${templateID}?user_id=${user_id}`，不发送 request body。
- 复用现有模板 endpoint、header、超时和业务响应解析。

#### `packages/opencode/src/studio/studio-service.ts`

- 导出模板更新请求类型。
- 增加调用工具层模板更新方法的 service 函数。
- 增加调用工具层模板删除方法的 service 函数。

#### `packages/opencode/src/server/routes/instance/studio.ts`

- 增加 Hono 模板更新路由。
- 增加 path、query 和更新 body 的 zod 校验。
- 校验 path 模板 ID 与 body `idx` 一致。
- 增加 Hono 模板删除路由，只校验 path 模板 ID 和 query `user_id`。

#### `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`

- 增加 Effect HTTP API 的模板更新路径、payload、query 和 endpoint 描述。
- 增加 Effect HTTP API 的模板删除路径、query 和 endpoint 描述；删除请求没有 payload。

#### `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`

- 增加 Effect HTTP API 模板更新 handler。
- 增加 Effect HTTP API 模板删除 handler。
- 将校验后的数据交给 Studio service。

#### `packages/sdk/js/src/v2/gen/*`

- 新增更新、删除路由后按仓库要求运行 `./packages/sdk/js/script/build.ts`，更新生成的 JavaScript SDK。

#### `packages/app/octoapp/pages/studio/studio-08.css`

- 增加我的模板卡片 hover 遮罩和编辑、删除图标样式。
- 增加编辑模式页面标题、分区标题和分隔线样式。
- 增加编辑 footer 取消、保存按钮状态。
- 增加 400px 删除确认弹窗、标题、说明和按钮样式。
- 保持现有卡片尺寸、三列网格和右侧工作区响应式规则。

#### `packages/app/octoapp/pages/studio/studio-07.css`

- 让模板删除遮罩复用 `StudioVideoRiskDialog` 的 fixed 全屏定位、居中布局、z-index 和半透明黑色背景。
- 保持现有视频风险弹窗样式不变。

#### `packages/app/public/studio/*`

- 优先复用已有 `studio_delete.svg` 和 `studio_risk_info.svg`。
- 新增从 Pixso 导出的编辑图标 `studio_template_edit.svg`。
- 如果已有删除图标与 Pixso 不一致，新增 `studio_template_delete.svg`，不覆盖被其他功能复用的原资源。
- 所有新增图标必须落在该目录，不把 base64、Pixso 临时地址或外部 URL 写入组件代码。

### 11.2 保持不变

- 已有模板详情接口保持不变，继续用于编辑初始化。
- 已有模板创建接口保持不变，创建模式继续使用 POST 发布流程。
- 删除请求不复用更新 payload，不新增 DELETE body schema。

## 12. 建议实施顺序

1. 定义页面级 `StudioTemplateWorkspace` 状态，保持现有 canvas 显隐行为。
2. 改造 `StudioResultCanvas`，支持动态 tab 文案和编辑加载态。
3. 为 `StudioTemplateCreator` 增加 mode 和 initialValue。
4. 完成编辑模式单页布局与“取消 / 保存”footer。
5. 用现有三个校验 memo 组合 `canSave`。
6. 改造模板卡片 DOM，并增加仅“我的模板”可见的 hover 操作层。
7. 串联编辑点击、详情加载和表单初始化。
8. 接入前端、本地路由、service 和工具层的模板 PUT 更新调用。
9. 新增删除确认弹窗、背景遮罩和页面级待删除状态。
10. 接入前端、本地路由、service 和工具层的模板 DELETE 调用。
11. 串联删除成功后的列表刷新和相关状态清理。
12. 重新生成 JavaScript SDK。
13. 检查现有图标资源，导出并保存缺失的 Pixso 图标到 `packages/app/public/studio`。
14. 补充样式并进行视觉核对。
15. 完成类型检查和交互回归。

## 13. 验收标准

### 13.1 列表

- [ ] 创意广场的模板卡片不渲染编辑、删除操作。
- [ ] 我的模板卡片默认不显示编辑、删除图标。
- [ ] 鼠标 hover 我的模板封面时显示编辑、删除图标。
- [ ] 鼠标移出后操作图标隐藏。
- [ ] 点击编辑、删除不会触发选择模板。
- [ ] 当前正在编辑的模板 hover 时编辑、删除图标置灰且不可点击。
- [ ] hover 置灰图标时显示“当前模板正在编辑中，请先保存或取消编辑”。
- [ ] 点击卡片其他区域仍可正常选择模板。
- [ ] 编辑、删除图标从 `/studio/` 静态资源路径加载，不包含外部或临时 URL。
- [ ] 缺失的编辑图标已保存到 `packages/app/public/studio`。
- [ ] 删除图标优先复用已有资源；视觉不一致时使用单独新增的模板删除资源。

### 13.2 编辑工作区

- [ ] 点击编辑后关闭风格模板浮窗。
- [ ] 右侧打开并激活“编辑模板-{模板标题}”tab。
- [ ] tab 关闭提示包含模板标题。
- [ ] 可同时打开多个不同模板的编辑 tab。
- [ ] 同一模板不会重复创建 tab，重复打开时激活已有 tab。
- [ ] 切换编辑 tab 后，各自未保存表单内容仍然保留且互不串联。
- [ ] 关闭激活 tab 后自动激活相邻 tab；关闭非激活 tab 不改变当前视图。
- [ ] 详情加载期间显示 loading，不显示空表单。
- [ ] 两种模板类型均能正确回填对应字段和图片。
- [ ] 编辑页不显示三步骤进度条。
- [ ] 制作、发布、示例三块内容在同一滚动页面展示。
- [ ] 两处标题输入使用同一个值并保持同步。
- [ ] 表单填写、上传、风格描述生成和用户搜索逻辑与创建模板一致。

### 13.3 Footer 与状态

- [ ] 编辑页底部只显示“取消”和“保存”。
- [ ] 任一创建模板校验不满足时，保存按钮不可用。
- [ ] 全部校验满足时，保存按钮可用。
- [ ] 取消会关闭 tab 且不保留本次修改。
- [ ] 保存请求使用 PUT，并调用 `/image_template/${templateID}?user_id=${user_id}` 对应的本地代理链路。
- [ ] 保存请求体与创建参数一致，并额外包含 `idx: templateID`。
- [ ] path 中的模板 ID 与 body `idx` 不一致时不调用供应商接口。
- [ ] 保存成功后只关闭对应编辑 tab，其他 tab 不受影响；保存失败时保留对应表单。
- [ ] 创建 tab 与各编辑 tab 的表单状态相互隔离。

### 13.4 删除确认与请求

- [ ] 点击“我的模板”卡片删除图标后出现背景遮罩和居中确认弹窗。
- [ ] 遮罩覆盖 Studio 页面，背景内容不可操作，展示效果与视频风险提示一致。
- [ ] 弹窗标题包含待删除模板的真实标题。
- [ ] 弹窗显示“删除操作无法撤回，请慎重选择”。
- [ ] 弹窗显示“取消”和“确认”，不显示右上角关闭按钮。
- [ ] 点击取消关闭弹窗且不发起请求。
- [ ] 点击确认调用 DELETE，并请求 `/image_template/${templateID}?user_id=${user_id}` 对应的本地代理链路。
- [ ] 删除请求不发送 request body。
- [ ] 删除中确认按钮显示“删除中...”，不能重复提交。
- [ ] 删除成功后关闭弹窗并刷新“我的模板”第一页。
- [ ] 删除失败后保留弹窗和模板卡片，并显示错误提示。
- [ ] 删除当前选中模板后清理 Composer 模板状态。
- [ ] 当前正在编辑的模板不能打开删除确认弹窗，也不会发出 DELETE 请求。

### 13.5 回归

- [ ] 原“创建模板”三步流程不受影响。
- [ ] 原模板选择和模板生成使用流程不受影响。
- [ ] 模板列表分页和切换 tab 不受影响。
- [ ] 无 session、无图片和已有图片场景都能打开编辑工作区。
- [ ] 小屏 workspace overlay 行为与创建模板一致。

## 14. 验证建议

代码实现后至少执行：

1. 从 `packages/app/octoapp` 所属包目录运行项目规定的 typecheck，不能在仓库根目录运行测试。
2. 手工验证“创意广场”和“我的模板”的 hover 差异。
3. 分别使用 `extract_style` 和 `preset_recipe` 模板验证完整回填。
4. 逐项破坏三个阶段的校验条件，确认保存按钮状态。
5. 验证编辑详情失败、PUT 保存成功和 PUT 保存失败的错误提示。
6. 检查保存请求中的 URL templateID、query `user_id` 和 body `idx` 三者映射正确。
7. 验证删除弹窗的遮罩、动态标题、取消、确认和删除中状态。
8. 检查 DELETE 请求中的 URL templateID 和 query `user_id`，确认没有 request body。
9. 验证 DELETE 成功、失败、列表刷新和关联模板状态清理。
10. 检查所有新增图片资源均位于 `packages/app/public/studio`，且组件只使用 `/studio/...` 路径。
11. 对照 Pixso 检查编辑、删除和信息图标的尺寸、颜色、透明背景及居中对齐。
12. 验证关闭 tab、取消、切换模板、切换 create/edit 模式后的状态清理。
13. 在窄屏宽度下验证右侧 overlay、footer 固定和长表单滚动。
