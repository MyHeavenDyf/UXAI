# Make 模块集成 Artifact 类型系统 + 设计系统资源

> 来源：Open Design (`D:/octoAI/open-design/`)
> 目标：octoAI Make 页面 (`packages/app/octoapp/pages/make/`)
> 日期：2026-05-25

---

## Context

octoAI 的 Make 页面当前只有启发式的 `detectCard()` 输出检测，6 种类型（html/table/mindmap/json/markdown/file），无结构化产物元数据，无设计系统资源。需要引入 Open Design 的 Artifact 类型和 150+ 套设计系统资源。

**核心约束**：
- 代码改动尽量限定在 `packages/app/octoapp/pages/make/` 内
- `packages/opencode/` 中仅修改纯文本文件（prompt/SKILL.md）
- 设计系统资源放在 `packages/app/octoapp/design-systems/`
- 设计系统通过**客户端 prompt 前缀注入**，避免修改 `system.ts`/`prompt.ts`

---

## 修改文件影响分析

### 仅修改 `/make` 内的文件（代码改动）

| 文件 | 修改类型 | 影响 |
|------|----------|------|
| `make/components/insight-turn.tsx` | 扩展类型 + 替换检测逻辑 | 仅影响 make 页面的产出检测，不影响 insight 或其他页面 |
| `make/components/result-viewer/tab-store.ts` | 扩展类型联合 | 仅 make ResultViewer 消费，无外部引用 |
| `make/components/result-viewer/index.tsx` | 新增 Switch 分支 | 仅 make ResultViewer，向后兼容（新类型有 fallback） |
| `make/components/result-viewer/action-bar.tsx` | 新增 deck/svg 操作按钮 | 仅 make ActionBar |
| `make/icons/index.tsx` | 新增图标导出 | 仅影响 make 页面内引用 |
| `make/index.tsx` | 添加设计系统选择器 + prompt 注入 | 仅影响 make 页面入口 |

### 仅修改纯文本/markdown 文件（零代码影响）

| 文件 | 修改类型 | 影响 |
|------|----------|------|
| `opencode/src/agent/prompt/octo_make.txt` | 重写 prompt 文本 | 仅影响 octo_make agent 的系统提示，其他 agent 不受影响 |
| `opencode/src/agent/skills/octo_make/html-prototype/SKILL.md` | 充实内容 | 仅影响该 skill 定义，不改代码逻辑 |

### 新建文件（零影响现有代码）

| 文件 | 说明 |
|------|------|
| `make/utils/artifact-parser.ts` | 纯 TS，零框架依赖，移植自 Open Design |
| `make/utils/artifact-markdown-context.ts` | 纯 TS，零依赖，移植自 Open Design |
| `make/utils/design-system-loader.ts` | 加载设计系统静态资源 |
| `make/components/result-viewer/deck-renderer.tsx` | SolidJS 幻灯片渲染器 |
| `make/components/result-viewer/svg-renderer.tsx` | SolidJS SVG 渲染器 |
| `make/components/design-system-picker.tsx` | 设计系统选择器 UI |

### 设计系统资源文件（静态资源）

| 路径 | 说明 |
|------|------|
| `packages/app/octoapp/design-systems/*/DESIGN.md` | 150+ 套品牌视觉规范 |
| `packages/app/octoapp/design-systems/*/tokens.css` | CSS 自定义属性 |
| `packages/app/octoapp/design-systems/index.json` | 设计系统索引（id, title, category） |

---

## Phase 1: Artifact 类型系统

### 1.1 移植 Artifact 解析器

**新建：** `make/utils/artifact-parser.ts`
- 移植 `D:/octoAI/open-design/apps/web/src/artifacts/parser.ts`
- 导出 `createArtifactParser()` 返回 `{ feed(delta): Generator<ArtifactEvent>; flush(): Generator<ArtifactEvent> }`
- `ArtifactEvent` 联合类型：`text | artifact:start | artifact:chunk | artifact:end`
- 解析 `<artifact identifier="..." type="..." title="...">...content...</artifact>` 标签

**新建：** `make/utils/artifact-markdown-context.ts`
- 移植 `D:/octoAI/open-design/apps/web/src/artifacts/markdown-context.ts`
- 导出 `computeSkipRanges()`, `isRealArtifactOpenAt()`, `rangeContains()`
- 跳过代码块内的 artifact 标签（避免误解析 ````html` 中的标签）

### 1.2 扩展产物类型

**修改：** `make/components/insight-turn.tsx`（第 9-18 行）

```ts
// 扩展前：
export type OutputCardType = "table" | "mindmap" | "markdown" | "file" | "json" | "html"

