# ModelEdit 开发指南

ModelEdit 是 Make 页面的可视化元素编辑能力：用户在预览中点击元素 → 弹出属性面板 → 修改后保存。
本文档自包含，读完即可为你的框架/产物类型实现完整的编辑能力。

---

## 1. ModelEdit 是什么

一句话：**点击 iframe 里的元素，弹出属性面板，改完保存**。

```
┌─────────────────────────────────────────────────┐
│  Make 页面                                       │
│  ┌───────────────────────┐  ┌────────────────┐  │
│  │   iframe (预览产物)     │  │  属性面板       │  │
│  │                       │  │                │  │
│  │   点击元素 ──────────────→ 收到元素信息      │  │
│  │                       │  │ 渲染配置项      │  │
│  │   ←───────────────────── 修改即时预览       │  │
│  │                       │  │                │  │
│  └───────────────────────┘  │  [保存] [删除]  │  │
│                             └────────────────┘  │
└─────────────────────────────────────────────────┘
```

面板显示哪些配置项、修改如何预览、保存写到哪里 —— 全部由一个 `ModelEditConfig` 对象决定。

---

## 2. 快速开始

跟着下面 5 步，10 分钟跑起来一个最小实现。

### 第 1 步：了解文件命名约定

subtype 从文件名提取：`xxx.<subtype>.html` → `"mytype"`。

```
音乐网站.mytype.html   →  subtype = "mytype"
index.shadcn.html      →  subtype = "shadcn"
index.html             →  subtype = undefined（走 _default）
```

### 第 2 步：开启 feature

在 `packages/app/octoapp/pages/make/utils/subtype-config.ts` 添加分支：

```ts
export const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  // ...现有分支
  mytype: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      modelEdit: { enabled: true, editOnly: true },  // ← 开启 modelEdit，仅预览模式可用
      // ...其他 feature 全部照抄 _default
    },
  },
}
```

### 第 3 步：创建 subtype handler

新建 `packages/app/octoapp/pages/make/subtype-handlers/mytype.ts`：

```ts
import type { SubtypeHandler } from './types'
import type { ModelEditConfig } from '../components/model-edit-items/types'
import defaultHandler from './default'

const myModelEditConfig: ModelEditConfig = {
  // 保存：返回 prompt 字符串 → 自动发给 agent 处理
  saveCallback: ({ type, prev, current, dom, filePath }) => {
    const lines: string[] = []
    lines.push(`[文件路径: ${filePath}]`)
    lines.push('请修改以下元素:')
    lines.push(`标签: <${dom.tagName}>`)
    lines.push(`选择器: ${dom.selector}`)
    for (const key of Object.keys(current)) {
      if (prev[key] !== current[key]) {
        lines.push(`  ${key}: ${prev[key] || '(空)'} → ${current[key] || '(空)'}`)
      }
    }
    return lines.join('\n')
  },
  // 删除：返回 prompt 字符串 → agent 删除元素
  deleteCallback: ({ dom, filePath }) => {
    return `请删除元素 <${dom.tagName}>（选择器: ${dom.selector}）\n文件: ${filePath}`
  },
}

const mytypeHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'mytype',
  modelEditConfig: myModelEditConfig,
}

export default mytypeHandler satisfies SubtypeHandler
```

### 第 4 步：注册 handler

在 `packages/app/octoapp/pages/make/utils/subtype-registry.ts`：

```ts
import mytypeHandler from "../subtype-handlers/mytype"

registerSubtypeHandler(mytypeHandler)
```

### 第 5 步：验证

1. 创建测试文件 `test.mytype.html`，写一些简单 HTML
2. 让 agent 生成它，或上传到 session 的 uploads 目录后打开
3. 点击 ActionBar 的「局部修改」按钮
4. 点击页面内任意元素 → 弹出属性面板
5. 改一个属性 → 预览即时生效
6. 点保存 → prompt 发给 agent → agent 修改文件 → 预览刷新

