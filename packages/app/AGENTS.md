## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## Unit tests

- `src/` 与 `octoapp/` 是两棵镜像目录树，存在同名测试文件（如两份 `server-health.test.ts`）。bun 的
  `mock.module` 是**进程级且不可撤销**的，两棵树塞进同一次 `bun test` 会互相污染模块注册表
  （实测 src 的 mock 漏进 octoapp，`createSdkForServer` 变 undefined）。
  因此 `test:unit` / `test:ci` 是**两次独立进程**（`test:unit:src` + `test:unit:octoapp`），
  别合并回一条命令。junit 也因此输出两份（`junit.xml` / `junit-octoapp.xml`，CI glob 已按 `*.xml` 收）。
- 跑单棵树：`bun run test:unit:src` / `bun run test:unit:octoapp`。
- `bun test` 会把 `solid-js` 解析到 `dist/server.js`（**无响应式**，memo 只算一次）。测响应式行为要么加
  `--conditions=browser`，要么把断言打在被驱动的数据层而不是 memo 上（后者是现有做法）。

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
