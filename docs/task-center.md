# 任务中心使用说明

任务中心是应用级任务追踪面板，封装在 `packages/app/octoapp/context/task.ts`（`TaskStore` 单例）与 `packages/app/octoapp/components/task-list/`（`TaskList` / `TaskItemRow`）。底层文件服务（`EdmUtil`/`FileService`）已与任务追踪解耦，业务侧自行调用 `TaskStore` 维护任务状态，任务中心自动渲染。

## 快速接入

任务中心入口已接入标题栏（`components/titlebar-simple.tsx` 渲染 `<TaskList />`），无需额外挂载。业务侧只需与 `TaskStore` 交互：

```ts
import { TaskStore, type TaskItem } from "@/context/task"
```

## API

### `TaskStore.add` — 任务入队

```ts
TaskStore.add([{
  key: `${taskId}-0`,
  taskId,
  type: "upload",
  serviceType: "edm_upload",
  hasProgress: true,
  canPause: true,
  canCancel: true,
  pauseDisabled: false,
  cancelDisabled: false,
  name: file.name,
  size: file.size,
  progress: 0,
  status: "pending",
  createdAt: Date.now(),
  fileIndex: 0,
}])
```

一个任务可包含多个文件：`taskId` 相同、`fileIndex` 不同、`key` 唯一（通常 `taskId + fileIndex`）。

### `TaskStore.progress` — 进度更新

```ts
TaskStore.progress([{ key, progress: 45, status: "in_progress" /* 其余字段补齐以满足类型 */ } as TaskItem])
```

按 `key` 定位，更新 `progress` 与 `status`。

### `TaskStore.finish` — 传输完成

```ts
TaskStore.finish([{ key, progress: 100, status: "completed", docId, version } as TaskItem])
```

### `TaskStore.error` — 传输失败

```ts
TaskStore.error([{ key, status: "error" } as TaskItem])
```

仅按 `key` 更新 `status`。

### `TaskStore.cancel` — 取消任务

```ts
TaskStore.cancel(item)
```

将该任务项（按 `key`）置为 `cancelled`，并通知底层服务中止传输（`edm_upload` 调 `FileService.cancelUpload(taskId, fileIndex)`，`edm_download` 调 `FileService.cancelDownload(taskId)`）。

### `TaskStore.togglePause` — 暂停 / 继续

```ts
TaskStore.togglePause(item)
```

在 `paused` ↔ `in_progress` 之间切换（按 `key` 单项切换）。

### 派生列表（只读）

| 访问器 | 含义 |
|--------|------|
| `TaskStore.activeItems` | 进行中（`pending` + `in_progress`） |
| `TaskStore.pausedItems` | 已暂停 |
| `TaskStore.errorItems` | 失败 |
| `TaskStore.completedItems` | 已完成 |
| `TaskStore.cancelledItems` | 已取消 |
| `TaskStore.activeCount` | 进行中数量，驱动入口徽标 |
| `TaskStore.formatFileSize(bytes)` | 字节数格式化（B/KB/MB/GB） |

## 参数说明

### `TaskItem` 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | `string` | ✓ | 唯一标识，通常 `taskId + fileIndex` |
| `taskId` | `string` | ✓ | 任务 ID；多文件任务共享 |
| `type` | `"upload" \| "download" \| "archive"` | ✓ | 任务类型，决定标签文案（上传/下载/归档） |
| `serviceType` | `string` | ✓ | 服务类型，如 `edm_upload` / `s3_download`；暂停/取消据此配置 |
| `name` | `string` | ✓ | 文件名 |
| `size` | `number` | ✓ | 文件大小（字节） |
| `status` | `TaskStatus` | ✓ | 任务状态 |
| `hasProgress` | `boolean` | — | 是否有进度信息；缺省/`false` 时不显示大小、百分比 |
| `progress` | `number` | — | 进度 0–100；缺省按 0 |
| `canPause` | `boolean` | — | 是否出现暂停/继续按钮；缺省不显示 |
| `canCancel` | `boolean` | — | 是否出现取消按钮；缺省不显示 |
| `pauseDisabled` | `boolean` | — | 暂停按钮置灰；缺省可点 |
| `cancelDisabled` | `boolean` | — | 取消按钮置灰；缺省可点 |
| `docId` | `string` | — | 完成后分配的文档 ID |
| `version` | `string` | — | 文档版本号 |
| `cacheSign` | `string` | — | 缓存标识 |
| `createdAt` | `number` | — | 创建时间戳 |
| `fileIndex` | `number` | — | 多文件任务中的文件序号 |

