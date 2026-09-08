# Studio 创建模板第二步发布模板实现方案

## 1. 文档状态

- 当前阶段：需求分析完成，尚未进入代码实现。
- 文档用途：记录 Studio“创建模板”流程第 2 步“发布模板”的 UI、状态、校验、组件边界和验收标准。
- 最后更新：2026-08-27。
- 关联前置：`packages/app/octoapp/pages/studio/docs/studio-template-creator-content-implementation-plan.md` 已覆盖第 1 步“制作模板”，并已进入实现阶段。本方案新建独立文档，不修改上一份文档。

## 2. 背景与目标

“创建模板”工作区目前按三步流程推进：

```text
创建模板
├── 1 制作模板
├── 2 发布模板
└── 3 添加示例
```

本阶段要规划第 2 步“发布模板”表单。用户从第 1 步点击“下一步”后进入该页面，页面顶部步骤条显示第 1 步已完成、第 2 步进行中、第 3 步未开始。

本方案只覆盖第 2 步前端表单和本地状态，不接后端发布接口，不实现第 3 步“添加示例”的实际内容。

## 3. 已确认的产品规则

### 3.1 通用布局

- 继续显示在 `studio-canvas-body` 内，由 `StudioTemplateCreator` 组件承载。
- 表单内容宽度沿用第 1 步，为 `640px`，在编辑区中水平居中显示。
- 底部固定操作栏显示两个按钮：
  - “上一步”：返回第 1 步“制作模板”。
  - “下一步”：进入第 3 步“添加示例”，本阶段可先只完成状态切换或预留 TODO。
- “下一步”根据第 2 步表单校验启用。
- 必填项标题右侧显示红色 `*`。

### 3.2 步骤条状态

第 2 步页面顶部步骤条沿用第 1 步结构，但需要支持不同步骤状态。

```text
1 制作模板：已完成，显示蓝色描边圆圈 + 对勾
2 发布模板：当前步骤，显示蓝色实心圆点 + 数字 2
3 添加示例：未开始，显示灰色描边圆圈 + 数字 3
```

建议把现有 `TemplateCreatorSteps` 改成可接收当前步骤的组件，而不是复制一份步骤条：

```ts
type TemplateCreatorStep = "make" | "publish" | "examples"

function TemplateCreatorSteps(props: {
  currentStep: TemplateCreatorStep
}): JSX.Element
```

步骤状态规则：

| currentStep | 制作模板 | 发布模板 | 添加示例 |
|---|---|---|---|
| `make` | active | pending | pending |
| `publish` | complete | active | pending |
| `examples` | complete | complete | active |

### 3.3 确认图片模板标题

字段：

| 项 | 规则 |
|---|---|
| label | 确认图片模板标题 |
| 必填 | 是 |
| 绑定字段 | 与第 1 步“图片模板标题”绑定同一个 `title` 状态 |
| 输入框样式 | 与第 1 步“图片模板标题”输入框完全一致 |

因为该字段绑定第 1 步同一个 `title`，第二步修改标题会同步影响第一步标题值。

注意：当前参考图中计数显示为 `6/20`，但第 1 步已明确标题输入提示和计数为 `0/10`。本方案以“同一字段”为准，标题最大长度、计数和校验继续沿用第 1 步 `10` 字规则；如果后续产品确认标题要改为 20 字，需要同步调整第 1 步和第 2 步，而不是只改第 2 步。

### 3.4 模板使用说明

字段：

| 项 | 规则 |
|---|---|
| label | 模板使用说明 |
| 必填 | 是 |
| 输入框类型 | 多行文本区域 |
| placeholder | 向其他用户介绍如何使用此模板 |

样式：

- 灰色输入背景。
- 圆角和输入框视觉沿用第 1 步 textarea 体系。
- 参考图中高度约 `180px`，建议设置稳定最小高度，避免内容区跳动。

### 3.5 提示词设置

字段：

| 项 | 规则 |
|---|---|
| label | 提示词设置 |
| 必填 | 是 |
| 默认值 | 必填提示词 |
| 控件 | 自定义下拉框 |

选项：

| 值 | 展示文案 |
|---|---|
| `required` | 必填提示词 |
| `optional` | 选填提示词 |
| `not_supported` | 不支持提示词 |

下拉框样式参考图 2：

- trigger 为灰底输入框样式，右侧下拉箭头。
- menu 宽度与 trigger 一致。
- menu 白底、圆角、阴影。
- 每一项高度稳定，左侧文本。
- 当前选中项使用浅灰背景。
- 点击选项后更新值并关闭 menu。
- 点击外部关闭 menu。

### 3.6 参考图设置

字段：

| 项 | 规则 |
|---|---|
| label | 参考图设置 |
| 必填 | 是 |
| 默认参考模式 | 固定参考图 |
| 默认张数 | 1 |

参考模式选项：

