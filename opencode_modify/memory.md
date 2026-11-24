# 跨会话自动记忆（Auto Memory）

参考 Claude Code Auto Memory 的"索引常驻 + 明细按需"模式，为 OctoAgent 实现跨 Session 记忆：Session A 中用户纠正/偏好/决策被自动提取落库，Session B 启动时索引自动注入 system 上下文。

## 决策记录

| 决策 | 结论 |
|-|-|
| 作用域 | `project_id`（ProjectID = git root commit，同仓库 worktree 共享） |
| 检索模式 | 索引常驻注入（token 预算硬帽），不做 embedding |
| 注入点 | `prepareRequest()`（`src/session/prompt.ts`），与 AGENTS.md 同列，自动计入 compaction 预算 |
| 存储 | SQLite `memory` 表（drizzle，非 markdown 文件） |
| 提取时机 | 每回合 loop 退出后 fork，节流（默认 60s/session） |
| 提取模型 | title 模型链路 + `memory.model` 配置覆盖 |
| Lifecycle | 写入时预算强制：超预算按 rowid 升序淘汰最旧未置顶条目 |
| 开关 | `memory.enabled` 默认 true（常开）；env `OCTO_DISABLE_MEMORY=1` 硬关（测试用） |
| 埋点 | `.temp` 落盘（见下） |
| UI | 无（按需求裁剪） |
| 同步 | 仅机器本地，不进 sync 事件流 |

## 文件清单

| 文件 | 职责 |
|-|-|
| `src/memory/memory.sql.ts` | `memory` 表：`(project_id, topic)` 唯一索引支撑 upsert，FK→project 级联删除 |
| `src/memory/store.ts` | 纯函数存储层（仿 tracking 模式）：`list/system/write/remove/clear`，写入后 trim |
| `src/memory/extract.ts` | `extract`（服务实例由 prompt 层闭包传入，避免 requirements 泄漏）+ `parseActions` JSON 解析校验 |
| `src/memory/debug.ts` | `.temp` 埋点落盘（仿 `session/compaction-debug.ts`）：extract/inject 两类事件，按 session 分目录 |
| `src/agent/prompt/memory.txt` | 提取器系统提示：四类记忆（user/feedback/project/reference）、排除规则、JSON 输出格式 |
| `src/config/memory.ts` | `ConfigMemory`：`enabled/model/budget_tokens/extraction_interval_seconds` |
| `migration/20261124032109_memory/` | 建表迁移 |
| `test/memory/memory.test.ts` | 存储层 + 解析层单测（11 用例） |

## 接入点（改动）

1. **注入** `src/session/prompt.ts` `prepareRequest`：`system = [...env, ...instructions, ...memory, ...skills]`。跳过规则：`enabled=false`、hidden 工具型 agent、`mode==="subagent"`、`session.parentID` 非空。
2. **提取触发** `src/session/prompt.ts` loop 退出处：`MemoryExtract.extract({...}).pipe(Effect.ignore, Effect.forkIn(scope))`，与 title 同款后台模式。
3. **agent 注册** `src/agent/agent.ts`：`memory` hidden agent，全工具 deny，temperature 0.1。
4. **config 注册** `src/config/config.ts`：`memory: Schema.optional(ConfigMemory.Info)`。
5. **env 开关** `packages/core/src/flag/flag.ts`：`OCTO_DISABLE_MEMORY`（访问时求值）；`test/preload.ts` 置 1 防提取 fork 抢 mock LLM 队列。

## 数据流

```
回合结束 → fork extract（节流/parentID/开关检查）
  → title 模型流式调用（系统提示=memory.txt，末条 user 消息含当前索引）
  → parseActions 解析 JSON（容忍围栏/散文包裹，逐条校验 type/topic/content/summary）
  → MemoryStore.write：delete 按 topic 删除；create 按 (project_id, topic) upsert
  → trim：索引超预算按 rowid 淘汰最旧未置顶条目
下一回合/新会话 → prepareRequest 拼装 <memory> 索引块（pinned 优先、time_updated 降序、预算内截断）
```

## 埋点落盘（.temp/auto-memory）

参考压缩调试的 `~/.temp/octo-compact-analysis` 模式（`src/session/compaction-debug.ts`），目录为 `~/.temp/auto-memory/<sessionID>_<首次落盘时间戳>/`，进程重启后按 sessionID 前缀复用已有文件夹：

| 事件 | 触发时机 | 文件 | 内容 |
|-|-|-|-|
| extract | 每次提取完成（模型已返回，含解析为空的情形） | `memory_<stamp>_no<N>_extract.txt` | 头部元信息（session/project/model/解析条数）、提取前记忆索引、发给提取器的完整 prompt、模型原始输出、解析后的 actions JSON |
| inject | 每次记忆非空注入 prompt（跳过 compaction 估算等 dryRun 路径） | `memory_<stamp>_no<N>_inject.txt` | 头部元信息 + token 估算（system/messages/tools/total）、完整 SYSTEM PROMPT、TOOLS、发给模型的 MESSAGES |

两类事件各自按 session 计数编号；落盘失败仅 `log.warn`，绝不影响主流程。

## 自测指南

```bash
# 看记忆落库
sqlite3 ~/.local/share/opencode/opencode.db \
  'select type, topic, summary, time_updated from memory order by time_updated desc limit 20'
# 看埋点落盘
ls ~/.temp/auto-memory/
cat ~/.temp/auto-memory/<sessionID>_*/memory_*_extract.txt   # 提取了什么、模型原始输出
cat ~/.temp/auto-memory/<sessionID>_*/memory_*_inject.txt    # 注入时的全部上下文
# 关闭功能
#   octo.json: { "memory": { "enabled": false } }  或  OCTO_DISABLE_MEMORY=1
# 调节
#   memory.budget_tokens / memory.extraction_interval_seconds / memory.model（provider/model 格式）
```

验证路径：Session A 中给一个明确纠正（如"记住这个仓库只用 pnpm"）→ 回合结束后查库 → 新开 Session B 问偏好 → 观察模型回答是否带出。

## 已知边界

- 同 ms 内多次写：`time_updated` 相同，trim 用 rowid 保插入序，确定性淘汰
- 提取 JSON 校验失败静默丢弃（无重试，dump 中可见原始输出便于排查）
- inject 埋点按请求级触发：长会话每次请求落一个文件，文件量与请求次数成正比
- 测试套件 prompt.test.ts 在本机存在与记忆无关的 flaky（基线与改动后各随机失败 2-4 个队列/超时用例，已对比确认）
