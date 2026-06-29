# Pipeline API 接口接入指南

后端接口统一封装在 `packages/app/octoapp/network/pipelineRequest.ts`，底层由 `apiFetch` 驱动，自动处理内网/外网双路径：
- **内网**（Electron + `VITE_OCTO_BASE_URL` 有值）：通过 IPC → 主进程 `net.fetch` 直连真实接口（绕过 CORS）
- **外网**（Web app 或 host 空）：浏览器 fetch → Vite mock/proxy 拦截

## 快速接入

```ts
import { fetchDomains } from "@/network/pipelineRequest"
```

## 新增接口步骤

假设后端新增了一个接口 `GET /pipeline/rest.root/workflow/team/getTeamById?teamId=123`，返回团队信息。

### 1. 添加类型定义

在 `packages/app/octoapp/network/types.ts` 中添加响应类型：

```ts
export type Team = {
  id: number
  name: string
  memberCount: number
}
```

### 2. 添加接口函数

在 `packages/app/octoapp/network/pipelineRequest.ts` 中：

```ts
import type { ..., Team } from "./types"

// GET 请求 — 无 body，参数放 query
export async function fetchTeamById(teamId: number): Promise<Team> {
  return apiFetch({ path: "/team/getTeamById", query: { teamId } })
}

// POST 请求 — 有 body
export async function createTeam(name: string, memberCount: number): Promise<Team> {
  return apiFetch({ path: "/team/createTeam", method: "POST", body: { name, memberCount } })
}
```

### 3. 选择路径前缀

接口默认使用 `API_PREFIXES.pipeline`（`/pipeline/rest.root/workflow`）。若接口属于 main 服务，显式指定 `prefix`：

```ts
export async function fetchTeamById(teamId: number): Promise<Team> {
  return apiFetch({ path: "/team/getTeamById", query: { teamId }, prefix: API_PREFIXES.main })
}
```

若后端新增了全新的路径前缀（如 `/report/rest.root/report`），先在 `API_PREFIXES` 注册：

```ts
const API_PREFIXES = {
  pipeline: "/pipeline/rest.root/workflow",
  main: "/main/rest.root/main",
  report: "/report/rest.root/report",  // 新增
}
```

然后接口函数通过 `prefix: API_PREFIXES.report` 引用。

## `ApiFetchOptions` 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `path` | `string` | ✓ | — | 接口相对路径，不含前缀（如 `/domain/getDomains`） |
| `method` | `string` | — | `"GET"` | HTTP 方法 |
| `query` | `Record<string, any>` | — | `{}` | URL 查询参数，自动拼接为 `?key=value` |
| `body` | `any` | — | — | JSON 请求体，自动 `JSON.stringify` + 设 `Content-Type: application/json` |
| `prefix` | `string` | — | `API_PREFIXES.pipeline` | 路径前缀，从 `API_PREFIXES` 中选取 |

## 响应解析规则

`parseResponse` 统一处理后端两种响应格式：

```ts
// 格式 A：{ errorCode: 200, content: ... }
// 格式 B：{ data: { errorCode: 200, content: ... } }
```

- `errorCode === 200` → 返回 `content`
- `errorCode === 400 || 1417` → 触发登录跳转（`openLogin`）
- 其他 `errorCode` → 弹出错误 toast + throw

## 现有接口一览

| 函数 | 方法 | 路径 | 前缀 | 说明 |
|------|------|------|------|------|
| `topProduct` | POST | `/product/top` | pipeline | 置顶产品 |
| `cancelTopProduct` | POST | `/product/cancelTop` | pipeline | 取消置顶 |
| `topVersion` | POST | `/version/top` | pipeline | 置顶版本 |
| `cancelTopVersion` | POST | `/version/cancelTop` | pipeline | 取消置顶 |
| `fetchDomains` | GET | `/domain/getDomains` | pipeline | 获取领域列表 |
| `fetchProductLines` | GET | `/domain/getSubDomains` | pipeline | 获取产品线 |
| `fetchProducts` | GET | `/product/getProducts` | pipeline | 获取产品列表 |
| `fetchVersions` | GET | `/version/getVersionByProduct` | pipeline | 获取版本列表 |
| `searchProducts` | GET | `/product/search` | pipeline | 搜索产品 |
| `fetchDomainInfoByProduct` | GET | `/domain/getDomainInfoByProduct` | pipeline | 按产品查领域信息 |
| `checkTokenExpiration` | GET | `/token/isExpiration` | main | token 过期检查 |
| `searchDeliverables` | GET | `/deliverable/search` | pipeline | 搜索交付物 |
| `uploadDeliverable` | POST | `/deliverable/uploadDeliverable` | main | 上传交付物 |

## 验证

### 外网 dev

`bun run dev` 启动后调用接口，Vite mock/proxy 拦截请求，terminal 打印入参。

### 内网 beta

配置 `.env.beta` 中 `VITE_OCTO_BASE_URL` 后，`bun run dev:beta` 即通过 IPC 走真实接口。若需 mock，设置 `MOCK_API=false` 关闭。