---

## 3. 核心概念

### 3.1 元素识别

iframe 内注入的 bridge 负责识别点击的元素，两种识别方式：

**componentFlag** — 框架组件识别（推荐）：

```ts
const myModelEditConfig: ModelEditConfig = {
  componentFlag: 'data-my-component',  // 属性名
  // ...
}
```

bridge 从点击目标向上冒泡，找到第一个带 `data-my-component` 属性的祖先元素，
属性值即 componentType（如 `data-my-component="button"` → `"button"`），
然后用 `componentConfig['button']` 渲染面板。

要求：你的框架渲染 DOM 时给组件根元素加上标记属性。例如：

```html
<button data-my-component="button" class="btn primary">确定</button>
```

**htmlFlag** — 普通 HTML 元素细分识别：

```ts
htmlFlag: 'data-my-type',  // 点击元素自身带此属性时，属性值作为 htmlType
```

**都不配时** — bridge 自动按 tagName + 内容判断 elementKind：

| elementKind | 判断条件 |
|-------------|---------|
| `link` | `<a>` |
| `image` | `<img>` |
| `text` | 有文本 + 无子元素 |
| `mixed` | label/button/span/p/div + 直接文本 + 有子元素 |
| `container` | 其他容器标签 |

### 3.2 面板配置

面板 = `ConfigGroup[]`（分组） → 每组 `items: ConfigItem[]`（控件）。

**ConfigItem 两种类型：**

```ts
// native：预定义控件（见 3.2.1 类型表），自带读取逻辑
{ type: 'color', key: 'od_color' }

// component：通用输入控件
{ type: 'input', key: 'od_title', data: { title: '标题', default: '', placeholder: '输入标题' } }
{ type: 'selector', key: 'od_variant', data: { title: '变体', items: [{ value: 'solid', label: '实心' }, { value: 'outline', label: '描边' }], default: 'solid' } }
```

**面板来源优先级**（html-renderer 收到元素后）：

```
1. componentFlag 命中 + componentConfig[type] 存在
   → 用 componentConfig[type].config / .data
2. htmlFlag 命中 + htmlConfig[type] 存在
   → 用 htmlConfig[type].config(默认面板) / .data(默认数据, dom)（可增删改默认面板）
3. 都没命中
   → getDefaultNativeConfig(elementKind, isLayoutContainer) 自动给默认面板
```

#### 3.2.1 Native item 类型表

| type | 默认 key | 控件 | 值格式 |
|------|---------|------|--------|
| `textContent` | `od_textContent` | textarea | 纯文本 |
| `href` | `od_href` | URL 输入框 | URL 字符串 |
| `fontFamily` | `od_fontFamily` | 字体下拉 | 字体名 |
| `fontProps` | `od_fontProps` | 字重下拉 + 字号拖拽 | `{"fontWeight":"600","fontSize":"16px"}` |
| `typSpacing` | `od_typSpacing` | 字距 + 行高拖拽 | `{"letterSpacing":"0px","lineHeight":"24px"}` |
| `color` | `od_color` | 取色器（HUI 色板） | hex 颜色 |
| `textAlign` | `od_textAlign` | 水平对齐按钮组 | `left`/`center`/`right`/`justify` |
| `verticalAlign` | `od_verticalAlign` | 垂直对齐按钮组 | `top`/`middle`/`bottom` |
| `sizeGroup` | `od_size` | 宽高 + 圆角（四角独立） | `{"width":"100px","height":"50px",...}` |
| `layoutGroup` | `od_layout` | flex 方向/对齐/间距 | `{"flexDirection":"row","gap":"8px",...}` |
| `appearanceGroup` | `od_appearance` | 填充色 + 不透明度 | `{"backgroundColor":"#fff","opacity":"1"}` |
| `paddingGroup` | `od_padding` | 四向 padding | `{"t":"8","r":"8","b":"8","l":"8"}` |
| `marginGroup` | `od_margin` | 四向 margin | `{"t":"8","r":"8","b":"8","l":"8"}` |
| `borderGroup` | `od_border` | 边框（颜色/宽度/样式） | `{"borderColor":"#000","borderTopWidth":"1px",...}` |
| `borderRadius` | `od_borderRadius` | 圆角拖拽 | px 数值 |
| `effectsGroup` | `od_effects` | 阴影/模糊效果编辑器 | `EffectEntry[]` JSON |
| `bgImageGroup` | `od_bgImage` | 背景图选择 | URL 字符串 |

