# Studio 创建模板内容区实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 Studio“创建模板”工作区第一步内容区的 UI、状态、校验、组件边界和验收标准。
- 最后更新：2026-08-27。
- 关联前置：`packages/app/octoapp/pages/studio/docs/studio-image-template-implementation-plan.md` 已负责“风格模板”入口、浮窗和“创建模板”canvas tab。本方案不修改该文档，只补充 tab 激活后内容区的实现。

## 2. 背景与目标

当前 Studio 已规划通过 Composer 的“风格模板”浮窗进入右侧 `studio-canvas-tab`，tab 标题为“创建模板”。本阶段要把 `StudioTemplateCreator` 从空白占位升级为“制作模板”表单的第一部分。

目标是实现三步流程中的第 1 步“制作模板”页面骨架和表单交互：

```text
创建模板
├── 步骤条
│   ├── 1 制作模板（当前）
│   ├── 2 发布模板
│   └── 3 添加示例
├── 图片模板标题
├── 模型分类
│   ├── 视觉风格（extract_style）
│   └── 灵感配方（preset_recipe）
├── 根据模型分类切换的表单内容
└── 底部固定操作栏
    └── 下一步
```

本阶段仍不接后端创建、发布、示例和生成接口，只完成前端静态结构、输入状态、上传展示和基础校验。

## 3. 已确认的产品规则

### 3.1 通用表单

- 页面显示在右侧 `studio-canvas-body` 内，使用现有 `StudioTemplateCreator` 组件承载。
- 内容区白底，表单内容宽度固定为 `640px`，在编辑区中水平居中显示。
- 底部固定操作栏在右侧工作区底部，包含居中的“下一步”按钮。
- “下一步”默认禁用；本阶段可以只按本地必填项决定启用，不触发真实提交。
- 必填项标题右侧使用红色 `*`。
- 步骤条当前步骤为蓝色圆点 `1`，后续步骤灰色圆点。

### 3.2 图片模板标题

字段：

| 项 | 规则 |
|---|---|
| label | 图片模板标题 |
| 必填 | 是 |
| placeholder | 描述你的模板（2-10字） |
| 字数计数 | 初始显示 `0/10` |
| 最大字数 | 10 |

注意：设计图中计数显示为 `0/20`，但用户已明确修正，应与输入提示一致为 `0/10`。

### 3.3 模型分类

模型分类为必填单选卡片，两个选项：

| 分类 | 文案 | 描述 |
|---|---|---|
| `extract_style` | 视觉风格 | 从图中提取色彩、笔触、材质和光影氛围，套用到你的新提示词上。 |
| `preset_recipe` | 灵感配方 | 锁定原图的轮廓、姿势、透视和物体摆放位置，用全新的风格重绘。 |

默认建议选中 `extract_style`，与图一一致。

选中态：

- 卡片边框为 Studio 主蓝色。
- 右侧显示蓝色选中圆点。
- 左侧显示分类图标。可以优先复用现有图标库；若没有完全匹配图标，可先用本地 CSS/简单 SVG，占位不影响后续接设计资源。

### 3.4 视觉风格表单

当模型分类选择“视觉风格”时，显示以下字段。

#### 风格关键词

- label：风格关键词
- 非必填
- 输入框类型：多行文本区域
- placeholder：`输入你希望强调的风格特征，可以使用短词和句子，例：抽象风格壁纸、弥散渐变风格`

#### 风格图集

- label：风格图集
- 必填
- 说明文案：`上传风格一致的参考图，最多30张，最少3张，大小在10M以下，尽量高清`
- 支持格式：`png`、`jpg`、`jpeg`、`webp`
- 数量限制：最少 3 张，最多 30 张
- 单张图片大小：不超过 10MB
- 所有已上传图片总大小：不超过 30MB

空状态样式：

- 灰色上传区域。
- 中间蓝色按钮“本地上传”。
- 下方显示支持格式。

已上传样式：

```text
风格图集上传区域
├── 继续上传卡片
│   ├── + 图标
│   └── 继续上传
└── 图片缩略图网格
    ├── image 1
    ├── image 2
    └── ...
```

