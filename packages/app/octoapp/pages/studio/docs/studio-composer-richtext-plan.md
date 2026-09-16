# StudioComposer 输入框改造为富文本(contenteditable)方案

## 目标

把 `StudioComposer` 里的输入框从 `<textarea>` 改为 `contenteditable` 富文本区域,使点击 @ 菜单项时能在文字流中内联插入"16×16 缩略图 + `@名称`"chip,并支持连续插入多个。

**约束:现有业务逻辑与样式不改变。** 即:父组件(studio-page.tsx)的 `prompt` 字符串模型、`onPrompt`/`onKeyDown`/`onReversePrompt`/`onPasteImage` 等回调、提交逻辑、CSS 视觉样式均保持不变。chip 的文本内容就是 `@名称`,富文本的 `innerText` 与原 textarea 的 `value` 语义一致,父组件拿到的仍是含 `@名称` 的纯文本字符串。

## 涉及文件

| 文件 | 改动类型 |
| --- | --- |
| `packages/app/octoapp/pages/studio/studio-composer.tsx` | 结构/逻辑改动 |
| `packages/app/octoapp/pages/studio/studio-01.css` | 补充样式 |

> 父组件 `studio-page.tsx` **不改动**:`handleKeyDown`(Enter 提交)、`handleReversePrompt`(`setPrompt(zh)`)、素材标签追加(`props.onPrompt(props.prompt + "，" + tag)`)均保持原样。

---

## 一、studio-composer.tsx 改动清单

### 1. `inputRef` 类型(L76)

```diff
- let inputRef!: HTMLTextAreaElement
+ let inputRef!: HTMLDivElement
```

**原因**:`<textarea>` → `<div contenteditable>`,ref 类型随之改变。所有用到 `inputRef` 的地方需复核(见下)。

### 2. `resizeInput`(L112–116)——逻辑不变,复核通过

```ts
const resizeInput = () => {
  if (!inputRef) return
  inputRef.style.height = "auto"
  inputRef.style.height = `${Math.min(inputRef.scrollHeight, 180)}px`
}
```

`div` 同样有 `scrollHeight` / `style.height`,**无需改动**。前提:CSS 给该 div 加 `white-space: pre-wrap`(见 CSS 部分),否则文本不换行、`scrollHeight` 不准。

### 3. `insertPromptText` → 改为 `insertMention`(L117–128 整体替换)

当前 `insertPromptText` 用 textarea 专属 API(`selectionStart`/`selectionEnd`/`setSelectionRange`),div 不支持,整体替换为基于 `Selection`/`Range` 的 chip 插入:

```ts
const insertMention = (asset: StudioAsset) => {
  if (!inputRef) return
  inputRef.focus()
  const sel = window.getSelection()
  if (!sel) return
  // 取当前光标;若光标不在编辑区内,则定位到末尾
  let range: Range
  if (sel.rangeCount && inputRef.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0)
    range.deleteContents()
  } else {
    range = document.createRange()
    range.selectNodeContents(inputRef)
    range.collapse(false)
  }
  const name = asset.name.replace(/\.[^.]+$/, "")
  // chip:不可编辑的内联节点,文本内容为 "@名称"(流入 prompt 字符串)
  const chip = document.createElement("span")
  chip.className = "studio-composer-at-chip"
  chip.setAttribute("contenteditable", "false")
  chip.setAttribute("data-mention", name)
  const img = document.createElement("img")
  img.src = asset.dataUrl
  img.alt = asset.name
  chip.appendChild(img)
  const label = document.createElement("span")
  label.className = "studio-composer-at-chip-name"
  label.textContent = `@${name}`
  chip.appendChild(label)
  range.insertNode(chip)
  // 尾随一个空格文本节点,便于光标落在 chip 之后继续输入
  const space = document.createTextNode(" ")
  chip.after(space)
  range.setStartAfter(space)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  props.onPrompt(inputRef.innerText)  // 同步:chip 的 "@名称" 进入 prompt 字符串
  resizeInput()
}
```

**要点**:
- chip 的可见文本 = `@名称`,因此 `inputRef.innerText` 自然包含 `@名称`,与原"插入 `@名称 ` 纯文本"方案产出的字符串**语义一致**,父组件无感知。
- chip 设 `contenteditable=false`,作为整体不可拆分;`data-mention` 便于后续扩展(如解析为资产 id)。
- 尾随空格让光标可落在 chip 之后;空格会进入 `innerText`,与原方案 `@名称 ` 带尾空格一致。

### 4. @ 菜单项 `onClick`(L971–977 附近)

```diff
  onClick={() => {
-   insertPromptText(`@${asset.name.replace(/\.[^.]+$/, "")} `)
+   insertMention(asset)
    setAtMenuOpen(false)
  }}
```