// 扩展后：
export type OutputCardType =
  | "table" | "mindmap" | "markdown" | "file" | "json" | "html"
  | "deck" | "svg" | "markdown-document" | "code-snippet"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  content: string
  filePath?: string
  artifactKind?: string  // 新增：artifact 标签的原始 type 值
  createdAt: Date
}
```

**修改：** `make/components/result-viewer/tab-store.ts` — `ResultTab.type` 同步扩展

### 1.3 双路径产物检测

**修改：** `make/components/insight-turn.tsx` — `outputCard` memo

替换现有检测逻辑为双路径：

```
1. 主路径：createArtifactParser().feed(完整文本) 解析 <artifact> 标签
   → artifact:start 提取 type/title
   → artifact:end 提取 fullContent
   → 类型映射：html→html, deck→deck, svg→svg, markdown-document→markdown-document, code-snippet→code-snippet

2. 兜底路径：保留 detectCard() 处理无 <artifact> 标签的旧格式输出
```

**影响分析**：`outputCard` memo 仅被 `<InsightTurn>` 组件内部消费，`detectCard()` 是内部函数。修改完全封闭在 insight-turn.tsx 内。

### 1.4 新增 Deck 和 SVG 渲染器

**新建：** `make/components/result-viewer/deck-renderer.tsx`
- SolidJS 组件，`<iframe srcdoc>` 渲染
- 注入导航 shim：`<div class="slide">` 可见性切换
- 幻灯片计数器 + 键盘方向键导航 + 全屏模式

**新建：** `make/components/result-viewer/svg-renderer.tsx`
- SolidJS 组件，内联 SVG + 缩放控制
- 预览/源码切换

**修改：** `make/components/result-viewer/index.tsx` — 在 `<Switch>` 中新增 `<Match>` 分支

```tsx
// 新增（在第 131 行 html Match 之后）：
<Match when={tab().type === "deck"}>
  <DeckRenderer content={tab().content} />
</Match>
<Match when={tab().type === "svg"}>
  <SvgRenderer content={tab().content} />
</Match>
<Match when={tab().type === "markdown-document"}>
  <MarkdownRenderer content={tab().content} />
</Match>
```

**影响分析**：ResultViewer 的 `<Switch fallback>` 已有兜底渲染（`<pre>` 标签），新增 Match 不影响已有类型的渲染路径。

### 1.5 重写 octo_make Prompt

**修改：** `packages/opencode/src/agent/prompt/octo_make.txt`

纯文本文件，无代码影响。重写为包含 artifact 输出格式规范的完整 prompt：

```
你是一个 Web 设计原型专家。你的职责是根据用户需求生成高保真可交互的 HTML 原型。

## 输出格式

用 <artifact> 标签包裹最终产出：

<artifact identifier="landing-page" type="html" title="产品落地页">
<!DOCTYPE html>
<html>...</html>
</artifact>

支持的 type 值：
- html — HTML 原型/页面/落地页/仪表盘
- deck — 幻灯片演示（每张用 <div class="slide"> 包裹，默认 1920x1080）
- svg — SVG 矢量图形/图标/图表
- markdown-document — Markdown 文档
- code-snippet — 代码文件

## 设计系统

如果用户指定了设计系统，必须遵循：
1. 将 tokens.css 的 :root 块粘贴到 <style> 中
2. 使用 DESIGN.md 中定义的色彩、排版、组件规范
3. 不发明设计系统之外的 token

## 技术规范