- 已上传后上传区域变为缩略图网格。
- 未达到数量上限时，第一个卡片固定为“继续上传”，虚线边框。
- 缩略图为固定尺寸卡片，圆角约 `8px`，使用 `object-fit: cover` 或 `contain` 以设计稿为准。
- 上传数量达到 30 张后，不显示“继续上传”卡片。
- 上传错误通过组件内提示呈现，不引入全局 toast，除非 Studio 现有上传交互已有统一 toast。

#### 风格描述

- label：风格描述
- 必填
- 说明文案：`可从多种风格维度中选择你希望保留的维度（仅分析选中的风格维度）`
- 维度标签：
  - 明暗
  - 构图
  - 体积感
  - 表面质感
  - 色彩
  - 线条
  - 造型特征
  - 角色形象
  - 字体
  - 后期效果
- 默认选中：明暗、构图、体积感、表面质感。
- “生成风格描述”按钮在上传风格图集前禁用。
- 按钮下说明文案：`生成风格描述需要先上传风格图集，生成描述耗时约20-30s，请耐心等待。`
- 本阶段不接生成接口，点击行为可先保留 disabled 或记录 TODO；若要做交互闭环，只生成空状态不造假数据。
- 下方描述区域由多个输入项组成：
  - “概览”为固定输入项，始终显示。
  - 其它输入项根据上方已选中的风格维度动态显示。
  - 取消选中某个维度后，对应输入项从界面隐藏；建议保留已输入内容，避免用户误触丢失。
- “概览”输入项 placeholder：
  `描述图片的整体风格定性、风格流派标签、核心视觉特征`
- 各维度输入项 placeholder 建议：

| 维度 | placeholder |
|---|---|
| 明暗 | 描述图片的明暗特征，包括整体亮度倾向、对比范围、层次丰富程度。 |
| 构图 | 描述图片的构图特征，包括透视类型、背景处理方式、负空间、景深、视觉层级，以及画面的整体节奏感。 |
| 体积感 | 描述图片的形体立体感，包括物体表面的过渡方式、过渡的边缘特征，以及形体边界的质量。 |
| 表面质感 | 描述图片中物体的表面属性，包括质感、纹理特征、细节密度、工艺痕迹 |
| 色彩 | 描述图片的色彩系统，包括主导色、背景色、饱和度分布、点缀色 |
| 线条 | 描述线条与笔触特征 |
| 造型特征 | 描述形状语言与造型构造 |
| 角色形象 | 描述角色或生物的造型设计，包括人物比例特征以及整体形态语言风格 |
| 字体 | 描述文字或者字体设计 |
| 后期效果 | 描述后期处理效果 |

输入限制和计数：

- 每个输入项，包括“概览”和所有动态维度输入项，最大输入长度为 300 字符。
- 单个输入项达到 300 字符后继续输入无反应，建议使用 `maxLength={300}` 实现。
- 每个输入项标题所在行右侧显示当前输入项计数，初始为 `0/300`，输入时实时更新。
- 整体风格描述总字符数为所有已填写输入项的字符数之和，包括隐藏但被保留的维度内容。
- 描述区域最底部右侧显示 `总字符数：0/700`，输入时实时更新。
- 总字符数超过 700 时不限制继续输入，也不阻止当前输入项继续在 300 字符内编辑；将总字符计数文本变红，并禁用“下一步”按钮。

“风格描述”对“下一步”按钮的校验要求“概览”输入项必填，且总字符数不超过 700；不要求必须选中任意风格维度。

### 3.5 灵感配方表单

当模型分类选择“灵感配方”时，显示以下字段。

#### 玩法描述

- label：玩法描述
- 必填
- 说明文案：
  - `如允许其他用户自行填写内容，使用“【内容填写提示】”来标记，否则发布后不支持其他用户输入。`
  - `例：淡金色的粒子环绕着【填写主体内容】悬浮在画面中心，背景是纯白色...`
- 输入框类型：多行文本区域
- 初始值为空，不预填示例。
- placeholder：`输入玩法提示词`

