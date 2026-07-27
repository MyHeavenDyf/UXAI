# 技能库：统一 Skill 目录 + 添加按钮

## Context

当前技能库页面硬编码 4 个内置 skill（`AGENT_GROUPS`），且 Desktop IPC 路径与 opencode 不一致导致 toggle 无效。需要：
1. 统一所有 skill（内置 + 用户自定义）存放于 `octoConfig/skill/` 目录
2. `skills.json` 新增 `type` 字段标识所属 agent，前端动态读取分组
3. 修复路径不一致问题
4. 技能库页面右上角添加"添加 Skill"按钮

---

## 现状分析

### Skill 发现机制

`discoverSkills()` 扫描 7 个来源，内置 skill 在 `agent/skills/`（Source 5），但**没有 `octoConfig/skill/` 目录**作为来源。

### skills.json 当前结构

```json
{
  "interview-analysis": { "description": "...", "import": true },
  "html-prototype": { "description": "...", "import": true },
  "design-basics": { "description": "...", "import": true },
  "creative-assets": { "description": "...", "import": true }
}
```

**缺失 `type` 字段**，无法知道每个 skill 属于哪个 agent。

### 路径问题（P0，已验证）

| 组件 | 路径 | 说明 |
|------|------|------|
| `octoConfig`（`global.ts`） | `~/.config/octo` | `xdgConfig + "/octo"`，Windows 上为 `HOME/.config/octo`（不是 `%APPDATA%`） |
| **Opencode 读取** | `~/.config/octo/skills.json` | 实际生效的配置 |
| **Desktop IPC 写入** | `AppData/Roaming/ai.octo.desktop.dev/skills.json` | `app.getPath("userData")`，与 opencode 不同 |

**结果**：前端 toggle 操作写入 Electron userData，opencode 完全不感知，用户操作无效。

### 技能库页面

- 硬编码 `AGENT_GROUPS`（4 个内置 skill，按 agent 分组）
- 无动态发现，无添加按钮

### 已有基础设施

- `deploySkillsJson()` 部署默认 `skills.json` 到 `~/.config/octo/`（`migrate.ts:141`）
- `build-node.ts` 构建时生成 `skills.json`（从 `agent/skills/` 提取）
- 文件选择器 IPC 已完整实现
- 内置 skill 位于 `src/agent/skills/{agent}/{skill}/SKILL.md`

---

## 修改方案

### 核心设计：统一 Skill 目录

**所有 skill（内置 + 用户自定义）存放于 `octoConfig/skill/` 目录**：
- 内置 skill 在应用启动时从打包目录复制到 `~/.config/octo/skill/`
- 用户通过"添加技能"按钮添加的 skill 也存入此目录
- `discoverSkills()` 扫描此目录发现所有 skill
- `skills.json` 记录所有 skill 的配置，包含 `type` 字段标识 agent

**`skills.json` 新结构**：
```json
{
  "interview-analysis": {
    "description": "用户访谈分析方法论",
    "import": true,
    "type": "octo_insight"
  },
  "html-prototype": {
    "description": "HTML 原型生成",
    "import": true,
    "type": "octo_make"
  },
  "design-basics": {
    "description": "UI 设计基础",
    "import": true,
    "type": "octo_design"
  },
  "creative-assets": {
    "description": "创意资产生成",
    "import": true,
    "type": "octo_studio"
  },
  "my-custom-skill": {
    "description": "我的自定义技能",
    "import": true,
    "type": "common"
  }
}
```

`type` 字段：
- 内置 skill：对应 agent 名称（`octo_insight`、`octo_make`、`octo_design`、`octo_studio`）
- 用户自定义 skill 及其他公共 skill：`"common"`（表示公共/通用，不属于特定 agent）

---

## 文件修改清单

### 1. `packages/opencode/script/build-node.ts` — 构建 skills.json 带 type

修改 `generateSkills()` 函数，在生成 `skills.json` 时提取 agent 名称作为 `type`：

```ts
// 改后：从目录路径提取 agent 名称
for (const skillPath of skillPaths) {
  // skillPath 格式: src/agent/skills/{agent}/{skill}/SKILL.md
  const parts = skillPath.split("/")
  const agent = parts[parts.indexOf("skills") + 1]  // e.g. "octo_insight"
  const skillName = parts[parts.length - 2]  // e.g. "interview-analysis"
  
  const content = fs.readFileSync(skillPath, "utf-8")
  const descMatch = content.match(/description:\s*(.+)/)
  const description = descMatch?.[1]?.trim() ?? ""
  
  skills[skillName] = { description, import: true, type: agent }
}
```

### 2. `packages/desktop/src/main/migrate.ts` — 新增部署内置 skill 目录

新增 `deployBuiltinSkills()` 函数，将内置 skill 复制到 `octoConfig/skill/`：

