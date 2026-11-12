# 分享页内容区对齐 Design 会话区

分析 `http://localhost:5173/design/agent/share/<uniqueId>.html` 内容区与 Design(make)页面会话区结构 / 样式的差异,并给出对齐方案。

- Design 会话区实现:
  - 容器:`packages/app/octoapp/pages/make/index.tsx`(`ScrollView` + `.make-chat-content`)
  - 单轮渲染:`packages/app/octoapp/pages/make/components/insight-turn.tsx`(`InsightTurn`)
  - 文本渲染:`packages/ui/src/components/markdown.tsx` + `packages/ui/src/components/markdown.css`
  - Design token:`packages/app/octoapp/pages/make/octo-tokens.css`
- 分享页实现:`packages/app/public/design/agent/share/index.html`(单文件,纯原生 JS)

## 1. Design 会话区结构

```
ScrollView (h-full, padding: 0 12px 16px 12px, bg #fff)
└─ div.make-chat-content.pt-4.flex.flex-col.gap-4        // pt-4=16px, gap=16px
   └─ InsightTurn  (每个 user 消息一个 turn)
      ├─ div.octo-make-turn.flex.flex-col.gap-4          // turn 容器, gap=16px
      │
      ├─ [用户气泡] div.flex.flex-col.items-end.gap-4.px-3     // px-3=12px, 右对齐
      │  ├─ [用户附件] 图片 80×80 圆角8 / 文件卡片
      │  └─ ExpandableBubble                                 // 超长可折叠+渐变遮罩+展开按钮
      │     style: bg rgba(10,89,247,0.08), padding 12px 16px,
      │           border-radius 16px 16px 2px 16px,
      │           color #191919, font 14/22, white-space pre-wrap,
      │           display inline-block, max-width 85%
      │
      ├─ [思考过程] div.mx-3  (border-left 1px rgba(0,0,0,.08), pl 12px,
      │                      color #777, font 12/18, max-h 300px)
      │
      ├─ [AI 文字] div.px-4  (padding 0 16px)
      │  └─ Markdown  (data-component="markdown")
      │     ├─ 14px / line-height 160% / color var(--text-strong)
      │     ├─ h1-h6: 14px medium, mb 8px
      │     ├─ p: mb 8px
      │     ├─ ul/ol: padding-left 32px, mb 8px
      │     ├─ code block: bg #f9f9fb, radius 16px, margin 16px 0
      │     └─ a: color var(--text-interactive-base)
      │
      ├─ [工具调用 / 子任务卡片] (mx-3, border 1px, radius 8px)
      │
      ├─ [产出文件列表] ProducedFilesList
      │
      ├─ [输出卡片] 每张 artifact 一张卡(随 turn 出现,非末尾堆叠)
      │  div: margin 12px, padding 16px 20px, border-radius 12px,
      │       bg linear-gradient(90deg,#f5f8ff,#fff 50%),
      │       border 1px rgba(0,0,0,0.1)
      │  └─ icon 28×28 + title(14px/500) + time(12px/#777)
      │
      └─ [turn meta] hover 显示 (agent · model · 耗时)
```

### 关键 token 值(`octo-tokens.css`)

| token | 值 |
|---|---|
| `--octo-brand-a8` | `rgba(10, 89, 247, 0.08)` |
| `--octo-text-primary` | `#191919` |
| `--octo-text-secondary` | `rgba(0,0,0,0.6)` |
| `--octo-border-default` | `#E5E7EB` |
| `--octo-radius-md` | `6px` |
| `--octo-surface-page` | `#FFFFFF` |

## 2. 分享页当前结构

```
main.content (flex:1, overflow-y auto, bg #fff, 4px 细滚动条)
└─ div.chat-scroll-view (max-width 1024px, margin auto, padding 12px ← 四边)
   └─ div.chat-content (padding-top 16px, flex column, gap 16px)
      └─ #conversation-list (padding-bottom 60px)
         └─ div.turn (flex column, gap 16px)
            ├─ div.turn-user-row (items flex-end, gap 16px, padding 0 12px)
            │  └─ div.bubble-user  (与 Design 气泡样式基本一致)
            └─ div.turn-assistant-row (padding 0 16px)
               └─ div.text-assistant  ← textContent 纯文本,不渲染 markdown
         └─ [末尾] div.turn > div.turn-assistant-row > div.file-list
            └─ div.file-card × N  (bg rgba(0,0,0,0.05), 8/12 padding, radius 8, icon 24)
```

