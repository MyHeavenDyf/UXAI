# Studio 新增 Seedream 5.0 Pro 实现方案

> 编写日期：2026-11-11。
> 本文依据当前仓库实现整理。2026-11-11 已按本文完成编码；验证结果见第 14 节。未执行真实第三方生图请求。
> 文中的函数和代码片段描述主要实现方式；完整实现以对应源文件为准，不要将多个局部片段直接拼成完整文件。

## 1. 需求与实施口径

Studio 的「图片生成 → 风格模型」新增 `Seedream 5.0 Pro`，与现有 Lite 并列。

风格模型选择弹框中，**Pro 排在 Lite 前面**，显示顺序为 `Seedream 5.0 Pro → Seedream 5.0 Lite → 千问 → 其他现有模型`，其余模型保持原有顺序。

| 项目 | Seedream 5.0 Lite | Seedream 5.0 Pro |
| --- | --- | --- |
| 前端模型 ID | `seedream-5-lite` | `seedream-5-pro` |
| 展示名称 | `Seedream 5.0 Lite` | `Seedream 5.0 Pro` |
| 图标 | `/studio/studio_seedream.webp` | 复用 Lite 图标 |
| 权限 | Seedream 权限 | 共用 Lite 的 Seedream 权限 |
| 参考图数量 | 当前实现为最多 4 张 | 最多 4 张 |
| @ 引用 | 支持，受现有模式和模板条件限制 | 同 Lite |
| 单次生成数量 | 1～4 张 | 同 Lite |
| 自定义尺寸面积下限 | `2560 × 1440` | `1280 × 720` |
| 自定义尺寸面积上限 | `3072 × 3072 × 1.1025` | `2048 × 2048 × 1.1025` |
| 自定义宽高比 | `1:16 ～ 16:1` | 不变 |
| 第三方 `task_type` | `txt2img_jimeng` | `txt2img_jimeng_v2` |

### 1.1 尺寸范围的含义

按现有 Lite 的校验方式，将需求中的 `[1280×720, 2048×2048×1.1025]` 理解为**宽高乘积范围**，不是宽、高分别限定在两个数之间。

设宽为 `w`、高为 `h`，Pro 自定义尺寸必须满足：

```text
w、h 都是正整数
1280 × 720 ≤ w × h ≤ 2048 × 2048 × 1.1025
1 / 16 ≤ w / h ≤ 16
```

即最小面积 `921600`，最大面积 `4624220.16`。由于宽高为整数，整数面积上界可取 `Math.floor(2048 * 2048 * 1.1025)`，即 `4624220`。

Lite 保留当前 `Math.round(3072 * 3072 * 1.1025)` 的行为。

### 1.2 本方案采用的产品决策

1. Pro 和 Lite 共用 `view:jimeng_entry` 权限，不新增独立 Pro 权限码。
2. 七种预设比例保持不变；需求只修改自定义面积范围，本方案同时沿用 Lite 的七组预设像素尺寸。
3. 已选 Pro 时，应用模板、恢复模板草稿应保留 Pro；从其他模型进入模板时，仍沿用当前默认选择规则，不自动改为 Pro。
4. Lite/Pro 相互切换时，符合目标规则的自定义尺寸继续保留，不符合时退出自定义模式、回到当前预设比例；参考图、提示词和 @ 引用继续保留。
5. Pro 模型决定最终生图任务类型，旧 `extra.taskType` 不能覆盖为其他值。

## 2. 当前实现与请求链路

### 2.1 前端

```text
studio/data.ts
  STUDIO_STYLE_MODELS 注册模型、图标、权限标记
  styleModelId / styleModelLabel 识别 ID 与展示名称
  referenceImageLimit 返回参考图上限
       ↓
studio-composer.tsx
  模型菜单、@ 引用、工具栏尺寸显示、图片设置弹层
       ↓
studio-page.tsx
  模型切换、模板应用、权限回退、草稿恢复、生成与再生成
       ↓
createStudioGeneration
  styleModel + aspectRatio，或 extra.width / extra.height
```

### 2.2 后端

```text
POST /studio/generations
       ↓
studio-service.ts → createProviderTask
       ↓
internel_image_generate.ts → createInternalGeneration
  getStudioStyleModel
  getInternalStyleConfig
  getInternalTargetSize
  getTaskType
       ↓
buildTextToImageRequestBody
  task_type: context.taskType
  args.target_size: context.targetSize
       ↓
第三方 create_task
```

本方案针对 Studio 当前使用的 `internel` 生图链路。不要将该映射误加到独立的 `jimeng_image_generate.ts` provider；如果实际入口允许切换 provider，应验收 Pro 走的仍是内部接口链路。

### 2.3 不能只增加一个模型列表项的原因

当前存在多处对 `seedream-5-lite` 的直接判断：

- `data.ts`：参考图上限。
- `studio-shared.ts`：2K 预设尺寸映射。
- `studio-composer.tsx`：@ 引用入口、两处即梦尺寸分支。
- `studio-page.tsx`：切换模型时是否保留模板。
- `studio-style-template-utils.ts`：模板目标模型选择。
- `internel_image_generate.ts`：后端模型与任务类型映射。

只注册列表项，会导致 Pro 使用默认参考图数量、缺少 @ 引用，且后端未识别时会回落到千问配置。

## 3. 文件改动清单

以下路径均相对仓库根目录 `/Users/ucd/Documents/GitHub/UXAI`。

