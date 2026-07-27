# 技能库页面实现方案（Electron IPC）

## 需求

1. 侧边栏"技能库"导航按钮跳转到技能库页面
2. 页面按 agent 分组展示内置 skills，每个 skill 显示名称、描述、import 开关
3. 开关控制 `~/.config/octo/skills.json` 中的 `import` 字段
4. 数据读写通过 Electron IPC，不修改 server 端

---

## 技能数据源

**文件**: `~/.config/octo/skills.json`（由 `deploySkillsJson()` 在首次启动时部署）

```json
{
  "html-prototype": { "description": "HTML prototype generation patterns and best practices", "import": true },
  "interview-analysis": { "description": "用户访谈分析方法论 — 文件上传、多维度分析、结构化输出", "import": true },
  "design-basics": { "description": "UI design fundamentals and best practices for octo_design agent", "import": true },
  "creative-assets": { "description": "Creative asset generation guidelines for images, videos, and other media", "import": true }
}
```

**Agent 分组映射**（硬编码在前端，来自 `agent/agent.ts` 的 skills 数组）：

| Agent | Label | Skills |
|-------|-------|--------|
| `octo_insight` | Octo Insight（用户研究） | interview-analysis |
| `octo_make` | Octo Make（原型生成） | html-prototype |
| `octo_design` | Octo Design（UI 设计） | design-basics |
| `octo_canva` | Octo Canva（创意生成） | creative-assets |

---

## 实现步骤

### Step 1：Electron IPC 三层添加

#### 1a. 类型定义 — `packages/desktop/src/preload/types.ts`

在 `ElectronAPI` 中新增：

```typescript
// SkillsConfig 类型
export type SkillConfigEntry = { description?: string; import?: boolean }
export type SkillsConfig = Record<string, SkillConfigEntry>

// 在 ElectronAPI 末尾添加：
getSkillsConfig: () => Promise<SkillsConfig>
setSkillsConfig: (config: SkillsConfig) => Promise<void>
```

#### 1b. Preload 桥接 — `packages/desktop/src/preload/index.ts`

在 `api` 对象末尾添加：

```typescript
getSkillsConfig: () => ipcRenderer.invoke("get-skills-config"),
setSkillsConfig: (config) => ipcRenderer.invoke("set-skills-config", config),
```

#### 1c. Main 进程处理 — `packages/desktop/src/main/ipc.ts`

无需添加到 `Deps` 类型（文件操作是自包含的）。在 `registerIpcHandlers()` 末尾添加自包含 handler：

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// 在 registerIpcHandlers() 函数体内末尾添加：

const skillsConfigPath = join(homedir(), ".config", "octo", "skills.json")

ipcMain.handle("get-skills-config", () => {
  try {
    if (!existsSync(skillsConfigPath)) return {}
    return JSON.parse(readFileSync(skillsConfigPath, "utf-8"))
  } catch {
    return {}
  }
})

ipcMain.handle("set-skills-config", (_event: IpcMainInvokeEvent, config: Record<string, any>) => {
  try {
    mkdirSync(dirname(skillsConfigPath), { recursive: true })
    writeFileSync(skillsConfigPath, JSON.stringify(config, null, 2), "utf-8")
  } catch (err) {
    log.warn("set-skills-config failed", err)
  }
})
```

> 注意：`dirname` 已在文件中通过 `import { dirname } from "node:path"` 导入（参照同文件其他 handler）。如未导入需补充。

---

### Step 2：技能库页面

**新建**: `packages/app/octoapp/pages/skills/index.tsx`

#### 数据流

1. `onMount` 时调用 `window.api.getSkillsConfig()` 获取 skills.json
2. 按 `AGENT_GROUPS` 硬编码映射分组渲染
3. Toggle 切换时：更新本地 state → 调用 `window.api.setSkillsConfig(merged)` 写入

#### UI 结构

```
┌─────────────────────────────────┐
│  Octo Insight（用户研究）    ▾  │  ← 手风琴 section header
│  ┌───────────────────────────┐  │
│  │ ⭐ interview-analysis   ○─│  │  ← skill 行：icon + name + toggle
│  │   用户访谈分析方法论       │  │  ← description
│  └───────────────────────────┘  │
│                                 │
│  Octo Make（原型生成）      ▾  │
│  ┌───────────────────────────┐  │
│  │ ⭐ html-prototype      ●─○│  │
│  │   HTML prototype genera…  │  │
│  └───────────────────────────┘  │
│                                 │
│  Octo Design（UI 设计）     ▾  │
│  └── ...                        │
│                                 │
│  Octo Canva（创意生成）     ▾  │
│  └── ...                        │
└─────────────────────────────────┘
```

#### 关键实现

```typescript
import { createSignal, For, Show, onMount } from "solid-js"
import { useNavigate } from "@solidjs/router"