## 3. 差异对照

| 项 | Design | 分享页 | 影响 |
|---|---|---|---|
| ScrollView 上内边距 | `0 12px 16px 12px` | `12px`(四边) | 顶部多 12px,首条消息偏下 |
| AI 文字渲染 | `Markdown`(标题/列表/加粗/代码/链接) | `textContent` 纯文本 | **内容差异**:看到原始 `**bold**`、`- item`、`` `code` `` 等 |
| AI 文字容器 | `div.px-4` | `.turn-assistant-row padding:0 16px` | 一致 |
| 用户气泡 | `ExpandableBubble`(超 222px 渐变遮罩 + 展开/收起) | 普通气泡,无折叠 | 长文本无折叠,但视觉一致 |
| 附件/产物位置 | 随 turn 出现(用户附件在用户行、artifact 卡在对应 assistant 后) | `manifest.files` 全部堆在末尾一个 `.turn` | **结构差异**:产物脱离对应 turn |
| 产物卡片样式 | 大卡:margin 12 / 16-20 padding / radius 12 / 渐变 bg / 28 图标 | 小卡:8-12 padding / radius 8 / 灰 bg / 24 图标 | **样式差异** |
| `#conversation-list` 底部 padding | 无(ScrollView 已有 `padding-bottom 16px`) | `padding-bottom 60px` | 末尾空白偏大 |
| 滚动条 | 默认/由 ScrollView 控制 | 4px `rgba(0,0,0,0.15)` | 基本一致 |

## 4. 对齐方案

### 4.1 容器内边距
- `.chat-scroll-view` 的 `padding` 由 `12px` 改为 `0 12px 16px 12px`(与 Design `ScrollView` 一致)。
- `.chat-content` 保留 `padding-top: 16px`(对应 `.make-chat-content.pt-4`)。
- `#conversation-list` 的 `padding-bottom: 60px` 改为 `0`(Design 无此值,底部留白由 scroll-view 的 16px 提供)。

### 4.2 AI 文字 markdown 渲染
分享页是单文件静态页,引入 `marked`(Design 用的同一库) + `DOMPurify`(Design 也用)从 CDN,把 `text-assistant` 改成渲染 HTML:
- 容器仍为 `padding 0 16px`、`color #191919`、`font 14/22`。
- 内联一份精简版 `markdown.css`(`[data-component="markdown"]` 的关键规则:14px、line-height 160%、p/ul/ol/code 的间距与样式)。
- 用 `DOMPurify` sanitize,配置与 `markdown.tsx` 一致(`FORBID_TAGS: ["style"]` 等)。

### 4.3 产物卡片(随 turn)
解析每个 assistant 文本 part 中的 `<artifact ...>...</artifact>` 标签(用与 Design 一致的流式 parser 不可行,改用轻量正则提取 `type` / `title` / `content`),为每个 artifact 在对应 turn 的 assistant 行之后渲染 Design 风格的大卡:
- `margin: 0 12px`、`padding: 16px 20px`、`border-radius: 12px`、`background: linear-gradient(90deg,#f5f8ff,#fff 50%)`、`border: 1px solid rgba(0,0,0,0.1)`。
- 左侧 28×28 图标(`AI_doc_plaintext.svg` 等价),右侧标题 14px/500 + 时间 12px/#777(取自 `assistant.info.time.created`,格式与 Design `formatTime` 一致)。
- `design-plan` / `plan-` 前缀 artifact 不显示(与 Design 一致,走 plan banner)。

### 4.4 不渲染 manifest.files
`manifest.files` 是 portable bundle 的物理文件清单,Design 会话区不直接展示它(Design 的 `ProducedFilesList` 来自 tool call 而非 bundle 文件列表)。因此分享页**不渲染** `manifest.files`,避免出现 Design 会话区没有的"多余"内容。内容显示区只展示 manifest 中会话消息解析出的:user 气泡 + assistant markdown 文本 + artifact 卡。

## 5. 验证

修改后访问 `http://localhost:5173/design/agent/share/<uniqueId>.html`,对比 Design 页同 session:
- 顶部首条消息与 header 距离一致(16px)。
- AI 回复中的 markdown 语法正常渲染(列表/加粗/代码块)。
- 每个 turn 的 artifact 卡片样式与 Design 一致(图标 + 标题 + 时间),位置在对应 assistant 文字之后。
- 末尾不再有 `manifest.files` 的"涉及文件"块(Design 会话区无此内容)。