| 类型 | 文件 | 修改内容 |
| --- | --- | --- |
| 必改 | `packages/app/octoapp/pages/studio/data.ts` | 注册 Pro；新增 Seedream 家族判断；Pro 参考图上限为 4 |
| 必改 | `packages/app/octoapp/pages/studio/studio-shared.ts` | Pro 复用 2K 预设；集中管理面积规则、有效性和单边范围计算 |
| 必改 | `packages/app/octoapp/pages/studio/studio-composer.tsx` | Pro 的 @ 引用；工具栏与弹层统一读取尺寸规则；模型变化后刷新相关显示状态 |
| 必改 | `packages/app/octoapp/pages/studio-page.tsx` | 保留 Pro 兼容模板；切换时校验目标尺寸；提交自定义尺寸前复核 |
| 必改 | `packages/app/octoapp/pages/studio/studio-style-template-utils.ts` | 应用模板和模板草稿恢复时保留有权限的 Pro |
| 必改 | `packages/opencode/src/tool/internel_image_generate.ts` | Pro aliases、tagName、预设尺寸、任务类型；阻止 Pro taskType 被旧参数覆盖 |
| 测试 | `packages/app/octoapp/pages/studio/turns.test.ts` | 补充 Pro ID 和展示名称的尺寸映射用例 |
| 测试，新建 | `packages/app/octoapp/pages/studio/studio-model-rules.test.ts` | 模型识别、权限标记、参考图限制、尺寸边界和模板目标选择 |
| 测试 | `packages/app/octoapp/pages/studio/studio-recommendation-actions.test.tsx` | 真实组件的 Pro 排序、权限过滤、@ 引用、尺寸提交与失焦修正 |
| 测试 | `packages/opencode/test/tool/image-generate-inputs.test.ts` | Pro 配置、预设尺寸和 taskType 优先级 |

业务实现主要修改 6 个文件。测试文件数量可按现有组织方式调整，重点覆盖实际共享函数和请求行为。

## 4. `studio/data.ts`：模型注册与家族判断

### 4.1 在 Lite 前增加 Pro，保证弹框显示顺序

在 `STUDIO_STYLE_MODELS` 中将 Pro 插入现有 Lite 项之前，保持 Pro、Lite 相邻：

```ts
{
  id: "seedream-5-pro",
  label: "Seedream 5.0 Pro",
  icon: "/studio/studio_seedream.webp",
  requiresSeedreamPermission: true,
  color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)",
},
```

模型选择弹框当前通过 `STUDIO_STYLE_MODELS.filter(...)` 过滤权限后直接渲染，过滤会保留数组顺序，因此调整注册数组即可实现 Pro 在 Lite 前面的排序，无需增加排序函数或按名称排序。

数组开头的关键顺序应为：

```ts
export const STUDIO_STYLE_MODELS = [
  { id: "seedream-5-pro", label: "Seedream 5.0 Pro", icon: "/studio/studio_seedream.webp", requiresSeedreamPermission: true, color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)" },
  { id: "seedream-5-lite", label: "Seedream 5.0 Lite", icon: "/studio/studio_seedream.webp", requiresSeedreamPermission: true, color: "linear-gradient(135deg, #8b5cf6, #c4b5fd)" },
  // 千问及其他现有模型按原顺序保留。
]
```

该片段仅展示数组开头，实际修改时保留其余所有模型。显示排序不改变已保存的模型选择或模板默认模型；模板默认选择仍按第 8 节执行。

现有 `styleModelId()` 和 `styleModelLabel()` 会通过模型表自动识别新增的 ID、展示名称，不需要再写一套名称映射。

### 4.2 新增家族判断

家族能力与权限标记分开表达：`isSeedreamStyleModel()` 用于 @ 引用、模板等能力判断；`styleModelRequiresSeedreamPermission()` 继续用于权限判断。

```ts
export function isSeedreamStyleModel(value?: string) {
  const id = styleModelId(value)
  return id === "seedream-5-lite" || id === "seedream-5-pro"
}
```

不要用 `includes("seedream")` 识别模型，避免未知名称被当作已支持模型。

### 4.3 更新参考图上限

替换当前 `referenceImageLimit()`：

```ts
export function referenceImageLimit(styleModel: string) {
  if (isSeedreamStyleModel(styleModel)) return 4
  if (styleModelId(styleModel) === "qwen") return 3
  return 1
}
```

上传、粘贴、模型切换后的裁剪、历史参考图恢复，已经复用此函数或其计算结果，继续保持同一个来源。

注意：旧的多参考图方案文档曾写 Seedream 为 3 张；本次以当前代码实际的 4 张为准。

4 张是模型在普通图片生成模式下的上限。AI 推荐模式当前另有 `assets().length <= 3` 的提交条件，并禁用 @ 引用；本次沿用这些模式级限制，不因新增 Pro 放宽。

## 5. `studio-shared.ts`：集中尺寸规则

### 5.1 Pro 映射到 2K 预设

从 `./data` 增加 `isSeedreamStyleModel` 导入，调整现有方法：

```ts
export function getModelResolutionKey(styleModel: string): string {
  const id = styleModelId(styleModel) ?? styleModel
  if (id === "hdesign") return "hdesign"
  if (isSeedreamStyleModel(styleModel)) return "2k"
  if (id.includes("2k")) return "2k"
  if (id.includes("3k")) return "3k"
  if (id.includes("4k")) return "4k"
  return "default"
}
```

`STUDIO_SIZE_MAP`、`getDefaultDimensions()` 的反向比例逻辑无需改动。

