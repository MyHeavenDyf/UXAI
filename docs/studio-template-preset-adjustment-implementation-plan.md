# Studio 风格模板临时预设调整实现方案

## 1. 背景

当前 Studio 已支持选择并使用风格模板/灵感配方模板。选择模板后，composer 工具栏会展示 `studio-composer-template-applied` 的“模版应用中”状态。

本次新增能力只针对已选择的「风格模板」：

- 只有 `template_type === "extract_style"` 的模板展示编辑图标。
- 点击编辑图标后，在 `studio-composer` 上方展示一个临时调整浮层。
- 浮层内可修改当前模板的风格描述内容。
- 修改仅影响当前选中模板后续发起生成任务时的提示词和 `args.template.prompt`。
- 修改不会更新远端模板内容，也不会进入真正的模板编辑保存流程。

## 2. Pixso 设计信息

参考 Pixso 节点：

`https://pixso.cn/app/design/27L8ZYe3wLXH3yaWPaAe8Q?item-id=1081:498828`

从 Pixso MCP 读取到的关键结构如下：

- 容器尺寸：`556px × 590px`
- 背景：白色
- 圆角：`8px`
- 阴影：弹窗阴影
- 内边距：左右约 `12px`，上下约 `16px`
- 布局：纵向布局，模块间距约 `24px`

顶部区域：

- 标题：`预设调整`
- 右侧关闭按钮
- 提示文案：`提醒：此处对提示词进行的修改不会影响原始图片模板提示词`

模板摘要区域：

- 左侧封面图：`64px × 64px`，圆角 `8px`
- 封面取值和模板列表一致：`example_images?.[0]?.url`
- 右侧上方展示模板标题：`title`
- 右侧下方展示模板使用说明：`usage_instructions`

风格描述区域：

- 每个字段一块。
- 字段标题在左侧。
- 右侧是“还原”按钮。
- 下方是多行输入框，高度约 `100px`。
- 当前字段内容和原模板字段内容一致时，“还原”按钮置灰。
- 当前字段内容被修改后，“还原”按钮高亮，可点击恢复原模板字段内容。

## 3. 功能规则

### 3.1 编辑图标展示规则

`studio-composer-template-applied-icon` 只在选择了风格模板时显示：

```ts
selectedStyleTemplate?.template_type === "extract_style"
```

选择灵感配方模板时：

- 不展示编辑图标。
- 仍保留“模版应用中”文案和取消应用按钮。

### 3.2 编辑图标点击规则

点击编辑图标时：

- 打开/关闭临时预设调整浮层。
- 需要阻止事件冒泡，避免触发 `studio-composer-template-applied` 原本的点击逻辑。
- 不打开模板列表 dropdown。

### 3.3 关闭规则

浮层支持以下关闭方式：

- 点击右上角关闭按钮。
- 再次点击编辑图标。
- 清空当前模板时自动关闭。
- 选择新模板时自动关闭。
- 切换到不支持模板的模型并触发清空模板时自动关闭。
- 新建对话时自动关闭。

### 3.4 临时修改规则

浮层中的修改只存储在前端本地状态中：

- 不调用模板保存接口。
- 不修改远端模板。
- 不更新模板列表缓存中的原模板数据。
- 不进入历史缓存记录。
- 只影响当前选中模板后续发送生成任务时使用的 `style_description`。

## 4. 风格描述字段顺序

展示顺序需要和创建模板页面保持一致：

1. `overview`：概述
2. `tonal`：明暗
3. `composition`：构图
4. `volume`：体积感
5. `surface`：表面质感
6. `color`：色彩
7. `linework`：线条
8. `shape_structure`：造型特征
9. `role_design`：角色形象
10. `lettering`：字体
11. `post_processing`：后期效果

展示字段建议按「原模板实际存在的 `style_description` 字段」过滤：

- `overview` 如果原模板存在则展示。
- 其他维度只有原模板 `style_description` 中存在对应 key 时才展示。
- 不额外展示原模板未保存的维度，避免用户误以为可以在此处新增模板维度。

## 5. 状态设计

### 5.1 新增状态

在 `packages/app/octoapp/pages/studio-page.tsx` 中新增本地状态：

```ts
const [styleTemplateEditorOpen, setStyleTemplateEditorOpen] = createSignal(false)
const [styleTemplateDescriptionDraft, setStyleTemplateDescriptionDraft] =
  createSignal<StudioTemplateStyleDescription | undefined>()
```

其中：

- `selectedStyleTemplate()` 是原模板数据。
- `styleTemplateDescriptionDraft()` 是当前临时调整后的风格描述。

### 5.2 初始化时机

选择风格模板时：

```ts
setStyleTemplateDescriptionDraft(template.style_description ?? {})
setStyleTemplateEditorOpen(false)
```

选择灵感配方模板时：

```ts
setStyleTemplateDescriptionDraft(undefined)
setStyleTemplateEditorOpen(false)
```

清空模板、新建对话、切换到非模板可用模型时：

```ts
setStyleTemplateDescriptionDraft(undefined)
setStyleTemplateEditorOpen(false)
```

