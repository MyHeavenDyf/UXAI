# Studio 风格模板选择与使用实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 `studio-style-template-card` 点击选择模板后的 UI 状态、模型切换、提示词拼接、发送链路和涉及文件。
- 最后更新：2026-09-01。
- 关联前置：
  - `docs/studio-style-template-list-implementation-plan.md`：模板列表查询、分页和卡片展示。
  - `docs/studio-template-submit-implementation-plan.md`：模板发布接口和模板字段结构。

## 2. 视觉参考

### 2.1 模板应用中按钮

Pixso MCP 节点：

```text
https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:499679
```

截图可见：

- 按钮文案为“模版应用中”。
- 按钮右侧有画笔图标和关闭图标。
- 点击关闭图标用于取消当前模板。

MCP DSL 关键规格：

| 项 | 规格 |
|---|---|
| 根节点 | `1081:499679`，`FRAME`，`容器 30030` |
| 尺寸 | `120px × 30px` |
| 布局 | 横向 auto layout |
| 内边距 | `5px 12px` |
| gap | `6px` |
| 圆角 | `999px` |
| 背景 | `rgba(44, 46, 52, 0.05)` |
| 文案 | `模版应用中` |
| 文案样式 | `Body/font-body-1 （Regular）`，颜色 `#191919` |
| 图标容器 | `16px × 16px` |
| 画笔图层名 | `ic_public_brush` |
| 关闭图层名 | `ic_public_close` |

实现约束：

- 该样式只在已经选择模板时替换原 `风格模板` toolbar 按钮。
- 按钮主体点击仍打开模板浮窗，用于切换模板。
- 关闭图标点击只清除模板，需 `event.stopPropagation()`，避免同时打开浮窗。

### 2.2 配方模板输入区

Pixso MCP 节点：

```text
https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:510343
```

截图可见：

- 前半段是灰色输入框。
- 后半段是普通可输入补充提示词。

MCP DSL 关键规格：

| 项 | 规格 |
|---|---|
| 根节点 | `1081:510343`，`FRAME`，`容器 72127` |
| 根节点尺寸 | `284px × 24px` |
| 根节点布局 | 横向 auto layout |
| 根节点 gap | `4px` |
| 灰框节点 | `1081:510344`，`容器 71934` |
| 灰框尺寸 | `172px × 24px` |
| 灰框内边距 | `4px 8px` |
| 灰框圆角 | `4px` |
| 灰框背景 | 设计 token `场景/Fill color/color-hover` |
| 灰框示例文案 | `输入徽章的形状、数字、图案` |
| 后置输入示例文案 | `可选输入补充提示词` |
| 文案颜色 | 设计 token `场景/Text color/color-text-secondary` |
| 字体 | `Body/font-body-1 （Regular）` |

实现约束：

- 只有选中 `preset_recipe` 模板时才切换为该输入结构。
- 选中 `extract_style` 模板时仍使用当前普通输入区。

## 3. 核心结论

模板选择与使用应走纯前端状态和现有生图链路，不需要新增供应商接口。

推荐调用链：

```text
StudioStyleTemplateMenu 卡片点击
  -> StudioComposer onSelectStyleTemplate
    -> studio-page.tsx applyStyleTemplate
      -> 保存 selectedStyleTemplate
      -> 切换模型 seedream/qwen
      -> 关闭 style-template 浮窗
      -> 用户点击发送
        -> studio-page.tsx 按模板类型构造 final prompt
        -> runGeneration({ refinedPrompt, effectivePrompt, extra.skipPromptRefine: true, extra.template })
        -> /studio/generations
        -> opencode studio-service 走 promptRefineFallback，不调用 LLM
        -> internel_image_generate.ts 将 extra.template 写入最终生图 args.template
```

关键点：

- 模板数据直接复用列表接口返回的 `StudioStyleTemplateListItem`。
- 点击卡片只做本地应用模板，不额外请求详情接口。
- 使用模板时强制生成能力为 `image.generate`。
- 应用模板后风格模型自动切到 `Seedream 5.0 Lite` 或 `千问`：
  - 有 seedream 权限时优先切换为 `seedream-5-lite`。
  - 没有 seedream 权限时切换为 `qwen`。
- 使用模板发送任务时不经过 LLM。
- 绕过 LLM 通过现有 `extra.skipPromptRefine: true` 实现，不建议新增服务端分支。
- 使用模板发送任务时，最终供应商生图接口的 `args` 里必须增加：

```ts
template: {
  id: string
  prompt: Record<string, string>
}
```

其中 `id` 为模板 `idx`；`prompt` 根据模板类型构造，详见第 11.3 节。
- 选择模板后需要同时遵守模板发布时配置的输入与参考图规则：
  - `prompt_setting=required`：发送必须有用户输入。
  - `prompt_setting=optional`：允许无用户输入。
  - `prompt_setting=not_supported`：输入区不可编辑，显示“此图片模板不支持输入提示词”。
  - `reference_image_setting=fixed`：必须上传且只能上传 `reference_image_count` 张参考图，发送校验为严格相等。
  - `reference_image_setting=optional`：参考图非必填，但最多上传 `reference_image_count` 张。
  - `reference_image_setting=not_supported`：禁用上传参考图入口，点击提示“该风格模版不支持上传参考图”。

## 4. 数据类型

### 4.1 复用列表项类型

文件：

`packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`

已有类型：

```ts
export type StudioStyleTemplateListItem = StudioTemplatePublishInput & {
  idx: string
}
```

该类型已经包含：

- 公共发布字段：`idx`、`template_type`、`title`、`usage_instructions`、`example_images` 等。
- 风格模板字段：`style_description`、`style_images`、`style_keywords`。
- 配方模板字段：`fixed_reference_images`、`play_description`。

### 4.2 页面新增状态

文件：

`packages/app/octoapp/pages/studio-page.tsx`

建议新增：

