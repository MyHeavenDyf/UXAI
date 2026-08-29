---
name: skill 前端注入式激活持久化 tool part
description: 用户通过 @ 或 / 激活 skill 时，在 user message 上创建 ToolPart 持久化记录
type: feature
---

# 背景

用户通过 `@skill-name` 或 `/skill-name` 使用 skill 时，skill 内容虽然以 text parts 进入模型上下文，但数据库中没有任何记录表明"这条用户消息激活了技能 X"。`skill.used` 事件仅存在于内存中，不持久化。

模型主动调用 skill 工具时，`processor.ts` 会在 assistant message 上创建 ToolPart（`tool:"skill"`，含完整 input/output/state），已正确持久化。前端注入式激活缺少同等待遇。

# 修改

## 1. `packages/opencode/src/session/prompt.ts` — `createUserMessage`

在消息和 parts 落库后（`updateMessage`/`updatePart` 之后），为 `extra.skills` 中声明的每个技能名创建一条 ToolPart：

```ts
// 持久化记录用户通过 @ 或 / 激活的技能（前端注入式）。
// 模型主动调用 skill 工具时由 processor.ts 创建 ToolPart，此处不重复处理。
for (const skillName of readActivatedSkills(input.extra)) {
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: info.id,
    sessionID: input.sessionID,
    type: "tool",
    tool: "skill",
    callID: PartID.ascending().toString(),
    state: {
      status: "completed",
      input: { name: skillName },
      output: "",
      title: `Loaded skill: ${skillName}`,
      metadata: { name: skillName, source: "user" },
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)
}
```

关键设计：
- `messageID: info.id` — 挂载在 **user message** 上（而非 assistant message），因为这是用户操作触发的
- `state.metadata.source: "user"` — 与模型调用产生的 ToolPart 区分（模型调用无此字段）
- `satisfies MessageV2.ToolPart` — 类型检查确保字段符合 schema

## 2. `packages/opencode/src/session/prompt.ts` — `command` 函数

向 `prompt()` 调用传递 `extra.skills`，使 command 路径的 skill 也能进入 `createUserMessage` 的处理：

```ts
const result = yield* prompt({
  sessionID: input.sessionID,
  messageID: input.messageID,
  model: userModel,
  agent: userAgent,
  parts,
  variant: input.variant,
  extra: cmd.source === "skill" ? { skills: [input.command] } : undefined,
})
```

# 覆盖的前端路径

| 路径 | extra.skills 来源 | 持久化 |
|------|------------------|--------|
| Insight `@技能名` | `insight/index.tsx:1362-1365` → `promptAsync` | ✅ 已有，`promptAsync` → `prompt()` → `createUserMessage` |
| Make `@技能名` → `/技能名` → `session.command()` | 本修改第 2 项新增 | ✅ `command()` → `prompt()` → `createUserMessage` |
| Make 普通 prompt 路径（非 command） | 暂未传 extra.skills | ❌ 需前端补传（当前 make 的 prompt 路径不走 @技能，走 command 路径） |

# 影响分析

### 数据库
- `PartTable` 结构不变（`data` JSON 列已容纳所有字段）
- 新增记录挂载在 user message 上，`type: "tool"`, `tool: "skill"`
- 无需数据库迁移

### 现有查询
- `assistantParts().filter(tool==="skill")` — **不受影响**（新 part 在 user message 上）
- `SELECT * FROM part WHERE data->>'$.tool' = 'skill'` — 能查到新旧两条路径
- 通过 `state.metadata.source === "user"` 可区分用户触发 vs 模型调用

### 模型上下文
- `toModelMessages`（`message-v2.ts:801-836`）处理 user message parts 时，只有 `type: "text"`（非 ignored）、`type: "file"`、`type: "compaction"`、`type: "subtask"` 被转换
- `type: "tool"` 的 part 在 user message 上被**静默跳过**，不会进入模型上下文
- 完全不干扰模型行为

### 编译
- `bun run typecheck` 通过