#### 固定参考图

- label：固定参考图
- 非必填
- 说明文案：`可选上传，上传后将作为默认参考图，最多支持3张参考图，每张参考图不超过10MB`
- 支持格式：`png`、`jpg`、`jpeg`、`webp`
- 数量限制：最多 3 张
- 单张图片大小：不超过 10MB
- 空状态样式同“风格图集”的空状态。
- 上传后展示样式与“风格图集”一致，但数量上限不同，未达到上限时首卡文案仍为“继续上传”。
- 上传数量达到 3 张后，不显示“继续上传”卡片。

## 4. 推荐组件边界

建议保留现有入口文件：

```text
packages/app/octoapp/pages/studio/studio-template-creator.tsx
```

并在同文件内先拆小函数，避免为单阶段表单过早增加文件数量。若组件继续膨胀，再拆到独立文件。

推荐结构：

```text
StudioTemplateCreator
├── TemplateCreatorSteps
├── TemplateCreatorTitleField
├── TemplateCreatorCategoryCards
├── VisualStyleForm
│   ├── StyleKeywordField
│   ├── TemplateImageUploader
│   └── StyleDescriptionSection
├── InspirationRecipeForm
│   ├── RecipeDescriptionField
│   └── TemplateImageUploader
└── TemplateCreatorFooter
```

`TemplateImageUploader` 应设计为可配置组件：

```ts
type TemplateImageUploaderProps = {
  title: string
  required?: boolean
  description: string
  value: TemplateUploadImage[]
  maxCount: number
  minCount?: number
  maxFileSizeMb: number
  maxTotalSizeMb?: number
  onChange: (images: TemplateUploadImage[]) => void
}
```

两个上传场景复用它：

| 场景 | maxCount | minCount | maxFileSizeMb | maxTotalSizeMb |
|---|---:|---:|---:|---:|
| 风格图集 | 30 | 3 | 10 | 30 |
| 固定参考图 | 3 | 0 | 10 | 无 |

## 5. 状态设计

建议状态集中在 `StudioTemplateCreator` 内部。本阶段没有必要上提到 `studio-page.tsx`。

```ts
type TemplateCreatorCategory = "extract_style" | "preset_recipe"

type TemplateUploadImage = {
  url: string
}
```

上传图片在表单状态中统一保存为对象数组：

```ts
type TemplateUploadImageList = TemplateUploadImage[]
```

其中 `url` 为图片 base64 数据或图片链接 URL。本地上传图片建议读取为 base64 data URL 后写入 `url`，后续若服务端返回远端图片地址，也可以直接写入图片链接 URL。文件名、大小、原始 `File` 只作为本地上传校验过程的临时数据，不进入最终图片对象结构。

核心状态：

| 状态 | 初始值 | 说明 |
|---|---|---|
| `title` | `""` | 图片模板标题 |
| `category` | `"extract_style"` | 模型分类 |
| `styleKeywords` | `""` | 风格关键词 |
| `styleImages` | `[]` | 风格图集 |
| `selectedDimensions` | 默认四项 | 风格描述维度 |
| `styleDescriptionOverview` | `""` | 风格描述固定输入项“概览” |
| `styleDescriptionDetails` | 空对象 | 各风格维度对应的描述输入内容 |
| `styleDescriptionTotalCount` | 派生值 | 概览和各维度描述输入内容的总字符数 |
| `recipeDescription` | `""` | 玩法描述 |
| `recipeImages` | `[]` | 固定参考图 |
| `uploadError` | `null` | 当前上传错误提示 |

切换模型分类时建议保留另一类已填写内容，避免用户误触造成输入丢失。

本地上传图片使用 base64 data URL 作为预览和状态值，不使用 `URL.createObjectURL()`，因此组件卸载时不需要 `URL.revokeObjectURL()`。

## 6. 上传实现策略

本阶段只实现本地选择、base64 转换和预览，不上传到后端。

### 6.1 文件选择

