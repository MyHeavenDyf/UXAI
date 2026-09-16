# Studio 创建模板第三步添加示例实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 Studio“创建模板”流程第 3 步“添加示例”的 UI、状态、校验、上传限制和验收标准。
- 最后更新：2026-08-28。
- 关联前置：
  - `packages/app/octoapp/pages/studio/docs/studio-template-creator-content-implementation-plan.md` 已覆盖第 1 步“制作模板”。
  - `packages/app/octoapp/pages/studio/docs/studio-template-publish-implementation-plan.md` 已覆盖第 2 步“发布模板”。
- 本方案新建独立文档，不修改前两份方案文档。

## 2. 背景与目标

“创建模板”工作区当前按三步流程推进：

```text
创建模板
├── 1 制作模板
├── 2 发布模板
└── 3 添加示例
```

第 3 步用于给即将发布的模板上传示例图，让使用者在模板发布前后都能理解该模板的风格效果或玩法结果。

本阶段目标：

- 将当前第 3 步占位内容替换为“添加示例图”上传表单。
- 上传交互复用第 1 步已有图片上传能力。
- 顶部步骤条展示第 1、2 步已完成，第 3 步进行中。
- 底部操作栏显示“上一步”和“发布”按钮。
- “发布”按钮按示例图上传校验启用；本阶段可先不接真实发布接口。

## 3. 已确认的产品规则

### 3.1 通用布局

- 继续显示在 `studio-canvas-body` 内，由 `StudioTemplateCreator` 组件承载。
- 表单内容宽度沿用前两步，为 `640px`，在编辑区中水平居中显示。
- 顶部步骤条沿用第 2 步已经抽象出的动态状态。
- 第 3 步页面底部固定操作栏：
  - 左侧按钮：“上一步”，返回第 2 步“发布模板”。
  - 右侧主按钮：“发布”，本阶段根据本地校验启用。
- 当前不接后端发布接口时，点击“发布”可先保留 TODO 或空实现，避免伪造发布结果。

### 3.2 步骤条状态

进入第 3 步时，步骤条状态为：

```text
1 制作模板：已完成，显示蓝色描边圆圈 + 对勾
2 发布模板：已完成，显示蓝色描边圆圈 + 对勾
3 添加示例：当前步骤，显示蓝色实心圆点 + 数字 3
```

继续复用现有步骤状态规则：

| currentStep | 制作模板 | 发布模板 | 添加示例 |
|---|---|---|---|
| `make` | active | pending | pending |
| `publish` | complete | active | pending |
| `examples` | complete | complete | active |

### 3.3 添加示例图

字段：

| 项 | 规则 |
|---|---|
| label | 添加示例图 |
| 必填 | 是 |
| 上传格式 | `png`、`jpg`、`jpeg`、`webp` |
| 最少数量 | 1 张 |
| 最多数量 | 20 张 |
| 单张图片大小 | 不超过 10MB |
| 所有图片总大小 | 不超过 30MB |
| 数据结构 | `{ url: string }[]` |
| 本地上传存储 | 转成 base64 data URL 后写入 `url` |

上传样式和交互与第 1 步 `TemplateImageUploader` 保持一致：

```text
空状态
├── 灰色上传区域
├── 蓝色“本地上传”按钮
└── 支持图片格式： png ｜ jpg ｜ jpeg ｜ webp

已上传状态
├── 继续上传卡片（未达到 20 张时显示）
└── 图片缩略图网格
```

上传规则：

- 支持一次选择多张图片。
- 批量上传时，不符合要求的图片只跳过，不完全中断本次上传。
- 不符合格式、单张超过 10MB、数量超过 20 张、总大小超过 30MB 的图片均跳过。
- 当已上传图片达到 20 张时，不显示“继续上传”按钮。
- 删除图片后，如果数量低于 20 张，则恢复显示“继续上传”按钮。
- 上传错误或跳过信息继续使用上传组件内提示，不新增全局 toast。

### 3.4 说明文案

设计图中的说明文案需要按第 1 步“模型分类”动态修正。

