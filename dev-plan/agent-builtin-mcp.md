# Agent 内置 MCP 服务器绑定方案

## 需求

每个 agent 绑定专属内置 MCP 服务器（优先加载），同时用户自定义的 MCP 也一并加载：
- `octo_design` → 内置设计 MCP（如 Pixso）+ 用户自定义 MCP
- `octo_insight` → 内置研究分析 MCP + 用户自定义 MCP
- `octo_make` → 内置原型开发 MCP + 用户自定义 MCP
- `octo_ai` → 所有 MCP 工具（保持不变）

## 现状

- MCP 服务器全局配置在 `opencode.json` 的 `mcp` 字段，所有 agent 共享
- `MCP.tools()` 返回所有已连接 MCP 的全部工具，无 agent 过滤
- `resolveTools()` (prompt.ts:458) 将所有 MCP 工具无条件加入 agent 工具列表
- Agent.Info 有 `skills: string[]` 实现按 agent 绑定 skill，但**无 MCP 绑定字段**

---

## 方案设计

### 核心思路

仿照 `skills` 绑定模式，为 agent 添加 `mcp: string[]` 字段声明绑定的内置 MCP 服务器。全局连接所有 MCP 服务器（内置 + 用户自定义），在 `resolveTools()` 阶段按以下规则过滤：

- **声明了 `mcp` 的 agent**：看到 自己绑定的内置 MCP + 用户自定义 MCP 的工具
- **未声明 `mcp` 的 agent**（如 `octo_ai`）：看到所有 MCP 工具（保持不变）

### 数据流

```
BUILTIN_MCP_SERVERS                     ← 内置 MCP 服务器配置
        │
cfg.mcp = { ...builtinMcp, ...userMcp } ← 合并：内置优先，用户可覆盖
        │
MCP 服务连接所有 enabled 服务器           ← 现有逻辑不变
        │
resolveTools(agent):
  ├─ agent.mcp 存在？
  │    ├─ YES → agent.mcp 工具 + 用户自定义 MCP 工具
  │    └─ NO  → 所有 MCP 工具（保持不变）
```

### 工具过滤规则

```typescript
// agent 看到的 MCP 工具 = agent.mcp 绑定的工具 ∪ 用户自定义 MCP 工具
// 其中"用户自定义"= cfg.mcp 中不在 BUILTIN_MCP_SERVERS 的服务器

function filterMcpTools(allTools, agentMcp, builtinKeys, userCustomKeys) {
  if (!agentMcp?.length) return allTools  // octo_ai 等：全部可见

  const builtinSet = new Set(agentMcp.map(sanitize))
  const customSet = new Set(userCustomKeys.map(sanitize))
  const allowed = new Set([...builtinSet, ...customSet])

  return filter by tool key prefix in allowed
}
```

---

## 实现步骤

### Step 1：Agent.Info 添加 `mcp` 字段

**文件**: `packages/opencode/src/agent/agent.ts` (line 32-53)

在 `Info` schema 中添加：

```typescript
mcp: Schema.optional(Schema.Array(Schema.String)),
```

### Step 2：内置 Agent 定义绑定 MCP

**文件**: `packages/opencode/src/agent/agent.ts` (line 116-284)

为各 agent 添加 `mcp` 字段：

```typescript
octo_design: {
  // ...现有字段...
  mcp: ["pixso-design"],
},
octo_insight: {
  // ...现有字段...
  mcp: ["data-analysis"],
},
octo_make: {
  // ...现有字段...
  mcp: ["prototype-dev"],
},
// octo_ai: 不声明 mcp → 看到所有 MCP 工具
```

### Step 3：定义内置 MCP 服务器配置

**新建文件**: `packages/opencode/src/config/builtin-mcp.ts`

```typescript
import { ConfigMCP } from "./mcp"

export const BUILTIN_MCP_SERVERS: Record<string, ConfigMCP.Info> = {
  "pixso-design": {
    type: "remote",
    url: "https://api.pixso.cn/mcp",  // 待定
    enabled: true,
  },
  "data-analysis": {
    type: "local",
    command: ["npx", "-y", "@opencode/mcp-analysis"],  // 待定
    enabled: true,
  },
  "prototype-dev": {
    type: "local",
    command: ["npx", "-y", "@opencode/mcp-prototype"],  // 待定
    enabled: true,
  },
}

// 导出内置 key 集合，用于区分内置 vs 用户自定义
export const BUILTIN_MCP_KEYS = new Set(Object.keys(BUILTIN_MCP_SERVERS))
```

> 具体 MCP 服务器配置（URL、command、环境变量）需根据实际服务确定后填入。

### Step 4：配置合并 — 内置 MCP 融入全局配置

**文件**: `packages/opencode/src/config/config.ts`

**现有配置加载优先级**（从低到高）：

```
~/.config/opencode/config.json          ← opencode 全局配置（低优先级）
~/.config/opencode/octo.json
~/.config/opencode/opencode.json
~/.config/octo/config.json              ← octo 全局配置（高优先级）★
~/.config/octo/octo.json
~/.config/octo/opencode.json
项目目录/.octo/octo.json                ← 项目级配置（最高优先级）
项目目录/.opencode/opencode.json
```

用户自定义 MCP 配置优先从 `~/.config/octo/octo.json` 的 `mcp` 字段读取（已在现有加载流程中优先于 opencode 目录）。

内置 MCP 作为最底层默认值，在全局配置合并之后注入：

```typescript
import { BUILTIN_MCP_SERVERS } from "./builtin-mcp"

// 在 loadGlobal() 末尾或 loadInstanceState() 中全局配置合并完成后：
const builtinMcp = BUILTIN_MCP_SERVERS
const userMcp = result.mcp ?? {}
result.mcp = { ...builtinMcp, ...userMcp }  // 用户配置覆盖内置默认
```