### 5.3 字段修改

字段修改时只更新 draft：

```ts
setStyleTemplateDescriptionDraft((current) => ({
  ...(current ?? {}),
  [field]: value,
}))
```

单字段是否可还原：

```ts
const originalValue = selectedStyleTemplate()?.style_description?.[field] ?? ""
const currentValue = styleTemplateDescriptionDraft()?.[field] ?? ""
const changed = currentValue !== originalValue
```

点击还原：

```ts
setStyleTemplateDescriptionDraft((current) => ({
  ...(current ?? {}),
  [field]: selectedStyleTemplate()?.style_description?.[field] ?? "",
}))
```

## 6. 生成参数接入

### 6.1 最终提示词

当前风格模板生成逻辑在 `studio-page.tsx` 中通过以下函数生成最终提示词：

```ts
styleTemplateFinalPrompt(template, templateInput)
```

本次需要在发送前构造一个使用 draft 的有效模板：

```ts
const effectiveTemplate = template.template_type === "extract_style"
  ? {
      ...template,
      style_description: styleTemplateDescriptionDraft() ?? template.style_description,
    }
  : template
```

然后继续复用原函数：

```ts
const finalPrompt = styleTemplateFinalPrompt(effectiveTemplate, templateInput).trim()
```

这样风格模板的最终提示词仍保持：

```ts
用户输入 + JSON.stringify(style_description)
```

但其中的 `style_description` 来自本地临时调整后的内容。

### 6.2 `args.template.prompt`

当前生成任务参数中已经会追加：

```ts
extra: {
  skipPromptRefine: true,
  template: {
    id: template.idx,
    prompt: styleTemplatePromptPayload(template, templateInput),
  },
}
```

本次也需要把这里的 `template` 替换为 `effectiveTemplate`：

```ts
prompt: styleTemplatePromptPayload(effectiveTemplate, templateInput)
```

确保生成任务中记录的模板 prompt 和实际发送给生成接口的最终提示词一致。

## 7. 工具函数调整

建议在 `packages/app/octoapp/pages/studio/studio-style-template-utils.ts` 中补充统一字段配置：

```ts
export const STUDIO_STYLE_TEMPLATE_DESCRIPTION_FIELDS = [
  { id: "overview", label: "概述" },
  { id: "tonal", label: "明暗" },
  { id: "composition", label: "构图" },
  { id: "volume", label: "体积感" },
  { id: "surface", label: "表面质感" },
  { id: "color", label: "色彩" },
  { id: "linework", label: "线条" },
  { id: "shape_structure", label: "造型特征" },
  { id: "role_design", label: "角色形象" },
  { id: "lettering", label: "字体" },
  { id: "post_processing", label: "后期效果" },
]
```

创建模板页面 `studio-template-creator.tsx` 和 composer 预设调整面板都复用这份字段顺序和文案。

如果后续需要输入 placeholder，仍可以在创建模板页保留字段 placeholder 配置，或扩展上述配置。

## 8. 组件调整

### 8.1 `SelectedTemplateButton`

文件：

`packages/app/octoapp/pages/studio/studio-composer.tsx`

当前函数：

```tsx
function SelectedTemplateButton(props: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  onPointerDown?: () => void
  onClear?: () => void
})
```

建议扩展为：

```tsx
function SelectedTemplateButton(props: {
  active?: boolean
  disabled?: boolean
  editable?: boolean
  editorOpen?: boolean
  onClick: () => void
  onPointerDown?: () => void
  onEdit?: () => void
  onClear?: () => void
})
```

编辑图标渲染：

```tsx
<Show when={props.editable}>
  <button
    type="button"
    class="studio-composer-template-applied-icon"
    classList={{ active: props.editorOpen }}
    disabled={props.disabled}
    aria-label="调整模板预设"
    title="调整模板预设"
    onClick={(event) => {
      event.stopPropagation()
      props.onEdit?.()
    }}
  />
</Show>
```

注意当前 `.studio-composer-template-applied-icon` 是 `span`，本次建议改为 `button`，方便键盘可访问和点击禁用。

### 8.2 新增临时预设调整面板组件

文件：

`packages/app/octoapp/pages/studio/studio-composer.tsx`

可以新增局部组件：

```tsx
function StyleTemplatePresetEditor(props: {
  template: StudioStyleTemplateListItem
  value: StudioTemplateStyleDescription
  onChange: (field: keyof StudioTemplateStyleDescription, value: string) => void
  onRestore: (field: keyof StudioTemplateStyleDescription) => void
  onClose: () => void
})
```

渲染内容：

- 标题：`预设调整`
- 关闭按钮
- 提示文案
- 模板摘要：
  - `props.template.example_images?.[0]?.url`
  - `props.template.title`
  - `props.template.usage_instructions`
- 风格描述字段列表：
  - 使用 `STUDIO_STYLE_TEMPLATE_DESCRIPTION_FIELDS`
  - 根据 `props.template.style_description` 是否存在字段过滤
  - textarea value 使用 `props.value[field] ?? ""`
  - restore disabled 状态根据当前值和原模板值比较

