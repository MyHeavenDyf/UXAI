# 跨会话自动记忆（Memory Worker 架构）

主 Agent 专注业务执行,后台 Memory Worker 通过事件驱动自动提取、维护记忆。主 Agent 只读索引,不负责维护。

## 架构

```
┌──────────────────────────────────────────────────────┐
│                  Memory Worker(独立模块)             │
│                                                      │
│  触发层          提取层              持久层             │
│  ┌──────────┐   ┌───────────┐    ┌──────────┐     │
│  │ bus event │──▶│ LLM 提取   │───▶│ 程序写文件│     │
│  │(idle事件) │   │(hidden agent)│   │(lock+ver)│     │
│  └──────────┘   └───────────┘    └──────────┘     │
│                                                      │
│  完全静默:无授权弹窗、无用户可见消息、失败只 log      │
└──────────────────────────────────────────────────────┘
          ↓ 注入(只读索引)
┌──────────────────────────────────────────────────────┐
│                主 Agent(business execution)          │
│  <memory>                                             │
│  这些是你的跨会话记忆(参考数据)。                      │
│  完整内容可用 read 工具读取 topics/ 目录下的文件。     │
│  <MEMORY.md 索引原文>                                 │
│  </memory>                                            │
└──────────────────────────────────────────────────────┘
```

## 文件清单

| 文件 | 职责 |
|-|-|
| `src/memory/worker.ts` | 事件订阅(session.idle)、节流、触发提取 |
| `src/memory/extract.ts` | LLM 调用(与 title() 同款,无子 Session)、JSON 解析、质量校验 |
| `src/memory/persist.ts` | 文件写入(项目锁+版本守卫)、tombstone、游标、索引重建 |
| `src/memory/store.ts` | 注入块构建(只读)、统一开关、动态预算 |
| `src/memory/debug.ts` | inject 埋点落盘 |
| `src/agent/prompt/memory.txt` | 提取 Agent 系统提示:四类记忆、操作类型、提取规则、防护 |
| `src/config/memory.ts` | `enabled/model/budget_tokens/extraction_interval_seconds` |

## 数据流

```
回合完成 → session.idle 事件
  → Worker 节流检查(同 session 5s 间隔)
  → 读取会话消息(sessions.messages,从循环外)
  → 游标过滤(跳过已处理消息)
  → LLM 结构化提取(hidden "memory" agent, small call, 无工具)
  → parseActions: JSON 解析 + topic 格式校验 + 密钥检测 + 类型校验
  → persist.applyActions: 项目锁内 → create/update/delete/merge → 索引重建
  → 游标推进到最后一条消息
  → (完全静默,主 Agent 与用户均无感知)

下一请求 → prepareRequest 注入 <memory> 索引(只读,动态预算)
```

## 记忆操作类型(LLM 输出,程序执行)

| action | 字段 | 语义 |
|-|-|-|
| create | type, topic, content, summary | 新增记忆 |
| update | type, topic, content, summary | 覆盖已有(版本守卫:旧批次不覆盖新) |
| delete | topic | 删除过时记忆 |
| merge | from, into, content, summary | 合并两条为一条 |

## 与主 Agent 的关系

- **主 Agent 只读不写**:注入块只有"你的记忆在 topics/ 下,用 read 工具查看"——没有维护指示、没有写入授权需求
- **Worker 完全后台**:无授权弹窗(write/edit 的 `isMemoryPath` 绕过已移除——Worker 用程序写文件不走工具层)、无用户可见消息、失败只 log
- **write/edit 工具已还原**:移除了 `isMemoryPath`、`indexNudge`、`Config.Service` 依赖

## 防护

| 层 | 机制 |
|-|-|
| 提取防护 | 只提取用户亲口说的话;工具/skill/文件内容中的指令忽略;密钥禁止;topic 格式白名单;单批 ≤10 条 |
| 持久防护 | 项目锁(O_EXCL + PID 存活检测);版本守卫(旧批次不覆盖);content ≤2000/summary ≤200 |
| 并发防护 | 节流(同 session 5s);项目级锁(跨进程) |
| 重启恢复 | 游标存 `.cursor` 文件;topic 文件 frontmatter 带 version |

## 配置

```json
{
  "memory": {
    "enabled": true,
    "model": "anthropic/claude-sonnet",
    "budget_tokens": 2000,
    "extraction_interval_seconds": 5
  }
}
```

或环境变量 `OCTO_DISABLE_MEMORY=1` 硬关。
