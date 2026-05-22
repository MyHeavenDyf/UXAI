# Insight 页面 Octo 适配记录

> 本文档记录 octoAI 在 `packages/app/octoapp/pages/insight/` 中的独有修改。
> 每次从 octo-agent 合入时，按此清单保留 Octo 适配。

---

## Octo 适配清单

### 1. Binary 导入路径（`index.tsx`）

```typescript
// octo-agent 上游:
import { Binary } from "@opencode-ai/shared/util/binary"
// octoAI（保留）:
import { Binary } from "@opencode-ai/core/util/binary"
```

**原因**: octoAI monorepo 中 `Binary` 工具类位于 `@opencode-ai/core` 包。

---

### 2. 项目目录解析（`index.tsx`）

```typescript
// octo-agent 上游:
const homeDir = () => globalSync.data.path.home
// octoAI（保留）:
import { useProjectDir } from "@/hooks/use-project-dir"
const homeDir = useProjectDir()
```

**原因**: octoAI 使用 `useProjectDir()` hook 统一解析项目目录，优先级为 URL params → server.projects.last() → globalSync.data.path.home。相关 commit: `a43dd33f9`。

---

### 3. Agent 名称（`index.tsx`，2 处）

```typescript
// octo-agent 上游:
// session.create:
const result = await globalSDK.client.session.create({ directory: dir })
// prompt:
agent: "insight",

// octoAI（保留）:
// session.create:
const result = await globalSDK.client.session.create({ directory: dir, agent: "octo_insight" })
// prompt:
agent: "octo_insight",
```

**原因**: octoAI 注册的 agent 名为 `octo_insight`（带前缀避免与上游冲突）。

---

### 4. CSS token（`octo-tokens.css`）

```css
--octo-brand-a5: rgba(0, 103, 209, 0.05);
```

**原因**: octoAI 独立添加的超低透明度 brand 变量，用于 action-bar hover 效果。octo-agent 上游不含此变量。位于 CSS 变量声明区域（约第 15 行）。

---

## 合并操作速查

| 操作 | 文件 | 说明 |
|------|------|------|
| 保留适配 A | `index.tsx` | Binary 导入路径 `@opencode-ai/core/util/binary` |
| 保留适配 B | `index.tsx` | `useProjectDir` hook 导入和使用 |
| 保留适配 C | `index.tsx` | agent 名称 `octo_insight`（2 处） |
| 保留适配 D | `octo-tokens.css` | `--octo-brand-a5` token |
| 直接替换 | 其余所有 insight 文件 | octoAI 无独有修改，直接用上游覆盖 |