| 值 | 展示文案 |
|---|---|
| `fixed` | 固定参考图 |
| `optional` | 选填参考图 |
| `not_supported` | 不支持参考图 |

张数下拉选项：

| 值 | 展示文案 |
|---|---|
| `1` | 1 张 |
| `2` | 2 张 |
| `3` | 3 张 |

动态显示规则：

| 参考模式 | 右侧张数下拉 | 右侧说明文案 |
|---|---|---|
| 固定参考图 | 显示 | 固定张数 |
| 选填参考图 | 显示 | 最多上传数 |
| 不支持参考图 | 隐藏 | 不显示 |

交互规则：

- 参考模式默认为 `fixed`。
- 张数默认为 `1`。
- 当参考模式切换为 `not_supported` 时，隐藏右侧张数下拉；内部可以保留当前张数值，用户切回固定或选填时继续使用。
- 参考模式和张数都使用与“提示词设置”相同的自定义下拉框样式。
- 当右侧张数下拉隐藏时，左侧参考模式下拉保持原宽度，不强制拉伸成整行，除非后续设计确认。

### 3.7 权限设置

字段：

| 项 | 规则 |
|---|---|
| label | 权限设置 |
| 必填 | 是 |
| 子标题 | 可见范围 |
| 默认值 | 所有用户 |
| 控件 | 单选框 |

可见范围选项：

| 值 | 展示文案 |
|---|---|
| `all_users` | 所有用户 |
| `specified_users` | 仅指定用户 |

动态显示规则：

- 默认选中 `all_users`，不显示下方用户输入框。
- 选择 `specified_users` 时显示下方用户输入框。
- 切回 `all_users` 时隐藏用户输入框；建议保留已输入内容，避免误触丢失。

指定可见用户输入框：

| 项 | 规则 |
|---|---|
| label | 指定可见用户 |
| placeholder | 请输入8位工号或姓名全拼，以“，”号间隔 |
| 显示条件 | `visibility === "specified_users"` |

本阶段只做本地输入，不接用户搜索、校验接口或人员选择器。

## 4. 推荐组件边界

继续使用：

```text
packages/app/octoapp/pages/studio/studio-template-creator.tsx
packages/app/octoapp/pages/studio/studio-08.css
```

第 2 步建议在现有 `StudioTemplateCreator` 内扩展步骤状态，并新增若干小组件：

```text
StudioTemplateCreator
├── TemplateCreatorSteps(currentStep)
├── MakeTemplateForm
├── PublishTemplateForm
│   ├── TemplateCreatorTitleInput（复用第 1 步）
│   ├── TemplateCreatorTextarea（复用第 1 步）
│   ├── TemplateCreatorSelect
│   ├── ReferenceSettingFields
│   └── VisibilitySettingFields
└── TemplateCreatorFooter
```

建议新增通用自定义下拉组件：

```ts
type TemplateCreatorSelectOption<T extends string | number> = {
  value: T
  label: string
}

function TemplateCreatorSelect<T extends string | number>(props: {
  value: T
  options: TemplateCreatorSelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}): JSX.Element
```

该组件负责：

- trigger 展示。
- menu 开关。
- 当前项高亮。
- 外部点击关闭。
- 选择后关闭。

## 5. 状态设计

第 2 步状态仍建议放在 `StudioTemplateCreator` 内部，和第 1 步表单状态并列。

```ts
type TemplateCreatorStep = "make" | "publish" | "examples"
type PromptSetting = "required" | "optional" | "not_supported"
type ReferenceMode = "fixed" | "optional" | "not_supported"
type ReferenceCount = 1 | 2 | 3
type TemplateVisibility = "all_users" | "specified_users"
```

核心新增状态：

| 状态 | 初始值 | 说明 |
|---|---|---|
| `currentStep` | `"make"` | 当前创建模板步骤 |
| `usageDescription` | `""` | 模板使用说明 |
| `promptSetting` | `"required"` | 提示词设置 |
| `referenceMode` | `"fixed"` | 参考模式 |
| `referenceCount` | `1` | 固定张数或最多上传数 |
| `visibility` | `"all_users"` | 可见范围 |
| `specifiedUsers` | `""` | 指定可见用户输入 |

已有状态复用：

| 状态 | 第 2 步用途 |
|---|---|
| `title` | “确认图片模板标题”继续绑定同一值 |

## 6. 表单校验和按钮启用

第 2 步“下一步”启用条件建议如下：

当 `currentStep === "publish"`：

- `title` 满足第 1 步标题规则。
- `usageDescription.trim()` 非空。
- `promptSetting` 有值。
- `referenceMode` 有值。
- 若 `referenceMode !== "not_supported"`，`referenceCount` 必须为 `1`、`2` 或 `3`。
- `visibility` 有值。
- 若 `visibility === "specified_users"`，`specifiedUsers.trim()` 非空。

“上一步”始终可点击，点击后回到 `currentStep = "make"`，保留第 2 步已填写内容。