| 预设比例 | Lite 与 Pro 的目标尺寸 | 面积 |
| --- | --- | --- |
| 1:1 | 2048 × 2048 | 4194304 |
| 2:3 | 1664 × 2496 | 4153344 |
| 3:4 | 1728 × 2304 | 3981312 |
| 9:16 | 1600 × 2848 | 4556800 |
| 3:2 | 2496 × 1664 | 4153344 |
| 4:3 | 2304 × 1728 | 3981312 |
| 16:9 | 2848 × 1600 | 4556800 |

七组尺寸全部满足 Pro 面积范围。沿用已有像素值，不因本次新增模型重新取整或改变预设比例算法。

### 5.2 新增统一面积规则方法

规则返回 `undefined` 表示继续采用普通模型的逐边限制。保留现有包含 2K/3K/4K 名称的历史模型分支，避免恢复老数据时行为改变。

```ts
export function getStudioImageAreaLimits(styleModel: string) {
  if (styleModelId(styleModel) === "seedream-5-pro") {
    return {
      min: 1280 * 720,
      max: Math.floor(2048 * 2048 * 1.1025),
      label: "1280×720, 2048×2048×1.1025",
    }
  }
  const key = getModelResolutionKey(styleModel)
  if (key === "default" || key === "hdesign" || styleModelId(styleModel) === "qwen") return
  return {
    min: 2560 * 1440,
    max: Math.round(3072 * 3072 * 1.1025),
    label: "2560×1440, 3072×3072×1.1025",
  }
}
```

Pro 分支必须放在通用 2K 规则之前，因为 Pro 本身也映射到 `2k`。

### 5.3 新增完整尺寸校验

工具栏、弹层、模型切换、最终提交复用同一校验函数。它校验已经填写完整的尺寸，不负责处理输入中的空值状态。

```ts
export function isStudioCustomSizeValid(styleModel: string, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false
  if (width <= 0 || height <= 0) return false
  const limits = getStudioImageAreaLimits(styleModel)
  if (limits) {
    return width * height >= limits.min &&
      width * height <= limits.max &&
      width / height >= 1 / 16 &&
      width / height <= 16
  }
  const max = styleModelId(styleModel) === "qwen" ? 1664 : 2500
  return width >= 250 && width <= max && height >= 250 && height <= max
}
```

`isSafeInteger()` 同时拒绝 `NaN`、无穷值、小数等非法输入；这不会要求预设尺寸必须是 64 的倍数。当前自定义尺寸也没有这样的限制，不要额外增加。

### 5.4 新增单边联动范围计算

当一边为 `dim` 时，另一边需要同时满足面积与宽高比：

```ts
export function getStudioImageDimensionRange(styleModel: string, dim: number) {
  const limits = getStudioImageAreaLimits(styleModel)
  if (!limits || !Number.isSafeInteger(dim) || dim <= 0) return
  return {
    min: Math.max(Math.ceil(limits.min / dim), Math.ceil(dim / 16)),
    max: Math.min(Math.floor(limits.max / dim), Math.floor(dim * 16)),
  }
}
```

该范围可能出现 `min > max`，表示这一边无论搭配什么整数尺寸都无法满足规则；保留现有失焦逻辑对这一状态的处理。

## 6. `studio-composer.tsx`：@ 引用及尺寸交互

### 6.1 更新 import

从 `./data` 导入 `isSeedreamStyleModel`；从 `./studio-shared` 导入：

```ts
getStudioImageAreaLimits,
getStudioImageDimensionRange,
isStudioCustomSizeValid,
```

两处旧即梦判断替换后，如果 `getModelResolutionKey` 在本文件没有其他调用，应删除该未使用导入。

### 6.2 @ 引用入口覆盖 Pro

替换原来只识别 Lite 的 memo：

```ts
const isSeedreamModel = createMemo(() => isSeedreamStyleModel(props.styleModel))
```

`showMentionEntry`、`mentionUnavailableReason`、`canInsertMention` 保留现有条件，因此 Pro 同样受以下限制：

- 仅图片生成显示 @ 引用入口。
- AI 推荐模式不支持 @ 引用。
- 模板禁止提示词或禁止参考图时，沿用现有不可用提示。

### 6.3 工具栏显示复用校验

当前 `imageSettingsLabel` 内写死 Lite 面积上下限。将自定义尺寸部分改为统一校验：

```ts
if (isCustom) {
  const label = `${customW}×${customH}`
  const valid = isStudioCustomSizeValid(props.styleModel, customW, customH)
  if (valid) setLastValidCustomLabel(label)
  ratio = valid ? label : (lastValidCustomLabel() || aspectRatio)
}
```

保留现有的 `committedCustomW/H` 锁定机制，弹层打开期间工具栏仍展示已提交值，避免输入时闪烁。

模型变化时应清空 `lastValidCustomLabel`，避免 Lite 的有效尺寸标签残留到 Pro。可以在现有响应式逻辑中增加对模型的监听；如果使用 Solid 的 `on()`，需补充相应 import：

```ts
createEffect(on(() => props.styleModel, () => setLastValidCustomLabel("")))
```

这段代码放在 `lastValidCustomLabel` 声明之后。清空后，工具栏会根据当前已提交尺寸重新判断和显示。

### 6.4 图片设置弹层改为动态规则

当前图片设置组件内存在以下固定常量和方法：

```ts
const JIMENG_AREA_MIN = 2560 * 1440
const JIMENG_AREA_MAX = Math.round(3072 * 3072 * 1.1025)
```

改为基于 `props.styleModel` 的动态访问器：

```ts
const areaLimits = () => getStudioImageAreaLimits(props.styleModel)
const isJimeng = () => areaLimits() !== undefined
const jimengDimRange = (dim: number) => getStudioImageDimensionRange(props.styleModel, dim) ?? { min: 1, max: 0 }
```

