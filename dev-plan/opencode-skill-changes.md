# packages/opencode Skill 模块修改记录

## 修改日期：2026-05-23

---

## 1. `script/build-node.ts` — 构建 skills.json 带 type 字段 + 复制内置 skill

### 修改内容

- `skillEntries` 类型新增 `type: string` 字段
- 从 glob 返回的相对路径中提取 agent 名称作为 `type`（如 `octo_insight`）
- 路径分隔符使用 `split(/[/\\]/)` 兼容 Windows/macOS/Linux
- 新增构建后复制逻辑：将 `src/agent/skills/` 下的内置 skill 目录扁平化复制到 `dist/node/skill/`

### 影响

- 构建产物 `dist/node/skills.json` 每个条目包含 `type` 字段
- 构建产物 `dist/node/skill/` 包含扁平化的内置 skill 目录（如 `dist/node/skill/interview-analysis/SKILL.md`）

---

## 2. `src/skill/index.ts` — 统一 Skill 发现路径 + 新增 refresh 方法

### 修改内容

#### 2.1 Interface 新增 refresh 方法

```ts
export interface Interface {
  // ...原有方法
  readonly refresh: () => Effect.Effect<void>
}
```

#### 2.2 移除内置 agent/skills/ 扫描

移除了 `discoverSkills()` 中扫描 `import.meta.dirname/../agent/skills` 的 Source 5 代码块。

#### 2.3 新增统一 skill 目录扫描

```ts
// Unified skill directory at octoConfig/skill/ (all skills including built-in)
const octoSkillDir = path.join(global.octoConfig, "skill")
if (yield* fsys.isDir(octoSkillDir)) {
  yield* scan(state, octoSkillDir, SKILL_PATTERN)
}
```

所有 skill（内置 + 用户自定义）统一从 `~/.config/octo/skill/` 目录发现。

#### 2.4 refresh 实现

```ts
const refresh = Effect.fn("Skill.refresh")(function* () {
  yield* InstanceState.invalidate(discovered)
  yield* InstanceState.invalidate(state)
})
```

invalidate `discovered`（发现缓存）和 `state`（加载缓存）两个 InstanceState，下次访问时重新扫描和加载。

### 影响

- Skill 发现不再依赖打包时的 `agent/skills/` 目录，统一从 `octoConfig/skill/` 读取
- `skills.json` 的 `import` 过滤逻辑不变，仍在 `discoverSkills()` 末尾执行（第207-224行）
- 外部可通过 `refresh()` 方法触发重新发现

---

## 3. `src/server/routes/instance/httpapi/groups/instance.ts` — HttpApi 端点定义

### 修改内容

新增 `skillRefresh` 端点定义：

```ts
HttpApiEndpoint.post("skillRefresh", "/skill/refresh", {
  success: described(Schema.Struct({ success: Schema.Boolean }), "Refresh result"),
}).annotateMerge(
  OpenApi.annotations({
    identifier: "app.skills.refresh",
    summary: "Refresh skills",
    description: "Invalidate skill cache and re-discover skills from disk.",
  }),
)
```

---

## 4. `src/server/routes/instance/httpapi/handlers/instance.ts` — HttpApi handler

### 修改内容

新增 `refreshSkill` handler：

```ts
const refreshSkill = Effect.fn("InstanceHttpApi.skillRefresh")(function* () {
  yield* skill.refresh()
  return { success: true }
})
```

注册到路由：`.handle("skillRefresh", refreshSkill)`

---

## 5. `src/server/routes/instance/index.ts` — Hono 路由

### 修改内容

新增 `POST /skill/refresh` Hono 路由：

```ts
.post("/skill/refresh",
  describeRoute({ operationId: "app.skills.refresh", ... }),
  async (c) => jsonRequest("InstanceRoutes.skill.refresh", c, function* () {
    const skill = yield* Skill.Service
    yield* skill.refresh()
    return { success: true }
  }),
)
```

### 影响（3-5 合计）

两个后端（旧 Hono + 新 HttpApi）均暴露 `POST /skill/refresh` API，前端 toggle 后调用此接口刷新 skill 缓存。

---

## 6. `test/session/system.test.ts` — 测试 mock 补充

### 修改内容

Skill.Service mock 对象新增 `refresh` 字段：

```ts
refresh: () => Effect.void,
```

---

## 数据流总结

```
构建时（build-node.ts）
  ├─ 生成 skills.json（含 type 字段）
  └─ 复制内置 skill → dist/node/skill/

运行时启动（desktop migrate.ts）
  ├─ deploySkillsJson() → ~/.config/octo/skills.json
  └─ deployBuiltinSkills() → ~/.config/octo/skill/

Skill 发现（skill/index.ts discoverSkills）
  ├─ 扫描 octoConfig/skill/**/SKILL.md（统一来源）
  ├─ 读取 skills.json 过滤 import === false
  └─ 结果缓存于 InstanceState

Skill 刷新（POST /skill/refresh）
  ├─ 调用 Skill.refresh()
  ├─ invalidate discovered + state 缓存
  └─ 下次访问时重新扫描并加载
```