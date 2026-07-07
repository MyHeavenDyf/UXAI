# Studio 多参考图上传实现方案

## 背景

Studio 图片生成当前已经用 `StudioAsset[]` 保存参考图，但上传和展示链路都按单图处理：

- 上传入口 `studio-composer-ref-btn` 点击后触发隐藏 file input。
- `addAssets()` 只读取第一张图片，并通过 `setAssets([asset])` 替换现有参考图。
- `StudioComposer` 只读取 `props.assets[0]` 展示一张参考图。
- 提交时 `referenceImages` 已经使用 `assets().map((item) => item.dataUrl)`，请求层天然支持多张参考图。

本次需求是：

1. Seedream 和千问模型最多上传 3 张参考图，其他模型仍最多 1 张。
2. 上传交互仍由 `studio-composer-ref-btn` 触发。
3. 上传 1 张及以上后，默认仍在原位置显示 1 张参考图，其余参考图与首图同中心堆叠，通过轻微旋转角度露出多图层次。
4. hover 已上传参考图时，从左到右展开参考图，最后一位显示上传按钮。
5. 展开状态下，未满最大上传数时显示上传按钮，满了则不显示。
6. 光标移出参考图展开区域后收起。

## 改动文件

### `packages/app/octoapp/pages/studio/data.ts`

新增参考图数量规则方法：

```ts
export function referenceImageLimit(styleModel: string) {
  return styleModel === "seedream-5-lite" || styleModel === "qwen" ? 3 : 1
}
```

原因：

- 模型规则属于 Studio 模型配置范畴，放在 `data.ts` 和 `styleModelLabel()`、`styleModelRequiresSeedreamPermission()` 同层更容易复用。
- `studio-page.tsx` 和 `studio-composer.tsx` 都可以通过同一个方法得到最大上传数，避免 UI 与上传逻辑不一致。

### `packages/app/octoapp/pages/studio/studio-page.tsx`

#### 1. 引入 `referenceImageLimit`

在现有 Studio data imports 中加入：

```ts
referenceImageLimit,
```

#### 2. 新增当前参考图上限 memo/function

在 `styleModel()` 定义附近新增：

```ts
const maxReferenceImages = () => referenceImageLimit(styleModel())
```

用途：

- 上传时决定接收数量。
- 模型切换后裁剪参考图。
- 传给 `StudioComposer` 控制展开区是否显示上传按钮。

#### 3. 调整图片上传 input

当前隐藏 input：

```tsx
<input ref={fileInputRef!} type="file" accept=".png,.jpg,.jpeg,.webp" class="hidden" onChange={handleFileChange} />
```

改为支持多选：

```tsx
<input ref={fileInputRef!} type="file" accept=".png,.jpg,.jpeg,.webp" multiple class="hidden" onChange={handleFileChange} />
```

说明：

- input 可以始终 `multiple`，真正的数量限制由 `addAssets()` 控制。
- 单图模型下即使用户选择多张，也只保留 1 张。

#### 4. 重写 `addAssets(files: File[])`

当前逻辑：

- `files.find(...)` 取第一张。
- 校验格式、大小、尺寸。
- 成功后 `setAssets([asset])`。

目标逻辑：

1. 过滤图片文件。
2. 根据当前模型计算上限。
3. 单图模型：只处理第一张有效图片，成功后替换现有参考图。
4. 多图模型：从用户选择的图片中按顺序校验，最多补齐到 3 张，成功后追加到现有参考图。
5. 每张图片复用现有扩展名、大小、尺寸校验。
6. 第一张成功图片仍触发 `autoSetAspectRatioFromDimensions()`，维持当前“参考图自动设置比例”的体验。

建议实现结构：

```ts
function addAssets(files: File[]) {
  const imageFiles = files.filter((item) => item.type.startsWith("image/"))
  if (!imageFiles.length) return

  const limit = maxReferenceImages()
  const selectedFiles = limit === 1
    ? imageFiles.slice(0, 1)
    : imageFiles.slice(0, Math.max(limit - assets().length, 0))

  if (!selectedFiles.length) {
    showToast({
      title: "上传失败",
      description: `最多上传 ${limit} 张参考图。`,
    })
    return
  }

  // 继续执行格式、大小、尺寸校验和 readStudioAsset。
}
```

为了避免嵌套过深，可以拆出两个小 helper：