#### 3.2.2 默认面板组合（未配置任何 Config 时）

| elementKind | 默认面板组 |
|-------------|-----------|
| `text` / `mixed` | 文字 + 文本（字体/字重/字距/颜色/对齐） |
| `link` | 链接 + 文本 |
| `image` | 尺寸 + 外观 + 内边距 + 外边距 + 边框 + 效果 |
| `container` | 尺寸 + [布局] + 外观 + 内边距 + 外边距 + 边框 + 效果 + 背景图 |
| `token` | 文本 + 内边距 + 外边距 + 外观 + 边框 + 效果 |

### 3.3 实时预览（onChange）

用户在面板拖动控件 → `onChange({ key, value, prev, dom, postMessageToIframe, ... })` →
你在这里把 key 转成 postMessage 发给 iframe → iframe 内即时改样式。

**iframe 侧已内置处理的消息**（model-edit bridge 收到后直接操作 DOM）：

```
od:edit-preview-style  { id, styles: Record<CSS属性, 值>, version }
    → 对元素 el.style.setProperty(kebab(属性), 值)；空值 removeProperty

od:edit-text           { elementId, value }
    → el.textContent = value

od:edit-attr           { elementId, attr, value }
    → el.setAttribute(attr, value)

od:replace-element     { elementId, html, attrs? }
    → 用 html 替换整个元素，保留 data-od-id，可选附加属性
```

**Prompt 模式不需要 onChange**（保存时发 agent，agent 改完文件刷新预览）。
**Direct 模式需要 onChange** 才有即时预览。`default.ts` 里的完整映射：

```ts
onChange: ({ key, value, dom, postMessageToIframe }) => {
  const id = dom.dataOdId
  const send = (styles: Record<string, string>) =>
    postMessageToIframe({ type: 'od:edit-preview-style', id, styles, version: Date.now() })

  switch (key) {
    case 'od_color':           send({ color: value }); break
    case 'od_fontSize':        send({ fontSize: value }); break
    case 'od_fontWeight':      send({ fontWeight: value }); break
    case 'od_fontFamily':      send({ fontFamily: value }); break
    case 'od_textAlign':       send({ textAlign: value }); break
    case 'od_lineHeight':      send({ lineHeight: value }); break
    case 'od_letterSpacing':   send({ letterSpacing: value }); break
    case 'od_verticalAlign':   send({ verticalAlign: value }); break
    case 'od_fontProps':       send({ fontWeight: parse(value).fontWeight, fontSize: parse(value).fontSize }); break
    case 'od_typSpacing':      send({ letterSpacing: ..., lineHeight: ... }); break
    case 'od_backgroundColor': send({ backgroundColor: value }); break
    case 'od_opacity':         send({ opacity: value }); break
    case 'od_borderRadius':    send({ borderRadius: value }); break
    case 'od_overflow':        send({ overflow: value }); break
    case 'od_width':           send({ width: value }); break
    case 'od_height':          send({ height: value }); break
    case 'od_textContent':     postMessageToIframe({ type: 'od:edit-text', elementId: id, value }); break
    case 'od_bgImage':         send({ backgroundImage: value }); break
    // JSON 复合值（sizeGroup/layoutGroup/paddingGroup/marginGroup/appearanceGroup/borderGroup/effectsGroup）
    // → 解析 JSON 后拆成多个 CSS 属性一起 send(...)
  }
}
```

