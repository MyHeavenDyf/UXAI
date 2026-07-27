# Insight 页面 Octo 适配记录

> 本文档记录 octoAI 在 `packages/app/octoapp/pages/insight/` 中的独有修改。
> 每次从 octo-agent 合入时，按此清单保留 Octo 适配。

---

## Octo 适配清单

### 1. 项目目录解析 + SDK Client 绑定（`index.tsx` InsightContent）

**外层 `InsightPage`（不变）：**
```typescript
import { useProjectDir } from "@/hooks/use-project-dir"
const homeDir = useProjectDir()
// 传给 SDKProvider
<SDKProvider directory={() => dir}>
```

**内层 `InsightContent`（2026-05-25 修复）：**
```typescript
// octo-agent 上游:
const globalSDK = useGlobalSDK()
const globalSync = useGlobalSync()
const homeDir = () => globalSync.data.path.home
// → session.create / prompt 使用 globalSDK.client（无 directory header）

// octoAI（保留）:
const sdk = useSDK()
// → session.create / prompt 使用 sdk.client（已绑定项目 directory header）
// → directory 取 sdk.directory（来自外层 SDKProvider）
```

**原因**: octoAI 使用 `SDKProvider` + `useSDK()` 模式，`sdk.client` 通过 `createClient({ directory })` 自动附加 `x-opencode-directory` header。上游 `globalSDK.client` 不带此 header，导致 session 创建在 HOME 目录而非项目目录，`octo_insight` agent 的 `uxr-tool` MCP 无法连接。

**涉及替换（3 处）：**
- `createAndNavigate()`: `homeDir()` → `sdk.directory`，`globalSDK.client.session.create()` → `sdk.client.session.create()`
- `doSendPrompt()`: `globalSDK.client.session.promptAsync()` → `sdk.client.session.promptAsync()`（上游 SPEC-INS-007 已从 `prompt()` 改为 `promptAsync()` + optimistic）
- `DataProvider`: `directory={homeDir() || ""}` → `directory={sdk.directory || ""}`

---

### 2. Agent 名称 + directory 参数（`index.tsx`，2 处）

```typescript
// octo-agent 上游:
// session.create:
const result = await globalSDK.client.session.create({ directory: dir })
// promptAsync:
agent: "insight",

// octoAI（保留）:
// session.create:
const result = await sdk.client.session.create({ directory: sdk.directory, agent: "octo_insight" })
// promptAsync:
agent: "octo_insight",
```

**原因**: octoAI 注册的 agent 名为 `octo_insight`（带前缀避免与上游冲突）。同时使用 `sdk.client` 确保 directory header 正确传递。

---

### 3. CSS token（`octo-tokens.css`）

```css
--octo-brand-a5: rgba(0, 103, 209, 0.05);
```

**原因**: octoAI 独立添加的超低透明度 brand 变量，用于 action-bar hover 效果。octo-agent 上游不含此变量。位于 CSS 变量声明区域（约第 15 行）。

---

## 已废弃的适配（无需再保留）

### ~~Binary 导入路径~~（已移除）

上游 commit `a0d4141`（SPEC-INS-005）将数据层切换为 opencode 原生 `sync.data` + `SyncProvider`，不再使用 `Binary` 二分查找。此适配自该 commit 起无需保留。

```typescript
// 已废弃 — 上游已不再使用 Binary
// import { Binary } from "@opencode-ai/shared/util/binary"  // 上游
// import { Binary } from "@opencode-ai/core/util/binary"    // octoAI 适配
```

---

## 合并操作速查

| 操作 | 文件 | 说明 |
|------|------|------|
| 保留适配 A | `index.tsx` 内层 | `useSDK()` 替代 `useGlobalSDK()` + `useGlobalSync()`，`sdk.client/directory` 替代 `globalSDK.client` + `homeDir()` |
| 保留适配 B | `index.tsx` | agent 名称 `octo_insight`（2 处） |
| 保留适配 C | `octo-tokens.css` | `--octo-brand-a5` token |
| 直接替换 | 其余所有 insight 文件 | octoAI 无独有修改，直接用上游覆盖 |