当第 1 步模型分类为 `extract_style`（视觉风格）时：

```text
风格模板至少要添加1张例图，让使用者了解风格特征，单张不超过10M，最多20张
```

当第 1 步模型分类为 `preset_recipe`（灵感配方）时：

```text
预设灵感配方至少要上传1张例图，让使用者了解玩法结果的变化，单张不超过10M，最多20张
```

注意：

- 文案只根据 `category` 状态动态变化。
- 文案中的数量限制写“最多20张”，但实际校验仍要同时执行所有示例图总大小不超过 30MB。

### 3.5 底部按钮校验

第 3 步的“发布”按钮启用条件：

- 示例图数量至少 1 张。
- 示例图数量不超过 20 张。
- 每张图片不超过 10MB。
- 所有示例图总大小不超过 30MB。

由于上传组件已在上传阶段跳过不合规文件，按钮校验主要检查当前状态：

```ts
exampleImages().length >= 1 &&
exampleImages().length <= 20 &&
imageTotalSize(exampleImages(), sizeByUrl()) <= 30 * BYTES_IN_MB
```

如果后续支持外部 URL 图片，需要在保存 URL 时补充可用的 size 信息；若无法得知大小，建议按后端最终校验兜底。

## 4. 推荐实现边界

继续使用现有文件：

```text
packages/app/octoapp/pages/studio/studio-template-creator.tsx
packages/app/octoapp/pages/studio/studio-08.css
```

不建议为第 3 步单独新增组件文件，当前 `StudioTemplateCreator` 已经包含三步的本地状态和表单切换，新增第 3 步表单函数即可。

推荐结构：

```text
StudioTemplateCreator
├── TemplateCreatorSteps(currentStep)
├── MakeTemplateForm
├── PublishTemplateForm
├── TemplateCreatorExamplesForm
│   └── TemplateImageUploader（复用）
└── TemplateCreatorFooter
```

需要替换当前占位组件：

```ts
function TemplateCreatorExamplesPlaceholder(): JSX.Element
```

替换为：

```ts
function TemplateCreatorExamplesForm(props: {
  category: TemplateCreatorCategory
  exampleImages: TemplateUploadImage[]
  sizeByUrl: Record<string, number>
  uploadMessage: string
  onExampleImages: (images: TemplateUploadImage[]) => void
  onSizes: (sizes: Record<string, number>) => void
  onUploadMessage: (message: string) => void
}): JSX.Element
```

表单内部复用：

```tsx
<TemplateImageUploader
  title="添加示例图"
  required
  description={exampleDescription()}
  value={props.exampleImages}
  maxCount={20}
  minCount={1}
  maxFileSizeMb={10}
  maxTotalSizeMb={30}
  sizeByUrl={props.sizeByUrl}
  message={props.uploadMessage}
  onChange={props.onExampleImages}
  onSizes={props.onSizes}
  onMessage={props.onUploadMessage}
/>
```

## 5. 状态设计

在 `StudioTemplateCreator` 内新增第 3 步状态：

```ts
const [exampleImages, setExampleImages] = createSignal<TemplateUploadImage[]>([])
const [exampleUploadMessage, setExampleUploadMessage] = createSignal("")
```

继续复用已有上传图片类型：

```ts
type TemplateUploadImage = {
  url: string
}
```

继续复用已有文件大小记录：

```ts
const [sizeByUrl, setSizeByUrl] = createSignal<Record<string, number>>({})
```

说明：

- 第 1 步风格图集、第 1 步固定参考图、第 3 步示例图都可以共享 `sizeByUrl`。
- `sizeByUrl` 以图片 `url` 为 key，记录本地上传原始文件大小。
- 本地上传图片仍通过 `fileToDataUrl` 转成 base64 后保存为 `{ url }`。

## 6. 校验设计

当前已有 `canMakeNext` 和 `canPublishNext`，第 3 步建议新增：

```ts
const canPublish = createMemo(() =>
  exampleImages().length >= 1 &&
  exampleImages().length <= 20 &&
  imageTotalSize(exampleImages(), sizeByUrl()) <= 30 * BYTES_IN_MB
)
```

