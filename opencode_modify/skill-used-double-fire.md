# skill.used 双触发修复

日期：2026-11-05 · 分支：dev_dyf（基于 dev 248463f9f2）

## 现象

用户通过 `@技能名` 调用技能（make 页与规划 handoff 流程）时，服务端对同一次调用发布**两次** `skill.used` 事件，前端技能用量统计（`skill-usage-tracker`）计数翻倍。

## 根因

`skill.used` 有两个发布点，command 路径历史上两者都命中：

| 时间 | 提交 | 作者 | 改动 |
|---|---|---|---|
| 2026-07-21 | `0bdfa31206` | MyHeavenDyf | `prompt.ts` command 分支在 `prompt()` 返回后发布（当时唯一发布点） |
| 2026-08-05 | `e0bcfe253c` | Kevin199802 | SPEC-INS-029：`prompt()` 公共入口按 `extra.skills` 发布（当时 command 路径不传 extra，两条路径互不重叠） |
| 2026-08-13 | `278550243f` | MyHeavenDyf | 给 command 路径补传 `extra: { skills: [input.command] }`（本意是 createUserMessage 持久化技能 ToolPart 记录）——**该 extra 同时喂给了公共入口的发布逻辑，而 command 分支的旧发布没有删除，从此每次调用双发** |

调用链：make 页 `@技能` → 替换为 `/技能名` 文本（make/index.tsx）→ slash 检测 → `session.command()` → command 分支：`extra.skills` 触发发布①（prompt() 公共入口），`cmd.source === "skill"` 触发发布②（command 分支）。

insight 页不受影响：`@技能` 走 `promptAsync + extra.skills`，只命中发布①。skill 工具（tool/skill.ts）的发布是第三条独立路径（模型主动调工具时才触发），与本次无关。

## 修复

`packages/opencode/src/session/prompt.ts` command 分支：删除发布②（连同两段 `skill.used-debug` elog），保留发布①。`extra: { skills: [input.command] }` **保留不动**——ToolPart 持久化（278550243f 的本意）和 `ArtifactStore.begin` 都依赖它。

保留①弃②的理由：①带 `catchDefect` 兜底（旁路观测绝不影响主流程），且覆盖 command 与非 command 两条路径；②只是①的历史前身。

## 测试

### 回归测试（新增）

`test/session/prompt.test.ts` — "command skill publishes skill.used exactly once"：
在 tmpdir 写入 `.opencode/skill/cmd-used-once/SKILL.md`，走 `session.command` 完整执行，断言 `SkillUsed` 事件恰好一次。已反向验证：临时恢复发布②时测试失败（收到 2 个事件），删除后通过。

两个测试环境适配（均为测试基建，非 src 改动）：

1. **config agent 覆盖**：默认 agent（octo_ai）deny skill，prompt.ts 的 command 守卫会拒掉 skill 命令。测试 config 里 `agent: { build: { permission: { skill: "allow" } } }` 放开（`Permission.disabled` 用 `findLast`，merge 后的 allow 是最后一条规则故取胜）。
2. **`test/preload.ts` rg 解析**：preload 把 XDG 重定向到空临时目录后，ripgrep 二进制解析不到 `Global.Path.bin` 下的 rg，会走 GitHub 兜底下载——离线/内网环境直接挂死（本机表现：一切依赖 `skill.files` 的测试 timeout，包括 `test/tool/skill.test.ts` 既有挂死）。preload 现在优先把 `OPENCODE_RIPGREP_PATH` 指到系统 PATH 或真实用户缓存（`~/.cache/opencode/bin/rg(.exe)`）里已存在的 rg。本机验证：`test/tool/skill.test.ts` 从 2 fail（挂死）恢复为 2 pass。

### 基线对比（Windows 本机）

- `test/session/prompt.test.ts` 全套：失败数在多次运行间波动（16/20/21/25，超时型 flaky，3s 内部超时对本机实例启动开销太紧）。逐一复核「改动后新增失败」的 5 个用例：1 个单独重跑即通过，其余 4 个（concurrent loop / assertNotBusy / cancel 系列）在**基线上单独跑同样失败**——均为本机既有 flaky，与本次改动无关。
- `test/tool/skill.test.ts`：2 fail（rg 挂死）→ 2 pass。
- `test/session/skill-activation.test.ts`：6 pass；SPEC-INS-029 既有用例 pass。
- `test/skill/`：13 fail，为基线 14 fail 的子集（既有环境性失败，少掉的 1 个正是被 rg 修复救活的）。
- `bun run typecheck`（全仓）：12/12 通过。

## 影响面

- 前端消费者（event-reducer、insight-turn、make 的 usage tracker）行为不变，只是不再收到重复事件。
- 服务端 `skill.used` 事件语义不变（事件名、载荷、发布时机都在发布①）。