const AGENT_GROUPS = [
  { agent: "octo_insight", label: "Octo Insight", subtitle: "用户研究", skills: ["interview-analysis"] },
  { agent: "octo_make", label: "Octo Make", subtitle: "原型生成", skills: ["html-prototype"] },
  { agent: "octo_design", label: "Octo Design", subtitle: "UI 设计", skills: ["design-basics"] },
  { agent: "octo_canva", label: "Octo Canva", subtitle: "创意生成", skills: ["creative-assets"] },
]

// 页面组件
// - onMount: window.api.getSkillsConfig() → setConfig
// - 每个 section 渲染 group.label + group.subtitle
// - 每个 skill 行：name + config[skillName].description + toggle
// - toggle onChange: 更新 config 中对应 skill 的 import → window.api.setSkillsConfig()
```

#### 样式参照

沿用侧边栏的 CSS 变量风格：
- 背景：`var(--octo-surface-base)` 或透明
- 文字：`var(--octo-text-primary)`, `var(--octo-text-secondary)`
- 选中/悬停：`var(--octo-surface-selected)`, `var(--octo-surface-hover)`
- Toggle active：`var(--octo-brand, #0067D1)`

---

### Step 3：路由注册

**文件**: `packages/app/octoapp/app.tsx`

#### 3a. 添加 lazy import（line 51-57 区域）

```typescript
const SkillsPage = lazy(() => import("@/pages/skills"))
```

#### 3b. 添加路由（line 419-420 区域，与 insight/make 同级）

```typescript
<Route path="/skills" component={SkillsPage} />
```

#### 3c. 更新 isOctoPage()（line 361-363）

```typescript
const isOctoPage = () => {
  const p = location.pathname
  return p === "/insight" || p.startsWith("/insight/")
    || p === "/make" || p.startsWith("/make/")
    || p === "/skills"
}
```

---

### Step 4：侧边栏导航

**文件**: `packages/app/octoapp/pages/_shell/sidebar.tsx`

#### 4a. 修改 skill_market 的 onClick（line 373）

```typescript
// 原来：onClick={() => setActiveNav((v) => (v === item.key ? null : item.key))}
// 改为：
onClick={() => {
  if (item.key === "skill_market") {
    navigate("/skills")
  } else {
    setActiveNav((v) => (v === item.key ? null : item.key))
  }
}}
```

#### 4b. 更新 activeNav 判断（line 369）

```typescript
// 原来：const isActive = () => activeNav() === item.key
// 改为：
const isActive = () =>
  item.key === "skill_market"
    ? location.pathname === "/skills"
    : activeNav() === item.key
```

---

## 关键文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/desktop/src/preload/types.ts` | 修改 | 新增 SkillsConfig 类型 + ElectronAPI 方法签名 |
| `packages/desktop/src/preload/index.ts` | 修改 | 新增 IPC 桥接 |
| `packages/desktop/src/main/ipc.ts` | 修改 | 新增 get/set-skills-config handler |
| `packages/app/octoapp/pages/skills/index.tsx` | 新建 | 技能库页面组件 |
| `packages/app/octoapp/app.tsx` | 修改 | 路由 + isOctoPage |
| `packages/app/octoapp/pages/_shell/sidebar.tsx` | 修改 | 技能库导航跳转 |

---

## 验证

1. `bun dev:desktop` 启动桌面端
2. 点击侧边栏"技能库" → 跳转 `/skills` 页面
3. 确认 4 个 agent 分组显示，共 4 个 skill
4. Toggle 某个 skill → 检查 `~/.config/octo/skills.json` 对应 `import` 字段已变更
5. 刷新/重进页面 → 确认 toggle 状态持久化
6. 导航到 insight/make 页面再切回 skills → 状态保持
