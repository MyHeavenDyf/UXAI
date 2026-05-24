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
- `doSendPrompt()`: `globalSDK.client.session.prompt()` → `sdk.client.session.prompt()`
- `DataProvider`: `directory={homeDir() || ""}` → `directory={sdk.directory || ""}`

---

### 2. Agent 名称 + directory 参数（`index.tsx`，2 处）

```typescript
// octo-agent 上游:
// session.create:
const result = await globalSDK.client.session.create({ directory: dir })
// prompt:
agent: "insight",

// octoAI（保留）:
// session.create:
const result = await sdk.client.session.create({ directory: sdk.directory, agent: "octo_insight" })
// prompt:
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