### 5. 替换 `<textarea>` → `<div contenteditable>`(L688–706)

```diff
- <textarea
-   ref={inputRef}
-   value={props.prompt}
-   onInput={(event) => {
-     props.onPrompt(event.currentTarget.value)
-     resizeInput()
-   }}
-   onKeyDown={(event) => {
-     if (event.key === "Enter" && isImeComposing(event)) return
-     props.onKeyDown(event)
-   }}
-   onCompositionStart={() => setComposing(true)}
-   onCompositionEnd={() => setComposing(false)}
-   onBlur={() => setComposing(false)}
-   onPaste={handlePaste}
-   placeholder={isVideoGeneration() ? undefined : isEditingCapability() ? "请前往编辑区，在右侧进行编辑" : isSeedreamModel() ? "上传参考图、输入文字或@主体，描述你想生成的图片。" : "上传参考图、输入文字，描述你想生成的图片。"}
-   class="studio-composer-input"
-   disabled={isEditingCapability()}
- />
+ <div
+   ref={inputRef}
+   class="studio-composer-input"
+   contenteditable={!isEditingCapability()}
+   data-placeholder={isVideoGeneration() ? undefined : isEditingCapability() ? "请前往编辑区，在右侧进行编辑" : isSeedreamModel() ? "上传参考图、输入文字或@主体，描述你想生成的图片。" : "上传参考图、输入文字，描述你想生成的图片。"}
+   onInput={() => {
+     props.onPrompt(inputRef.innerText)
+     resizeInput()
+   }}
+   onKeyDown={(event) => {
+     if (event.key === "Enter" && isImeComposing(event)) return
+     props.onKeyDown(event)
+   }}
+   onCompositionStart={() => setComposing(true)}
+   onCompositionEnd={() => {
+     setComposing(false)
+     props.onPrompt(inputRef.innerText)
+   }}
+   onBlur={() => setComposing(false)}
+   onPaste={handlePaste}
+ />
```

**逐属性说明**:

| 属性 | textarea 写法 | contenteditable 写法 | 说明 |
| --- | --- | --- | --- |
| `ref` | 同 | 同(类型改 div) | 见改动 1 |
| `value` | `value={props.prompt}`(受控) | 删除,改用 mount 初始化 + effect 同步(见改动 6) | div 无 `value` |
| `onInput` | `event.currentTarget.value` | `inputRef.innerText` | div 取渲染文本;chip 的 `@名称` 会被包含 |
| `onKeyDown` | 同 | 同 | 不变;父组件 `handleKeyDown` 在 Enter(无 Shift)时 `preventDefault`+提交,故不会插入换行;Shift+Enter 由 contenteditable 默认插入 `<br>`,与原 textarea 行为一致 |
| `onCompositionStart` | `setComposing(true)` | 同 | 不变 |
| `onCompositionEnd` | `setComposing(false)` | `setComposing(false)` 后追加 `props.onPrompt(inputRef.innerText)` | contenteditable 合成结束需显式同步一次(避免漏掉最后合成文本) |
| `onBlur` | 同 | 同 | 不变 |
| `onPaste` | `handlePaste` | `handlePaste`(内部需改造,见改动 7) | 必须处理文本粘贴为纯文本 |
| `placeholder` | 原生 `placeholder` 属性 + `::placeholder` CSS | 改为 `data-placeholder` 属性 + `:empty::before` CSS(见 CSS 部分) | div 无原生 placeholder |
| `class` | `studio-composer-input` | 同 | 样式不变 |
| `disabled` | `disabled={isEditingCapability()}` | `contenteditable={!isEditingCapability()}` | 以 contenteditable 开关实现"禁用编辑" |

### 6. 受控同步:初始化 + 外部 prompt 变更回写

textarea 用 `value={props.prompt}` 受控。contenteditable 无此绑定,需新增:

**(a) onMount 初始化**(在现有 `onMount` L307 内追加一行):

```ts
onMount(() => {
  if (inputRef && props.prompt) inputRef.innerText = props.prompt   // 新增
  requestAnimationFrame(() => {
    checkToolbarOverflow()
    resizeInput()
  })
  ...
})
```

**(b) 新增 effect:外部 prompt 变更回写**(紧邻现有 `createEffect`(L317)新增):

```ts
createEffect(() => {
  const prompt = props.prompt
  if (!inputRef) return
  if (prompt !== inputRef.innerText) {
    inputRef.innerText = prompt        // 外部整段替换(反推提示词、素材标签等)
    queueMicrotask(resizeInput)
  }
})
```

**防循环**:本地输入时 `onInput` 已把 `props.prompt` 设为 `inputRef.innerText`,二者相等 → effect 跳过,不回写、不丢光标。仅当外部(反推/标签/清空)使二者不一致时才回写。