```ts
export function deployBuiltinSkills() {
  const octoSkillDir = join(homedir(), ".config", "octo", "skill")
  
  // 打包后的内置 skill 目录
  const builtinSource = process.resourcesPath
    ? join(process.resourcesPath, "skills")  // 打包后：resources/skills/
    : join(__dirname, "..", "..", "..", "opencode", "dist", "node", "skills")  // dev
  
  // 创建目标目录
  mkdirSync(octoSkillDir, { recursive: true })
  
  // 复制内置 skill（仅复制不存在的，避免覆盖用户修改）
  const skills = ["interview-analysis", "html-prototype", "design-basics", "creative-assets"]
  for (const skill of skills) {
    const dest = join(octoSkillDir, skill)
    if (!existsSync(dest)) {
      cpSync(join(builtinSource, skill), dest, { recursive: true })
    }
  }
}
```

打包配置需将 `skills/` 目录包含在 `resources` 中（`electron-builder.yml` 或类似配置）。

修改 `index.ts` 启动时调用：
```ts
deploySkillsJson()
deployBuiltinSkills()  // 新增
```

**同步修复 `deploySkillsJson` 路径**（当前已正确使用 `~/.config/octo/`）。

### 3. `packages/desktop/src/main/ipc.ts` — 修复路径 + 新增 IPC

#### 3.1 修复 skills.json 路径

```ts
// 改前
const skillsConfigPath = join(app.getPath("userData"), "skills.json")

// 改后：与 xdg-basedir 保持一致（Windows 上使用 HOME/.config）
function getOctoConfigPath(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "octo")
}
const skillsConfigPath = join(getOctoConfigPath(), "skills.json")
```

#### 3.2 新增 `add-skill` IPC handler

```ts
ipcMain.handle("add-skill", async (_event, sourcePath: string) => {
  const octoSkillDir = join(getOctoConfigPath(), "skill")
  mkdirSync(octoSkillDir, { recursive: true })
  
  const skillName = basename(sourcePath)
  const destDir = join(octoSkillDir, skillName)
  
  if (existsSync(destDir)) {
    return { success: false, error: "同名 skill 已存在" }
  }
  
  await fs.cp(sourcePath, destDir, { recursive: true })
  
  // 更新 skills.json，type 为 "common"
  const config = await readSkillsConfig()
  const skillMd = join(destDir, "SKILL.md")
  const desc = extractDescription(readFileSync(skillMd, "utf-8"))
  config[skillName] = { description: desc, import: true, type: "common" }
  await writeSkillsConfig(config)
  
  return { success: true, skillName }
})
```

#### 3.3 新增 `get-skills-with-type` IPC handler

返回带 `type` 字段的完整配置：

```ts
ipcMain.handle("get-skills-with-type", async () => {
  return readSkillsConfig()  // 已包含 type 字段
})
```

### 4. `packages/desktop/src/preload/` — 暴露新 IPC

**preload/index.ts**：
```ts
addSkill: (sourcePath) => ipcRenderer.invoke("add-skill", sourcePath),
getSkillsWithType: () => ipcRenderer.invoke("get-skills-with-type"),
```

**preload/types.ts**：
```ts
type SkillConfigEntry = { description?: string; import?: boolean; type?: string }
type SkillsConfig = Record<string, SkillConfigEntry>

addSkill: (sourcePath: string) => Promise<{ success: boolean; skillName?: string; error?: string }>
getSkillsWithType: () => Promise<SkillsConfig>
```

### 5. `packages/opencode/src/skill/index.ts` — 新增扫描源

在 `discoverSkills()` 中新增扫描 `octoConfig/skill/`：

```ts
// 在 Source 5 (built-in) 之后
const octoSkillDir = path.join(global.octoConfig, "skill")
if (yield* fsys.isDir(octoSkillDir)) {
  yield* scan(state, octoSkillDir, "**/SKILL.md")
}
```

**注意**：内置 skill 现在也从此目录发现，不再需要 Source 5 的 `agent/skills/` 扫描（可保留作为备用）。

### 6. `packages/app/octoapp/pages/skills/index.tsx` — 动态分组 + 添加按钮

#### 6.1 移除硬编码，动态从 config 分组

```ts
// Agent 显示信息
const AGENT_INFO: Record<string, { label: string; subtitle: string }> = {
  octo_insight: { label: "Octo Insight", subtitle: "用户研究" },
  octo_make: { label: "Octo Make", subtitle: "原型生成" },
  octo_design: { label: "Octo Design", subtitle: "UI 设计" },
  octo_studio: { label: "Octo Studio", subtitle: "图片创作" },
  common: { label: "公共技能", subtitle: "适用于所有 Agent" },
}

// 动态分组：从 skills.json 按 type 字段分组
const groupedSkills = createMemo(() => {
  const config = skillsConfig()
  const groups: Record<string, { skills: string[]; label: string; subtitle: string }> = {}
  
  for (const [name, entry] of Object.entries(config)) {
    if (entry.import === false) continue  // 排除已关闭的
    const type = entry.type || "common"
    if (!groups[type]) {
      groups[type] = {
        skills: [],
        label: AGENT_INFO[type]?.label || type,
        subtitle: AGENT_INFO[type]?.subtitle || "",
      }
    }
    groups[type].skills.push(name)
  }
  return groups
})
```