---

## 合入记录

### 2026-05-25: commit `4077179` (提示词改预置按钮 + promptAsync/optimistic + 简化 queue)

**上游变更**：
- 删除 `components/prompt-template-selector.tsx` + `store/prompt-template.ts`（模板下拉选择器）
- 新增 `components/preset-prompts.tsx` + `store/preset-prompts.ts`（预置提示词横向滚动按钮组）
- `index.tsx`：移除 `sending` signal + `templateId`，改用 `promptAsync` + optimistic message + queue 排队机制
- `octo-tokens.css`：模板选择器 CSS 替换为预置按钮 + 队列提示条 CSS
- 分隔线拖拽从 `mousedown/mousemove/mouseup` 改为 `pointer events`（修复 Electron webview 中 pointer capture）

**Octo 适配已保留**：适配 A/B/C 全部正确应用，无遗漏。

### 2026-05-26: commits `bbf0c13` + `cb84b73` (收紧嗅探 + tab URI 去重 + Office 唤起 + 全链路 console)

**上游变更**：
- `insight-turn.tsx`：OutputCard 检测拆为双路径（A: MCP resource_link 强契约 / B: 自由文本嗅探），HTML 改用 `scanFencedHtml` 多卡 + 未闭合 fence 支持，删除 length>200 markdown 兜底
- `detect.ts`：新增 `scanFencedHtml` + `HtmlFenceBlock` 类型，`isPlainJSON` 收紧到 ≥80 字符 + fence 或 ≥3 keys
- `result-viewer/index.tsx`：FileFallback 新增"用本地应用打开"和"下载到本地"双按钮（依赖 `electron-api.ts`）
- `result-viewer/tab-store.ts`：openTab 新增 URI 去重（多入口指向同一产物不重复开 tab）
- `index.tsx`：新增 busy→idle 时完整 dump assistant message 内容到 console（内网调试用）
- `lib/electron-api.ts`：新增 Electron preload API 类型抽象（downloadResourceToTemp / openPath / saveFilePicker）
- `store/preset-prompts.ts`：新增 `run_usability_analysis` 预置胶囊
- `utils/resource-link.ts` / `utils/task-detect.ts`：新增全链路 branch 跟踪 console 日志

**Octo 适配已保留**：适配 A/B/C 全部正确应用。`electron-api.ts` 中的 `downloadResourceToTemp` / `downloadResource` 在本项目中尚未实现 IPC handler，FileFallback 会优雅降级（显示 toast 提示桌面 API 不可用）。

### 2026-05-27: commit `4283b01` (对话不抹 + 紧凑入口条 + business_type 标准字段 + JSON 高亮)

**上游变更**：
- `insight-turn.tsx`：重构 OutputCard 检测逻辑，对话不抹（保留上一轮结果），紧凑入口条样式，新增 `business_type` 标准字段判断
- `result-viewer/index.tsx`：调整 tab 渲染逻辑适配新字段
- `mindmap-renderer.tsx`：增强 mindmap 渲染器，使用 mindmap-adapter 适配 UXR JSON 格式
- `tab-store.ts`：简化 tab URI 去重逻辑
- `detect.ts` / `detect.test.ts`：新增 `stripCodeFence` 辅助函数，调整检测策略
- `mindmap-adapter.ts`：新增 UXR JSON → Markdown 转换工具（处理内网 MCP mindmap 工具 shape）
- `resource-link.ts`：新增 resource link 解析辅助函数
- `octo-tokens.css`：新增 CSS 变量/样式

**Octo 适配已保留**：适配 A（useSDK）和 B（octo_insight agent 名）未受影响（index.tsx 未变），适配 C（--octo-brand-a5）已加回 CSS。无 desktop-electron 变更。

### 2026-05-27: commit `83a3418` (预置文案按设计师定稿 + 用户 tooltip 友好化 + agent prompt 去过期段)