`jimengDimRange()` 仅在 `isJimeng()` 成立且 `dim > 0` 的分支调用；超出安全整数范围时返回不可行区间，避免读取空范围导致异常。普通模型继续使用当前逐边尺寸限制。

不要在组件初始化时写 `const limits = getStudioImageAreaLimits(props.styleModel)` 并长期复用；模型改变时需要重新读取规则。

逐项替换如下：

| 现有位置 | 修改方式 |
| --- | --- |
| 关闭弹层的 `onCleanup` | 完整尺寸用 `isStudioCustomSizeValid()` 判断，不合法时关闭自定义模式 |
| `computeJimengDimMin/Max` | 沿用整数可行性搜索，读取当前 `areaLimits().min/max` |
| `JIMENG_DIM_MIN/MAX` | 改为动态访问器或 memo，避免仅在初始化计算一次 |
| `jimengDimRange` | 复用共享单边范围函数 |
| `sizeWarnText` | 根据当前规则的 `label` 生成提示 |
| `needsWarn` | 保留未填完的状态分支，填写完整后复用共享校验 |
| `handleSizeBlur` | 保留现有修正策略，单边范围改为动态规则 |
| `clampJimengSize` | 若保留此函数，同步改为当前规则，不能残留 Lite 常量 |

当前 `clampJimengSize()` 未见实际调用；本次不需要为新增 Pro 改动交互并启用它。若决定删除未使用函数，应与功能改动分开评估。

完整尺寸错误提示：

```ts
const limits = areaLimits()
if (limits) return `支持宽高乘积在 [${limits.label}]，宽高比 1:16 ~ 16:1`
```

该片段放在现有「填写完整且不合法」分支；不要让合法尺寸也显示错误。

完整尺寸校验分支示例：

```ts
if (isJimeng()) {
  // 这里保留原有的只填写一个输入框、或两个输入框均为空的判断。
  return !isStudioCustomSizeValid(props.styleModel, w, h)
}
```

### 6.5 保持单边范围的整数可行性算法

原算法不仅取平方根，还会验证能否搭配另一条整数边。这部分应保留，替换规则来源即可：

```ts
function computeJimengDimMin() {
  const limits = areaLimits()!
  for (let dim = Math.ceil(Math.sqrt(limits.min / 16)); ; dim++) {
    const range = jimengDimRange(dim)
    if (range.min <= range.max) return dim
  }
}

function computeJimengDimMax() {
  const limits = areaLimits()!
  for (let dim = Math.floor(Math.sqrt(limits.max * 16)); ; dim--) {
    const range = jimengDimRange(dim)
    if (range.min <= range.max) return dim
  }
}

const jimengDimMin = createMemo(() => isJimeng() ? computeJimengDimMin() : 0)
const jimengDimMax = createMemo(() => isJimeng() ? computeJimengDimMax() : 0)
```

将所有原 `JIMENG_DIM_MIN/MAX` 访问替换成 `jimengDimMin()/jimengDimMax()`。上述循环延续现有可行性搜索，仅用于整数边界，不用于遍历业务集合。

## 7. `studio-page.tsx`：模型切换与提交复核

### 7.1 增加依赖

从 data 导入 `isSeedreamStyleModel`，从 shared 导入 `isStudioCustomSizeValid`。

### 7.2 切换到 Pro 时保留兼容模板

在 `selectStyleModel()` 中，将只放行 Lite、千问的判断改为支持整个 Seedream 家族：

```ts
const shouldClearStyleTemplate = Boolean(
  currentTemplate &&
    !options?.preserveStyleTemplate &&
    value !== styleModel() &&
    !isSeedreamStyleModel(value) &&
    nextStyleModelID !== "qwen",
)
```

继续沿用现有模板对参考图是否支持、参考图数量、提示词是否支持等限制。Pro 的 4 张上限不应覆盖模板自身更小的上限。

### 7.3 补充 Lite/Pro 间的尺寸处理

现有逻辑只比较模型是否需要 Seedream 权限。同属 Seedream 时不会清空自定义尺寸，新增 Pro 后会产生以下问题：

- Lite 的 `3072×3072` 自定义尺寸会被带到 Pro，超过 Pro 上限。
- Pro 的 `1280×720` 自定义尺寸会被带到 Lite，低于 Lite 下限。

在原「Seedream 与其他模型切换清空尺寸」分支后、普通模型尺寸钳位分支前，增加 Seedream 家族内判断：

```ts
const resetCustomSize = prevIsSeedream !== nextIsSeedream || (
  isCustomStore() &&
  isSeedreamStyleModel(styleModel()) &&
  isSeedreamStyleModel(value) &&
  !isStudioCustomSizeValid(value, customWidth(), customHeight())
)
if (resetCustomSize) {
  setIsCustomStore(false)
  setCustomWidth(0)
  setCustomHeight(0)
}
if (
  !resetCustomSize &&
  isCustomStore() &&
  styleModelId(styleModel()) !== "qwen" &&
  nextStyleModelID === "qwen"
) {
  setCustomWidth(Math.min(customWidth(), 1664))
  setCustomHeight(Math.min(customHeight(), 1664))
}
```

以上整体替换现有尺寸处理分支，保留普通模型切换至千问时的 1664px 钳位逻辑。这里使用独立条件，不在 `selectStyleModel()` 中提前 `return`，以免跳过后续模板和参考图处理。

不要因为 Lite/Pro 切换而触发 Seedream 与普通模型切换时的 @ 引用清理；两者都能承接同一组参考图和引用。