“下一步”点击后：

- 本阶段可以先切换到 `currentStep = "examples"` 并显示第 3 步空占位。
- 如果第 3 步尚不实现，也可以先保留 TODO，但步骤状态和按钮事件应避免无响应。

## 7. 样式方案

继续使用 Studio CSS 分片：

```text
packages/app/octoapp/pages/studio/studio-08.css
```

建议补充以下类名：

| 类名 | 用途 |
|---|---|
| `.studio-template-creator-select` | 下拉框根容器 |
| `.studio-template-creator-select-trigger` | 下拉触发器 |
| `.studio-template-creator-select-menu` | 下拉菜单 |
| `.studio-template-creator-select-option` | 下拉选项 |
| `.studio-template-creator-select-option.active` | 当前选中项 |
| `.studio-template-creator-reference-row` | 参考图设置两列布局 |
| `.studio-template-creator-setting-label` | 参考模式、固定张数、最多上传数等小标题 |
| `.studio-template-creator-radio-list` | 可见范围单选组 |
| `.studio-template-creator-radio` | 单选项 |
| `.studio-template-creator-user-input` | 指定用户输入框 |
| `.studio-template-creator-footer-actions` | 底部按钮组 |
| `.studio-template-creator-prev` | 上一步按钮 |

关键样式规则：

- 下拉 trigger 高度、背景、圆角与第 1 步标题输入框风格一致。
- 下拉 menu 宽度与 trigger 一致，圆角和阴影参考图 2。
- 参考图设置在 `640px` 表单宽度下使用两列布局，左侧“参考模式”、右侧“固定张数 / 最多上传数”。
- 当右侧张数隐藏时，不保留一个空的可见下拉框。
- 单选框使用圆形 radio，选中态蓝色。
- 指定用户输入框样式与标题输入框一致。
- 小屏下参考图设置可降为单列，避免横向挤压。

## 8. 实现步骤

1. 在 `StudioTemplateCreator` 中新增 `currentStep` 状态，并把第 1 步表单包成 `MakeTemplateForm`。
2. 改造 `TemplateCreatorSteps`，支持 `make`、`publish`、`examples` 三种当前步骤和 completed 状态。
3. 新增 `PublishTemplateForm`，接入复用的标题输入框、模板使用说明 textarea、提示词设置、参考图设置和权限设置。
4. 新增通用 `TemplateCreatorSelect`，实现图 2 风格下拉。
5. 实现参考模式动态规则：固定参考图显示“固定张数”，选填参考图显示“最多上传数”，不支持参考图隐藏张数下拉。
6. 实现可见范围动态规则：仅指定用户显示用户输入框，所有用户隐藏。
7. 改造底部 footer：第 1 步只显示“下一步”，第 2 步显示“上一步 + 下一步”。
8. 在 `studio-08.css` 中补齐第 2 步相关样式。
9. 运行 `bun typecheck`。
10. 本地打开 Studio 验证第 1 步到第 2 步的切换、下拉选项、动态显示和按钮启用规则。

## 9. 验收标准

- 从第 1 步点击“下一步”后进入第 2 步“发布模板”。
- 步骤条显示第 1 步完成、第 2 步进行中、第 3 步未开始。
- “确认图片模板标题”绑定第 1 步同一个标题字段，修改后两步值同步。
- “确认图片模板标题”输入框样式与第 1 步标题输入框一致。
- “模板使用说明”为必填，placeholder 为 `向其他用户介绍如何使用此模板`。
- “提示词设置”默认值为“必填提示词”，下拉选项为“必填提示词 / 选填提示词 / 不支持提示词”。
- “参考模式”默认值为“固定参考图”，张数默认 `1`。
- 参考模式为“固定参考图”时，右侧说明为“固定张数”，张数下拉显示 `1 / 2 / 3`。
- 参考模式为“选填参考图”时，右侧说明为“最多上传数”，张数下拉显示 `1 / 2 / 3`。
- 参考模式为“不支持参考图”时，右侧张数下拉隐藏。
- 下拉菜单样式符合图 2：白底、圆角、阴影、选中项浅灰高亮。
- 可见范围默认选中“所有用户”，不显示用户输入框。
- 选择“仅指定用户”后显示用户输入框，placeholder 为 `请输入8位工号或姓名全拼，以“，”号间隔`。
- 切回“所有用户”后隐藏用户输入框，并保留已输入内容。
- 第 2 步“上一步”返回第 1 步，且第 2 步已填写内容不丢失。
- 第 2 步“下一步”按校验规则启用和禁用。
- `bun typecheck` 通过。

## 10. 后续非本阶段内容

- 接入模板发布接口。
- 接入真实用户搜索、用户合法性校验或人员选择器。
- 实现第 3 步“添加示例”的完整表单。
- 实现草稿保存、离开确认和发布失败错误处理。
- 增加埋点和异常上报。
