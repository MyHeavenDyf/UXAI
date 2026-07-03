# EDM 文件服务接入指南

EDM 文件服务 SDK 封装在 `packages/app/octoapp/utils/edmUtil.ts`，底层调用 `FileService`，调用方只需传业务参数，上传/下载进度、回调全部自动分发。

## 快速接入

```ts
import { EdmUtil } from "@/utils/edmUtil"
```

## API

### `EdmUtil.upload` — 文件上传

```ts
const files = ... // 来自 <input type="file"> 的 FileList

EdmUtil.upload(files, {
  onInit: (taskId, items) => {
    // taskId: 任务 ID，items: 每个文件的初始化状态
    console.log("任务初始化", taskId, items)
  },
  onProgress: (taskId, items) => {
    // items: 每个文件的上传进度（0-100）
    console.log("上传进度", taskId, items)
  },
  onFinish: (taskId, items) => {
    // items: 每个文件完成后的 docId / version
    console.log("上传完成", taskId, items)
  },
  onError: (taskId, error) => {
    console.log("上传失败", taskId, error)
  },
})
```

### `EdmUtil.download` — 文件下载

```ts
EdmUtil.download(
  [{ docId: "12345", docVersion: "1.0" }],
  {
    onProgress: (taskId, progress) => {
      // progress: 下载进度（0-100）
      console.log("下载进度", taskId, progress)
    },
    onFinish: (taskId, data) => {
      console.log("下载完成", taskId, data)
    },
    onError: (taskId, error) => {
      console.log("下载失败", taskId, error)
    },
  }
)
```

### `EdmUtil.preview` — 文件预览

通过 `deliverableId` 在线预览文件：

```ts
EdmUtil.preview(10001)
```

### `EdmUtil.edit` — 文件编辑

通过 `deliverableId` 打开在线编辑：

```ts
EdmUtil.edit(10001)
```

## 参数说明

### `EdmUtil.upload` 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileData` | `FileList` | ✓ | 来自文件输入控件的文件列表 |
| `callbacks` | `UploadCallbacks` | ✓ | 上传生命周期回调 |

#### `UploadCallbacks`

| 回调 | 签名 | 说明 |
|------|------|------|
| `onInit` | `(taskId: string, files: UploadInitItem[]) => void` | 任务创建，获取每个文件的 `cacheSign`、初始进度 |
| `onProgress` | `(taskId: string, files: UploadProgressItem[]) => void` | 进度更新，`progress` 为 0-100 |
| `onFinish` | `(taskId: string, files: UploadFinishItem[]) => void` | 上传完成，`docId` / `version` 可用 |
| `onError` | `(taskId: string, errors: ServiceError) => void` | 错误回调，含 `statusCode` + `message` |

### `EdmUtil.download` 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileData` | `Array<DownloadItem>` | ✓ | 要下载的文件列表，每项含 `docId`，可选 `docVersion` |
| `callbacks` | `DownloadCallbacks` | ✓ | 下载生命周期回调 |

#### `DownloadCallbacks`

| 回调 | 签名 | 必填 | 说明 |
|------|------|------|------|
| `onProgress` | `(taskId: string, progress: number) => void` | ✓ | 下载进度 0-100 |
| `onFinish` | `(taskId: string, data: unknown) => void` | — | 下载完成 |
| `onError` | `(taskId: string, data: ServiceError) => void` | — | 下载失败 |

### `EdmUtil.preview` / `EdmUtil.edit` 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deliverableId` | `number` | ✓ | EDM 交付物 ID |

## 类型定义

### `UploadInitItem`

```ts
interface UploadInitItem {
  index: number        // 文件在 FileList 中的序号
  cacheSign: string    // 缓存标识
  progress: number     // 初始进度
  name: string         // 文件名
  size: number         // 文件大小（字节）
  lstatus: { statusCode: number; message: string }
}
```

### `UploadFinishItem`

```ts
interface UploadFinishItem {
  cacheSign: string
  name: string
  size: number
  docId: string        // 上传完成后分配的文档 ID
  version: string      // 文档版本号
  file: {
    index: number
    cacheSign: string
    progress: number
    docId: string
    version: string
    status: { statusCode: number; message: string }
  }
}
```

### `DownloadItem`

```ts
type DownloadItem = {
  docId: string           // 文档 ID
  docVersion?: string     // 文档版本（可选）
}
```

### `ServiceError`

```ts
interface ServiceError {
  status: number
  message: string
}
```

## 验证

### 外网 dev

`bun run dev` 启动后调用 `EdmUtil.upload` / `EdmUtil.download`，terminal 打印入参：

```
Uploading files: FileList [...]
Downloading files: [{ docId: "12345", docVersion: "1.0" }]
```

### 内网 beta / prod

配置 EDM 相关环境变量后，`bun run dev:beta` 即走真实接口。
