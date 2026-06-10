# MCP 代理策略修复：自动检测 + 显式配置

## 问题描述

用户设置全局代理后，MCP 服务无法连接（超时/504），关闭全局代理后恢复正常。

## 根因

`sidecar.ts` 中调用 `setGlobalProxyFromEnv()` 后，进程内所有 `fetch` 调用都走代理。MCP transport 连接内网/本地服务器时也被代理拦截。

之前的修复 `addMcpHostsToNoProxy()` 通过 `NO_PROXY` 环境变量尝试绕过，但 Bun 的 `NO_PROXY` 支持不可靠（oven-sh/bun#1440），修复无效。

## 修改方案

### 1. `packages/opencode/src/config/mcp.ts` — 添加 `proxy` 配置字段

在 `Remote` schema 中添加可选的 `proxy` 字段：

```ts
proxy: Schema.optional(Schema.Boolean).annotate({
  description: "Force proxy usage (true) or bypass proxy (false). Auto-detected from URL if not set.",
}),
```

用户配置示例：

```json
{
  "mcp": {
    "uxr-tool": {
      "type": "remote",
      "url": "http://7.192.161.60:8005/mcp",
      "proxy": false
    },
    "some-cloud-mcp": {
      "type": "remote",
      "url": "https://api.example.com/mcp",
      "proxy": true
    }
  }
}
```

### 2. `packages/opencode/src/mcp/index.ts` — 自动检测 + 配置覆盖

新增三个函数：

- **`noProxyFetch`** — 临时清除 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量后执行 fetch，完成后恢复
- **`isPrivateUrl`** — 判断 URL 是否为内网/本地地址（localhost、127.x、10.x、172.16-31.x、192.168.x、::1）
- **`mcpFetch`** — 根据 `proxy` 配置选择 fetch 策略：
  - `proxy: true` → 使用 `globalThis.fetch`（走代理）
  - `proxy: false` → 使用 `noProxyFetch`（绕过代理）
  - 未设置 → 自动检测：内网用 `noProxyFetch`，外网用 `globalThis.fetch`

在 `connectRemote` 和 `startAuth` 的 transport 创建处传入 `fetch: fetchFn`。

### 3. `packages/desktop/src/main/sidecar.ts` — 移除无效修复

删除 `addMcpHostsToNoProxy` 函数定义和调用（Bun NO_PROXY 不可靠）。

## 涉及文件

| 文件 | 修改 |
|------|------|
| `packages/opencode/src/config/mcp.ts` | `Remote` schema 添加 `proxy` 可选字段 |
| `packages/opencode/src/mcp/index.ts` | 新增 `noProxyFetch`/`isPrivateUrl`/`mcpFetch`，transport 使用动态 fetch |
| `packages/desktop/src/main/sidecar.ts` | 移除无效的 `addMcpHostsToNoProxy` |

## 验证

- 类型检查: `cd packages/opencode && bunx tsgo --noEmit` — 通过
- 功能测试:
  - 设置全局代理，MCP 配置不设 `proxy` → 内网 MCP 自动绕过代理，外网 MCP 走代理
  - MCP 配置 `proxy: false` → 强制绕过代理
  - MCP 配置 `proxy: true` → 强制走代理
  - 无代理环境下所有 MCP 连接正常
