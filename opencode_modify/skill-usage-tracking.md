# Skill 使用打点（埋点计数）

## 动机

后端需要统计每个 skill 被模型实际使用的次数，用于数据看板。

## 触发时机

模型每次主动调用 `skill(name=xxx)` 工具加载某 skill 内容时，向后端 POST 一次计数。autoload 注入到 system prompt 的 skill 不计入（被动注入，模型未主动选择）。

## 改动文件

| 文件 | 改动内容 |
|------|----------|
| `packages/opencode/src/tool/skill-track.ts` | 新建：env 切换 URL + `reportSkillUse()` fire-and-forget 上报 |
| `packages/opencode/src/tool/skill.ts` | import + `ctx.ask` 之后调用 `reportSkillUse(info.name)` |
| `opencode_modify/skill-usage-tracking.md` | 本文件 |

## 设计决策

### 1. 环境切换：模式 A（env 覆盖默认 beta）

与 `config/builtin-mcp.ts` 中 `OCTO_UXR_MCP_URL` 一致：
- 默认 beta：`https://octo-beta.hdesign.huawei.com/main/rest.root/report/skill/count`
- prod：`https://octo.hdesign.huawei.com/main/rest.root/report/skill/count`
- 生产部署通过 `OCTO_SKILL_TRACKING_URL` env 注入 prod URL
- 首次调用时 log `SKILL_TRACKING_URL_SOURCE`，方便排查

### 2. 脱离 effect scope 的 fire-and-forget

用裸 `fetch().then()` 而非 `Effect.fork`。原因：`tool execute` 返回后 effect scope 可能关闭，`Effect.fork` 出去的 child fiber 会随 scope 关闭被中断，fetch 可能发不出去。计数场景"发了就行"，不需要 effect 生命周期管理。

### 3. 失败完全静默

fetch rejection / non-2xx / 超时全部 catch，只 log.warn，不影响 skill 工具返回。5 秒超时（`AbortSignal.timeout(5_000)`）。不传 `ctx.abort`：用户取消 skill 不影响计数。

### 4. 不带用户身份

payload：`{"zipName": <skill名>, "type": "citation"}`。无 user / session / agent 字段。

### 5. 代理绕过

不需要改 `util/network.ts`：`BYPASS_PROXY_HOSTS` 已含 `.huawei.com` 通配，自动覆盖 `octo-beta.hdesign.huawei.com` 和 `octo.hdesign.huawei.com`。

## 使用方式

```bash
# 默认 beta，无需设置
# 切到 prod：
export OCTO_SKILL_TRACKING_URL=https://octo.hdesign.huawei.com/main/rest.root/report/skill/count
```

## 实施日期

2026-07-02