```ts
const [selectedStyleTemplate, setSelectedStyleTemplate] = createSignal<StudioStyleTemplateListItem>()
const [recipeMainPrompt, setRecipeMainPrompt] = createSignal("")
const [recipeExtraPrompt, setRecipeExtraPrompt] = createSignal("")
```

含义：

| 状态 | 用途 |
|---|---|
| `selectedStyleTemplate` | 当前应用中的模板 |
| `recipeMainPrompt` | 配方模板灰框内输入 |
| `recipeExtraPrompt` | 配方模板后置补充提示词 |

不建议把这些状态放在 `StudioStyleTemplateMenu`：

- 菜单组件只负责列表和选择。
- 真正影响发送任务的是 Studio 页面级状态。
- 这样模板选择后即使菜单关闭，发送逻辑仍能拿到当前模板。

### 4.3 模板约束派生状态

文件：

`packages/app/octoapp/pages/studio-page.tsx`

基于 `selectedStyleTemplate()` 统一派生模板约束，避免在输入区、上传入口、发送校验里重复散写判断。

```ts
const templatePromptSetting = createMemo(() => selectedStyleTemplate()?.prompt_setting)
const templateReferenceSetting = createMemo(() => selectedStyleTemplate()?.reference_image_setting)
const templateReferenceCount = createMemo(() =>
  selectedStyleTemplate()?.reference_image_setting === "not_supported"
    ? 0
    : selectedStyleTemplate()?.reference_image_count ?? referenceImageLimit(styleModel())
)
```

实际可上传参考图上限需要同时考虑模型能力和模板配置：

```ts
const effectiveMaxReferenceImages = createMemo(() => {
  const template = selectedStyleTemplate()
  const modelLimit = referenceImageLimit(styleModel())
  if (!template) return modelLimit
  if (template.reference_image_setting === "not_supported") return 0
  return Math.min(modelLimit, template.reference_image_count)
})
```

说明：

- 未选择模板时，继续使用模型自身 `referenceImageLimit(styleModel())`。
- `fixed` 和 `optional` 的上传上限都取 `reference_image_count` 与模型上限的较小值。
- 区别在发送校验：
  - `fixed` 必须 `assets().length === reference_image_count`。
  - `optional` 允许 `0 ~ reference_image_count`。
  - `not_supported` 必须为 `0`，并从入口禁用上传。

## 5. 卡片选择

文件：

`packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`

### 5.1 新增 props

```ts
export function StudioStyleTemplateMenu(props: {
  onCreateTemplate: () => void
  onListTemplates?: (input: StudioStyleTemplateListInput) => Promise<StudioStyleTemplateListResult>
  onSelectTemplate?: (item: StudioStyleTemplateListItem) => void
}): JSX.Element
```

### 5.2 卡片点击

当前卡片是纯展示。需要改成可点击元素：

```tsx
<button
  type="button"
  class="studio-style-template-card"
  onClick={() => props.onSelectTemplate?.(item)}
>
  ...
</button>
```

样式注意：

- 重置按钮默认样式：`border: 0; padding: 0; background: transparent; text-align: left;`
- 保留现有 `120px × 140px` 卡片布局。
- 可加 hover 态，但不要改变卡片尺寸。

## 6. 应用模板逻辑

文件：

`packages/app/octoapp/pages/studio-page.tsx`

新增函数：

```ts
function applyStyleTemplate(template: StudioStyleTemplateListItem) {
  const targetModel = canUseSeedream() ? "seedream-5-lite" : "qwen"
  batch(() => {
    setSelectedStyleTemplate(template)
    setCapability("image.generate")
    selectStudioStyleModel(targetModel)
    setOpenMenu(null)

    if (template.template_type === "preset_recipe") {
      setRecipeMainPrompt("")
      setRecipeExtraPrompt("")
    }

    if (template.reference_image_setting === "not_supported") {
      setAssets([])
    } else {
      setAssets((items) => items.slice(0, Math.min(referenceImageLimit(targetModel), template.reference_image_count)))
    }
  })
}
```

实际项目中已有 `selectStyleModel` / `setStyleModel` / `selectStudioCapability` 等函数，需要优先复用当前页面现有的模型切换封装，避免漏掉宽高、比例、参考图上限等副作用。

模型切换规则：

```ts
const targetModel = canUseSeedream() ? "seedream-5-lite" : "qwen"
```

注意：

- 如果当前能力不是图片生成，应用模板时也要切回 `image.generate`。
- 如果切换到 `qwen`，需要保留现有千问尺寸钳位逻辑。
- 如果切换到 `seedream-5-lite`，需要保留现有 seedream 权限和参考图数量限制逻辑。
- 应用模板后要按模板参考图规则裁剪现有参考图：
  - `not_supported`：清空当前参考图。
  - `fixed` / `optional`：裁剪到 `Math.min(referenceImageLimit(targetModel), reference_image_count)`。
  - 若 `fixed` 裁剪后数量仍不足 `reference_image_count`，发送按钮保持禁用，等待用户补足。

## 7. 模板输入与参考图规则

### 7.1 `prompt_setting`

模板字段：

```ts
prompt_setting: "required" | "optional" | "not_supported"
```

规则：

| 值 | 输入区行为 | 发送按钮校验 |
|---|---|---|
| `required` | 允许输入 | 必须有用户输入 |
| `optional` | 允许输入 | 不要求用户输入 |
| `not_supported` | 不允许输入，显示“此图片模板不支持输入提示词” | 不校验用户输入 |

用户输入文本定义：

```ts
const templateUserPromptText = createMemo(() => {
  const template = selectedStyleTemplate()
  if (template?.template_type === "preset_recipe") {
    return `${recipeMainPrompt()}${recipeExtraPrompt()}`
  }
  return prompt()
})
```

注意：