## 9. 样式调整

文件：

`packages/app/octoapp/pages/studio/studio-08.css`

建议新增样式：

- `.studio-composer-template-preset-editor`
- `.studio-composer-template-preset-editor-header`
- `.studio-composer-template-preset-editor-title`
- `.studio-composer-template-preset-editor-close`
- `.studio-composer-template-preset-editor-tip`
- `.studio-composer-template-preset-editor-summary`
- `.studio-composer-template-preset-editor-cover`
- `.studio-composer-template-preset-editor-meta`
- `.studio-composer-template-preset-editor-name`
- `.studio-composer-template-preset-editor-usage`
- `.studio-composer-template-preset-editor-fields`
- `.studio-composer-template-preset-editor-field`
- `.studio-composer-template-preset-editor-field-head`
- `.studio-composer-template-preset-editor-field-label`
- `.studio-composer-template-preset-editor-restore`
- `.studio-composer-template-preset-editor-textarea`

主要样式建议：

```css
.studio-composer-template-preset-editor {
  width: 556px;
  max-height: 590px;
  padding: 16px 12px;
  border-radius: 8px;
  background: #fff;
  box-shadow: ...;
}
```

面板建议放在 composer 主体上方，并和 composer 居中对齐。若 composer 宽度不足，需要加：

```css
max-width: calc(100vw - 32px);
```

字段列表区域建议可滚动，避免描述字段较多时浮层超出视窗。

## 10. 与历史/重新编辑的关系

本次功能是“当前使用前的临时调整”，不是模板编辑保存。

对于已生成任务的“重新编辑”：

- 仍按已有逻辑通过模板 id 查询最新模板详情。
- 查询成功后恢复为使用模板的输入态。
- 查询接口返回的模板详情作为「原模板内容」，用于展示模板封面、标题、使用说明，以及作为还原按钮的比较基准。
- 如果历史生成任务使用的是风格模板，需要从生成任务参数 `args.template.prompt` 中恢复当时实际使用的风格描述内容，作为本次重新编辑的临时 draft。
- 还原按钮状态根据「当前 draft 字段值」和「查询接口返回的原模板字段值」比较：
  - 两者一致时，还原按钮置灰。
  - 两者不一致时，还原按钮高亮。
  - 点击还原后，将该字段恢复为查询接口返回的原模板字段值。
- 从历史任务恢复 draft 时，只回填当前查询到的模板 `style_description` 中仍存在的字段；如果模板后续被编辑导致某个字段已不存在，则该字段不再展示，也不参与本次重新编辑。
- 如果历史生成任务没有记录可恢复的风格描述字段，则 draft 初始化为查询接口返回的模板 `style_description`。

## 11. 涉及文件清单

### 必改

1. `packages/app/octoapp/pages/studio/studio-composer.tsx`

   - `SelectedTemplateButton` 增加 `editable/editorOpen/onEdit`。
   - 风格模板时显示编辑图标。
   - 点击编辑图标打开 composer 上方临时调整浮层。
   - 新增 `StyleTemplatePresetEditor` 组件。

2. `packages/app/octoapp/pages/studio-page.tsx`

   - 新增 `styleTemplateEditorOpen`。
   - 新增 `styleTemplateDescriptionDraft`。
   - 选择模板、清空模板、新建对话、模型切换清理时同步关闭/清空。
   - 发送风格模板生成任务时使用 draft 后的 `style_description`。

3. `packages/app/octoapp/pages/studio/studio-style-template-utils.ts`

   - 新增统一的风格描述字段顺序/文案配置。
   - 可选增加构造有效风格模板描述的 helper。

4. `packages/app/octoapp/pages/studio/studio-08.css`

   - 新增预设调整浮层样式。
   - 调整 `studio-composer-template-applied-icon` 从纯展示图标变成可点击 button 后的样式。

### 可改

5. `packages/app/octoapp/pages/studio/studio-template-creator.tsx`

   - 如果抽出了统一字段配置，可改为复用 `STUDIO_STYLE_TEMPLATE_DESCRIPTION_FIELDS`，避免字段顺序/文案重复。

## 12. 验收点

1. 选择风格模板后，“模版应用中”按钮展示编辑图标。
2. 选择灵感配方模板后，不展示编辑图标。
3. 点击风格模板编辑图标后，composer 上方展示预设调整浮层。
4. 浮层顶部展示标题、关闭按钮和“不影响原始图片模板提示词”的提醒。
5. 浮层模板摘要区封面取 `example_images[0].url`。
6. 浮层模板摘要区展示 `title` 和 `usage_instructions`。
7. 风格描述字段顺序和创建模板页面一致。
8. 未修改字段时“还原”置灰。
9. 修改字段后“还原”高亮。
10. 点击“还原”后恢复为原模板字段文案。
11. 修改后的风格描述会进入最终提示词。
12. 修改后的风格描述会进入 `args.template.prompt`。
13. 清空模板/新建对话/切换到不支持模板的模型时，浮层关闭且 draft 清空。
14. 不产生任何模板保存请求。
