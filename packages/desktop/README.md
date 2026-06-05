# Octo Agent Desktop

The Octo Agent Desktop app, built with Electron (electron-vite + electron-builder).

## IPC Handlers (`src/main/ipc.ts`)

| Handler | 说明 |
|---------|------|
| `get-skills-config` | 读取 `~/.config/octo/skills.json` |
| `set-skills-config` | 写入 `~/.config/octo/skills.json` |
| `store-get/set/delete/clear/keys/length` | electron-store 操作 |
| `open-directory-picker` / `open-file-picker` / `save-file-picker` | 文件选择对话框 |
| `get/set-default-server-url` | 服务端 URL 管理 |
| `get/set-window-focus`, `show-window` | 窗口管理 |
| `run-updater`, `check-update`, `install-update` | 自动更新 |

## Development

```bash
bun install
bun dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```