- 风格模板的用户输入来自普通 `prompt`。
- 配方模板的用户输入来自灰框输入和后置补充输入。
- `not_supported` 不是 placeholder，而是输入区禁用态文案；用户不能编辑。
- `optional` 允许空输入，但发送链路需要给 `runGeneration` 一个非空 `prompt/displayPrompt` 兜底，建议使用模板标题。

### 7.2 `reference_image_setting`

模板字段：

```ts
reference_image_setting: "fixed" | "optional" | "not_supported"
reference_image_count: 0 | 1 | 2 | 3
```

规则：

| 值 | 参考图入口 | 发送按钮校验 |
|---|---|---|
| `fixed` | 允许上传，最大数量为 `reference_image_count` | 必须上传且只能上传 `reference_image_count` 张 |
| `optional` | 允许上传，最大数量为 `reference_image_count` | 不要求上传 |
| `not_supported` | 上传按钮禁用，点击提示“该风格模版不支持上传参考图” | 不允许有参考图 |

`fixed` 需要特别注意：

- 创建模板时“固定参考图”表示使用模板时必须提供指定数量。
- 不是“至少上传 N 张”。
- 发送校验必须是严格相等：

```ts
assets().length === template.reference_image_count
```

失败提示：

```ts
`请上传 ${template.reference_image_count} 张参考图`
```

`optional`：

- `0` 张可以发送。
- 上传数量不能超过 `reference_image_count`。

`not_supported`：

- 应用模板时清空已有参考图。
- 上传按钮禁用。
- 点击上传按钮提示：

```text
该风格模版不支持上传参考图
```

- 粘贴图片、拖拽图片也要拦截，不能绕过按钮限制。

### 7.3 上传入口拦截

文件：

`packages/app/octoapp/pages/studio-page.tsx`

参考图上传入口目前包含：

- 点击上传按钮：`onPickFile`
- 粘贴图片：`handlePasteReferenceImage`
- 拖拽图片：`handleDropFiles`
- URL 拖入：`handleDropImageUrl`

建议新增：

```ts
function canUseTemplateReferenceImages() {
  return selectedStyleTemplate()?.reference_image_setting !== "not_supported"
}

function showUnsupportedReferenceNotice() {
  showFloatingNotice("info", "该风格模版不支持上传参考图")
}

function pickReferenceFile() {
  if (!canUseTemplateReferenceImages()) {
    showUnsupportedReferenceNotice()
    return
  }
  fileInputRef.click()
}
```

并在粘贴/拖拽入口前置：

```ts
if (!canUseTemplateReferenceImages()) {
  showUnsupportedReferenceNotice()
  return
}
```

对于 `fixed` / `optional`，原有上传逻辑中的 `limit = maxReferenceImages()` 应改为 `effectiveMaxReferenceImages()`，确保超过模板限制的图片不会进入 `assets`。

## 8. 清除模板逻辑

文件：

`packages/app/octoapp/pages/studio-page.tsx`

新增函数：

```ts
function clearStyleTemplate() {
  batch(() => {
    setSelectedStyleTemplate(undefined)
    setRecipeMainPrompt("")
    setRecipeExtraPrompt("")
  })
}
```

清除模板后：

- Toolbar 按钮恢复为“风格模板”。
- 普通输入区恢复现有样式。
- 不强制清空原 `prompt`，避免误删用户输入。
- 不强制切换模型回旧值，因为用户可能已经接受 seedream/qwen。

## 9. `StudioComposer` 透传与展示

文件：

`packages/app/octoapp/pages/studio/studio-composer.tsx`

### 9.1 新增 props

```ts
selectedStyleTemplate?: StudioStyleTemplateListItem
recipeMainPrompt: string
recipeExtraPrompt: string
templatePromptSetting?: "required" | "optional" | "not_supported"
templateReferenceSetting?: "fixed" | "optional" | "not_supported"
onSelectStyleTemplate?: (item: StudioStyleTemplateListItem) => void
onClearStyleTemplate?: () => void
onRecipeMainPrompt: (value: string) => void
onRecipeExtraPrompt: (value: string) => void
onUnsupportedReferenceUpload?: () => void
```

也可以将配方输入状态合并成一个对象，但当前 StudioComposer props 已经偏显式，保持单字段 props 更符合现有代码风格。

### 9.2 菜单透传

打开 `StudioStyleTemplateMenu` 时传入：

```tsx
<StudioStyleTemplateMenu
  onCreateTemplate={...}
  onListTemplates={props.onListStyleTemplates}
  onSelectTemplate={(item) => {
    props.onOpenMenu(null)
    props.onSelectStyleTemplate?.(item)
  }}
/>
```

### 9.3 Toolbar 按钮替换

当前未选择模板时保持：

```tsx
<ToolButton label="风格模板" ... />
```

已选择模板时替换为：

```tsx
<SelectedTemplateButton
  disabled={isBusy()}
  onClick={() => props.onOpenMenu(pointerDownOpenMenu === "style-template" ? null : "style-template")}
  onClear={props.onClearStyleTemplate}
/>
```

建议新增组件：

```tsx
function SelectedTemplateButton(props: {
  disabled?: boolean
  onClick: () => void
  onPointerDown?: () => void
  onClear?: () => void
}): JSX.Element
```

关闭图标：

```tsx
<button
  type="button"
  class="studio-composer-template-clear"
  onClick={(event) => {
    event.stopPropagation()
    props.onClear?.()
  }}
/>
```

如果按钮整体用 `<button>`，内部不能再嵌套 `<button>`。实现时建议：

- 外层使用普通 `button`。
- 清除图标使用 `span role="button"` 并监听 click/keyDown；或
- 外层使用 `div role="button"`，内部用真实 `button`。

优先推荐第二种：外层 `div role="button"`，内部关闭使用 `button`，语义和交互更干净。

### 9.4 输入区禁用态

当 `templatePromptSetting === "not_supported"` 时，输入区不渲染普通 contenteditable，也不渲染配方灰框输入，而是显示固定文案：