```ts
function validateReferenceImageFile(file: File) {
  // 复用现有 jimeng/ext/maxSize 校验。
  // 成功返回 undefined，失败时 showToast 并返回 false。
}
```

```ts
function validateReferenceImageDimensions(asset: StudioAsset) {
  // 返回 Promise<{ asset: StudioAsset; width: number; height: number }>
  // 内部 new Image() 读取 naturalWidth/naturalHeight。
}
```

但如果希望保持 AGENTS 风格“Keep things in one function unless reusable”，也可以把逻辑留在 `addAssets()` 内，只用 `Promise.all` 处理多个文件。推荐平衡做法：

- `addAssets()` 保持主流程。
- 尺寸读取抽成 `readStudioAssetDimensions(asset)`，因为它能显著减少回调嵌套。

推荐新增方法：

```ts
function readStudioAssetDimensions(asset: StudioAsset) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error("无法读取图片尺寸。"))
    img.src = asset.dataUrl
  })
}
```

`addAssets()` 成功后更新：

```ts
setAssets((items) => limit === 1 ? [nextAssets[0]] : [...items, ...nextAssets].slice(0, limit))
autoSetAspectRatioFromDimensions(firstDimensions.width, firstDimensions.height)
```

#### 5. 粘贴图片复用同一上限

`handlePasteReferenceImage(files)` 当前图片生成会调用：

```ts
addAssets(files.filter((file) => file.type.startsWith("image/")))
```

保留即可，因为 `addAssets()` 已统一处理数量限制。

#### 6. 模型切换时裁剪参考图

当用户从 seedream/千问切换到其他模型时，需要保留第一张并移除后续参考图。

建议新增包装方法：

```ts
function selectStyleModel(value: string) {
  setStyleModel(value)
  setAssets((items) => items.slice(0, referenceImageLimit(value)))
}
```

然后把两处 `StudioComposer` props：

```tsx
onStyleModel={setStyleModel}
```

改为：

```tsx
onStyleModel={selectStyleModel}
```

这样只有用户主动选择模型时裁剪，不需要额外 effect。

另外，已有权限修正逻辑会把无权限的 seedream 切回 qwen：

```ts
if (canUseSeedream() || !styleModelRequiresSeedreamPermission(styleModel())) return
setStyleModel("qwen")
```

这里 qwen 仍支持 3 张，不需要裁剪；如果以后默认模型变为单图模型，需同步改为 `selectStyleModel()` 或手动裁剪。

#### 7. 传递最大参考图数量给 Composer

给 `StudioComposer` 增加 prop：

```ts
maxReferenceImages: number
```

两处调用都传：

```tsx
maxReferenceImages={maxReferenceImages()}
```

### `packages/app/octoapp/pages/studio/studio-composer.tsx`

#### 1. 扩展 props

新增：

```ts
maxReferenceImages: number
```

#### 2. 替换单图 memo

当前：

```ts
const referenceAsset = createMemo(() => props.assets[0])
```

调整为：

```ts
const referenceAssets = createMemo(() => props.assets.slice(0, props.maxReferenceImages))
const referenceAsset = createMemo(() => referenceAssets()[0])
const canAddReferenceAsset = createMemo(() => referenceAssets().length < props.maxReferenceImages)
```

#### 3. 新增展开状态

使用 Solid signal 控制 hover 展开：

```ts
const [referenceExpanded, setReferenceExpanded] = createSignal(false)
```

展开触发：

- `onPointerEnter={() => setReferenceExpanded(true)}`
- `onPointerLeave={() => setReferenceExpanded(false)}`

用 signal 而不是纯 CSS 的好处：

- 更容易控制上传按钮是否出现。
- 删除按钮、展开 class、aria 状态可保持一致。
- 后续如果要加键盘 focus 展开也容易扩展。

#### 4. 新增参考图旋转角度方法

在 `StudioComposer` 内新增局部方法：

```ts
function referenceAssetRotation(index: number) {
  return [-7.8, 4.1, -3.6][index] ?? 0
}
```

说明：

- 第一张参考图逆时针 `7.8deg`。
- 第二张参考图顺时针 `4.1deg`。
- 第三张参考图再给一个较小的逆时针角度，例如 `-3.6deg`。
- 这个方法只负责 UI 展示，不改变图片数据、不影响提交。
- 上传按钮不使用旋转角度，保持标准加号按钮，便于识别。

#### 5. 重构参考图 JSX

当前结构只渲染一个按钮和一个删除按钮。改为分两种状态：

未上传：