### `TaskStatus` 取值

| 状态 | 含义 | 说明 |
|------|------|------|
| `pending` | 等待中 | 已入队未开始传输 |
| `in_progress` | 传输中 | 正在传输 |
| `paused` | 已暂停 | 手动暂停，可继续 |
| `completed` | 已完成 | 传输成功结束 |
| `error` | 失败 | 传输出错 |
| `cancelled` | 已取消 | 手动取消 |

终态（`completed` / `error` / `cancelled`）下：不显示大小与百分比、不显示进度条、不显示暂停/取消按钮。

## 业务接入示例

`EdmUtil` 不再自动写任务，业务侧在各生命周期回调中调用 `TaskStore`：

```ts
import { EdmUtil } from "@/utils/edmUtil"
import { TaskStore, type TaskItem } from "@/context/task"

EdmUtil.upload(files, {
  onInit: (taskId, items) => {
    TaskStore.add(items.map((f, i) => ({
      key: `${taskId}-${i}`,
      taskId,
      type: "upload",
      serviceType: "edm_upload",
      hasProgress: true,
      canPause: true,
      canCancel: true,
      pauseDisabled: false,
      cancelDisabled: i === 0, // 首个文件未启动前置灰取消
      name: f.name,
      size: f.size,
      progress: f.progress,
      status: "pending",
      createdAt: Date.now(),
      fileIndex: i,
    })))
  },
  onProgress: (taskId, items) => {
    TaskStore.progress(items.map((f, i) => ({
      key: `${taskId}-${i}`, progress: f.progress, status: "in_progress",
    }) as TaskItem))
  },
  onFinish: (taskId, items) => {
    TaskStore.finish(items.map((f, i) => ({
      key: `${taskId}-${i}`, progress: 100, status: "completed", docId: f.docId, version: f.version,
    }) as TaskItem))
  },
  onError: (taskId, errors) => {
    TaskStore.error(TaskStore.items()
      .filter(i => i.taskId === taskId)
      .map(i => ({ ...i, status: "error" }) as TaskItem))
  },
})
```

### 自定义暂停 / 取消行为

`TaskItemRow` 通过 props 注入回调，默认指向 `TaskStore`：

```tsx
<TaskItemRow
  item={item}
  onPause={TaskStore.togglePause}   // 默认
  onCancel={TaskStore.cancel}       // 默认
/>
```

若某类任务需要差异化逻辑，替换为自定义回调即可（如直接调用对应服务的取消接口）。

## UI 与图标

### 面板结构

- 入口：标题栏图标，有进行中任务时变蓝并显示数量徽标
- 面板：固定 360×446，头部（标题 `任务中心` + 关闭按钮）+ 可滚动列表
- 任务项：文件图标 + 标题 + 类型标签，状态描述，进度条；hover 显示暂停/取消按钮

### 图标替换

所有图标以 SVG 背景图引入，位于 `packages/app/public/task/`：

| 文件 | 用途 |
|------|------|
| `task-center.svg` | 入口图标（空闲态） |
| `task-center-active.svg` | 入口图标（有任务态） |
| `task-panel-close.svg` | 面板关闭按钮 |
| `task-pause.svg` | 暂停 |
| `task-play.svg` | 继续 |
| `task-cancel.svg` | 取消 |

直接替换对应 SVG 文件即可换图标（颜色已写进文件）。

## 验证

### DEV mock 数据

`context/task.ts` 在 `import.meta.env.DEV` 下注入覆盖每个 `type` / `serviceType` 组合与全部状态的 mock 数据，启动后打开任务中心即可核验各状态样式。

### 真实接入

业务侧按上方示例在 `EdmUtil` 回调中调用 `TaskStore`，`bun run dev` 后触发上传/下载，任务中心实时更新。