- 使用隐藏 `<input type="file" accept="image/png,image/jpeg,image/webp" multiple>`。
- 点击“本地上传”或“继续上传”触发 input。
- 支持一次选择多张图片。
- 每次选择后把合法图片转为 base64 data URL，并以 `{ url }` 结构 append 到现有列表。
- 同名文件不强制去重，除非产品后续明确。

### 6.2 校验顺序

建议对批量选择中的候选文件逐个按以下顺序校验：

1. 格式是否为 `png`、`jpg`、`jpeg`、`webp`。
2. 单张大小是否超过 `maxFileSizeMb`。
3. 追加当前候选文件后数量是否超过 `maxCount`。
4. 追加当前候选文件后总大小是否超过 `maxTotalSizeMb`。

风格图集总大小规则建议基于本地上传文件的原始 `File.size` 校验。因为最终表单状态只保存 `{ url }`，可以在 uploader 组件内部维护一个非提交用的 `sizeByUrl` 记录，或在全部为 base64 data URL 时通过 data URL 估算已上传图片大小。

```ts
const totalSize = acceptedImageUrls.reduce((sum, url) => sum + (sizeByUrl.get(url) ?? estimateBase64Size(url)), 0)
const nextTotalSize = totalSize + acceptedFiles.reduce((sum, file) => sum + file.size, 0) + candidateFile.size
const valid = nextTotalSize <= 30 * 1024 * 1024
```

本地文件转 base64 示例：

```ts
async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
```

批量上传时不因单个文件不合规而完全中断本次上传。建议逐个校验并追加合法图片，不符合格式、单张大小、数量上限或总大小限制的图片直接跳过，并在组件内提示被跳过的数量或第一条跳过原因。

数量和总大小校验按追加顺序处理：

- 若已达到 `maxCount`，后续文件跳过。
- 若追加某张图片后会超过 `maxTotalSizeMb`，该图片跳过，继续检查后面的文件。
- 本次选择中已经通过校验的图片应正常展示，不因后续文件失败而回滚。

### 6.3 删除能力

设计图三没有展示删除按钮，但真实上传交互通常需要可撤销能力。建议本阶段在缩略图 hover 时显示轻量删除按钮，或先预留结构不展示。

如果严格按图三实现，则可以暂不显示删除按钮，但代码结构需要保留 `removeImage(id)`，便于后续补交互。

## 7. 表单校验和按钮启用

“下一步”本阶段不进入发布页，但应体现基本可用性。

建议启用条件：

当 `category === "extract_style"`：

- 标题长度 `2-10`。
- 风格图集数量 `>= 3` 且 `<= 30`。
- 风格图集总大小 `<= 30MB`。
- 风格描述“概览”输入项必填。
- 风格描述总字符数 `<= 700`。
- 不校验是否选中风格维度；风格维度只决定“概览”之外的动态输入项是否显示。

当 `category === "preset_recipe"`：

- 标题长度 `2-10`。
- 玩法描述非空。
- 固定参考图数量 `<= 3`。

字数计数和输入限制：

- 标题输入框使用 `maxLength={10}`。
- 计数实时显示 `${title.length}/10`。
- 不再出现 `0/20`。
- 风格描述每个输入项使用 `maxLength={300}`，标题行右侧实时显示 `${value.length}/300`。
- 风格描述底部总计数实时显示 `总字符数：${total}/700`。
- 风格描述总字符数超过 700 时把总计数字体变红，不限制输入，但禁用“下一步”按钮。

## 8. 样式方案

建议新增 Studio CSS 分片，文件名遵守当前 Studio 模块 `studio-01.css`、`studio-02.css` 等顺序命名：

```text
packages/app/octoapp/pages/studio/studio-08.css
```

该文件由 `packages/app/octoapp/pages/studio/studio.css` 追加 `@import "./studio-08.css";` 引入。样式选择器仍统一使用 `studio-style-template-*` 和 `studio-template-creator-*` 前缀，避免污染其它 Studio 模块。

关键布局尺寸：

