# skill available 查询接口（GET /skill/available）

日期：2026-11-19　分支：feat/make-router

## 动机

前端需要「直接获取当前 agent 有哪些可用 skill」——与模型 prompt 中 `<available_skills>` 注入列表同源的数据。此前 `GET /skill` 只返回全量 skill，没有任何按 agent 过滤的入口；真正的过滤函数 `Skill.available(agent)` 只在 prompt 组装内部使用（`src/session/prompt.ts:747`），外部拿不到。

## 设计

- **输入**：`GET /skill/available?agent=<agent名>`（必填）。不做 session 解析——前端自己知道当前 agent（session.agent 已由 AgentSwitched projector 实时回写，`projectors-next.ts:123`，前端从会话信息取值传入即可）。
- **响应**：`Skill.Info[]`（同 `GET /skill` 的元素结构）。agent 不存在返回 404（显式输入，不做全量兜底——静默全量会误导调用方）。
- **过滤逻辑**：完全复用 `Skill.available(agent)`（`src/skill/index.ts:378`）——`AGENT_SKILL_ALIASES`（`proto_*→octo_make`）别名继承 + `Permission.evaluate` deny + skill_config.json 的 agent 白名单（按 skill **目录名**匹配）。本次只是暴露它，未改任何过滤逻辑。
- **「即时」语义**：available() 每次现算过滤，但 skill 清单与 skill_config 走 InstanceState 缓存——写后需 `POST /skill/refresh`（invalidateAll）才可见。桌面端已在所有 skill 写路径后 fire refresh（主进程 skill-refresh.ts + 渲染端 refreshSkills，commit f5cd955f44），接口即时性成立；未经 refresh 的直写模型下一轮 prompt 同样看不到，与模型可见性完全一致。

## 改动（纯增量：diff 只有 + 行，不改不删原有行）

| 文件 | 新增内容 |
|---|---|
| `src/server/routes/instance/httpapi/groups/instance.ts` | `ApiNotFoundError` import、`InstancePaths.skillAvailable`、`skillAvailable` endpoint（query schema 内联 `Schema.Struct({ agent: Schema.String })`，identifier `app.skills.available`，error `[ApiNotFoundError]`） |
| `src/server/routes/instance/httpapi/handlers/instance.ts` | `notFound` import、`getSkillAvailable` handler（`agent.get` → 未知名 `Effect.fail(notFound(...))` → `skill.available(info)`）、`.handle("skillAvailable", ...)` 注册 |
| `src/server/routes/instance/index.ts` | `NotFoundError`（`@/storage/storage`）import、flag ON 转发 mount `app.get(InstancePaths.skillAvailable, handler)`、v1 `.get("/skill/available")` 路由块（`validator("query", z.object({ agent: z.string() }))`，`c.req.valid("query").agent`，NotFound → 404 走全局 ErrorMiddleware） |

**双路由的原因**：默认后端（`Flag.OPENCODE_EXPERIMENTAL_HTTPAPI` OFF）下 v2 SDK 的请求实际命中 v1 Hono 路由；flag ON 时 v1 入口按 `InstancePaths.*` 转发到 httpapi handler（同路径先注册者遮蔽 v1 路由）。两层薄薄包装同一个 `available()`，保持一致。

`agent.get`（`src/agent/agent.ts:736`）对未知名返回 undefined（不 throw）、自带 `build→octo_ai` 兼容。

## SDK 重生成

`cd packages/sdk/js && bun run build`（httpapi 契约 → openapi.json → hey-api 全量重写 `src/v2/gen` → prettier → tsc）。

生成结果：`skills2.available({ agent, directory?, workspace? })`，`res.data: Skill.Info[]`，错误 `{ 404: NotFoundError }`。v1 gen（`src/gen/`）也经 hono-openapi 的 operationId 同步生成了同名方法。gen 文件的无关 diff 属契约漂移（types.gen.ts 全量重排），已确认 tsc 通过。

## 测试

- `test/skill/skill-available.test.ts`（新文件）：重组 `Skill.layer` 依赖链注入 `Global.layerWith({ octoConfig, home })` 隔离本机 `~/.config/octo` 与 `~/.claude/.agents`，断言 `available()` 四态：无 agent=全量（arrayContaining）、`octo_make`=白名单精确、`octo_ai`=空、`proto_replanner` 走 alias 命中 octo_make 白名单。
- `test/server/httpapi-instance.test.ts`（追加）：真起 HttpApi server，`setUrlParam("agent", ...)` 请求——`octo_make` 200+数组、不存在 agent 404。不断言 skill 内容（依赖机器全局配置，避免 flaky）。

## 影响面

- 纯插入，不触碰 jk 内网合并段内任何行，无同步负担。
- 不新增依赖，package.json/bun.lock 不动。