```text
此图片模板不支持输入提示词
```

建议新增组件或分支：

```tsx
<Show
  when={props.templatePromptSetting === "not_supported"}
  fallback={/* 普通输入区或配方输入区 */}
>
  <div class="studio-composer-template-prompt-disabled">
    此图片模板不支持输入提示词
  </div>
</Show>
```

注意：

- 这不是 placeholder，而是不可编辑状态。
- 配方模板在该状态下也不展示灰框输入和后置输入。
- `prompt_setting=required` / `optional` 时才允许用户输入。

### 9.5 参考图禁用态

当 `templateReferenceSetting === "not_supported"` 时：

- 首个上传参考图按钮显示禁用态。
- 已上传参考图会在应用模板时被清空，因此通常不会出现继续上传按钮。
- 点击上传按钮调用 `onUnsupportedReferenceUpload`，提示“该风格模版不支持上传参考图”。
- 拖拽 hover 态不应激活。

Composer 内部的 `canDropImages` 建议叠加：

```ts
const canUseReferenceImages = createMemo(() =>
  props.templateReferenceSetting !== "not_supported"
)

const canDropImages = () =>
  canUseReferenceImages() && (isImageGeneration() || isVideoGeneration())
```

首个上传按钮：

```tsx
<button
  type="button"
  onClick={() => {
    if (!canUseReferenceImages()) {
      props.onUnsupportedReferenceUpload?.()
      return
    }
    props.onPickFile()
  }}
  class="studio-composer-ref-btn"
  classList={{ disabled: !canUseReferenceImages() }}
  title={canUseReferenceImages() ? "上传参考图" : "该风格模版不支持上传参考图"}
/>
```

## 10. 配方模板输入 UI

文件：

`packages/app/octoapp/pages/studio/studio-composer.tsx`

### 10.1 判断是否配方模板

```ts
const selectedRecipeTemplate = createMemo(() =>
  props.selectedStyleTemplate?.template_type === "preset_recipe"
    ? props.selectedStyleTemplate
    : undefined
)
```

### 10.2 拆分 `play_description`

规则：根据 `play_description` 返回的字符串从第一个 `【` 开始做括号深度匹配，找到与第一个 `【` 对应闭合的 `】` 后进行分割：

- `【` 前的字符串：`prefix`
- 与第一个 `【` 对应闭合的 `】` 后面的字符串：`suffix`
- 第一个 `【】` 中间内容：作为灰框 placeholder

多个 `【】` 或嵌套 `【】` 的处理规则：

- 只处理第一个 `【` 对应的完整匹配段。
- 支持嵌套括号，匹配时需要维护括号深度。
- 如果第一个 `【` 找不到对应闭合的 `】`，则认为没有可拆分槽位，`prefix = play_description`，`suffix = ""`。
- 即使后面或内部存在局部看起来成对的 `【】`，只要第一个 `【` 没有完整闭合，也不拆分。

示例：

| `play_description` | `prefix` | `slotPlaceholder` | `suffix` |
|---|---|---|---|
| `aaa【111】bbb【222】` | `aaa` | `111` | `bbb【222】` |
| `aaa【b【c【】】】ddd` | `aaa` | `b【c【】】` | `ddd` |
| `aaa【【【111】bbb` | `aaa【【【111】bbb` | `输入内容` | `` |

建议函数：

```ts
function splitPlayDescription(text: string) {
  const left = text.indexOf("【")
  if (left < 0) {
    return {
      prefix: text,
      slotPlaceholder: "输入内容",
      suffix: "",
    }
  }

  let depth = 0
  let right = -1
  for (let index = left; index < text.length; index += 1) {
    if (text[index] === "【") depth += 1
    if (text[index] === "】") depth -= 1
    if (depth !== 0) continue
    right = index
    break
  }

  if (right < 0) {
    return {
      prefix: text,
      slotPlaceholder: "输入内容",
      suffix: "",
    }
  }

  return {
    prefix: text.slice(0, left),
    slotPlaceholder: text.slice(left + 1, right).trim() || "输入内容",
    suffix: text.slice(right + 1),
  }
}
```

### 10.3 输入区替换

当前普通输入区为：

```tsx
<div
  ref={inputRef}
  class="studio-composer-input"
  contenteditable={!isEditingCapability()}
  ...
/>
```

选中配方模板时改为渲染：

```tsx
<div class="studio-composer-recipe-input">
  <input
    class="studio-composer-recipe-slot"
    value={props.recipeMainPrompt}
    placeholder={splitPlayDescription(template.play_description).slotPlaceholder}
    onInput={(event) => props.onRecipeMainPrompt(event.currentTarget.value)}
  />
  <input
    class="studio-composer-recipe-extra"
    value={props.recipeExtraPrompt}
    placeholder="可选输入补充提示词"
    onInput={(event) => props.onRecipeExtraPrompt(event.currentTarget.value)}
  />
</div>
```

说明：

- 灰框输入只保存用户填入的主体变量，不把 `prefix/suffix` 写进输入框。
- 后置输入保存补充提示词。
- 普通 `prompt` state 不参与配方模板输入，避免和 contenteditable 同步复杂化。
- 如果后续需要支持 `@主体`，再单独扩展；本次不实现。

### 10.4 Enter 发送

普通 contenteditable 的 `onKeyDown` 当前负责 Enter 发送。

配方模板使用 `input` 后，需要在两个 input 上补：

```ts
function handleRecipeInputKeyDown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) return
  event.preventDefault()
  props.onKeyDown(event)
}
```

或直接调用 `props.onSubmit()`，但当前 composer 已统一通过 `onKeyDown` 交给页面判断 `canSubmit`，建议沿用 `props.onKeyDown`。

## 11. 发送提示词构造

文件：

`packages/app/octoapp/pages/studio-page.tsx`

### 11.1 风格模板

模板类型：

```ts
template.template_type === "extract_style"
```