| 区域 | 建议 |
|---|---|
| 根容器 | `height: 100%`, `overflow: hidden`, 白底 |
| 内容滚动层 | `height: calc(100% - footerHeight)`, `overflow-y: auto` |
| 表单内容宽度 | `640px`，在编辑区中居中显示，小屏使用 `max-width: 100%` |
| 表单左右留白 | 编辑区提供外层留白，小屏降到 `24px` |
| 步骤条 | 顶部居中，左右连线 |
| 分类卡片 | 两列，间距约 `40px`，小屏可降为一列 |
| 文本输入 | 灰底、无明显边框，圆角约 `6px` |
| 上传区域空态 | 高约 `180px`，灰底 |
| 上传后缩略图 | 风格图集和固定参考图使用同一网格展示，固定卡片尺寸，按 `640px` 容器自适应 |
| 底部操作栏 | 固定在 canvas body 底部，顶部 1px 分割线 |

注意右侧工作区可能作为小屏 overlay 展示，表单宽度需要用 `max-width: 100%` 和响应式 grid，避免横向溢出。

## 9. 与现有 Studio 的关系

- 不修改 Composer、浮窗、tab 打开逻辑。
- 不新增 `StudioCapability` 或 `StudioMode`。
- 不改变 session、生成消息、文件管理和动态图片 tab 数据。
- 不触发 `runGeneration()`。
- 不接入 `StudioDetails`。
- 不写入 `studio.view.preference`。
- 所有创建模板表单状态为本地临时状态，关闭“创建模板”tab 后可以丢弃。

## 10. 实现步骤

1. 在 `studio-template-creator.tsx` 中实现步骤条、标题输入、分类卡片和底部操作栏。
2. 实现 `extract_style` 表单：风格关键词、风格图集上传、风格描述维度标签、描述区域。
3. 实现 `preset_recipe` 表单：玩法描述、固定参考图上传。
4. 实现通用本地图片 uploader：格式、数量、单张大小、总大小校验，空态和已上传网格。
5. 新增 `studio-08.css`，在 `studio.css` 中追加 import，并补齐布局、卡片、输入框、上传区和底部栏样式。
6. 运行 `bun typecheck`。
7. 本地打开 Studio，验证从“风格模板 -> 创建模板”进入后内容区展示和两类表单切换。

## 11. 验收标准

- 点击“创建模板”tab 后内容区不再空白，展示三步步骤条和第 1 步表单。
- 图片模板标题初始计数为 `0/10`，输入后实时更新，最多输入 10 字。
- 默认选中“视觉风格”（`extract_style`），展示图一对应字段。
- 切换“灵感配方”（`preset_recipe`）后展示图二对应字段。
- 风格描述“概览”固定显示，其它输入项随风格维度选中状态动态显示。
- 风格描述每个输入项初始计数为 `0/300`，最多输入 300 字符。
- 风格描述底部显示 `总字符数：0/700`，超过 700 时计数变红但不限制继续输入。
- “下一步”要求风格描述“概览”必填，并在总字符数超过 700 时禁用；不要求选择风格维度。
- 风格图集空态和上传后网格分别符合图一、图三结构。
- 风格图集限制满足：最多 30 张、最少 3 张、单张不超过 10MB、总大小不超过 30MB。
- 固定参考图限制满足：最多 3 张、单张不超过 10MB。
- 上传支持 `png`、`jpg`、`jpeg`、`webp`。
- 本地上传图片转为 base64 data URL，并按 `{ url }[]` 存入表单状态。
- 风格图集和固定参考图已上传后的展示样式一致，达到各自数量上限后不显示“继续上传”。
- 批量上传时合法图片正常追加，不合规图片跳过，不完全中断本次上传。
- 切换模型分类不丢失另一类已填写内容。
- 页面在空 Studio、有 session、有图片结果和小屏 overlay 下都能正常展示。
- `bun typecheck` 通过。

## 12. 后续非本阶段内容

- 接入生成风格描述接口。
- 接入模板保存、发布和添加示例流程。
- 接入真实图片上传服务和远端 URL。
- 增加删除、排序、拖拽、多选等图片管理能力。
- 增加草稿保存和离开确认。
- 增加埋点和异常上报。