### 7.4 提交自定义尺寸前复核

弹层关闭时的校验不能覆盖所有恢复路径。`runGeneration()` 支持 overrides，历史任务和再生成可能直接恢复自定义宽高。

在得到 `nextStyleModel`、`nextWidth`、`nextHeight`、`nextIsCustom` 后，且尚未修改输入状态、创建会话或创建任务前，增加：

```ts
if (
  nextCapability === "image.generate" &&
  nextIsCustom &&
  !isStudioCustomSizeValid(nextStyleModel, nextWidth, nextHeight)
) {
  showFloatingNotice("info", "当前自定义尺寸不符合所选模型要求，请调整后重试。")
  return
}
```

仅对自定义尺寸执行此检查，七组预设仍按既有流程映射。不要在这里静默修改用户恢复的尺寸并直接提交。

### 7.5 权限相关调用保持复用

以下现有逻辑通过 `styleModelRequiresSeedreamPermission()` 识别模型，在 Pro 注册权限标记后会自动覆盖：

- 首次读取缓存设置时的模型清理。
- 权限加载中或无权限时回退千问。
- `canSubmit` 等生成入口状态判断。
- 历史结果的权限限制。
- 恢复草稿的 Seedream 权限判断。
- 当前模型下的再生成权限判断。

应逐项验收，避免改成 Lite/Pro 两套独立权限状态。

## 8. `studio-style-template-utils.ts`：模板目标模型

更新 data import，新增 `isSeedreamStyleModel`，然后调整：

```ts
export function styleTemplateTargetModel(canUseSeedream: boolean, currentStyleModel?: string) {
  const current = styleModelId(currentStyleModel)
  if (current && isSeedreamStyleModel(current)) return canUseSeedream ? current : "qwen"
  if (current === "qwen") return current
  return canUseSeedream ? "seedream-5-lite" : "qwen"
}
```

目标行为：

| 当前模型 | 有 Seedream 权限 | 无 Seedream 权限 |
| --- | --- | --- |
| Lite | 保留 Lite | 千问 |
| Pro | 保留 Pro | 千问 |
| 千问 | 保留千问 | 保留千问 |
| 其他或未指定 | 默认 Lite | 千问 |

该函数已经用于应用模板、模板草稿恢复、模板生成参数选择；修改一个入口即可复用，避免生成时又把 Pro 强制改回 Lite。

## 9. `internel_image_generate.ts`：第三方模型映射

### 9.1 提取共用预设尺寸

将 Lite 当前 `targetSizes` 字面量提取到模型配置数组之前：

```ts
const seedreamTargetSizes = {
  "1:1": { width: 2048, height: 2048 },
  "2:3": { width: 1664, height: 2496 },
  "3:4": { width: 1728, height: 2304 },
  "9:16": { width: 1600, height: 2848 },
  "3:2": { width: 2496, height: 1664 },
  "4:3": { width: 2304, height: 1728 },
  "16:9": { width: 2848, height: 1600 },
}
```

Lite 的 `targetSizes` 改为引用它，保持原任务类型和其他配置。

### 9.2 注册 Pro aliases 与配置

在 Lite 配置之后插入：

```ts
{
  aliases: ["Seedream 5.0 Pro", "seedream-5-pro"],
  config: {
    ...defaultInternalStyleConfig,
    taskType: "txt2img_jimeng_v2",
    tagName: "Seedream 5.0 Pro",
    targetSize: { width: 2048, height: 2048 },
    targetSizes: seedreamTargetSizes,
  },
},
```

显式设置 Pro 的无比例默认尺寸为 `2048×2048`，与前端 `1:1` 默认一致。Lite 无比例时当前继承的默认行为不在本次顺带调整范围内。

`getInternalStyleConfig()` 已支持 trim 和不区分大小写的 aliases 查找，Pro 不需要额外增加解析分支。

`target`、`loras`、`mode` 沿用 Lite 同样继承的默认值：

```text
target = flux1-dev
loras = []
mode = performance
```

这些是沿用当前请求结构的实现选择；第三方具体执行哪个模型由本次要求的 `task_type` 区分。

### 9.3 防止 `extra.taskType` 覆盖 Pro

当前 `createInternalGeneration()` 优先使用 `input.extra.taskType`。仅新增配置不能保证最终请求一定为 Pro。

建议扩展现有 `getTaskType()`，将 Pro 的优先级固化在可测试的真实实现中：

```ts
export function getTaskType(input: {
  generationMode: InternalTaskType
  taskType?: string
  styleModel?: string
}) {
  const config = input.styleModel ? getInternalStyleConfig(input.styleModel) : undefined
  if (config?.taskType === "txt2img_jimeng_v2") return config.taskType
  const txt2img = env("IMAGE_TXT2IMG_TASK_TYPE") ?? "txt2img_qwen"
  return input.taskType ?? txt2img
}
```

在 `createInternalGeneration()` 的现有调用中传入已经解析的 `styleModel`：

```ts
const taskType = getTaskType({
  generationMode,
  styleModel,
  taskType: input.extra && typeof input.extra.taskType === "string"
    ? input.extra.taskType
    : styleConfig.taskType,
})
```

优先级结果：

```text
Pro → 固定 txt2img_jimeng_v2
其他模型 → 保持 extra.taskType > 模型配置 > 环境默认值 的既有顺序
```

这样也能处理历史任务携带旧 `taskType`、模型从提示词工具参数解析出来等情况。

`buildTextToImageRequestBody()` 已使用 `task_type: context.taskType`，不需要在那里再次重复判断模型。编辑和视频能力有各自请求构造器，本次不要把它们的 `task_type` 改为生图类型。