最终提示词：

```ts
const userPrompt = template.prompt_setting === "not_supported" ? "" : prompt().trim()
const styleDescriptionPrompt = JSON.stringify(template.style_description)
const finalPrompt = `${userPrompt}${styleDescriptionPrompt}`
const displayPrompt = userPrompt || template.title
const templatePrompt = {
  ...template.style_description,
  custom: userPrompt,
}
```

发送：

```ts
void runGeneration({
  prompt: displayPrompt,
  displayPrompt,
  refinedPrompt: finalPrompt,
  effectivePrompt: finalPrompt,
  styleModel: canUseSeedream() ? "seedream-5-lite" : "qwen",
  extra: {
    skipPromptRefine: true,
    template: {
      id: template.idx,
      prompt: templatePrompt,
    },
  },
})
```

注意：

- `style_description` 直接使用接口返回/发布时的字段结构，不再做字段映射。
- 不把 `style_images` 自动传给 `referenceImages`，因为当前需求只明确要求拼接 `style_description`。
- `displayPrompt` 建议使用用户原始输入，避免会话气泡展示 JSON。
- 当 `prompt_setting=optional` 且用户未输入时，`displayPrompt` 使用模板标题兜底。
- 当 `prompt_setting=not_supported` 时，`userPrompt` 固定为空，最终提示词只使用 `JSON.stringify(style_description)`。
- 最终接口 `args.template.prompt` 需要包含 `style_description` 中已有的全部属性值，并额外包含 `custom`。
- `custom` 为用户实际输入；`optional` 未输入或 `not_supported` 时为 `""`。
- `effectivePrompt/refinedPrompt` 使用最终提示词，确保供应商收到模板增强后的内容。

### 11.2 配方模板

模板类型：

```ts
template.template_type === "preset_recipe"
```

先分割：

```ts
const recipe = splitPlayDescription(template.play_description)
```

最终提示词：

```ts
const mainPrompt = template.prompt_setting === "not_supported" ? "" : recipeMainPrompt().trim()
const extraPrompt = template.prompt_setting === "not_supported" ? "" : recipeExtraPrompt().trim()
const finalPrompt = [
  recipe.prefix,
  mainPrompt,
  recipe.suffix,
  extraPrompt,
].join("")
```

显示用输入：

```ts
const displayPrompt = [mainPrompt, extraPrompt]
  .filter(Boolean)
  .join("，") || template.title
const templatePrompt = {
  custom: `${mainPrompt}${extraPrompt}`,
  extraPrompt,
  mainPrompt,
}
```

发送：

```ts
void runGeneration({
  prompt: displayPrompt,
  displayPrompt,
  refinedPrompt: finalPrompt,
  effectivePrompt: finalPrompt,
  styleModel: canUseSeedream() ? "seedream-5-lite" : "qwen",
  extra: {
    skipPromptRefine: true,
    template: {
      id: template.idx,
      prompt: templatePrompt,
    },
  },
})
```

注意：

- 灰框输入拼在 `prefix` 和 `suffix` 中间。
- 灰框后面的输入拼到最后。
- 如果第一个 `【` 没有对应闭合的 `】`，则 `prefix = play_description`，`suffix = ""`，用户灰框输入会拼到 `play_description` 后面。
- 当 `prompt_setting=optional` 且用户未输入时，`displayPrompt` 使用模板标题兜底，最终提示词为 `prefix + suffix`。
- 当 `prompt_setting=not_supported` 时，不展示配方输入区，`mainPrompt` 和 `extraPrompt` 固定为空，最终提示词为 `prefix + suffix`。
- 最终接口 `args.template.prompt` 只包含 `custom`、`extraPrompt`、`mainPrompt` 三个属性。
- `custom` 为 `mainPrompt + extraPrompt` 直接拼接，不额外加分隔符。
- 仍不走 LLM。

### 11.3 最终接口 `args.template`

使用模板的生成任务，最终供应商接口参数的 `args` 中必须带：

```ts
args: {
  ...
  template: {
    id,
    prompt,
  },
}
```

字段规则：

| 字段 | 来源 | 说明 |
|---|---|---|
| `template.id` | `selectedStyleTemplate().idx` | 当前使用模板的模板 id |
| `template.prompt` | 按模板类型构造 | 不同模板类型结构不同 |

风格模板：

```ts
const prompt = {
  ...template.style_description,
  custom: userPrompt,
}

const templateArgs = {
  id: template.idx,
  prompt,
}
```

说明：

- `prompt` 包含 `style_description` 对象中已有的所有属性。
- 不额外补不存在的风格描述字段。
- `custom` 为用户实际输入。
- 如果用户未输入且规则允许为空，`custom` 传 `""`。

配方模板：

```ts
const prompt = {
  custom: `${mainPrompt}${extraPrompt}`,
  extraPrompt,
  mainPrompt,
}

const templateArgs = {
  id: template.idx,
  prompt,
}
```

说明：

- 配方类型的 `prompt` 只包含 `custom`、`extraPrompt`、`mainPrompt`。
- `mainPrompt` 为灰框内输入。
- `extraPrompt` 为灰框后面输入。
- `custom` 为 `mainPrompt + extraPrompt` 直接拼接。

前后端传递建议：

- 前端 `runGeneration` 的 `extra` 中携带 `template`：

```ts
extra: {
  skipPromptRefine: true,
  template: templateArgs,
}
```

- 服务端 `studio-service.ts` 不需要理解模板结构，继续把 `extra` 透传给内部生图工具。
- `packages/opencode/src/tool/internel_image_generate.ts` 在构造文生图最终请求体时，从 `input.extra.template` 读取并写入 `requestBody.args.template`。
- 只需要对 `input.extra.template` 做最小运行时校验：必须是对象，`id` 是字符串，`prompt` 是普通对象。

## 12. 绕过 LLM 的实现方式

服务端文件：

`packages/opencode/src/studio/studio-service.ts`