key 命名约定 `od_` 前缀；复合控件的 value 是 JSON 字符串。

### 3.4 保存（saveCallback / deleteCallback）

用户点「保存」→ 宿主调用 `saveCallback({ ...ModelEditContext, prev, current })`：

```
saveCallback 返回非空字符串
  → 自动 sendTextToAgent(prompt) 发给 agent
  → agent 修改文件 → 预览刷新 → 面板等 agent 回复完成后自动关闭

saveCallback 返回空字符串 ''
  → 视为已自行处理完（如直接写回了文件/数据）
  → 面板立即关闭
```

**两种典型模式：**

**A. Prompt 模式**（框架产物不可直接改，靠 agent 定位源码修改）：

```ts
saveCallback: ({ dom, prev, current, filePath }) => buildPrompt(dom, prev, current, filePath),
deleteCallback: ({ dom, filePath }) => buildDeletePrompt(dom, filePath),
// 不配 onChange（无即时预览，保存靠 agent）
```

**B. Direct 模式**（HTML 产物可直接改写）：

```ts
onChange: ({ key, value, dom, postMessageToIframe }) => { /* 见 3.3 */ },

saveCallback: async ({ getIframeSnapshot, cleanBridgeContent, wrapHtmlContent, onContentChange, onRefreshNeeded }) => {
  const html = await getIframeSnapshot()   // 取 iframe 当前 DOM（含预览中的修改）
  const clean = cleanBridgeContent(html)   // 剥离 bridge 注入的脚本/属性
  const wrapped = wrapHtmlContent(clean)   // 原内容是 markdown 代码块则包回 ```html 围栏
  await onContentChange(wrapped)           // 写回文件 + 更新 tab
  onRefreshNeeded()                        // 刷新预览
  return ''                                // 空串 = 不发 agent
},