> 关键：`...userMcp` 在后，同名 key 用户配置覆盖内置。用户在 `~/.config/octo/octo.json` 中配置的 `mcp` 字段天然优先于内置。

### Step 5：ConfigAgent.Info 添加 `mcp` 字段

**文件**: `packages/opencode/src/config/agent.ts` (line 23-55)

```typescript
mcp: Schema.optional(Schema.Array(Schema.String)).annotate({
  description: "List of MCP server names this agent should have access to",
}),
```

同时在 `KNOWN_KEYS` 集合中添加 `"mcp"`。

### Step 6：Agent 配置合并

**文件**: `packages/opencode/src/agent/agent.ts`

确保 agent state 初始化时 `mcp` 字段正确合并（与 `skills` 相同的 mergeDeep 模式）。

### Step 7：MCP service 新增过滤方法

**文件**: `packages/opencode/src/mcp/index.ts`

在 Interface 和实现中添加 `toolsForAgent` 方法：

```typescript
// Interface 中声明
readonly toolsForAgent: (
  agentMcp: string[] | undefined,
  customServerNames: string[],
) => Effect.Effect<Record<string, Tool>>

// 实现
const toolsForAgent = Effect.fn("MCP.toolsForAgent")(
  function* (agentMcp: string[] | undefined, customServerNames: string[]) {
    const allTools = yield* tools()

    // 未声明 mcp → 全部可见（octo_ai 等默认行为）
    if (!agentMcp || agentMcp.length === 0) return allTools

    // agent.mcp（内置绑定）+ 用户自定义服务器
    const allowed = new Set([
      ...agentMcp.map(sanitize),
      ...customServerNames.map(sanitize),
    ])

    return Object.fromEntries(
      Object.entries(allTools).filter(([key]) => {
        const prefix = key.split("_")[0]
        return allowed.has(prefix)
      }),
    )
  },
)
```

### Step 8：resolveTools 传入用户自定义服务器名

**文件**: `packages/opencode/src/session/prompt.ts` (line 458)

```typescript
// 原来：
for (const [key, item] of Object.entries(yield* mcp.tools())) {

// 改为：
import { BUILTIN_MCP_KEYS } from "@/config/builtin-mcp"

// 计算用户自定义 MCP 服务器名（不在内置列表中的）
const cfg = yield* config.get()
const userMcpKeys = Object.keys(cfg.mcp ?? {}).filter(k => !BUILTIN_MCP_KEYS.has(k))

// 获取过滤后的 MCP 工具
const mcpTools = yield* mcp.toolsForAgent(agent.mcp, userMcpKeys)

for (const [key, item] of Object.entries(mcpTools)) {
```

---

## 工具可见性矩阵

| Agent | 内置 MCP | 用户自定义 MCP | 说明 |
|-------|----------|----------------|------|
| `octo_ai` | 全部 | 全部 | 未声明 mcp，保持不变 |
| `octo_design` | pixso-design | 全部 | 绑定设计 MCP + 自定义 |
| `octo_insight` | data-analysis | 全部 | 绑定分析 MCP + 自定义 |
| `octo_make` | prototype-dev | 全部 | 绑定原型 MCP + 自定义 |
| `plan` | 无 | 无 | 所有工具已 deny |
| `explore` | 无 | 无 | 白名单制，MCP 不在白名单 |

---

## 关键文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/opencode/src/agent/agent.ts` | 修改 | Info schema 添加 mcp + 内置 agent 定义 |
| `packages/opencode/src/config/agent.ts` | 修改 | ConfigAgent schema 添加 mcp |
| `packages/opencode/src/config/builtin-mcp.ts` | 新建 | 内置 MCP 服务器配置 + BUILTIN_MCP_KEYS |
| `packages/opencode/src/config/config.ts` | 修改 | 合并内置 MCP 到全局配置 |
| `packages/opencode/src/mcp/index.ts` | 修改 | 新增 toolsForAgent() |
| `packages/opencode/src/session/prompt.ts` | 修改 | resolveTools 按规则过滤 |

---

## 设计决策

1. **为什么不按需连接 MCP？** — MCP 连接生命周期复杂（进程管理、OAuth、重连），全局连接 + 按需过滤更稳定
2. **用户自定义 MCP 如何识别？** — 通过 `BUILTIN_MCP_KEYS` 集合做差集，不在内置集合中的即为用户自定义
3. **用户覆盖内置 MCP 配置怎么办？** — 用户在 `opencode.json` 的 `mcp` 字段中同名配置覆盖内置默认，但该服务器仍被视为内置（key 不变），所以仍会被 agent.mcp 绑定命中
4. **用户如何给 agent 增加自定义 MCP？** — 在 `opencode.json` 的 `agent.xxx.mcp` 数组中追加自定义服务器名即可
5. **explore 等 subagent 是否看到 MCP？** — explore 的 permission 是白名单制，MCP 工具不在白名单中，所以执行时会被 deny。这是现有行为，不需要改动

---

## 验证

1. 在 `builtin-mcp.ts` 中配置一个已知可用的 MCP 服务器（如 filesystem）作为测试
2. 启动 opencode，确认内置 MCP 自动出现在 `mcp status` 中
3. 切换到 `octo_design`，验证能看到内置 MCP + 用户自定义 MCP 的工具
4. 切换到 `octo_ai`，验证仍能看到所有 MCP 工具
5. 在 `opencode.json` 中 `mcp.pixso-design.enabled: false`，确认覆盖生效
6. 在 `opencode.json` 中添加自定义 MCP + `agent.octo_design.mcp: ["pixso-design", "my-custom"]`，确认两者均可见
