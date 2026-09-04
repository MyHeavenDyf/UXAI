# 设计规划 agent 禁用 skill：堵住 session.command 模板注入旁路

## 背景

/make 的设计规划模式中，规划子会话（agent `octo_make_plan`）本不该使用 skill，但存在旁路：

- **工具层已禁**：octo_make_plan 的权限是 `"*": "deny"` + `read: "ask"` + `websearch: "allow"`，`Permission.disabled`（permission/index.ts，findLast 规则匹配）会把 skill 工具判定为「隐藏 + 阻断」，模型侧调不到 skill 工具。
- **命令层漏了**：前端在规划模式里发带 @skill 的消息时，`sendMessage` 把 `@name` 替换成 ` /name ` → slash 检测命中 → `session.command(planSid, name, agent: "octo_make_plan")`。而 `session.command` 的 skill 命令是把 **完整 SKILL.md 作为 prompt 模板**（command/index.ts `skillCommand` → `Skill.formatLoaded`）直接注入会话，**完全不走工具调用**，agent 的工具权限拦不住。

## 改动文件

| 文件 | 改动内容 |
|------|----------|
| `packages/opencode/src/agent/agent.ts` | octo_make_plan 权限显式加 `skill: "deny"`（`"*": "deny"` 已隐含禁用，显式声明使意图可见） |
| `packages/opencode/src/session/prompt.ts` | `command()` 在解析出目标 agent 后新增守卫：`cmd.source === "skill"` 且 `Permission.disabled(["skill"], agent.permission)` 命中 → publish Session.Event.Error 并抛 NamedError。agent 层禁掉 skill 权限时，session.command 也不能再注入该 skill |

## 服务端守卫逻辑

prompt.ts `command()`，紧跟 agent 解析之后：

```ts
if (cmd.source === "skill" && Permission.disabled(["skill"], agent.permission).has("skill")) {
  const error = new NamedError.Unknown({
    message: `Skill "${input.command}" is not available for agent "${agentName}".`,
  })
  yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
  throw error
}
```

- `agentName` 取自 `cmd.agent ?? input.agent ?? 默认 agent`，与实际执行 agent 一致，所以权限判定准确。
- 语义对所有 agent 通用：凡禁了 skill 的 agent（octo_make_plan、insight_reader 等），skill 命令注入一律被拦。octo_make 未禁 skill，[confirm-plan] 确认后主会话执行 skill 的既有链路不受影响。
- 用户 config 的 permission 覆盖仍优先（merge 在后、findLast 取最后匹配规则），显式 allow 可放开。

## 配套前端改动（packages/app，见 make/index.tsx）

1. `sendMessage` 开头计算 `inPlanSession = sessionId === activePlanSessionId()`；规划模式下 @skill **不再替换成 ` /name `**（保持纯文本），skill 收集进 `planSkillStash`。
2. slash 检测循环：规划模式下 `matched.source === "skill"` 的手输 `/skill` 同样跳过，按非命令文本走 prompt 兜底，也收集进 stash。
3. slash 检测结束后统一暂存：`savePlanSkillHandoff(params.id, sessionId, merged)`（与初始页进入规划时的暂存同源，按 name 去重合并）——`handleConfirmPlan` 在确认方案后把这些 skill 发到**主会话（octo_make）**执行，保留既定的「规划期选择、确认期执行」设计。
4. 顺带修复初始页规划分支的转义 bug：`/^[\\s\\S]*?---\\n/` 和 `\\n\\n`（双反斜杠，正则失效 + 字面 `\n`）改为单反斜杠，与 handleEnterPlan 的正确写法对齐。

## 验证

- `bun run typecheck` 通过（18 packages）。
- 待人工验证：规划模式中发 @skill 消息 → 规划子会话只收到纯文本、无 skill 注入；确认方案后主会话执行暂存的 skill。
