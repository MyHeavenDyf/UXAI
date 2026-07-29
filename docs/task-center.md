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
TaskStore.progress([{ key, progress: 45, status: "in_progress" }])
```

按 `key` 定位，更新 `progress` 与 `status`。仅传需更新字段；终态（`completed`/`error`/`cancelled`）项不会被覆盖，`paused` 项保持 `paused`（底层未真正暂停，见 `togglePause` TODO）。

### `TaskStore.finish` — 传输完成

```ts
TaskStore.finish([{ key, progress: 100, status: "completed", docId, version }])
```

写入 `progress`/`status`，并持久化 `docId`/`version`（供后续按文档 id 跳转）。`progress`/`status` 可缺省（分别回退原值与 `completed`）。

### `TaskStore.error` — 传输失败

```ts
TaskStore.error([{ key, status: "error" }])
```

仅按 `key` 更新 `status`（缺省为 `error`）。

### `TaskStore.cancel` — 取消任务

```ts
TaskStore.cancel(item)
```

将该任务项（按 `key`）置为 `cancelled`，并通知底层服务中止传输（`edm_upload` 调 `FileService.cancelUpload(taskId, fileIndex)`，`edm_download` 调 `FileService.cancelDownload(taskId)`）。

### `TaskStore.togglePause` — 暂停 / 继续

```ts
TaskStore.togglePause(item)
```

在 `paused` ↔ `in_progress` 之间切换（按 `key` 单项切换）。**注意：`FileService` 暂无 pause/resume，当前仅翻转 store 状态、未真正暂停底层传输**，待 `FileService` 支持后经注册表 `pause` 句柄补接。

### `TaskStore.registerService` — 注册服务句柄

```ts
TaskStore.registerService("edm_upload", {
  cancel: (item) => { FileService.cancelUpload(item.taskId, item.fileIndex!) },
})
```

按 `serviceType` 注册取消/暂停句柄；`cancel` / `togglePause` 据此派发，新服务接入无需改 `task.ts`。已内置 `edm_upload` / `edm_download` 的 `cancel`（`pause` 待 `FileService` 支持后补）。

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
| `serviceType` | `string` | ✓ | 服务类型，如 `edm_upload` / `s3_download`；取消时据此派发到对应服务（`edm_upload`→`FileService.cancelUpload`，`edm_download`→`FileService.cancelDownload`） |
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
    })))
  },
  onFinish: (taskId, items) => {
    TaskStore.finish(items.map((f, i) => ({
      key: `${taskId}-${i}`, progress: 100, status: "completed", docId: f.docId, version: f.version,
    })))
  },
  onError: (taskId, errors) => {
    TaskStore.error(TaskStore.items()
      .filter(i => i.taskId === taskId)
      .map(i => ({ key: i.key, status: "error" })))
  },
})
```

### 自定义暂停 / 取消行为

取消/暂停按 `serviceType` 经注册表（`TaskStore.registerService`）派发到对应服务，内置 `edm_upload` / `edm_download` 的 `cancel`。新服务（如 `s3_upload`）接入时调用 `registerService` 注册自己的 `cancel` / `pause` 句柄即可，无需改 `task.ts`。

`TaskItemRow` 的 `onPause` / `onCancel` props 默认指向 `TaskStore.togglePause` / `TaskStore.cancel`：

```tsx
<TaskItemRow
  item={item}
  onPause={TaskStore.togglePause}   // 默认
  onCancel={TaskStore.cancel}       // 默认
/>
```

若某条目需完全跳过 store 派发、走自定义逻辑，可替换为自定义回调。

## UI 与图标

### 面板结构

- 入口：标题栏图标，有进行中任务时外加旋转圈并缩小为 16px；全为终态时显示 28px 静态图标；无任何任务时整入口隐藏
- 面板：固定 360×446，头部（标题 `任务中心` + 关闭按钮）+ 可滚动列表
- 任务项：文件图标 + 标题 + 类型标签，状态描述，进度条；hover 显示暂停/取消按钮

### 图标替换

所有图标以 SVG 背景图引入，位于 `packages/app/public/task/`：

| 文件 | 用途 |
|------|------|
| `task-center.svg` | 入口图标（空闲态与有任务态共用，有任务时叠加旋转圈） |
| `task-panel-close.svg` | 面板关闭按钮 |
| `task-pause.svg` | 暂停 |
| `task-play.svg` | 继续 |
| `task-cancel.svg` | 取消 |

直接替换对应 SVG 文件即可换图标（颜色已写进文件）。

## 验证

`context/task.ts` 不再注入 DEV mock 数据。任务中心为纯展示层，验证依赖真实接入：`bun run dev` 后触发上传/下载/归档，`TaskStore` 在各生命周期回调中更新，任务中心实时刷新。
