# 打点接入指南

打点 SDK 封装在 `packages/app/octoapp/utils/tracker.ts`，调用方只需传业务字段，系统信息、用户信息、环境路由全部自动处理。

## 快速接入

```ts
import { tracker } from "@/utils/tracker"
```

## API

### `tracker.page` — PV 打点

页面挂载时调用，放在 `onMount` 里：

```ts
import { onMount } from "solid-js"
import { tracker } from "@/utils/tracker"

onMount(() => {
  tracker.page({ module: "insight", name: "insight-page" })
})
```

### `tracker.interaction` — 交互打点

用户完成一次操作后调用（按钮点击、流程完成等）：

```ts
async function createAndNavigate() {
  const session = await sdk.client.session.create(...)
  navigate(`/insight/${session.id}`)
  tracker.interaction({ module: "insight", name: "new-session" })
}
```

### `tracker.duration` — 时长打点

```ts
tracker.duration({ module: "insight", name: "session-active", extend: String(elapsedSeconds) })
```

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `module` | `string` | ✓ | 来源模块，如 `"insight"`、`"chat"` |
| `name` | `string` | ✓ | 事件名，描述这个打点的含义 |
| `from` | `string` | — | 数据来源，可选 |
| `extend` | `string` | — | 扩展参数，JSON 字符串或普通字符串 |

`type`（page / interaction / duration）由调用方法自动推断，无需传入。

## 自动采集字段

以下字段 SDK 内部自动处理，调用方无感知：

| 字段 | 来源 |
|------|------|
| `account` / `uid` | `localStorage.userInfo` |
| `browserName` / `browserVersion` / `os` | 解析 `navigator.userAgent` |
| `userAgent` | `navigator.userAgent` 原值 |
| `platform` | 固定 `3` |
| `project` | 固定 `"octo-agent"` |
| `datas.path` | `window.location.href` |
| `datas.screenWidth` / `datas.screenHeight` | `window.screen` |

## 验证

### 外网 dev

`bun run dev` 启动后触发任意打点，terminal 打印完整 payload，Network 面板可见请求响应 204：

```
[octo:tracker-mock] {
  "account": "xxx",
  "browserName": "Chrome",
  "browserVersion": "130",
  "module": "insight",
  "os": "macOS",
  "platform": 3,
  "project": "octo-agent",
  "userAgent": "...",
  "datas": {
    "name": "insight-page",
    "path": "http://localhost:5173/#/insight",
    "screenWidth": 1470,
    "screenHeight": 956,
    "type": "page"
  }
}
```

### 内网 beta / prod

`.env.beta` / `.env.prod` 中配置 `VITE_OCTO_REPORT_BASE_URL`，`bun run dev:beta` 即打真实接口，无需打包。Network 面板确认请求命中真实域名且响应 200/204。