当前已有：

```ts
function shouldRefineWithLLM(input: StudioGenerationRequest) {
  if (input.capability !== "image.generate" && input.capability !== "video.generate") return false
  return input.extra?.skipPromptRefine !== true
}
```

因此前端只要传：

```ts
extra: {
  skipPromptRefine: true,
}
```

`refineStudioPrompt` 会进入：

```ts
if (!shouldRefineWithLLM(input)) return promptRefineFallback(input, previous)
```

`promptRefineFallback` 会优先使用：

```ts
input.effectivePrompt?.trim() || input.refinedPrompt?.trim()
```

所以模板任务可以通过 `effectivePrompt/refinedPrompt` 保证最终提示词直达生成工具，不需要新增 opencode 接口。

## 13. `canSubmit` 校验

文件：

`packages/app/octoapp/pages/studio-page.tsx`

当前图片生成发送校验依赖：

```ts
prompt().trim().length > 0
```

选中模板后，需要把 prompt 规则和参考图规则一起纳入校验。

### 13.1 用户输入文本

模板用户输入来自：

- 风格模板：普通 `prompt`
- 配方模板：`recipeMainPrompt + recipeExtraPrompt`

需要新增：

```ts
const templateUserPromptText = createMemo(() => {
  const template = selectedStyleTemplate()
  if (template?.template_type === "preset_recipe") {
    return `${recipeMainPrompt()}${recipeExtraPrompt()}`
  }
  return prompt()
})
```

### 13.2 模板禁用原因

建议新增：

```ts
function selectedTemplateSubmitDisabledReason() {
  const template = selectedStyleTemplate()
  if (!template) return ""

  if (
    template.prompt_setting === "required" &&
    templateUserPromptText().trim().length === 0
  ) {
    return "请输入提示词"
  }

  if (
    template.reference_image_setting === "fixed" &&
    assets().length !== template.reference_image_count
  ) {
    return `请上传 ${template.reference_image_count} 张参考图`
  }

  if (
    template.reference_image_setting === "not_supported" &&
    assets().length > 0
  ) {
    return "该风格模版不支持上传参考图"
  }

  return ""
}
```

### 13.3 `canSubmit` 接入

未选择模板时保持现有逻辑。

选择模板时，图片生成分支改为：

```ts
const canSubmit = createMemo(() => {
  const template = selectedStyleTemplate()
  if (!template) {
    return /* 现有 canSubmit 逻辑 */
  }

  return SUPPORTED_STUDIO_CAPABILITIES.has(capability()) &&
    !isActionBusy() &&
    capability() === "image.generate" &&
    (canUseSeedream() || !styleModelRequiresSeedreamPermission(styleModel())) &&
    !selectedTemplateSubmitDisabledReason()
})
```

注意：

- `prompt_setting=optional` 时允许 `templateUserPromptText` 为空。
- `prompt_setting=not_supported` 时也允许 `templateUserPromptText` 为空，因为输入区本身不可编辑。
- `reference_image_setting=fixed` 必须严格等于 `reference_image_count`，不能按“至少”处理。
- `reference_image_setting=optional` 不参与发送禁用，只限制最大上传数。
- 发送时也要使用模板专用逻辑，而不是直接 `runGeneration()`。

## 14. `handleSubmit` 分流

文件：

`packages/app/octoapp/pages/studio-page.tsx`

在普通 `void runGeneration()` 之前增加：

```ts
const template = selectedStyleTemplate()
if (capability() === "image.generate" && template) {
  runStyleTemplateGeneration(template)
  return
}
```

新增：

```ts
function runStyleTemplateGeneration(template: StudioStyleTemplateListItem) {
  const reason = selectedTemplateSubmitDisabledReason()
  if (reason) {
    showFloatingNotice("info", reason)
    return
  }

  const targetModel = canUseSeedream() ? "seedream-5-lite" : "qwen"
  if (template.template_type === "extract_style") {
    const userPrompt = template.prompt_setting === "not_supported" ? "" : prompt().trim()
    const finalPrompt = `${userPrompt}${JSON.stringify(template.style_description)}`
    const displayPrompt = userPrompt || template.title
    const templatePrompt = {
      ...template.style_description,
      custom: userPrompt,
    }
    void runGeneration({
      prompt: displayPrompt,
      displayPrompt,
      refinedPrompt: finalPrompt,
      effectivePrompt: finalPrompt,
      styleModel: targetModel,
      extra: {
        skipPromptRefine: true,
        template: {
          id: template.idx,
          prompt: templatePrompt,
        },
      },
    })
    return
  }

  const recipe = splitPlayDescription(template.play_description)
  const mainPrompt = template.prompt_setting === "not_supported" ? "" : recipeMainPrompt().trim()
  const extraPrompt = template.prompt_setting === "not_supported" ? "" : recipeExtraPrompt().trim()
  const finalPrompt = `${recipe.prefix}${mainPrompt}${recipe.suffix}${extraPrompt}`
  const displayPrompt = [mainPrompt, extraPrompt].filter(Boolean).join("，") || template.title
  const templatePrompt = {
    custom: `${mainPrompt}${extraPrompt}`,
    extraPrompt,
    mainPrompt,
  }
  void runGeneration({
    prompt: displayPrompt,
    displayPrompt,
    refinedPrompt: finalPrompt,
    effectivePrompt: finalPrompt,
    styleModel: targetModel,
    extra: {
      skipPromptRefine: true,
      template: {
        id: template.idx,
        prompt: templatePrompt,
      },
    },
  })
}
```

注意：