deleteCallback: async ({ dom, getIframeSnapshot, applyPatch, cleanBridgeContent, wrapHtmlContent, onContentChange, onRefreshNeeded }) => {
  const html = await getIframeSnapshot()
  const result = applyPatch(html, { id: dom.dataOdId, kind: 'remove-element' })  // DOM patch 删元素
  if (result.ok) {
    await onContentChange(wrapHtmlContent(cleanBridgeContent(result.source)))
    onRefreshNeeded()
  }
  return ''
},
```

**promptCallback**（可选）— 面板上「AI 修改」自由文本对话框的 prompt 前缀：

```ts
promptCallback: (filePath, selector) => `[文件: ${filePath}]\n[选择器: ${selector}]`
```

---

## 4. 进阶：自定义面板

### 4.1 componentConfig — 按组件类型定义面板

```ts
const myModelEditConfig: ModelEditConfig = {
  componentFlag: 'data-my-component',
  componentConfig: {
    button: {
      title: '按钮',                                    // 面板标题
      info: (dom) => `变体: ${dom.attributes['data-variant']}`,  // 标题下的描述行（可选）
      config: [                                          // ConfigGroup[]
        { title: '内容', items: [
          { type: 'input', key: 'od_title', data: { title: '按钮文字', default: '', placeholder: '' } },
        ]},
        { title: '样式', items: [
          { type: 'selector', key: 'od_variant', data: {
            title: '变体',
            items: [
              { value: 'primary', label: '主要' },
              { value: 'secondary', label: '次要' },
              { value: 'ghost', label: '幽灵' },
            ],
            default: 'primary',
          }},
          { type: 'input', key: 'od_customCss', data: { title: '自定义CSS', default: '', placeholder: '如 color: red' } },
        ]},
      ],
      data: (dom) => ({                                  // 面板初始值：从元素提取
        od_title: dom.text,
        od_variant: dom.attributes['data-variant'] || 'primary',
        od_customCss: '',
      }),
    },
    card: { /* ... */ },
  },
  // ...
}
```

### 4.2 htmlConfig — 增删改默认面板

不想整体替换、只想在默认面板上做增删时用 htmlConfig：

```ts
const myModelEditConfig: ModelEditConfig = {
  htmlFlag: 'data-my-type',
  htmlConfig: {
    // htmlType 与元素 data-my-type 属性值匹配
    hero: {
      config: (defaultConfig) => [
        { title: '专属', items: [
          { type: 'input', key: 'od_heroTitle', data: { title: '主标题', default: '', placeholder: '' } },
        ]},
        ...defaultConfig.filter(g => g.title !== '文字'),  // 去掉默认的某个组
      ],
      data: (defaultData, dom) => ({ ...defaultData, od_heroTitle: dom.text }),
    },
  },
  // ...
}
```

### 4.3 selectionStyle — 选中框样式

```ts
selectionStyle: (dom) => {
  if (dom.elementKind === 'image') return { color: '#7c3aed', lineStyle: 'dashed' }
  return null  // null = 默认蓝色实线
}
```

### 4.4 iconConfig / assetConfig — 图标与资源替换

选中 `svg`/`img` 元素时面板会出现图标替换入口，选中任意元素时可出现资源替换入口。
完整字段见 `types.ts` 的 `IconConfig` / `AssetConfig`，可直接参考实现：
`demo.ts`（demoIconConfig，prompt 版）、`default.ts`（direct 版，替换 DOM + 写回）。

onConfirm 返回值语义与 saveCallback 相同：**非空 = prompt 发 agent；空串 = 已直接处理**。

---

## 5. 进阶：覆盖非标准场景

产物不是「可直接改写的 HTML」（如内容由 JSON 数据驱动、页面是编译产物）时，
用以下四项把保存/预览/生命周期接管过来。

### 5.1 customContext — 注入自定义操作

工厂函数，返回的对象会合并进所有回调的 `ctx.custom`：

```ts
const myModelEditConfig: ModelEditConfig = {
  customContext: () => ({
    commitDoc: commitA2uiDoc,       // 你的数据提交函数
    applyModify: applyModify,       // 你的属性修改函数
    loadDocs: loadA2uiDocs,         // 你的数据加载函数
  }),
  // saveCallback / onChange / onBridgeMessage 中通过 ctx.custom.commitDoc() 调用
}
```

### 5.2 onEnter / onExit — 模式生命周期钩子

点击「局部修改」按钮开/关时触发，用于初始化/清理自定义编辑态：

```ts
const myModelEditConfig: ModelEditConfig = {
  onEnter: (ctx) => {
    // 初始化：加载数据文档、启用自定义 picker
    ctx.postMessageToIframe({ type: 'od:dom-picker-mode', enabled: true })
    ctx.postMessageToIframe({ type: 'od:drag-mode', enabled: true, siblingMap: buildMap() })
  },
  onExit: (ctx) => {
    // 清理：关闭 picker、dispose session、保存未提交状态
    ctx.postMessageToIframe({ type: 'od:dom-picker-mode', enabled: false })
  },
}
```

### 5.3 onBridgeMessage — 接收自定义 bridge 消息

编辑模式激活期间，iframe 发来的**未被内置处理**的消息都转发到这里。
拖拽排序、状态回传等自定义协议靠它：

```ts
const myModelEditConfig: ModelEditConfig = {
  onBridgeMessage: (data, ctx) => {
    if (data.type === 'od:drag-reorder') {
      // 拖拽排序：data.elementId / data.from / data.to
      ctx.custom.applyReorder?.(data.elementId, data.from, data.to)
    }
    if (data.type === 'MY_STATE_CHANGE') {
      // 状态同步：写回数据文件
      ctx.custom.commitDoc?.()
    }
  },
}
```

### 5.4 自定义 bridge 脚本

标准 bridge 覆盖不了的 iframe 侧逻辑（自定义元素选择、拖拽 handle、状态上报），
需要注入自己的脚本。

1. 在 `subtype-config.ts` 声明：

```ts
mytype: {
  features: { /* ... */ },
  rendering: {
    customBridges: ['my-bridge'],  // ← bridge ID
  },
},
```

2. 在 `packages/desktop/src/main/custom-bridge-registry.ts` 注册脚本：

```ts
registerCustomBridge('my-bridge', {
  script: `
    (function() {
      window.addEventListener('message', function(e) {
        var d = e && e.data
        if (!d) return
        if (d.type === 'od:dom-picker-mode') {
          /* 自定义 picker 逻辑，选中后 postMessage 给父窗口 */
        }
      })
      // 主动上报：
      // window.parent.postMessage({ type: 'MY_STATE_CHANGE', state: {...} }, '*')
    })()
  `,
  style: '[data-my-edit]:hover { outline: 2px solid #2563eb; }',  // 可选
  position: 'body',  // 'head' | 'body'
})
```

3. 消息流向：iframe → `onBridgeMessage` 接收；宿主 → `ctx.postMessageToIframe` 发送。

---

## 6. 类型速查

### ModelEditConfig（完整字段）

| 字段 | 类型 | 必填 | 用途 |
|------|------|------|------|
| `saveCallback` | `(args: SaveCallbackArgs) => string \| Promise<string>` | ✅ | 保存。返回 prompt（发 agent）或空串（已直接处理） |
| `deleteCallback` | `(args: DeleteCallbackArgs) => string \| Promise<string>` | ✅ | 删除。返回值语义同上 |
| `componentFlag` | `string` | | 组件识别属性名（向上冒泡找祖先） |
| `componentConfig` | `Record<string, ComponentTypeConfig>` | | 按组件类型的面板定义 |
| `htmlFlag` | `string` | | HTML 元素细分识别属性名（看元素自身） |
| `htmlConfig` | `Record<string, HtmlTypeConfig>` | | 按元素类型的面板定制（增删改默认面板） |
| `onChange` | `(args: OnChangeArgs) => void` | | 实时预览回调 |
| `promptCallback` | `(filePath, selector) => string` | | 「AI 修改」对话框 prompt 前缀 |
| `colors` | `ColorToken[]` | | 取色器色板（默认 HUI 色板） |
| `iconConfig` | `IconConfig` | | 图标替换入口 |
| `assetConfig` | `AssetConfig` | | 资源替换入口 |
| `selectionStyle` | `(dom) => SelectionStyle \| null` | | 选中框样式 |
| `onEnter` | `(ctx: ModelEditModeContext) => void \| Promise<void>` | | 进入编辑模式 |
| `onExit` | `(ctx: ModelEditModeContext) => void \| Promise<void>` | | 退出编辑模式 |
| `customContext` | `() => Record<string, unknown>` | | 注入自定义操作（合并进 ctx.custom） |
| `onBridgeMessage` | `(data, ctx: ModelEditModeContext) => void` | | 接收自定义 bridge 消息 |

### ModelEditElement（bridge 上报的元素信息）

| 字段 | 说明 |
|------|------|
| `dataOdId` | iframe 内元素 ID（`el-N`，动态元素也会自动分配） |
| `tagName` / `className` | 标签名 / class |
| `attributes` | 常用属性 + componentFlag/htmlFlag 属性（`class,id,href,src,alt,title,aria-label,...`） |
| `styles` | computedStyle（字体/颜色/间距/边框/阴影等约 40 项） |
| `outerHTML` | 外层 HTML（截断 500 字符） |
| `rect` | 视口坐标 `{ x, y, width, height }` |
| `text` | 文本内容（截断 200 字符；mixed 取直接文本） |
| `selector` | CSS 选择器（跨 iframe 用 `>>>` 连接） |
| `htmlHint` | 起始标签片段（prompt 里给 agent 提示用） |
| `isLayoutContainer` | 是否有子元素 |
| `elementKind` | `text/link/image/container/mixed/token` |
| `selectionKind` | `component`（componentFlag 命中）/ `native` |
| `componentType` | componentFlag 属性值 |
| `htmlType` | htmlFlag 属性值 |

### ModelEditContext（saveCallback/deleteCallback/onChange 的 ctx）

| 字段 | 说明 |
|------|------|
| `dom` | ModelEditElement |
| `filePath` | 产物文件路径 |
| `type` | componentType 或 htmlType 或 `'default'` |
| `postMessageToIframe(data)` | 向 iframe 发消息 |
| `getIframeSnapshot()` | 取 iframe 当前 DOM 快照 |
| `onContentChange(content)` | 写回内容（更新文件 + tab） |
| `onRefreshNeeded()` | 触发预览刷新 |
| `cleanBridgeContent(html)` | 剥离 bridge 注入的脚本/属性 |
| `applyPatch(html, patch)` | 应用 DOM 补丁（set-text/set-style/remove-element/...） |
| `wrapHtmlContent(html)` | 按原格式包回（markdown 围栏等） |
| `custom` | customContext 注入的对象 |

### ModelEditModeContext（onEnter/onExit/onBridgeMessage 的 ctx）

`postMessageToIframe` / `getIframeSnapshot` / `onContentChange` / `onRefreshNeeded` / `custom`（无 `dom`，进入编辑模式时就存在）。

### Bridge 消息协议

**宿主 → iframe**（用 `ctx.postMessageToIframe`）：

| 消息 | 用途 | 内置处理 |
|------|------|---------|
| `od:model-edit-mode { enabled, componentFlag, htmlFlag }` | 开关编辑模式 | ✅（按钮点击自动发） |
| `od:model-edit-clear` | 清除选中态 | ✅ |
| `od:edit-preview-style { id, styles, version }` | 预览样式 | ✅ |
| `od:edit-text { elementId, value }` | 改文本 | ✅ |
| `od:edit-attr { elementId, attr, value }` | 改属性 | ✅ |
| `od:replace-element { elementId, html, attrs? }` | 替换元素 | ✅ |
| `od:track-rect { elementId }` / `od:stop-track-rect` | 跟踪元素位置（面板锚定） | ✅ |
| `od:selection-style { style }` | 选中框样式 | ✅ |
| 其他任意消息 | 自定义协议 | ❌ → 自己的 bridge 脚本处理 |

**iframe → 宿主**：

| 消息 | 用途 | 内置处理 |
|------|------|---------|
| `od:model-edit-selected { target: ModelEditElement }` | 元素被点击选中 | ✅（自动开面板） |
| `od:rect-update { elementId, rect }` | 被跟踪元素位置变化 | ✅ |
| 其他任意消息 | 自定义协议 | ❌ → `onBridgeMessage` 接收 |

---

## 7. 参考实现

| 文件 | 场景 | 要点 |
|------|------|------|
| `subtype-handlers/default.ts`（`directModelEditConfig`） | HTML 产物直接改写 | 完整 onChange 映射 + iframe 快照写回 + iconConfig/assetConfig direct 版 |
| `subtype-handlers/default.ts`（`defaultModelEditConfig`） | Prompt 基类 | saveCallback/deleteCallback 拼 prompt 的标准写法 |
| `subtype-handlers/demo.ts` | Prompt 模式 | selectionStyle + promptCallback + iconConfig prompt 版 |
| `subtype-handlers/components.tsx` | 编译产物 | prompt 外再包「定位源码 → 重编译」指引；customBridges + ActionBar 扩展按钮 |
| `subtype-handlers/demoedit.ts` | Direct 最简 | 只用 directModelEditConfig，无额外配置 |

非 HTML 数据驱动场景的组装方式（customContext + onEnter/onExit + onBridgeMessage + saveCallback 写数据）见第 5 章各小节示例。