**已知折中**:外部整段替换时,已有 chip 的视觉会丢失——chip 变回 `@名称` 纯文本(字符串内容不变,仅失去缩略图视觉)。符合"逻辑不变"约束(父组件只认字符串),后续如需保留视觉 chip,可扩展为序列化/反序列化(见"后续可选增强")。

### 7. `handlePaste`(L493–502)——增加文本粘贴分支

```diff
  function handlePaste(event: ClipboardEvent) {
-   if (!isImageGeneration() && !isVideoGeneration()) return
-   const files = Array.from(event.clipboardData?.items ?? [])
-     .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
-     .map((item) => item.getAsFile())
-     .filter((file): file is File => Boolean(file))
-   if (!files.length) return
-   event.preventDefault()
-   props.onPasteImage(files)
+   // 图片粘贴:仅图片/视频生成能力下拦截
+   if (isImageGeneration() || isVideoGeneration()) {
+     const files = Array.from(event.clipboardData?.items ?? [])
+       .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
+       .map((item) => item.getAsFile())
+       .filter((file): file is File => Boolean(file))
+     if (files.length) {
+       event.preventDefault()
+       props.onPasteImage(files)
+       return
+     }
+   }
+   // 文本粘贴:强制以纯文本插入(contenteditable 默认会带样式 HTML)
+   event.preventDefault()
+   const text = event.clipboardData?.getData("text/plain") ?? ""
+   if (text) document.execCommand("insertText", false, text)
  }
```

**原因**:textarea 默认粘贴纯文本;contenteditable 默认粘贴富 HTML(带样式/标签),会破坏输入样式。故文本粘贴也需拦截并以纯文本插入。

### 8. 其他 `inputRef` 使用点复核(均无需改动)

| 位置 | 用法 | contenteditable 兼容性 |
| --- | --- | --- |
| L113–115 `resizeInput` | `style.height` / `scrollHeight` | div 支持,不变 |
| L307 onMount | `resizeInput()` | 不变 |
| L317 createEffect | `queueMicrotask(resizeInput)` | 不变 |
| L708 video placeholder `onClick` | `inputRef.focus()` | contenteditable div 可 focus,不变 |

---

## 二、studio-01.css 改动清单

### 1. `.studio-composer-input`(L544–557)——补充换行规则

```diff
  .studio-composer-input {
    width: 100%;
    min-height: 64px;
    max-height: 180px;
    resize: none;
    overflow-y: auto;
    border: 0;
    outline: none;
    padding-top: 0;
    background: transparent;
    color: #191919;
    font-size: 14px;
    line-height: 22px;
+   white-space: pre-wrap;
+   word-break: break-word;
  }
```

**原因**:textarea 默认按文本换行;div 需显式 `pre-wrap` 保留空格/换行并自动换行,`word-break` 保证长串不撑破布局。其余样式**完全保留**。

### 2. 占位符(L559–562)——`::placeholder` 失效,改用 `:empty::before`

```diff
  .studio-composer-input::placeholder {
    color: rgba(15, 23, 42, 0.45);
    font-size: 14px;
  }
+ .studio-composer-input:empty::before {
+   content: attr(data-placeholder);
+   color: rgba(15, 23, 42, 0.45);
+   font-size: 14px;
+   pointer-events: none;
+ }
```

> `::placeholder` 对 div 无效但留着不报错;新增 `:empty::before` 读取 `data-placeholder`。
> **边界**:浏览器清空 contenteditable 后可能残留 `<br>`,导致 `:empty` 不成立、占位符不显示。需在 `onInput` 里补一句:若 `inputRef.innerText.trim() === ""` 则 `inputRef.innerHTML = ""`。属可选稳健性补丁,见下。

### 3. (可选稳健性)清空时去除残留 `<br>`

studio-composer.tsx 的 `onInput` 内补:

```ts
onInput={() => {
  if (inputRef.innerText.trim() === "") inputRef.innerHTML = ""
  props.onPrompt(inputRef.innerText)
  resizeInput()
}}
```

### 4. 新增内联 chip 样式

```css
.studio-composer-at-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px 1px 2px;
  background: rgba(25, 25, 25, 0.05);
  border-radius: 4px;
  font-size: 12px;
  color: #191919;
  line-height: 20px;
  vertical-align: middle;
  user-select: none;
  -webkit-user-select: none;
  margin: 0 2px;
}

.studio-composer-at-chip img {
  width: 16px;
  height: 16px;
  object-fit: cover;
  border-radius: 2px;
}

.studio-composer-at-chip-name {
  white-space: nowrap;
}
```