### 9.4 最终第三方请求示例

Pro、预设 `3:4`、生成 1 张、无参考图时，请求中的关键字段应为：

```json
{
  "user": { "idx": "<当前用户>" },
  "task_type": "txt2img_jimeng_v2",
  "args": {
    "tag_name": "Seedream 5.0 Pro",
    "num_image": 1,
    "target": "flux1-dev",
    "target_size": { "width": 1728, "height": 2304 },
    "loras": [],
    "mode": "performance",
    "ref_img_list": [],
    "customer_prompt": "<原始提示词>",
    "prompt": "<既有逻辑构造的完整提示词>"
  }
}
```

自定义 `1280×720` 时，`args.target_size` 改为对应宽高；带参考图时仍复用现有 `ref_img_list` 转换。模板场景继续携带现有 `args.template`。

## 10. 权限、接口、存储与兼容性

### 10.1 共用现有权限查询

`checkStudioPermission()` 当前发送：

```ts
checkPermList: ["view:keling_entry", "view:jimeng_entry", "octoai:image_template"]
```

`studio-permission-store.ts` 将返回数组的第二项保存为 `seedream`。Pro 使用相同权限标记，因此本方案不增加权限字段、数组项或接口。

模型菜单通过 `requiresSeedreamPermission` 过滤，新增 Pro 后自动与 Lite 一起显示或隐藏。

当前生成链路未见再次调用 Seedream 权限查询进行模型授权校验；本方案沿用 Lite 当前机制。不要将此次新增模型描述为已经增加后端强制授权。

### 10.2 无需修改接口 schema 和 SDK

当前 `styleModel` 是可选字符串，`extra` 可以携带自定义宽高，已有接口足以表达 Pro：

```json
{
  "capability": "image.generate",
  "styleModel": "seedream-5-pro",
  "count": 1,
  "extra": { "width": 1280, "height": 720 }
}
```

以上只列相关字段，实际请求仍需原有的会话、提示词等必要字段。

以下文件应核对但本方案无需修改：

- `packages/opencode/src/server/routes/instance/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/studio.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/studio.ts`
- `packages/opencode/src/studio/image-provider.ts`
- `packages/opencode/src/studio/studio-service.ts`
- `packages/app/octoapp/pages/studio/types.ts`

不变更公开 schema，无需重新生成 JS SDK。如果实际落地另行修改了 schema，则需要同时保持 Hono/Effect HttpApi 行为一致，并按仓库要求运行 `./packages/sdk/js/script/build.ts`。

### 10.3 历史和草稿兼容

历史与草稿已保存字符串 `styleModel`，无需数据库迁移。新增注册项后，`seedream-5-pro` 和 `Seedream 5.0 Pro` 都应能正确还原名称、预设尺寸、参考图上限。

供应商任务的 `model` 可能是 `txt2img_jimeng_v2`，展示和模型恢复继续优先使用保存的 `styleModel`；不要将任务类型当成风格模型 ID。

`studio-history-service.ts`、`studio-history.sql.ts` 等文件无需新增 Pro 专用字段。

### 10.4 自定义尺寸校验的范围

本文的集中校验覆盖 Studio 页面及其历史恢复、再生成入口。当前内部 provider 仍直接读取 `extra.width/height`；仅前端改动不等于所有直接 API 调用均受同样限制。

如果后续明确要求服务端也强制校验尺寸，可在 `createInternalGeneration()` 解析目标尺寸后补充后端规则与错误返回；这属于额外的服务端约束，不应通过跨包导入前端 `studio-shared.ts` 实现，也不在本次默认的 6 文件业务改动内。

## 11. 测试实现建议

### 11.1 新建 `studio-model-rules.test.ts`

直接导入真实实现，不在测试中重新实现模型识别和面积判断。

关键用例示例：

```ts
import { describe, expect, test } from "bun:test"
import {
  isSeedreamStyleModel,
  referenceImageLimit,
  styleModelId,
  styleModelRequiresSeedreamPermission,
} from "./data"
import { isStudioCustomSizeValid } from "./studio-shared"
import { styleTemplateTargetModel } from "./studio-style-template-utils"

describe("Seedream Pro model rules", () => {
  test("recognizes Pro IDs and persisted labels", () => {
    expect(styleModelId("Seedream 5.0 Pro")).toBe("seedream-5-pro")
    expect(isSeedreamStyleModel("seedream-5-pro")).toBe(true)
    expect(styleModelRequiresSeedreamPermission("Seedream 5.0 Pro")).toBe(true)
    expect(referenceImageLimit("seedream-5-pro")).toBe(4)
    expect(referenceImageLimit("Seedream 5.0 Pro")).toBe(4)
    expect(referenceImageLimit("seedream-5-lite")).toBe(4)
    expect(referenceImageLimit("qwen")).toBe(3)
    expect(referenceImageLimit("bd-icon")).toBe(1)
  })

  test("uses Pro area limits while preserving Lite limits", () => {
    expect(isStudioCustomSizeValid("seedream-5-pro", 1280, 720)).toBe(true)
    expect(isStudioCustomSizeValid("seedream-5-pro", 1279, 720)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-pro", 2150, 2150)).toBe(true)
    expect(isStudioCustomSizeValid("seedream-5-pro", 2151, 2151)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-lite", 1280, 720)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-lite", 3072, 3072)).toBe(true)
    expect(isStudioCustomSizeValid("seedream-5-pro", 3072, 3072)).toBe(false)
  })

  test("keeps ratio limits and rejects invalid numbers", () => {
    expect(isStudioCustomSizeValid("seedream-5-pro", 3840, 240)).toBe(true)
    expect(isStudioCustomSizeValid("seedream-5-pro", 240, 3840)).toBe(true)
    expect(isStudioCustomSizeValid("seedream-5-pro", 4000, 240)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-pro", 240, 4000)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-pro", 1280.5, 720)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-pro", NaN, 720)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-pro", 1280, 0)).toBe(false)
  })

  test("preserves Pro for templates only with permission", () => {
    expect(styleTemplateTargetModel(true, "seedream-5-pro")).toBe("seedream-5-pro")
    expect(styleTemplateTargetModel(true, "Seedream 5.0 Pro")).toBe("seedream-5-pro")
    expect(styleTemplateTargetModel(false, "seedream-5-pro")).toBe("qwen")
    expect(styleTemplateTargetModel(true, "bd-icon")).toBe("seedream-5-lite")
  })
})
```

