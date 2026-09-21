# Skill 来源优先级：~/.config/octo 确定性胜出

## 动机

`discoverSkills` 会从多个来源扫描 SKILL.md（`~/.config/octo`、`~/.config/opencode`、`~/.claude/skills`、项目 `.opencode/skill` 等，见 `skill-architecture.md`）。当不同来源存在**同名 skill**（frontmatter `name` 相同）时：

- `loadSkills` 原以 `concurrency: "unbounded"` 并发加载
- `add()` 对重名直接 `state.skills[name] = {...}` 后写覆盖

两者叠加导致同名冲突时**谁赢取决于并发完成顺序，结果不确定**。内网曾出现 `ict-ui-skill` 技能偶发读取不到的现象（旧副本/残留副本随机遮蔽正式副本），与此机制相关。

## 改动文件

| 文件 | 改动 |
|------|------|
| `packages/opencode/src/skill/index.ts` | `discoverSkills` 返回前按来源优先级排序；`add()` 重名改为首个注册生效；`loadSkills` 改为顺序加载 |
| `packages/opencode/test/skill/priority.test.ts` | 新增：octo vs 项目目录同名冲突、octo 深度 1 vs 嵌套副本冲突 |

## 优先级定义

```
P0  ~/.config/octo/skill/<dir>/SKILL.md     桌面端统一管理/部署位置（仅一层，regenerateSkillConfig/add-skill 的落盘位置）
P1  ~/.config/octo 下其余路径               skills/ 复数目录、嵌套副本（如 skill/<dir>/dist/SKILL.md）
P2  其它所有来源                             .claude/.agents/.opencode/项目目录/cfg.skills.paths/远端
```

判断逻辑（`discoverSkills` 内）：

```ts
const priority = (match: string) => {
  if (path.dirname(path.dirname(match)) === octoSkillDir) return 0
  if (match.startsWith(global.octoConfig + path.sep)) return 1
  return 2
}
matches.sort((a, b) => priority(a) - priority(b))
```

排序为稳定排序（`Array.prototype.sort`），同优先级内保持发现顺序。

## 生效机制

1. `loadSkills` 去掉 `concurrency: "unbounded"`，改为顺序 `Effect.forEach`——保证排序真实生效（并发下 check-then-write 仍有竞态）。
2. `add()` 中重名时**跳过而不是覆盖**（`state.dirs` 仍会收录该目录以保留文件访问白名单，但 `state.skills` / `skillDirMap` 保留先注册的高优先级条目）。

## 行为变化

- 同名冲突从"随机后写覆盖"变为"octo > 其他、深度 1 > 嵌套副本、同优先级按发现顺序"的确定性结果。
- 项目级 skill 不再可能覆盖 `~/.config/octo` 的同名 skill（此前也只是随机覆盖，并非明确语义）。
- 加载从并发改为顺序：skill 数量为几十个量级的本地文件解析，启动开销可忽略。

## 验证

- `bun --cwd packages/opencode test test/skill/priority.test.ts`
- `bun run --cwd packages/opencode typecheck`