再把当前 `canNext` 扩展成按步骤返回：

```ts
const canNext = createMemo(() => {
  if (currentStep() === "make") return canMakeNext()
  if (currentStep() === "publish") return canPublishNext()
  return canPublish()
})
```

底部按钮文案建议由步骤决定：

```ts
const primaryLabel = () => (currentStep() === "examples" ? "发布" : "下一步")
```

`goNext` 逻辑：

```ts
const goNext = () => {
  if (!canNext()) return
  setCurrentStep((step) => {
    if (step === "make") return "publish"
    if (step === "publish") return "examples"
    return step
  })
}
```

第 3 步点击“发布”时，本阶段可先不切换页面；后续接接口时在 `step === "examples"` 分支中组装完整表单数据并调用发布接口。

## 7. 样式方案

第 3 步优先复用已有样式：

- `.studio-template-creator-form`
- `.studio-template-creator-field`
- `.studio-template-creator-field-title`
- `.studio-template-creator-field-description`
- `.studio-template-creator-upload-empty`
- `.studio-template-creator-upload-grid`
- `.studio-template-creator-upload-more`
- `.studio-template-creator-upload-thumb`
- `.studio-template-creator-footer`

如果需要补充样式，继续写入：

```text
packages/app/octoapp/pages/studio/studio-08.css
```

原因：

- `studio-08.css` 已用于风格模板相关入口、创建模板内容区、发布模板表单样式。
- 文件命名遵守当前 Studio 模块的数字分段 CSS 命名方式。
- 第 3 步没有独立复杂视觉系统，不需要再新增 `studio-09.css`。

可能需要补充的最小样式：

- 第 3 步表单顶部间距若和设计图有差异，可微调 `.studio-template-creator-form` 或新增局部 class。
- 底部主按钮在第 3 步显示“发布”时仍复用 `.studio-template-creator-next`，不另起按钮样式。

## 8. 数据提交预留

未来接入真实发布接口时，建议整理成一个统一 payload：

```ts
const payload = {
  title: title(),
  category: category(),
  styleKeywords: styleKeywords(),
  styleImages: styleImages(),
  styleDescription: {
    overview: styleDescriptionOverview(),
    dimensions: styleDescriptionDetails(),
  },
  recipeDescription: recipeDescription(),
  recipeImages: recipeImages(),
  usageDescription: usageDescription(),
  promptSetting: promptSetting(),
  referenceMode: referenceMode(),
  referenceCount: referenceMode() === "not_supported" ? null : referenceCount(),
  visibility: visibility(),
  specifiedUsers: visibility() === "specified_users" ? specifiedUsers() : "",
  exampleImages: exampleImages(),
}
```

本阶段不需要新增接口请求，也不需要新增后端类型。

## 9. 验收标准

- 从第 2 步点击“下一步”后进入第 3 步。
- 第 3 步步骤条显示：
  - 第 1 步完成态。
  - 第 2 步完成态。
  - 第 3 步进行态。
- 第 3 步显示“添加示例图”必填上传区域。
- 第 1 步分类为 `extract_style` 时，说明文案为：
  `风格模板至少要添加1张例图，让使用者了解风格特征，单张不超过10M，最多20张`
- 第 1 步分类为 `preset_recipe` 时，说明文案为：
  `预设灵感配方至少要上传1张例图，让使用者了解玩法结果的变化，单张不超过10M，最多20张`
- 上传空状态、已上传缩略图状态、继续上传卡片样式与第 1 步一致。
- 支持一次选择多张图片。
- 批量上传遇到不合规图片时只跳过不合规项，不中断其他合规图片上传。
- 单张超过 10MB 的图片被跳过。
- 总大小超过 30MB 的图片被跳过。
- 达到 20 张后不显示“继续上传”按钮。
- 未上传示例图时，“发布”按钮禁用。
- 上传至少 1 张合规示例图后，“发布”按钮启用。
- 点击“上一步”返回第 2 步，并保留第 3 步已上传图片状态。
- `bun typecheck` 通过。