- `runGeneration` 当前参数类型没有显式声明 `prompt`，但函数内部使用 `overrides?.prompt`，实现时需要检查/补齐 `StudioGenerationOverrides` 类型。
- `displayPrompt` 建议传入，避免会话里展示最终拼接后的完整模板 prompt。
- 模板发送前必须调用 `selectedTemplateSubmitDisabledReason()` 做二次校验，防止快捷键或状态异步绕过按钮禁用。
- `reference_image_setting=fixed` 的二次校验必须使用 `assets().length !== reference_image_count`，不能使用小于判断。
- `extra.template` 是后端最终写入供应商接口 `args.template` 的来源，不再使用旧的 `extra.styleTemplate` 轻量元信息。
- 使用模板发送成功后，是否清除模板需求未明确；建议先不清除，保持“模板应用中”状态，方便连续生成。

## 15. 样式实现

文件：

`packages/app/octoapp/pages/studio/studio-08.css`

### 15.1 模板应用中按钮

建议新增类：

- `.studio-composer-template-applied`
- `.studio-composer-template-applied-label`
- `.studio-composer-template-applied-icon`
- `.studio-composer-template-applied-clear`

目标样式：

```css
.studio-composer-template-applied {
  box-sizing: border-box;
  width: 120px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: rgba(44, 46, 52, 0.05);
  color: #191919;
  font-size: 12px;
  line-height: 20px;
}
```

图标：

- 画笔：`16px × 16px`，内部图形约 `10px × 10px`。
- 关闭：`16px × 16px`，内部图形约 `10px × 10px`。

资源策略：

- 优先复用现有 public/studio 图标。
- 如果没有匹配图标，新增：
  - `packages/app/public/studio/studio_template_brush.svg`
  - `packages/app/public/studio/studio_template_close.svg`

### 15.2 配方输入区

建议新增类：

- `.studio-composer-recipe-input`
- `.studio-composer-recipe-slot`
- `.studio-composer-recipe-extra`

目标样式：

```css
.studio-composer-recipe-input {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.studio-composer-recipe-slot {
  box-sizing: border-box;
  width: 172px;
  height: 24px;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: #f3f3f3;
  color: #191919;
  font-size: 12px;
  line-height: 20px;
}

.studio-composer-recipe-extra {
  min-width: 108px;
  height: 24px;
  border: 0;
  background: transparent;
  color: #191919;
  font-size: 12px;
  line-height: 20px;
}
```

注意：

- 两个输入都要 `outline: none`。
- placeholder 使用 `#858587` 或现有 Studio 输入 placeholder 色。
- 宽度不足时要允许整体输入区收缩，不能撑坏发送按钮区域。

### 15.3 禁用输入区

建议新增类：

- `.studio-composer-template-prompt-disabled`

目标样式：

```css
.studio-composer-template-prompt-disabled {
  min-height: 24px;
  display: flex;
  align-items: center;
  color: #858587;
  font-size: 12px;
  line-height: 20px;
  user-select: none;
}
```

用于 `prompt_setting=not_supported` 时展示：

```text
此图片模板不支持输入提示词
```

### 15.4 参考图禁用态

建议复用现有 `.studio-composer-ref-btn`，新增禁用态：

```css
.studio-composer-ref-btn.disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
```

如果禁用态下仍需响应点击提示，不要设置 `pointer-events: none`，否则点击无法触发 notice。

## 16. 涉及修改文件清单

### 16.1 前端

1. `packages/app/octoapp/pages/studio/studio-style-template-menu.tsx`
   - 新增 `onSelectTemplate` props。
   - 卡片改为可点击。
   - 点击后回传完整模板 item。

2. `packages/app/octoapp/pages/studio/studio-composer.tsx`
   - 新增当前应用模板 props。
   - 新增配方模板输入 props。
   - 新增 `templatePromptSetting` / `templateReferenceSetting` props。
   - 新增 `onUnsupportedReferenceUpload` props。
   - 将 `StudioStyleTemplateMenu` 的选择事件透传给页面。
   - 未选择模板时显示原“风格模板”按钮。
   - 已选择模板时显示 Pixso `1081:499679` 的“模版应用中”按钮。
   - 选中配方模板时，把普通输入区切换为 Pixso `1081:510343` 的灰框输入 + 补充输入。
   - `prompt_setting=not_supported` 时显示禁用文案，不允许输入。
   - `reference_image_setting=not_supported` 时禁用参考图上传按钮，点击调用提示。
   - 拖拽图片时尊重 `reference_image_setting=not_supported`，不激活拖拽态。
   - 为配方输入补 Enter 发送处理。

3. `packages/app/octoapp/pages/studio-page.tsx`
   - 新增 `selectedStyleTemplate`。
   - 新增 `recipeMainPrompt`、`recipeExtraPrompt`。
   - 新增模板 prompt/reference 约束派生状态。
   - 新增 `effectiveMaxReferenceImages` 并传给 `StudioComposer`。
   - 新增 `applyStyleTemplate`。
   - 新增 `clearStyleTemplate`。
   - 新增 `selectedTemplateSubmitDisabledReason`。
   - 新增 `pickReferenceFile` / `showUnsupportedReferenceNotice` 等上传入口拦截。
   - 传 props 给两个 `StudioComposer` 调用点。
   - 修改 `canSubmit`，按 `prompt_setting` 和 `reference_image_setting` 联合校验。
   - 修改 `handleSubmit`，模板任务走 `runStyleTemplateGeneration`。
   - `runStyleTemplateGeneration` 发送前二次校验，尤其 `fixed` 参考图数量必须严格等于 `reference_image_count`。
   - 构造模板最终提示词并传 `skipPromptRefine: true`。
   - 应用模板后自动切换风格模型为 seedream/qwen。
   - 应用模板后按模板参考图规则裁剪或清空当前参考图。

4. `packages/app/octoapp/pages/studio/studio-08.css`
   - 新增模板应用中按钮样式。
   - 新增配方模板输入样式。
   - 新增输入不支持时的禁用文案样式。
   - 新增参考图上传按钮禁用态样式。
   - 新增卡片按钮化后的 reset/hover 样式。

5. `packages/app/public/studio`
   - 如无可复用图标，新增：
     - `studio_template_brush.svg`
     - `studio_template_close.svg`

