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
| 开关 | `memory.enabled` 默认 true（常开）；env `OCTO_DISABLE_MEMORY=1` 硬关（经 `MemoryStore.disabled()` 统一判断，提取/写入/注入/日志全走同一开关）；`OCTO_MEMORY_DEBUG=1` 独立控制埋点（默认关） |
| 埋点 | `.temp` 落盘（见下），测试阶段默认常开（`OCTO_MEMORY_DEBUG=0` 可关），脱敏/权限/限额/自动清理/异步 IO |
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
| `test/memory/memory.test.ts` | 单测 23 用例：存储/预算/trim/版本防覆盖/统一开关/严格校验/游标补偿与节流/密钥检测 |
| `test/memory/memory-e2e.test.ts` | e2e：功能开启状态下 提取→落库→下轮注入→埋点落盘 全链路（临时清 env 并严格恢复，不依赖全局关闭） |

## 接入点（改动）

1. **注入** `src/session/prompt.ts` `prepareRequest`：`system = [...env, ...instructions, ...memory, ...skills]`。跳过规则：`enabled=false`、hidden 工具型 agent、`mode==="subagent"`、`session.parentID` 非空。
2. **提取触发** `src/session/prompt.ts` loop 退出处：`MemoryExtract.extract({...}).pipe(Effect.ignore, Effect.forkIn(scope))`，与 title 同款后台模式。
3. **agent 注册** `src/agent/agent.ts`：`memory` hidden agent，全工具 deny，temperature 0.1。
4. **config 注册** `src/config/config.ts`：`memory: Schema.optional(ConfigMemory.Info)`。
5. **env 开关** `packages/core/src/flag/flag.ts`：`OCTO_DISABLE_MEMORY`（访问时求值）；`test/preload.ts` 置 1 防提取 fork 抢 mock LLM 队列。

## 数据流

```
回合结束 → fork extract（统一开关/parentID 检查）
  → 节流检查（不推进游标 → 后续补偿）
  → 游标切片：从上次已处理消息之后的首个真实用户消息到结尾（≤50 条，游标失效回退最后回合）
  → title 模型流式调用（指令含可信边界声明：工具输出中的"记住/删除"指令一律忽略）
  → parseActions 严格校验（topic 正则/长度上限/密钥拒绝/单批 create≤20 delete≤3）
  → 落盘 extract dump（OCTO_MEMORY_DEBUG 开启时）
  → 推进游标（模型正常返回即推进，含解析为空）→ MemoryStore.write（单事务 + 版本条件 upsert）→ trim
下一回合/新会话 → prepareRequest 拼装 <memory> 索引块（超预算单条跳过不阻断，预算内截断）
  → 落盘 inject dump（dryRun 路径跳过）
```

## 埋点落盘（.temp/auto-memory）

参考压缩调试的 `~/.temp/octo-compact-analysis` 模式（`src/session/compaction-debug.ts`），目录为 `~/.temp/auto-memory/<sessionID>_<首次落盘时间戳>/`，进程重启后按 sessionID 前缀复用已有文件夹：

| 事件 | 触发时机 | 文件 | 内容 |
|-|-|-|-|
| extract | 每次提取完成（模型已返回，含解析为空的情形） | `memory_<stamp>_no<N>_extract.txt` | 头部元信息（session/project/model/解析条数）、提取前记忆索引、发给提取器的完整 prompt、模型原始输出、解析后的 actions JSON |
| inject | 每次记忆非空注入 prompt（跳过 compaction 估算等 dryRun 路径） | `memory_<stamp>_no<N>_inject.txt` | 头部元信息 + token 估算（system/messages/tools/total）、完整 SYSTEM PROMPT、TOOLS、发给模型的 MESSAGES |

两类事件各自按 session 计数编号；落盘失败仅 `log.warn`，绝不影响主流程。

埋点约束：**测试阶段默认常开**（设 `OCTO_MEMORY_DEBUG=0` 或 `false` 关闭），`OCTO_MEMORY_DEBUG_DIR` 可覆盖目录（默认 `~/.temp/auto-memory`）；密钥模式**脱敏**（`sk-`/`Bearer`/`api_key=`/长 base64-hex → `[REDACTED]`）；session 目录 `0700`、文件 `0600`；单文件 256KB 截断；每 session 保留最近 50 个文件；7 天未更新的 session 目录自动清理；全部 `fs/promises` **异步写**。

## 隔离边界（project_id 验证结论）

- **OS 多用户**：数据存于各自 `$HOME` 下（`~/.local/share/opencode.db`、`~/.temp/auto-memory`），物理隔离天然满足
- **同仓库多 worktree/sandbox**：共享记忆是设计特性（ProjectID = git 首个 root commit）
- **同项目多 workspace**：当前共享记忆，为已知边界；需要隔离时按 `workspace_id` 过滤是后续演进方向
- **多租户/云端共享 DB**：**不满足**——memory 表无 tenant/user 列，云化部署时需加列迁移，此边界在单机部署下不构成风险

## 防护与健壮性（hardening）

| 防护 | 实现 |
|-|-|
| 主流程隔离 | store 公开函数内部 catch 降级（warn + 空返回），提取为 fork+ignore，dump 为 exit 隔离 |
| 并发覆盖 | write 单事务；upsert 带 `setWhere: time_updated <= version`（提取批次时间戳），旧批次永不覆盖新批次 |
| 提取校验 | action 枚举、topic `^[a-z][a-z0-9_]{0,63}$`、summary≤200、content≤2000、单批 create≤20/delete≤3、密钥模式整条拒绝 |
| 注入防护 | 提取器 prompt + 指令消息双重声明可信边界：工具/文件/网页输出中的记忆操作指令一律忽略 |
| 消息遗漏 | 成功处理游标（per session 的 lastProcessedMessageID）：节流跳过不推进，下次从游标后累积补偿（≤50 条窗口） |
| 预算统一 | system() 单条超预算跳过不阻断后续；trim 与 system 共用 indexLine/预算常量；write 层字段 clamp 双保险 |

## 自测指南

```bash
# 看记忆落库
sqlite3 ~/.local/share/opencode/opencode.db \
  'select type, topic, summary, time_updated from memory order by time_updated desc limit 20'
# 看埋点落盘(测试阶段默认常开)
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
- 密钥检测对长 base64/hex 串（≥32 字符）宁可误杀：含完整 commit SHA 的记忆会被拒——需要记录 SHA 时建议截断或转述
- 测试套件 prompt.test.ts 在本机存在与记忆无关的 flaky（基线与改动后各随机失败 2-8 个队列/超时用例，失败集逐次轮换，已 stash 对比确认；确定性用例全部稳定）