**说明**:
- `display:inline-flex` + `vertical-align:middle` 使 chip 在文本行内对齐。
- `user-select:none` 防止 chip 文本被半选(整体作为不可编辑单元)。
- `contenteditable=false` 已在 JS 里设到 chip 元素上。
- 缩略图 16×16、圆角 2px,与"文案左侧 16×16 缩略图"需求一致。

---

## 三、不改动的部分(确认)

1. **父组件 studio-page.tsx**:`prompt` 信号、`setPrompt`、`handleKeyDown`(Enter 提交)、`handleReversePrompt`、素材标签追加逻辑——全部不变。
2. **提交数据流**:提交时父组件读 `prompt` 字符串;chip 的 `@名称` 已通过 `innerText` 进入该字符串,语义与"插入 `@名称 ` 纯文本"完全一致,无需后端/提交逻辑改动。
3. **CSS 视觉主体**:`.studio-composer-input` 字号 14px、行高 22px、颜色 #191919、min/max-height、背景透明等全部保留;视频占位符 `.studio-composer-video-placeholder` 及其交互不变。
4. **@ 菜单本身**(列表项、缩略图 26×26、空状态 empty.png 等):不变,仅菜单项 `onClick` 由 `insertPromptText` 改为 `insertMention`。
5. **拖拽/粘贴图片**:`handleDragEnter/Over/Leave/Drop`、`onPasteImage` 不变(图片粘贴分支逻辑保留,仅文本粘贴新增纯文本分支)。
6. **IME 处理**:`isImeComposing`、`composing` 信号、`onCompositionStart/End` 行为保持;仅 `onCompositionEnd` 额外同步一次文本。

---

## 四、已知限制与边界

| 场景 | 行为 | 是否可接受 |
| --- | --- | --- |
| 多次连续插入 chip | 每个 chip 独立节点,随文字流排版,光标可落在 chip 之间 | ✅ 满足"连续插入多个 图片+文本" |
| Shift+Enter 换行 | contenteditable 插入 `<br>`,与 textarea 行为一致 | ✅ |
| Enter(无 Shift) | 父组件 `preventDefault`+提交,不插换行 | ✅ 不变 |
| 外部整段替换 prompt(反推/素材标签) | effect 回写 `innerText`,chip 视觉丢失为 `@名称` 纯文本 | ⚠️ 字符串不变,仅失视觉;如需保留需序列化 |
| 清空输入残留 `<br>` | 占位符可能不显示 | ⚠️ 用"清空时 `innerHTML=""`"补丁规避 |
| 文本粘贴 | 强制纯文本,不带外来样式 | ✅ |
| `execCommand("insertText")` | 已废弃但全主流浏览器仍支持;若后续需替换,可用 `Range` 手动插入文本节点 | ⚠️ 可接受 |

---

## 五、后续可选增强(本次不做)

1. **序列化 chip**:把 chip 在 prompt 字符串里存为可逆标记(如 `@[id]`),回写时用 `props.assets` 还原视觉 chip,使外部替换也不丢缩略图。
2. **删除键整体删 chip**:监听 `keydown` Backspace,若光标紧贴 chip 前/后则整块移除 chip 节点。
3. **替换 `execCommand`**:用 Range API 手动插入纯文本节点,彻底去依赖。

---

## 六、改动一览表

| # | 文件 | 位置 | 改动 |
| --- | --- | --- | --- |
| 1 | studio-composer.tsx | L76 | `inputRef` 类型 `HTMLTextAreaElement`→`HTMLDivElement` |
| 2 | studio-composer.tsx | L117–128 | `insertPromptText` 整体替换为 `insertMention(asset)` |
| 3 | studio-composer.tsx | L971–977 | 菜单项 `onClick`:`insertPromptText(...)`→`insertMention(asset)` |
| 4 | studio-composer.tsx | L688–706 | `<textarea>`→`<div contenteditable>`(属性映射见上表) |
| 5 | studio-composer.tsx | L307 onMount | 追加 `inputRef.innerText = props.prompt` 初始化 |
| 6 | studio-composer.tsx | L317 后 | 新增 effect:外部 prompt 变更回写 |
| 7 | studio-composer.tsx | L493–502 | `handlePaste` 增加文本粘贴纯文本分支 |
| 8 | studio-composer.tsx | (可选)onInput | 清空时 `innerHTML=""` 去 `<br>` 残留 |
| 9 | studio-01.css | L544–557 | `.studio-composer-input` 加 `white-space: pre-wrap; word-break: break-word;` |
| 10 | studio-01.css | L559 后 | 新增 `.studio-composer-input:empty::before` 占位符 |
| 11 | studio-01.css | 末尾 | 新增 `.studio-composer-at-chip` / `img` / `-name` 样式 |

> 父组件 studio-page.tsx:**不改动**。
