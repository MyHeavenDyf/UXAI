# 配置文件读取加载路径分析

## 全局路径体系

**文件**: `packages/core/src/global.ts`

```
Global.Path.config  → ~/.config/opencode/     (xdg config)
Global.Path.data    → ~/.local/share/opencode/
Global.Path.state   → ~/.local/state/opencode/
Global.Path.cache   → ~/.cache/opencode/
Global.Path.home    → ~/
```

`Global.Path.config` 可通过 `OPENCODE_CONFIG_DIR` 环境变量覆盖。

---

## 配置加载涉及的文件

| 文件 | 职责 |
|------|------|
| `core/global.ts` | 全局路径定义 |
| `config/paths.ts` | 配置目录和文件发现 |
| `config/config.ts` | 配置加载、合并、写入主逻辑 |
| `config/agent.ts` | Agent 配置加载（.md 文件） |
| `config/command.ts` | 命令配置加载（.md 文件） |
| `config/plugin.ts` | 插件配置加载 |
| `config/managed.ts` | MDM 托管配置 |

---

## 配置加载流程（按顺序）

### 第 1 步：全局配置 (`loadGlobal`, config.ts:420-445)

```
~/.config/opencode/config.json          ← 旧格式
~/.config/opencode/octo.json            ← ✓ octo 优先
~/.config/opencode/octo.jsonc           ← ✓ octo 优先
~/.config/opencode/opencode.json
~/.config/opencode/opencode.jsonc
~/.config/opencode/config               ← TOML 旧格式，自动迁移
```

**注意**: 按顺序加载合并，后者覆盖前者，octo 文件在 opencode 之前。

### 第 2 步：`globalConfigFile()` (config.ts:334-342)

用于 `updateGlobal()` 写入配置时确定目标文件。

```
候选文件（按优先级）:
1. ~/.config/opencode/octo.jsonc        ← ✓ octo 优先
2. ~/.config/opencode/octo.json         ← ✓ octo 优先
3. ~/.config/opencode/opencode.jsonc
4. ~/.config/opencode/opencode.json
5. ~/.config/opencode/config.json
```

如果都不存在，默认写入 `octo.jsonc`（第一个候选）。

### 第 3 步：环境变量配置 (config.ts:565-567)

```
OPENCODE_CONFIG=<filepath>              ← 指定单个配置文件
```

### 第 4 步：项目向上查找配置文件 (config.ts:570-576)

```typescript
for (const name of ["opencode", "octo"]) {   // ← octo 在后（后加载覆盖先加载）
  for (const file of ConfigPaths.files(name, ctx.directory, ctx.worktree)) {
    merge(file, loadFile(file), "local")
  }
}
```

从项目目录向上查找 `octo.json`/`octo.jsonc` 和 `opencode.json`/`opencode.jsonc`。

### 第 5 步：配置目录遍历 (config.ts:590-634)

```typescript
for (const dir of directories) {
  if (dir.endsWith(".octo") || dir.endsWith(".opencode") || ...) {
    // 加载目录下的配置文件
    for (const file of ["opencode.json", "opencode.jsonc", "octo.json", "octo.jsonc"]) {
      merge(source, loadFile(source))
    }
  }
  // 加载 agent、command、plugin 配置
}
```

### 第 6 步：环境变量内容 (config.ts:636-644)

```
OPENCODE_CONFIG_CONTENT=<json-string>   ← 直接传入 JSON 内容
```

---

## 目录发现逻辑

### `ConfigPaths.directories()` (paths.ts:23-41)

**当前**: 只搜索 `.opencode` 目录

```typescript
return unique([
  Global.Path.config,                           // ~/.config/opencode/
  ...afs.up({ targets: [".opencode"], ... }),   // 项目向上找 .opencode
  ...afs.up({ targets: [".opencode"], ... }),   // 用户主目录 .opencode
  ...OPENCODE_CONFIG_DIR,
])
```

**缺失**: 没有搜索 `.octo` 目录。