### 16.2 后端

本次需要对内部生图请求体做最小后端补充。

1. `packages/opencode/src/tool/internel_image_generate.ts`
   - 新增从 `input.extra.template` 读取模板参数的工具函数。
   - 在文生图请求体 `buildTextToImageRequestBody` 的 `args` 中追加 `template`。
   - 只对 `input.extra.template` 做最小运行时校验：
     - `template` 是普通对象。
     - `template.id` 是字符串。
     - `template.prompt` 是普通对象。
   - 校验通过才写入 `args.template`，避免把非法结构传给供应商接口。

建议函数：

```ts
function styleTemplateArgs(input: ImageGenerateInput): JsonRecord | undefined {
  const template = input.extra?.template
  if (!template || typeof template !== "object" || Array.isArray(template)) return
  if (!("id" in template) || typeof template.id !== "string") return
  if (!("prompt" in template) || !template.prompt || typeof template.prompt !== "object" || Array.isArray(template.prompt)) return
  return {
    id: template.id,
    prompt: template.prompt as JsonRecord,
  }
}
```

在 `buildTextToImageRequestBody` 中：

```ts
const template = styleTemplateArgs(input)

return {
  user: { idx: context.userIdx },
  task_type: context.taskType,
  args: {
    ...
    prompt: buildPrompt(input),
    ...(template ? { template } : {}),
  },
}
```

2. `packages/opencode/src/studio/studio-service.ts`
   - 原则上无需理解模板结构。
   - 继续通过 `studioToolInput` 保留 `extra: request.extra`，让 `extra.template` 透传到 `internel_image_generate.ts`。

保留现有逻辑：

- 模板选择是前端状态。
- 最终提示词仍通过现有 `/studio/generations` 发送。
- `skipPromptRefine` 已存在，能绕过 LLM。
- `effectivePrompt/refinedPrompt` 已能控制最终进入生图工具的 prompt。
- 服务端只负责把结构化模板参数落入最终 `args.template`，不重新计算模板 prompt。

## 17. 验证计划

实现后运行：

```bash
cd packages/app
bun typecheck
```

如果涉及后端类型变更，再运行：

```bash
cd packages/opencode
bun typecheck
```

手动验证：

1. 打开 Studio。
2. 点击“风格模板”。
3. 点击一个风格模板卡片：
   - 浮窗关闭。
   - toolbar 按钮变为“模版应用中”。
   - 有 seedream 权限时模型切到 `Seedream 5.0 Lite`。
   - 无 seedream 权限时模型切到 `千问`。
4. 输入普通 prompt，点击发送：
   - 最终发送 prompt 为 `用户输入 + JSON.stringify(style_description)`。
   - request extra 带 `skipPromptRefine: true`。
   - request extra 带 `template: { id, prompt }`。
   - 最终供应商接口 `args.template.id` 等于模板 `idx`。
   - 最终供应商接口 `args.template.prompt` 包含 `style_description` 全部已有属性和 `custom`。
   - `args.template.prompt.custom` 等于用户实际输入。
   - 会话中展示用户输入，不展示 JSON。
5. 点击“模版应用中”按钮的关闭图标：
   - 当前模板被清除。
   - 按钮恢复“风格模板”。
6. 点击一个配方模板卡片：
   - 输入区切换为灰框输入 + 补充输入。
   - 灰框 placeholder 来自 `play_description` 的 `【】` 中间内容。
7. 配方模板输入后发送：
   - 最终 prompt 为 `【前字符串】 + 灰框输入 + 【后字符串】 + 后置补充输入`。
   - request extra 带 `template: { id, prompt }`。
   - 最终供应商接口 `args.template.id` 等于模板 `idx`。
   - 最终供应商接口 `args.template.prompt` 只有 `custom`、`extraPrompt`、`mainPrompt`。
   - `mainPrompt` 等于灰框内输入。
   - `extraPrompt` 等于灰框后面输入。
   - `custom` 等于 `mainPrompt + extraPrompt`。
   - 不经过 LLM。
8. 配方模板输入区按 Enter 能触发发送。
9. 清除配方模板后，输入区恢复普通 contenteditable。
10. 选择 `prompt_setting=required` 的模板：
    - 用户输入为空时发送按钮禁用。
    - 输入后发送按钮恢复可用。
11. 选择 `prompt_setting=optional` 的模板：
    - 用户输入为空也可以发送。
    - 会话展示使用模板标题兜底，不展示完整模板 JSON。
12. 选择 `prompt_setting=not_supported` 的模板：
    - 输入区显示“此图片模板不支持输入提示词”。
    - 用户无法编辑输入区。
    - 可以在满足参考图规则后发送。
13. 选择 `reference_image_setting=fixed`、`reference_image_count=2` 的模板：
    - 0 张 / 1 张参考图时发送按钮禁用。
    - 2 张参考图时发送按钮可用。
    - 最多只能上传 2 张。
    - 校验逻辑使用 `assets().length === 2`，不是 `>= 2`。
14. 选择 `reference_image_setting=optional`、`reference_image_count=2` 的模板：
    - 不上传参考图也可以发送。
    - 最多只能上传 2 张。
15. 选择 `reference_image_setting=not_supported` 的模板：
    - 应用模板时清空已有参考图。
    - 上传参考图按钮禁用态显示。
    - 点击上传按钮提示“该风格模版不支持上传参考图”。
    - 粘贴、拖拽图片不能绕过限制。

## 18. 暂不实现内容

- 不实现模板详情接口。
- 不实现模板卡片二次确认。
- 不实现模板应用历史。
- 不实现模板选择后的自动填充参考图。
- 不实现配方模板中的多个输入槽位；本次只处理第一个 `【` 对应闭合的完整匹配段，后续 `【】` 会保留在 `suffix` 中。
- 不实现配方模板输入区的 `@主体` 能力。
