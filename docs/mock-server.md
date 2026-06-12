# Mock Server 接入指南

本地 dev 环境的 mock server 基于 Vite 插件实现，无需额外进程，`bun run dev` 自动生效。

## 目录结构

```
packages/app/mock/
  index.ts                    ← 插件入口，注册所有 handler
  handlers/
    pipeline/
      index.ts                ← pipeline API handler
      data.ts                 ← pipeline mock 数据
    tracker/
      index.ts                ← 打点 API handler
    your-feature/             ← 新 handler 按此模式新增
      index.ts
      data.ts
```

## 新增 Mock Handler

### 1. 创建 handler 目录

```
packages/app/mock/handlers/your-feature/
  index.ts      ← 路由逻辑
  data.ts       ← mock 数据（响应有数据时创建，void 接口不需要）
```

### 2. 实现 handler

`index.ts` 导出 `prefix` 和 `handle`，结构固定：

```ts
// packages/app/mock/handlers/your-feature/index.ts
import type { IncomingMessage, ServerResponse } from "node:http"
import { MOCK_DATA } from "./data.js"

export const prefix = "/your-api/path"

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

export function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.method === "OPTIONS") {
    setCors(res)
    res.statusCode = 204
    res.end()
    return
  }

  setCors(res)
  res.setHeader("Content-Type", "application/json")
  res.statusCode = 200
  res.end(JSON.stringify({ data: MOCK_DATA }))
}
```

### 3. 注册到 index.ts

在 `packages/app/mock/index.ts` 中添加一行 import：

```ts
import * as pipeline from "./handlers/pipeline/index.js"
import * as tracker from "./handlers/tracker/index.js"
import * as yourFeature from "./handlers/your-feature/index.js"  // 新增

const handlers: MockHandler[] = [pipeline, tracker, yourFeature]  // 新增
```

`vite.js` 和 `electron.vite.config.ts` 不需要改动。

## 注意事项

- **前缀匹配**：`prefix` 用 `startsWith` 匹配，精确路径和带子路径都能命中
- **响应格式**：按各接口实际格式返回，与真实接口保持一致
- **CORS**：每个 handler 自己设置，模板见上方示例
- **环境隔离**：mock 仅在外网 dev 生效；内网环境（`VITE_OCTO_REPORT_BASE_URL` 有值）请求直接打真实接口，mock 不拦截