### `ConfigPaths.files(name, dir, worktree)` (paths.ts:10-21)

搜索 `${name}.json` 和 `${name}.jsonc`，已对 "opencode" 和 "octo" 都调用。

---

## 子配置加载

### Agent 配置 (`config/agent.ts:133`)

**当前模式**:
```typescript
const patterns = ["/.opencode/agent/", "/.opencode/agents/", "/agent/", "/agents/"]
```

**缺失**: 没有 `.octo/agent/` 模式。

### Command 配置 (`config/command.ts:46`)

**当前模式**:
```typescript
const patterns = ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"]
```

**缺失**: 没有 `.octo/command/` 模式。

### Plugin 配置 (`config/plugin.ts:33`)

```typescript
Glob.scan("{plugin,plugins}/*.{ts,js}", { cwd: dir })
```

不受 `.opencode`/`.octo` 前缀影响，在传入的 `dir` 下直接搜索。

---

## 写入逻辑

### `updateGlobal()` (config.ts:795-818)

写入到 `globalConfigFile()` 返回的文件。当前优先级：
1. `octo.jsonc`（默认写入目标）
2. `octo.json`
3. `opencode.jsonc`
4. `opencode.json`
5. `config.json`

**已优先 octo** ✓

---

## 现状总结

| 位置 | octo 已支持 | 需要修改 |
|------|:-----------:|----------|
| 全局文件加载顺序 (`loadGlobal`) | ✓ octo 在 opencode 前 | - |
| 全局文件写入 (`globalConfigFile`) | ✓ 默认写入 octo.jsonc | - |
| 项目文件向上查找 | ✓ 对 "octo" 和 "opencode" 都搜索 | - |
| 目录遍历文件加载 | ✓ 检查 `.octo` 和 `.opencode` | - |
| **目录发现** (`paths.ts`) | ✗ | 添加 `.octo` 到 targets |
| **Agent 模式** (`agent.ts`) | ✗ | 添加 `.octo/agent/` 模式 |
| **Command 模式** (`command.ts`) | ✗ | 添加 `.octo/command/` 模式 |
| 托管配置 (`managed.ts`) | - | 无需修改 |
| 环境变量 | - | 无需修改 |

---

## 需要修改的文件

### 1. `config/paths.ts` — 添加 `.octo` 目录搜索

```typescript
// 现有
targets: [".opencode"]

// 改为
targets: [".octo", ".opencode"]
```

共两处（项目向上 + 主目录）。

### 2. `config/agent.ts` — 添加 `.octo` 模式

```typescript
// 现有
const patterns = ["/.opencode/agent/", "/.opencode/agents/", "/agent/", "/agents/"]

// 改为
const patterns = [
  "/.octo/agent/", "/.octo/agents/",
  "/.opencode/agent/", "/.opencode/agents/",
  "/agent/", "/agents/",
]
```

### 3. `config/command.ts` — 添加 `.octo` 模式

```typescript
// 现有
const patterns = ["/.opencode/command/", "/.opencode/commands/", "/command/", "/commands/"]

// 改为
const patterns = [
  "/.octo/command/", "/.octo/commands/",
  "/.opencode/command/", "/.opencode/commands/",
  "/command/", "/commands/",
]
```

---

## 完整配置优先级（修改后）

```
低 ←────────────────────────────────────────────────────→ 高

1. 代码默认值
2. ~/.config/opencode/config.json (旧)
3. ~/.config/opencode/octo.json
4. ~/.config/opencode/octo.jsonc
5. ~/.config/opencode/opencode.json
6. ~/.config/opencode/opencode.jsonc
7. OPENCODE_CONFIG 指定文件
8. 项目向上 octo.json / octo.jsonc (后加载覆盖)
9. 项目向上 opencode.json / opencode.jsonc
10. .octo/ 目录下的配置文件 (新增)
11. .opencode/ 目录下的配置文件
12. OPENCODE_CONFIG_CONTENT 环境变量
13. 托管/MDM 配置
```

octo 配置始终在 opencode 之前或同级优先。
