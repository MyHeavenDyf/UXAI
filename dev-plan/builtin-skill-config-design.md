# 内置 Skill 配置控制方案设计

## 需求

1. 内置一批 Skill，打包进入应用发布产物
2. 通过 JSON 配置（格式 `"skillName": boolean`）控制是否读取
3. **规则**：`false` 的不读取，其他都读取
4. 配置放在 octo 专属全局目录 `~/.config/octo/`
5. 未来通过前端 UI 修改

---

## 配置位置

**新建**: `~/.config/octo/skills.json`

| 平台 | 路径 |
|------|------|
| Linux/macOS | `~/.config/octo/skills.json` |
| Windows | `%APPDATA%/octo/skills.json` |

与现有 `~/.config/opencode/` 分离，作为 octo 品牌专属配置目录。

---

## 配置格式

```json
{
  "code-review": true,
  "testing-guide": false,
  "debugging": false
}
```

| 配置值 | 行为 |
|--------|------|
| `false` | 不读取 |
| `true` 或未列出 | 读取 |

---

## 需要修改的文件

### 1. `packages/core/src/global.ts` — 新增 octo 配置路径

```typescript
// 现有
const app = "opencode"
const config = path.join(xdgConfig!, app)

// 新增 octo 专属配置目录
const octoConfig = path.join(xdgConfig!, "octo")

const paths = {
  // ...现有字段...
  config,
  octoConfig,  // 新增
}

// mkdir 也需创建
fs.mkdir(octoConfig, { recursive: true })
```

### 2. `packages/core/src/global.ts` — Interface 新增字段

```typescript
export interface Interface {
  // ...现有字段...
  readonly config: string
  readonly octoConfig: string  // 新增
}
```

### 3. `packages/opencode/src/skill/index.ts` — 添加过滤逻辑

在 `discoverSkills()` 末尾添加（约 line 209）：

```typescript
// 读取 octo 全局 skills.json
const skillConfigPath = path.join(global.octoConfig, "skills.json")
const skillConfigExists = yield* fsys.exists(skillConfigPath)

if (skillConfigExists) {
  const skillConfig = yield* Effect.tryPromise({
    try: () => Bun.file(skillConfigPath).json(),
    catch: () => null as Record<string, boolean> | null,
  })

  if (skillConfig && typeof skillConfig === "object") {
    state.matches = new Set(
      Array.from(state.matches).filter((match) => {
        const skillDir = path.basename(path.dirname(match))
        return skillConfig[skillDir] !== false
      })
    )
  }
}
```

### 4. 新增内置 Skill 文件

```
packages/opencode/src/agent/skills/builtin/
├── code-review/
│   └── SKILL.md
├── git-workflow/
│   └── SKILL.md
├── testing-guide/
│   └── SKILL.md
├── documentation/
│   └── SKILL.md
└── debugging/
    └── SKILL.md
```

### 5. 确保 SKILL.md 打包

确认 Bun 打包时 `src/agent/skills/` 下的 `.md` 文件被复制到输出目录。`import.meta.dir` 打包后指向编译输出目录。

---

## 数据流

```
~/.config/octo/skills.json
            │
            ▼
discoverSkills() 扫描所有 SKILL.md
            │
            ▼
读取 skills.json → 移除 false 的
            │
            ▼
loadSkills() → Agent 可用 Skill
```

## 关键文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/core/src/global.ts` | 修改 | 新增 `octoConfig` 路径 |
| `packages/opencode/src/skill/index.ts` | 修改 | 添加过滤逻辑 |
| `src/agent/skills/builtin/*/SKILL.md` | 新增 | 内置 Skill |

## 验证步骤

1. 创建 `~/.config/octo/skills.json`
2. 设置某 Skill 为 `false`，确认不加载
3. 不设置某 Skill，确认默认加载
4. 打包后测试路径