- 使用 Tailwind CSS v4
- 生成完整、自包含的 HTML 文件
- 响应式设计，适配不同屏幕尺寸
- 包含必要的 JavaScript 实现交互
- 产出应可直接在浏览器中运行
```

### 1.6 充实 SKILL.md

**修改：** `packages/opencode/src/agent/skills/octo_make/html-prototype/SKILL.md`

纯 markdown 文件，无代码影响。补充：
- Artifact 输出格式契约
- 设计系统绑定指令
- 响应式设计要求
- 常见原型模式

### 1.7 新增图标

**修改：** `make/icons/index.tsx`
- 新增 `IconCardDeck`（幻灯片图标）和 `IconCardSvg`（SVG 图标）
- 更新 `CardTypeIcon` switch（在 insight-turn.tsx 第 68 行）

---

## Phase 2: 设计系统资源

### 2.1 搬运设计系统文件

**新建目录：** `packages/app/octoapp/design-systems/`

从 `D:/octoAI/open-design/design-systems/` 全量复制 150+ 套。每套保留：
- `DESIGN.md` — 品牌视觉规范
- `tokens.css` — CSS 自定义属性

**新建：** `packages/app/octoapp/design-systems/index.json`

生成设计系统索引文件，前端快速加载列表用：
```json
[
  { "id": "apple", "title": "Apple", "category": "Consumer Brands" },
  { "id": "vercel", "title": "Vercel", "category": "Developer Tools" },
  { "id": "brutalism", "title": "Brutalism", "category": "Design Aesthetics" },
  ...
]
```

**不搬运 `components.html`**（单文件 20-40KB，prompt 注入中不需要完整组件展示 HTML）。

### 2.2 设计系统加载器

**新建：** `make/utils/design-system-loader.ts`

```ts
// 使用 fetch 相对路径加载（octoapp 下的资源通过 Vite dev server 可访问）
// 索引：fetch('/design-systems/index.json') 或 import from "../../design-systems/index.json"
// 内容：fetch('/design-systems/vercel/DESIGN.md') 动态加载
export async function loadDesignSystemIndex(): Promise<DesignSystemEntry[]>
export async function loadDesignSystem(id: string): Promise<{ design: string; tokens: string }>
```

### 2.3 设计系统选择器 UI

**新建：** `make/components/design-system-picker.tsx`

- 下拉选择器，按 category 分组显示设计系统
- 支持"无设计系统"默认选项
- 选中后存入 `createSignal`，供 `sendMessage` 使用

### 2.4 Prompt 注入（客户端方案）

**修改：** `make/index.tsx` — `sendMessage` 函数（第 248-269 行）

在设计系统被选中时，将内容作为文本前缀注入：

```ts
async function sendMessage(sessionId: string, text: string) {
  setSending(true)
  try {
    const fileParts = attachments().map(/* ... */)
    let promptText = text

    // 设计系统注入
    if (selectedDesignSystem()) {
      const ds = await loadDesignSystem(selectedDesignSystem())
      promptText = [
        `[Design System: ${selectedDesignSystem()}]`,
        `Treat the following as authoritative for color, typography, spacing, and component rules:`,
        ds.design,
        `Paste this :root block verbatim into the first <style>:`,
        "```css",
        ds.tokens,
        "```",
        "---",
        text,
      ].join("\n\n")
    }

    const textPart: TextPartInput = { type: "text", text: promptText }
    await globalSDK.client.session.prompt({
      sessionID: sessionId,
      agent: "octo_make",
      parts: [textPart, ...fileParts],
    })
    setAttachments([])
  } catch (err) {
    console.error("[MakePage] prompt failed", err)
  } finally {
    setSending(false)
  }
}
```

**影响分析**：`sendMessage` 是 make 页面内部函数，只在 `handleSubmit` 中调用。修改完全封闭在 make 页面内。

**trade-off**：设计系统规则在用户消息而非系统消息中。但考虑到：
- 每次 prompt 都会注入（不只是首次），保证持续有效
- 避免修改 opencode 核心代码
- 现代 LLM 对用户消息中的明确指令遵循度很高

---

## 文件清单总览

| 文件 | 操作 | Phase |
|------|------|-------|
| `make/utils/artifact-parser.ts` | 新建 | 1.1 |
| `make/utils/artifact-markdown-context.ts` | 新建 | 1.1 |
| `make/components/insight-turn.tsx` | 修改 | 1.2, 1.3 |
| `make/components/result-viewer/tab-store.ts` | 修改 | 1.2 |
| `make/components/result-viewer/deck-renderer.tsx` | 新建 | 1.4 |
| `make/components/result-viewer/svg-renderer.tsx` | 新建 | 1.4 |
| `make/components/result-viewer/index.tsx` | 修改 | 1.4 |
| `packages/opencode/src/agent/prompt/octo_make.txt` | 修改（纯文本） | 1.5 |
| `packages/opencode/src/agent/skills/octo_make/html-prototype/SKILL.md` | 修改（纯文本） | 1.6 |
| `make/icons/index.tsx` | 修改 | 1.7 |
| `packages/app/octoapp/design-systems/` | 新建目录 | 2.1 |
| `packages/app/octoapp/design-systems/index.json` | 新建 | 2.1 |
| `make/utils/design-system-loader.ts` | 新建 | 2.2 |
| `make/components/design-system-picker.tsx` | 新建 | 2.3 |
| `make/index.tsx` | 修改 | 2.4 |

（所有路径相对于 `packages/app/octoapp/pages/` 和 `packages/opencode/`）

## 验证步骤

1. `cd packages/app && bun typecheck` — 前端类型检查通过
2. `bun dev:desktop` 启动桌面端
3. Make 页面输入 "帮我做一个产品落地页" → 确认 LLM 输出 `<artifact>` 标签
4. 确认 ResultViewer 正确渲染 deck/svg/html 类型
5. 选择设计系统（如 vercel）→ 确认 prompt 包含 DESIGN.md + tokens.css
6. 确认产出 HTML 包含设计系统的 `:root` CSS 变量

---

## 实施记录（2026-05-25）

### 实际新建文件（8 个）

| 文件 | 说明 | 来源 |
|------|------|------|
| `make/utils/artifact-parser.ts` | `<artifact>` 标签流式解析器 | 移植 open-design `apps/web/src/artifacts/parser.ts` |
| `make/utils/artifact-markdown-context.ts` | Markdown 代码块跳过逻辑 | 移植 open-design `apps/web/src/artifacts/markdown-context.ts` |
| `make/utils/design-system-loader.ts` | 设计系统资源加载（`import.meta.glob` + `?raw`） | 新写 |
| `make/components/result-viewer/deck-renderer.tsx` | 幻灯片渲染器（iframe + slide 导航 shim + postMessage 滑块状态） | 新写 |
| `make/components/result-viewer/svg-renderer.tsx` | SVG 渲染器（预览/源码切换） | 新写 |
| `make/components/design-system-picker.tsx` | 设计系统下拉选择器（搜索 + 列表） | 新写 |
| `packages/app/octoapp/design-systems/` | 150 套设计系统（DESIGN.md + tokens.css） | 复制 open-design `design-systems/` |
| `packages/app/octoapp/design-systems/index.json` | 设计系统索引（自动从 DESIGN.md H1 标题生成） | 脚本生成 |

### 实际修改文件（8 个）

| 文件 | 修改内容 |
|------|----------|
| `make/components/insight-turn.tsx` | 扩展 `OutputCardType`（+deck/svg/markdown-document/code-snippet）；新增 `artifactKind` 字段；新增 `parseArtifactFromText()` 双路径检测；新增 `ARTIFACT_TYPE_MAP` 类型映射；新增 `IconCardDeck`/`IconCardSvg` 图标引用 |
| `make/components/result-viewer/tab-store.ts` | `ResultTab.type` 同步扩展 |
| `make/components/result-viewer/index.tsx` | 导入 DeckRenderer/SvgRenderer；`<Switch>` 新增 deck/svg/markdown-document 的 `<Match>` |
| `make/icons/index.tsx` | 新增 `IconCardDeck`（矩形叠放图标）、`IconCardSvg`（三角+圆图标） |
| `make/index.tsx` | 导入 DesignSystemPicker + loadDesignSystem；新增 `selectedDesignSystem` 信号；`sendMessage` 增加设计系统 prompt 前缀注入；输入栏添加 DesignSystemPicker |
| `packages/opencode/src/agent/prompt/octo_make.txt` | 重写为包含 `<artifact>` 输出格式 + 设计系统绑定 + 技术规范的完整 prompt |
| `packages/opencode/src/agent/skills/octo_make/html-prototype/SKILL.md` | 充实为包含 artifact 格式、设计系统绑定、原型模式的完整 skill |

### 计划中列出但实际未修改的文件

| 文件 | 原因 |
|------|------|
| `make/components/result-viewer/action-bar.tsx` | 通用 copy/download 已满足需求，deck/svg 暂无额外操作 |
| `packages/app/vite.js` | 使用 `import.meta.glob` 替代 fetch，无需添加 static serving |
| `packages/opencode/src/session/system.ts` | 设计系统通过客户端 prompt 前缀注入 |
| `packages/opencode/src/session/prompt.ts` | 同上 |

### 关键设计决策变更

**设计系统加载方式**：计划中用 `fetch` 加载，实际改为 `import.meta.glob` + `query: '?raw'` 懒加载。

原因：设计系统文件在 `packages/app/octoapp/design-systems/`（不在 Vite `public/` 目录），用 `fetch` 需要 Vite 提供静态文件服务（需修改 `vite.js`，超出计划范围）。`import.meta.glob` 直接在构建时生成动态导入，运行时按需加载，无需任何配置改动。

```ts
const designModules = import.meta.glob("../../design-systems/*/DESIGN.md", {
  query: "?raw", import: "default", eager: false,
})
```