```tsx
<button
  type="button"
  onClick={props.onPickFile}
  disabled={isBusy()}
  class="studio-composer-ref-btn"
  title="上传参考图"
/>
```

已上传：

```tsx
<div
  class="studio-composer-ref-stack"
  classList={{ expanded: referenceExpanded() }}
  onPointerEnter={() => setReferenceExpanded(true)}
  onPointerLeave={() => setReferenceExpanded(false)}
>
  <For each={referenceAssets()}>
    {(asset, index) => (
      <div
        class="studio-composer-ref-item"
        style={{
          "--ref-index": String(index()),
          "--ref-rotate": `${referenceAssetRotation(index())}deg`,
        }}
      >
        <button
          type="button"
          onClick={props.onPickFile}
          disabled={isBusy()}
          class="studio-composer-ref-btn"
          title="上传参考图"
        >
          <img src={asset.dataUrl} alt={asset.name} class="studio-composer-ref-image" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            props.onRemoveAsset(asset.id)
          }}
          disabled={isBusy()}
          class="studio-composer-ref-remove"
          aria-label="删除参考图"
          title="删除参考图"
        >
          ×
        </button>
      </div>
    )}
  </For>
  <Show when={canAddReferenceAsset()}>
    <button
      type="button"
      onClick={props.onPickFile}
      disabled={isBusy()}
      class="studio-composer-ref-btn studio-composer-ref-add"
      title="继续上传参考图"
    />
  </Show>
</div>
```

注意点：

- 常态下所有图片在同一个中心点堆叠，通过不同旋转角度露出多图层次，不再向下偏移。
- 展开后所有图改为横向布局，但保留各自旋转角度。
- 每张图都有自己的删除按钮。
- 上传按钮只有未满上限时出现。
- 图上的点击仍触发 `props.onPickFile()`，满足“点击参考图按钮触发上传”的原交互。

可以保留外层：

```tsx
<div class="studio-composer-ref-slot" classList={{ filled: Boolean(referenceAsset()) }}>
```

并把展开内容放在里面，减少对输入行布局的影响。

### `packages/app/octoapp/pages/studio/studio-01.css`

#### 1. 保持 slot 固定占位

现有：

```css
.studio-composer-ref-slot {
  position: relative;
  width: 52px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

保留固定宽高，避免展开时挤压输入框。

#### 2. 新增 stack 容器

```css
.studio-composer-ref-stack {
  position: absolute;
  left: 0;
  top: 0;
  width: 52px;
  height: 64px;
  z-index: 5;
}

.studio-composer-ref-stack.expanded {
  width: auto;
  min-width: 52px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding-right: 2px;
  z-index: 20;
}
```

#### 3. 新增旋转堆叠项

```css
.studio-composer-ref-item {
  position: absolute;
  left: 0;
  top: 0;
  width: 52px;
  height: 64px;
  z-index: calc(10 - var(--ref-index));
  transform: rotate(var(--ref-rotate));
  transform-origin: center center;
  transition: transform 160ms ease;
}