另外应覆盖 `getStudioImageDimensionRange()` 的正常范围和不可行范围，验证弹层实际调用的共享范围计算。若新增组件交互测试，应使用现有 Solid/Happy DOM 测试方式验证真实输入、失焦、关闭行为。

### 11.2 扩展 `turns.test.ts`

在现有 `Studio model resolution mapping` describe 中补充：

```ts
test("recognizes Pro IDs and persisted display names", () => {
  expect(getModelResolutionKey("seedream-5-pro")).toBe("2k")
  expect(getModelResolutionKey("Seedream 5.0 Pro")).toBe("2k")
  expect(getDefaultDimensions("Seedream 5.0 Pro", "3:4"))
    .toEqual({ width: 1728, height: 2304 })
  expect(getDefaultDimensions("seedream-5-pro", "16:9"))
    .toEqual({ width: 2848, height: 1600 })
})
```

### 11.3 扩展后端 `image-generate-inputs.test.ts`

在现有模型映射表中增加 Pro，预期 `taskType` 为 `txt2img_jimeng_v2`。再补充真实 resolver 的优先级测试：

```ts
test("keeps Pro on its required task type", () => {
  expect(getTaskType({
    generationMode: "txt2img",
    styleModel: "seedream-5-pro",
    taskType: "txt2img_jimeng",
  })).toBe("txt2img_jimeng_v2")
  expect(getTaskType({
    generationMode: "txt2img",
    styleModel: "Seedream 5.0 Pro",
    taskType: "txt2img_qwen",
  })).toBe("txt2img_jimeng_v2")
})

test("preserves non-Pro task type overrides", () => {
  expect(getTaskType({
    generationMode: "txt2img",
    styleModel: "seedream-5-lite",
    taskType: "custom_task",
  })).toBe("custom_task")
})
```

Pro ID、展示名称、trim/大小写 aliases、七组预设、无比例默认尺寸都应有覆盖。优先在已有参数化模型测试中扩充，避免复制一套映射逻辑。

最终请求体仍需验证：resolver 单测只能证明任务类型选择，无法单独证明 `createInternalGeneration()` 正确传递了 `styleModel`。可复用现有本地接口测试设施捕获 `create_task` 请求，或在测试环境手工检查脱敏后的实际请求；不要仅检查配置表就结束验收。

### 11.4 测试与类型检查命令

从 `packages/app` 执行，显式指定 `octoapp` 下的测试；该包默认 `test:unit` 只包含 `./src`，不能依赖默认脚本自动发现本文涉及的测试。

```sh
bun test --conditions=browser --preload ./happydom.ts ./octoapp/pages/studio/studio-model-rules.test.ts ./octoapp/pages/studio/studio-recommendation-actions.test.tsx
bun test --preload ./happydom.ts ./octoapp/pages/studio/turns.test.ts
bun typecheck
```

从 `packages/opencode` 执行：

```sh
bun test --timeout 30000 ./test/tool/image-generate-inputs.test.ts
bun typecheck
```

不得从仓库根目录运行测试；类型检查使用包内 `bun typecheck`，不直接执行 `tsc`。

组件测试需要 `--conditions=browser`，否则 Solid 会解析到服务端导出，无法运行真实 DOM 组件。纯规则测试不依赖该选项，但可以与组件测试一起执行。

## 12. 手工验收清单

### 12.1 模型与权限

- [ ] 有权限时，风格模型选择弹框按 Pro、Lite、千问及其他现有模型的顺序展示，Pro 位于 Lite 前面，名称清晰，图标一致。
- [ ] 无权限时，Lite 和 Pro 都不出现在模型菜单。
- [ ] 缓存中保存 Pro、但当前无权限时，按现有规则回退千问。
- [ ] 权限请求失败、重试、退出登录、切换账号后，Pro 状态与 Lite 一致。
- [ ] 已有 Lite 用户不被自动切换为 Pro。

### 12.2 参数和交互

- [ ] Pro 可上传、粘贴最多 4 张参考图，第 5 张按现有机制限制。
- [ ] Lite 与 Pro 切换时保留 4 张参考图、提示词和 @ 引用。
- [ ] Pro 的 @ 引用受 AI 推荐模式、模板能力限制，与 Lite 一致。
- [ ] 切换千问或单参考图模型时，按既有规则裁剪参考图和处理引用。
- [ ] 七种预设比例、尺寸展示、1～4 张生成数量正常。

### 12.3 尺寸边界与状态同步