#### 6.2 渲染结构

```tsx
<For each={Object.entries(groupedSkills())}>
  {[type, group] => (
    <SkillGroup
      type={type}
      label={group.label}
      subtitle={group.subtitle}
      skills={group.skills}
      config={skillsConfig()}
      onToggle={toggleSkill}
    />
  )}
</For>
```

#### 6.3 右上角添加按钮

```tsx
<div class="flex items-center justify-between mb-4">
  <div>
    <h1 class="text-lg font-semibold">技能库</h1>
    <p class="text-xs text-gray-500">管理各 Agent 的技能</p>
  </div>
  <button
    onClick={handleAddSkill}
    class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600"
  >
    + 添加技能
  </button>
</div>
```

---

## 数据流

```
应用启动
  ↓ deploySkillsJson() → ~/.config/octo/skills.json（含 type 字段）
  ↓ deployBuiltinSkills() → ~/.config/octo/skill/{skill-name}/
  ↓
discoverSkills() 扫描 octoConfig/skill/**/SKILL.md
  ↓ skills.json 过滤（import !== false）
  ↓ loadSkills() 加载所有启用的 skill
  ↓
前端 getSkillsWithType() 获取配置
  ↓ 按 type 分组渲染
  ↓
用户点击"添加技能" → 选择目录 → add-skill IPC
  ↓ 复制到 octoConfig/skill/
  ↓ 更新 skills.json（type: "common"）
  ↓ 前端刷新显示
```

---

## 验证

1. `bun run --cwd packages/desktop dev`
2. 首次启动 → `~/.config/octo/skill/` 包含 4 个内置 skill
3. `~/.config/octo/skills.json` 包含 type 字段，每个 skill 对应正确 agent
4. 技能库页面按 agent 分组显示 4 个内置 skill
5. 点击"添加技能" → 选择包含 SKILL.md 的文件夹 → 新 skill 出现在"公共技能"分组
6. toggle skill → skills.json 更新，重启后状态持久化
7. 创建 insight session → 系统提示包含已开启的 skill

---

## 方案 B：会话启动时实时读取 skills.json 过滤（待实现）

### 背景

当前方案 A 通过 `POST /skill/refresh` API 刷新 opencode 的 skill 缓存。但依赖前端在 toggle 后主动调用 API，如果直接编辑 `skills.json` 文件或通过其他方式修改配置，缓存不会更新。

方案 B 将 skill 过滤逻辑从 `discoverSkills()`（缓存层）移到会话创建时实时执行，确保每次新建会话都能读取最新的 `skills.json`。

### 当前问题

`discoverSkills()` 在 `skill/index.ts:207-224` 中读取 `skills.json` 并过滤，但结果被 `InstanceState` 缓存。缓存只在实例销毁时失效，不会因为 `skills.json` 变更而自动刷新。

### 修改方案

#### 1. `packages/opencode/src/skill/index.ts` — 分离发现与过滤

将 `discoverSkills()` 中的过滤逻辑移除，改为发现所有 skill：

```ts
// discoverSkills() 中移除第207-224行的 skills.json 过滤逻辑
// 直接返回所有匹配的 SKILL.md
return {
  matches: Array.from(state.matches),  // 不再过滤
  dirs: Array.from(state.dirs),
}
```

新增 `filterByConfig()` 函数，在 `Skill.available()` 中实时过滤：

```ts
const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
  const s = yield* InstanceState.get(state)
  const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))

  // 实时读取 skills.json 过滤
  const skillConfigPath = path.join(global.octoConfig, "skills.json")
  const skillConfig = yield* Effect.tryPromise({
    try: () =>
      import("fs/promises").then((fs) =>
        fs.readFile(skillConfigPath, "utf-8").then((text) =>
          JSON.parse(text) as Record<string, { import?: boolean }>
        ),
      ),
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)))

  const filtered = skillConfig && typeof skillConfig === "object"
    ? list.filter((skill) => {
        const entry = skillConfig[skill.name]
        if (entry && typeof entry === "object") return entry.import !== false
        return true
      })
    : list

  if (!agent) return filtered
  return filtered.filter(
    (skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny"
  )
})
```

#### 2. `packages/opencode/src/session/system.ts` — 确认调用链

确认 `sys.skills(agent)` 最终调用 `Skill.available(agent)`，这样每次构建系统提示都会实时读取 `skills.json`。

### 优势

- 直接编辑 `skills.json` 文件立即生效
- 无需手动调用 refresh API
- 无需 file watcher
- 每次会话创建时都能读到最新配置

### 注意事项

- `available()` 每次调用会读磁盘（`skills.json` 通常很小，<1KB），性能影响可忽略
- `discoverSkills()` 的缓存仍负责 SKILL.md 文件的发现和加载，只是不再负责过滤
- `refresh` API 仍保留，用于 SKILL.md 文件变更（添加/删除 skill 文件）时刷新发现缓存