.studio-composer-ref-stack.expanded .studio-composer-ref-item {
  position: relative;
  top: 0;
  flex: 0 0 52px;
  z-index: auto;
  transform: rotate(var(--ref-rotate));
}
```

说明：

- 默认第 1、2、3 张在同一位置堆叠，不做 `top` 或 `left` 偏移。
- 通过 `--ref-rotate` 给每张图不同角度：第一张逆时针、第二张顺时针、第三张再轻微逆时针。
- 展开后恢复正常文档流，从左到右排列，但仍保留各自的旋转角度。
- 如果旋转导致图边缘被容器裁掉，需要确保 `.studio-composer-ref-slot` 和 `.studio-composer-ref-stack` 不设置 `overflow: hidden`。图片按钮自身可以保留 `overflow: hidden`，只裁剪图片内容，不裁掉旋转后的卡片外轮廓。

#### 4. 调整 filled 状态按钮样式作用范围

当前：

```css
.studio-composer-ref-slot.filled .studio-composer-ref-btn {
  width: 52px;
  height: 64px;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid #f2f2f2;
}
```

保留，但需要确保上传加号按钮也有正确空态背景：

```css
.studio-composer-ref-add::before {
  content: "";
  width: 52px;
  height: 64px;
  background: url("/studio/IconAdd.svg") center / 52px 64px no-repeat;
}
```

如果 `.studio-composer-ref-slot.filled .studio-composer-ref-btn` 给上传按钮加了边框和 overflow，可接受；如果视觉不对，可以给 `.studio-composer-ref-add` 单独覆盖背景和边框。

#### 5. 删除按钮 hover 规则调整

当前：

```css
.studio-composer-ref-slot:hover .studio-composer-ref-remove,
.studio-composer-ref-remove:focus-visible {
  opacity: 1;
  transform: scale(1);
}
```

改为只在具体 item hover 时显示，避免展开后所有删除按钮同时出现：

```css
.studio-composer-ref-item:hover .studio-composer-ref-remove,
.studio-composer-ref-remove:focus-visible {
  opacity: 1;
  transform: scale(1);
}
```

也可以保留全部显示，但逐项显示更干净。

## 行为细节

### 上传规则

| 当前模型 | 最大参考图数量 | 上传多图行为 |
| --- | ---: | --- |
| `seedream-5-lite` | 3 | 追加到现有参考图，最多 3 张 |
| `qwen` | 3 | 追加到现有参考图，最多 3 张 |
| 其他模型 | 1 | 新上传图片替换现有参考图 |

### 满额行为

- 已有 3 张且模型支持 3 张时，展开区域不显示上传按钮。
- 已有 1 张且模型只支持 1 张时，展开区域不显示上传按钮。
- 如果用户从多图模型切到单图模型，立即裁剪为第一张，避免提交超过模型能力。

### 删除行为

- 删除任意参考图后，数组重新排列。
- 如果删除第一张，第二张变成新的默认展示图。
- 删除后若未满上限，hover 展开时最后一位重新显示上传按钮。

### 参考图展示角度

- 常态堆叠：所有参考图在同一位置叠放，不通过 `top` 或 `left` 偏移制造层次。
- 第一张参考图：`rotate(-7.8deg)`。
- 第二张参考图：`rotate(4.1deg)`。
- 第三张参考图：建议 `rotate(-3.6deg)`，角度保持轻微即可。
- 展开状态：图片从左到右排列，但保留各自旋转角度。
- 上传按钮不旋转，保持标准加号按钮。

### 自动比例

保持当前体验：

- 用户上传参考图后，根据第一张成功上传的图片自动设置比例。
- 批量上传多张时，只使用第一张成功图片的尺寸触发 `autoSetAspectRatioFromDimensions()`。

### 提交请求

提交逻辑无需大改：

```ts
assets().map((item) => item.dataUrl)
```

会自然生成多张 `referenceImages`。

只需确保上传和模型切换阶段已经把 `assets()` 限制在合法数量内。

## 验证清单

1. `qwen` 模型下点击 `studio-composer-ref-btn` 可选择多张图片。
2. `qwen` 模型下最多保留 3 张参考图。
3. `seedream-5-lite` 模型下最多保留 3 张参考图。
4. 其他模型下上传多张时只保留 1 张。
5. 已有 1 张时，常态只显示第一张。
6. 已有 2 或 3 张时，常态图片同中心堆叠，通过不同旋转角度露出层次，不向下偏移。
7. hover 参考图区域后横向展开，展开后各图片仍保持旋转角度。
8. 未满上限时，展开区域最后一位显示上传按钮。
9. 满上限时，展开区域不显示上传按钮。
10. 鼠标移出展开区域后自动收起。
11. 删除任意图片后 UI 顺序正确，上传按钮显示状态正确。
12. 从 `qwen` 或 `seedream-5-lite` 切换到其他模型后，只保留第一张参考图。
13. 提交时 `referenceImages.length` 与当前 UI 中参考图数量一致。
14. `bun typecheck` 在 `packages/app` 目录执行通过。

## 风险和注意事项

- 展开层不要参与 grid 宽度计算，否则会挤压 textarea。
- 删除按钮的 `event.stopPropagation()` 必须保留，避免删除时同时触发上传。
- `multiple` input 会让用户一次选多张，但格式、大小、尺寸错误需要逐张处理。建议遇到第一张错误时 toast 并跳过该文件，不影响其他有效文件；如果希望行为更严格，也可以任意一张失败就整批失败。
- 如果 `imageTool() === "jimeng"` 时仍走图片生成参考图上传，应继续沿用当前 `.png/.jpg/.jpeg` 和 15MB 规则，不因多图改动放宽。
- 如果后端某些非 qwen/seedream 的 style label 也映射到同一模型，需要同步扩展 `referenceImageLimit()` 的判断条件。