- [ ] `1280×720`：Pro 合法，Lite 不合法。
- [ ] `1279×720`：Pro 面积低于下限，提示非法。
- [ ] `2150×2150`：Pro 合法；`2151×2151`：Pro 超过上限。
- [ ] `3840×240` 和 `240×3840`：分别在 16:1、1:16 边界，Pro 合法。
- [ ] `4000×240` 和 `240×4000`：面积合法但比例超限，Pro 非法。
- [ ] 只输入一边时仍执行单边可行范围提示，空输入状态沿用原交互。
- [ ] 输入、600ms 防抖提示、失焦修正、关闭弹层和工具栏显示一致。
- [ ] Lite 自定义 `3072×3072` 切到 Pro：退出自定义模式，回到当前预设。
- [ ] Pro 自定义 `1280×720` 切到 Lite：退出自定义模式。
- [ ] 两者均合法的自定义尺寸在 Lite/Pro 切换时保留。
- [ ] 从历史或草稿恢复非法自定义尺寸时，提交前阻止并提示调整。
- [ ] 千问和其他风格模型的原有尺寸限制继续有效。

### 12.4 模板、历史与第三方请求

- [ ] Pro 下应用风格模板，仍保留 Pro；切换 Lite/Pro 不清空兼容模板。
- [ ] 模板禁止参考图、禁止提示词、限制参考图数量时，Pro 继续遵守。
- [ ] Pro 历史结果显示正确模型名称，重新编辑和再生成不回落到 Lite/千问。
- [ ] 普通生图、带参考图、模板生图的 Pro 请求均为 `task_type: txt2img_jimeng_v2`。
- [ ] 携带旧 `extra.taskType: txt2img_jimeng` 的 Pro 请求，最终仍为 `txt2img_jimeng_v2`。
- [ ] Lite 请求仍为 `txt2img_jimeng`，其他模型任务类型保持原行为。
- [ ] 图片编辑与视频请求仍使用各自任务类型。

实际第三方生图验收会创建任务，应在已有授权的测试账号和测试环境执行，并以脱敏请求体核验上述参数。

## 13. 推荐落地顺序

1. 更新 `data.ts` 注册和家族能力，补齐 Pro 识别。
2. 更新 `studio-shared.ts` 的预设和共享尺寸规则。
3. 更新 composer 中的 @ 引用、工具栏与弹层校验。
4. 更新页面模型切换、提交复核及模板目标选择。
5. 更新后端模型配置与 Pro 的任务类型优先级。
6. 增加上述重点测试，运行两个包的类型检查。
7. 使用现有运行中的环境完成 UI 与实际请求验收，不重启应用或服务器进程。

完成后，Pro 应在所有 Studio 图片生成入口中保留独立模型身份，同时继承 Lite 的家族能力和权限；尺寸与任务类型按 Pro 的独立规则生效。

## 14. 编码后的验证记录

- 前端模型规则与真实 composer 组件测试：34 项通过，0 失败。
- 后端参数与本地 HTTP 请求链路测试：22 项通过，0 失败。覆盖 Pro 自定义尺寸、4 张参考图、模板请求、旧 taskType 覆盖，以及 Lite 和抠图任务类型不变。
- `packages/app` 与 `packages/opencode` 的 `bun typecheck` 均通过。
- `turns.test.ts`：28 项通过、32 项失败；新增的 Pro 尺寸映射用例均通过。将修改前 HEAD 的相关模块与测试提取到临时目录后复核，32 个失败名称完全一致，属于已有历史消息解析测试问题。
- HTTP 测试只访问测试进程启动的 `127.0.0.1` 服务；未向真实第三方接口创建生图任务。

本节记录自动化验证范围；第 12 节涉及登录账号和真实供应商环境的手工验收项仍作为后续环境验收清单。

## 15. Review 修复：尺寸校验失败后保留扩写重试入口

跨会话时，风格模型使用全局设置，而推荐图片尺寸按会话保存。例如会话 A 保存 Pro 的 `1280×720`，会话 B 将全局模型切为 Lite，返回 A 后尺寸不符合 Lite 规则。原调用顺序先 `choose()` 消耗扩写选择，再由 `runGeneration()` 拒绝非法尺寸，会使该条扩写没有创建任务却失去重试按钮。

修复涉及：

- `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.ts`：新增 `generateExpansion()`，集中构造生成参数，先检查文本、参考图数量和自定义尺寸，全部通过后才调用 `review.choose()` 并提交生成。失败时只提示，保持 `pending`、编辑内容及捕获版本不变。
- `packages/app/octoapp/pages/studio-page.tsx`：扩写按钮改为调用该入口；保留 `runGeneration()` 的最终尺寸校验，继续覆盖普通生成、历史恢复等其他入口。
- `packages/app/octoapp/pages/studio/studio-prompt-expansion-review.test.ts`：增加 Pro→Lite、Lite→Pro 两个方向与 confirmed/ignored 两种选择的跨会话回归用例，验证无效时不提交、不消耗选择，调整到合法尺寸后可成功提交且只提交一次。
- `packages/app/octoapp/pages/studio/studio-prompt-expansion-review-view.test.tsx`：真实组件测试复用相同入口，验证尺寸失败后保留编辑框和两个按钮，改为兼容模型后可重试成功。

验证命令，从 `packages/app` 执行：

```sh
bun test --conditions=browser --preload ./happydom.ts ./octoapp/pages/studio/studio-prompt-expansion-review.test.ts ./octoapp/pages/studio/studio-prompt-expansion-review-view.test.tsx ./octoapp/pages/studio/studio-recommendation-settings.test.ts
bun typecheck
```

修复后的相关测试 42 项通过，0 失败；`bun typecheck` 通过。本次修复不涉及后端参数或真实第三方请求。
