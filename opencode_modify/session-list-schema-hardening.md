# Session List 读取侧容错加固

## 概述

加固 session 列表读取链路，防止单行脏数据导致整个列表 400/500。两层防御中的第二层（容错层）。

## 背景

- commit `900f347be` / `dd13676aa`（第一层接纳）补全了 `subagent` 的 schema 缺失
- 但根本性脆弱性仍在：fromRow 无校验 + 读取循环无 try/catch = 一行脏数据炸整个列表
- 本修改在读取侧加 try/catch + category 防御性降级，对未来任何脏数据免疫

## 修改文件

### `packages/opencode/src/session/session-category.ts`

- `AGENT_TO_CATEGORY` 改为 `export`（原为模块私有）
- 新增 `CATEGORY_VALUES: ReadonlySet<SessionCategory>` — 合法 category 集合，供 fromRow 复用
- `listByCategory` 里的 `.map(fromRow)` 改为 `.flatMap` + try/catch 跳过坏行

### `packages/opencode/src/session/session.ts`

- import `CATEGORY_VALUES` from `session-category`
- `fromRow` 函数：`category as Info["category"]` 强转改为 `CATEGORY_VALUES.has()` 校验，不在枚举则降级为 `undefined`

### `packages/opencode/src/session/session-category-query.ts`

- import log（`@/util/log`）
- 5 个读取方法全部加单行 try/catch 容错：
  - `getWithCategory` — 单条查询，异常时返回 null
  - `childrenWithCategory` — `.map` 改 `.flatMap`，异常时跳过
  - `listByProjectWithCategory` — generator 循环加 try/catch，异常时跳过
  - `listGlobalWithCategory` — generator 循环加 try/catch，异常时跳过
  - `getAllWithCategory` — `.map` 改 `.flatMap`，异常时跳过

## 设计决策

- **category 走降级（undefined）而非跳过整行**：category 是可选字段，单字段异常不应让整个 session 不可见
- **其他字段异常走跳过整行**：model/time/id 等关键字段异常时跳过该行，log.error 记录 sessionID + 错误信息
- **复用 AGENT_TO_CATEGORY 构建 CATEGORY_VALUES**：避免三处枚举（SessionCategory 类型、Session.Info schema、合法值集合）不同步
