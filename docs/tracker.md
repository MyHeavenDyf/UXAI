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

进入/离开/切换页面时可指定 `subType`（默认 `"enter"`）：

```ts
tracker.page({ module: "insight", name: "insight-page", subType: "leave" })
```

### `tracker.interaction` — 交互打点

用户完成一次操作后调用，`name` 为必填事件标识：

```ts
tracker.interaction({ module: "insight", name: "new-session" })
tracker.interaction({ module: "insight", name: "send-message", subType: "click", extend: '{"from":"preset"}' })
```

`subType` 默认 `"click"`，可选 `"click" | "input" | "scroll" | "hover"`。

## 参数说明

### `tracker.page` 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `module` | `string` | ✓ | 来源模块，如 `"insight"`、`"chat"` |
| `name` | `string` | — | 页面名称 |
| `subType` | `"enter" \| "leave" \| "switch"` | — | 默认 `"enter"` |
| `from` | `string` | — | 来源路径，默认 `""` |
| `extend` | `string` | — | 扩展 JSON 字符串 |

### `tracker.interaction` 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `module` | `string` | ✓ | 来源模块 |
| `name` | `string` | ✓ | 事件标识，如 `"new-session"`、`"send-message"` |
| `subType` | `"click" \| "input" \| "scroll" \| "hover"` | — | 默认 `"click"` |
| `extend` | `string` | — | 扩展 JSON 字符串 |

## 自动采集字段

以下字段 SDK 内部自动处理，调用方无感知：

| 字段 | 来源 |
|------|------|
| `account` / `uid` | `localStorage.userInfo` |
| `browserName` | 解析 `navigator.userAgent`，小写（如 `"chrome"`） |
| `browserVersion` | 完整版本（如 `"147.0.0.0"`） |
| `os` / `platform` | 解析 `navigator.userAgent`，platform 为整数（1=Windows, 2=macOS, 3=Linux） |
| `userAgent` | `navigator.userAgent` 原值 |
| `project` | 固定 `"octo-agent"` |
| `datas[].path` | `window.location.href` |
| `datas[].screenWidth/Height` | `window.screen`（仅页面打点） |

## 验证

### 外网 dev

`bun run dev` 启动后触发打点，terminal 打印完整 payload（两个接口 tag 不同）：

```
[octo:tracker-mock:page] {
  "account": "xxx",
  "browserName": "chrome",
  "browserVersion": "148.0.0.0",
  "platform": 2,
  "module": "insight",
  "project": "octo-agent",
  "datas": [{ "type": "page", "subType": "enter", "name": "insight-page", ... }]
}

[octo:tracker-mock:interaction] {
  ...
  "datas": [{ "type": "interaction", "subType": "click", "name": "new-session", ... }]
}
```

Network 面板可见两个独立请求均响应 200。

### 内网 beta / prod

配置 `VITE_OCTO_REPORT_BASE_URL` 后，`bun run dev:beta` 即打真实接口，无需打包。