**上游变更**：
- `index.tsx`：发送按钮 tooltip "等待附件上传完成" → "请等待附件上传完成"
- `task-card/index.tsx`：3 处 tooltip 友好化（"等待" → "请等待"、"3分钟内只能刷新一次" → "请稍后再试"）
- `preset-prompts.ts`：4 个预置胶囊 label 和 text 按设计师定稿更新（"观点解析" → "观点解析报告" 等）
- `insight.md`（agent prompt）：去掉"模板下拉"过期描述，改为"预置按钮带入文本"表述

**Octo 适配已保留**：index.tsx 仅 tooltip 文案变更（第 844 行），不涉及适配 A/B 的 import/sdk 代码。agent prompt 路径对应 `opencode/src/agent/prompt/octo_insight.txt`，已同步更新。

### 2026-05-30: commit `6855421` (文件上传交互改版——chip 入胶囊 + 气泡文件卡片)

**上游变更**：
- `index.tsx`：附件上限 5→10，超额弹 toast 截断；uploadBlock 走独立 synthetic text part（不再拼进用户可见文本）；doSendPrompt 中 optimistic parts 包含 synthetic 上传块
- `attachment-bar.tsx`：附件条从胶囊外移到胶囊内部顶部，单行横向滚动（overflow-x: auto）
- `insight-turn.tsx`：新增 `parseUploadedFiles` 解析 synthetic 块，渲染用户上传文件卡片（气泡上方，右对齐）
- `upload.ts`：`formatUploadsForPrompt` 去掉前导换行；新增 `parseUploadedFiles` 逆解析函数
- `octo-tokens.css`：新增 `.octo-attach-strip`（附件条滚动）和 `.octo-input-attachments`/`.octo-input-attachment-card`（文件卡片样式）

**Octo 适配已保留**：适配 A（useSDK/sdk.client/sdk.directory）和 B（octo_insight agent 名）已正确应用到 InsightContent。适配 C（--octo-brand-a5）已加回 CSS。agent prompt 无变更，无需同步。

### 2026-06-01: commits `bbcee4c..45d3188` (19 commits: 停止按钮 + 浅色强制 + 标题栏 + 文件上传预过滤 + 产出卡片改版 + FileFallback 三按钮 + mindmap 双卡合一 + 错误卡修复 + 对话背景白色 + 预览卡间距)

**上游变更**（19 个 commit 主要变更）：
- `index.tsx`：停止生成按钮（abort）；会话标题栏（conversation-header）；上传端点未配置时用户友好文案；`useTheme` + mount 时注入亮色 token 覆盖暗色
- `components/conversation-header.tsx`：新增会话标题栏组件（标题编辑、删除、模型选择）
- `components/insight-turn.tsx`：预览卡与下一轮用户消息加 16px 间距；产出卡片改预览/代码切换；mindmap 双卡合一；预览入口卡片简化
- `components/attachment-bar.tsx`：文件上传 accept 预过滤 + 支持类型 tooltip；附件失败 chip 重试与错误提示修复
- `components/result-viewer/index.tsx`：预览/代码切换模式；FileFallback 三按钮（打开/文件夹定位/另存为）
- `components/result-viewer/action-bar.tsx`：产出卡片 action bar 增强
- `components/result-viewer/mindmap-renderer.tsx`：mindmap 渲染逻辑统一检测规则
- `lib/electron-api.ts`：新增 `showItemInFolder` 桌面 API（FileFallback"打开所在文件夹"按钮）
- `lib/upload.ts`：上传端点未配置时友好错误文案
- `utils/detect.ts`：mindmap 检测=渲染同一规则
- `utils/mindmap-adapter.ts`：mindmap adapter 增强
- `octo-tokens.css`：对话背景改白色；用户消息气泡对齐 UXAI 样式；错误 card 文字颜色修复；预置按钮样式调整；停止按钮样式

**Octo 适配已保留**：适配 A（useSDK/sdk.client/sdk.directory）和 B（octo_insight agent 名）已正确应用到 InsightContent（5 处 globalSDK→sdk 替换）。适配 C（--octo-brand-a5）已加回 CSS。agent prompt 无变更。`showItemInFolder` 桌面 API 在本项目 Electron 壳尚未实现，FileFallback 按钮会优雅降级为 toast 提示。
