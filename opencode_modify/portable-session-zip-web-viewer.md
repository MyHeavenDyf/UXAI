# Session ZIP 在线对话查看器接入说明

## 1. 目标

本文说明如何在浏览器中读取 Octo Agent 导出的 Session ZIP，将其中的会话、消息、附件和生成产物转换为可视化对话记录。

该 ZIP 是一个离线数据包，不需要连接原始电脑或原始项目。浏览器端只需要解压并读取根目录下的 `manifest.json`，再按清单中的 `blob` 引用加载附件和产物。

适用场景：

- 在网页中上传 ZIP 后离线浏览对话；
- 将 ZIP 上传到服务端，生成只读分享页面；
- 在知识库或审计系统中归档 Session；
- 查看主 Session、子 Session、Todo、附件和生成产物。

## 2. ZIP 目录结构

典型结构如下：

```text
session.zip
├── manifest.json
└── blobs/
    ├── 08f12c...a91e
    ├── 5a9bc1...33d0
    └── ...
```

说明：

- `manifest.json`：Session、消息、Todo 和文件索引；
- `blobs/<sha256>`：附件和产物的实际二进制内容；
- 相同内容只保存一次，多个文件可以引用同一个 Blob；
- ZIP 内不会按原目录重复保存文件，原始逻辑路径记录在 `manifest.files` 中。

## 3. manifest.json 顶层结构

当前格式版本为 `1`：

```ts
type PortableManifest = {
  format: "octo-session"
  version: 1
  exportedAt: number
  rootSessionID: string
  sourceDirectory: string
  exclusions: string[]
  sessions: SessionEntry[]
  files: FileEntry[]
}

type SessionEntry = {
  info: SessionInfo
  messages: MessageWithParts[]
  todos: Todo[]
}

type FileEntry = {
  sessionID: string
  scope?: "session" | "design-history" | "project"
  directory: string
  path: string
  size: number
  sha256: string
  blob: string
}
```

打开文件后应首先校验：

```ts
if (manifest.format !== "octo-session") throw new Error("不支持的文件格式")
if (manifest.version !== 1) throw new Error("不支持的格式版本")
if (!manifest.sessions.some((item) => item.info.id === manifest.rootSessionID)) {
  throw new Error("根 Session 不存在")
}
```

`sourceDirectory` 只用于识别导出前的旧路径。在线查看器不能直接访问该目录，也不应向用户暴露完整本地路径。

`exclusions` 会明确列出未导出的内容。目前通常不包含凭据、权限、分享链接、运行中的进程和工作区绑定。

代码工作区分享会传入 `?scope=project`；直接导出时在 JSON 中传入 `scope: "project"`。
此时收集整个工作区共享目录中的文件，使用 `scope: "project"` 标记，每个文件只收集一次，不按 Session 重复。
不再按会话引用筛选文件，也不解析静态依赖，因此动态引用的目录内资源同样可以包含。
共享文件保留相对工作区根目录的路径，跳过隐藏条目、`node_modules`、符号链接和本次导出目标 ZIP。
普通工作区不传 `scope`，继续只导出会话私有文件。代码工作区的 ZIP 可能包含其他会话生成或上传的共享文件，但不会额外包含其他会话的聊天记录。
导入时共享文件恢复到选中的工作区目录；已有文件内容相同则保留，内容不同则提示冲突并停止，不覆盖。
导入只恢复 `manifest.files` 中的文件；之前按需导出的 ZIP 不会自动补齐文件，需要重新导出。
文件读取并发上限为 8，相同内容通过 Blob 哈希去重。

## 4. Session 结构

网页应通过 `rootSessionID` 找到主 Session，并根据 `info.parentID` 构建子 Session 树。

常用字段：

```ts
type SessionInfo = {
  id: string
  parentID?: string
  title: string
  agent?: string
  category?: "dev" | "design" | "prototype" | "analysis" | "creative" | "planning" | "subagent"
  model?: {
    id: string
    providerID: string
    variant?: string
  }
  time: {
    created: number
    updated: number
    archived?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: unknown[]
  }
  pinned: boolean
  sort_order: number
}
```

推荐界面：

- 左侧展示主 Session 和子 Session 树；
- 中间展示当前 Session 的消息时间线；
- 右侧展示附件、生成产物和 Todo；
- 如果只需要单页分享，可默认打开 `rootSessionID`，将子 Session 放在“子任务”折叠区。

构建树的示例：

```ts
function buildSessionTree(manifest: PortableManifest) {
  const children = new Map<string, SessionEntry[]>()

  for (const session of manifest.sessions) {
    const parentID = session.info.parentID ?? "__root__"
    children.set(parentID, [...(children.get(parentID) ?? []), session])
  }

  const visit = (sessionID: string): unknown => {
    const session = manifest.sessions.find((item) => item.info.id === sessionID)
    if (!session) throw new Error(`Session 不存在: ${sessionID}`)
    return {
      ...session,
      children: (children.get(sessionID) ?? []).map((item) => visit(item.info.id)),
    }
  }

  return visit(manifest.rootSessionID)
}
```

## 5. 消息结构与排序

每条消息由 `info` 和 `parts` 组成：

```ts
type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: MessagePart[]
}
```

用户消息：

```ts
type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent: string
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
}
```

助手消息：

```ts
type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  parentID: string
  time: {
    created: number
    completed?: number
  }
  agent: string
  providerID: string
  modelID: string
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  error?: unknown
  finish?: string
}
```

渲染时优先保持 `messages` 数组原顺序。为了兼容其他处理链路，也可以复制数组后按 `info.time.created` 排序，并使用 `info.id` 作为时间相同时的稳定排序键。`parts` 的数组顺序是消息内部的权威顺序，不要按类型重新排序。

助手消息的 `parentID` 指向对应的用户消息，可用于将“一次用户提问 + 一次或多次助手响应”组合为一个 Turn。

```ts
function orderedMessages(session: SessionEntry) {
  return [...session.messages].sort(
    (left, right) =>
      left.info.time.created - right.info.time.created || left.info.id.localeCompare(right.info.id),
  )
}
```

## 6. MessagePart 的可视化规则

建议按以下规则将 `parts` 转为 UI：

| `part.type` | 推荐显示方式 |
| --- | --- |
| `text` | 用户或助手正文；支持 Markdown，但必须净化 HTML |
| `reasoning` | 默认折叠的“思考过程”区域，可根据产品策略隐藏 |
| `file` | 附件卡片，显示文件名、类型、大小和预览/下载按钮 |
| `tool` | 折叠的工具调用卡片，显示工具名、状态、输入和输出 |
| `subtask` | 子任务卡片，显示描述、Agent 和模型 |
| `agent` | Agent 切换或调用标记 |
| `retry` | 重试提示和错误摘要 |
| `compaction` | “上下文已压缩”系统标记，通常不进入正文 |
| `step-start` / `step-finish` | 步骤边界；可用于耗时、Token 和费用统计 |
| `snapshot` / `patch` | 代码快照或文件变更摘要，默认折叠 |

`text` 部件中 `ignored: true` 的内容建议隐藏；`synthetic: true` 的内容建议标为系统生成内容，而不是用户真实输入。

工具状态包括：

- `pending`：等待执行；
- `running`：执行中；
- `completed`：成功，可展示 `title`、`output` 和 `attachments`；
- `error`：失败，展示经过转义的 `error`。

工具输入、输出和错误默认都按纯文本或代码块显示。不要将工具输出直接作为 HTML 插入页面。

## 7. 加载 ZIP 的浏览器示例

以下示例使用 `JSZip`。生产代码建议再配合运行时 Schema 校验库，如 Zod、Valibot 或 Effect Schema。

```ts
import JSZip from "jszip"

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

export async function loadPortableSession(file: File) {
  const zip = await JSZip.loadAsync(file)
  const manifestEntry = zip.file("manifest.json")
  if (!manifestEntry) throw new Error("ZIP 中缺少 manifest.json")

  const manifest = JSON.parse(await manifestEntry.async("string")) as PortableManifest
  if (manifest.format !== "octo-session" || manifest.version !== 1) {
    throw new Error("不是受支持的 Session ZIP")
  }

  const blobs = new Map<string, Uint8Array>()
  let totalBytes = 0

  for (const fileEntry of manifest.files) {
    if (!isSafeRelativePath(fileEntry.blob) || !isSafeRelativePath(fileEntry.path)) {
      throw new Error("ZIP 中包含不安全路径")
    }

    if (blobs.has(fileEntry.blob)) continue
    const blobEntry = zip.file(fileEntry.blob)
    if (!blobEntry) throw new Error(`缺少数据文件: ${fileEntry.blob}`)

    const bytes = await blobEntry.async("uint8array")
    totalBytes += bytes.byteLength
    if (bytes.byteLength !== fileEntry.size) throw new Error(`文件大小不匹配: ${fileEntry.path}`)
    if ((await sha256Hex(bytes)) !== fileEntry.sha256) {
      throw new Error(`文件校验失败: ${fileEntry.path}`)
    }
    blobs.set(fileEntry.blob, bytes)
  }

  return { manifest, blobs, totalBytes }
}

function isSafeRelativePath(value: string) {
  const normalized = value.replaceAll("\\", "/")
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:\//.test(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    !normalized.includes("\0")
  )
}
```

## 8. 将 Blob 映射回附件和产物

`manifest.files` 是文件逻辑路径与 ZIP Blob 的映射。浏览器端不需要恢复原始磁盘目录，只需建立逻辑路径索引和 Object URL。

```ts
function logicalFilePath(file: FileEntry) {
  const tail = [file.directory, file.path]
    .filter((part) => part && part !== ".")
    .join("/")

  if (file.scope === "project") return tail
  if (file.scope === "design-history") {
    return `.octo/design/history/${file.sessionID}/${tail}`
  }
  return `.octo/${file.sessionID}/${tail}`
}

function createFileIndex(manifest: PortableManifest, blobs: Map<string, Uint8Array>) {
  return new Map(
    manifest.files.map((file) => {
      const bytes = blobs.get(file.blob)
      if (!bytes) throw new Error(`Blob 尚未加载: ${file.blob}`)
      return [
        logicalFilePath(file),
        {
          ...file,
          bytes,
          url: URL.createObjectURL(new Blob([bytes], { type: inferMime(file.path) })),
        },
      ]
    }),
  )
}
```

页面卸载或切换 ZIP 时必须对所有 Object URL 调用 `URL.revokeObjectURL(url)`，避免内存泄漏。

ZIP 清单当前不单独保存 MIME 类型，因此 `inferMime` 需要根据扩展名推断，并对未知类型返回 `application/octet-stream`。不要只相信文件名决定是否执行内容，预览前还应检查文件头或在服务端做内容识别。

文件分类建议：

- `.octo/<sessionID>/uploads/**`：用户上传的附件；
- `.octo/<sessionID>/outputs/**`：Agent 生成的文件和产物；
- `.octo/<sessionID>/assets/**`、`resource/**`：产物引用的资源；
- `.octo/<sessionID>/extracted/**`：从文档中抽取的中间内容；
- `.octo/design/history/<sessionID>/**`：设计历史、主题和批注资源。

`file` 类型消息中的 `url` 或 `source.path` 可能仍表现为导出机器上的路径。在线查看器应优先使用 `sessionID + filename/path` 在 `manifest.files` 中匹配，不能直接请求 `file://` URL。

推荐匹配顺序：

1. 从 `url` 或 `source.path` 中提取 `.octo/<sessionID>/` 后的相对路径，做精确匹配；
2. 在相同 `sessionID` 的 `uploads` 和 `outputs` 中按 `filename` 匹配；
3. 如果仍无法匹配，将附件标为“文件未包含在数据包中”；
4. 对 `https://` 远程资源不要默认自动加载，可由用户确认后访问。

## 9. 生成产物的在线预览

生成产物通常位于 `outputs/**`。建议根据扩展名或 MIME 类型选择预览器：

- 图片：`img`；
- 音频、视频：`audio`、`video`；
- PDF：浏览器 PDF Viewer 或 PDF.js；
- Markdown：Markdown 渲染器 + HTML 净化；
- 文本、代码、JSON：只读代码编辑器；
- Office 文件：提供下载，或在可信服务端转换为 PDF；
- HTML/SVG：只能在隔离环境中预览。

HTML 产物必须放入带 `sandbox` 的 `iframe`，不能用 `innerHTML` 注入主页面：

```tsx
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  src={artifactObjectUrl}
/>
```

如果产物不需要执行 JavaScript，应去掉 `allow-scripts`。不要添加 `allow-same-origin`，否则不可信 HTML 可能突破隔离边界。对于包含外链资源的 HTML，建议额外使用 CSP，并默认阻止网络请求。

如果 HTML、CSS 或 Markdown 使用了相对资源路径，单独创建 HTML Blob URL 后无法自动找到同目录图片和样式。推荐采用以下任一方案：

1. 服务端查看器：把 `manifest.files` 映射为 `/session-viewer/<bundleID>/<logicalPath>` 只读路由，让 HTML 保留目录关系；
2. 纯浏览器查看器：解析 HTML 的 `src`、`href`、`srcset`，以及 CSS 的 `url(...)`，将相对路径改写为对应文件的 Object URL；
3. 对复杂站点产物，将所有资源放入受限的独立源中提供，并使用严格 CSP。

资源解析必须以当前产物的逻辑目录为基准，规范化后再次执行路径穿越校验。不要简单拼接字符串，也不要允许资源路径跳出当前 ZIP 的逻辑文件集合。

部分设计产物也可能以内嵌 `<artifact ...>...</artifact>` 的形式存在于助手的 `text` 部件中。网页可以将其解析为单独的产物卡片，但应做到：

- 对标签属性做白名单校验；
- 将正文作为不可信内容处理；
- HTML 仍放入沙箱 iframe；
- 原始 `<artifact>` 文本不直接插入 DOM；
- 解析失败时回退为普通代码块或纯文本。

## 10. React 渲染骨架

```tsx
function Conversation({ session }: { session: SessionEntry }) {
  return (
    <main className="conversation">
      {orderedMessages(session).map((message) => (
        <article key={message.info.id} data-role={message.info.role}>
          <header>
            <strong>{message.info.role === "user" ? "用户" : message.info.agent}</strong>
            <time>{new Date(message.info.time.created).toLocaleString()}</time>
          </header>

          <section className="parts">
            {message.parts.map((part) => (
              <MessagePartView key={part.id} part={part} />
            ))}
          </section>
        </article>
      ))}
    </main>
  )
}

function MessagePartView({ part }: { part: MessagePart }) {
  if (part.type === "text" && !part.ignored) return <SafeMarkdown source={part.text} />
  if (part.type === "reasoning") return <ReasoningDetails text={part.text} />
  if (part.type === "file") return <AttachmentCard part={part} />
  if (part.type === "tool") return <ToolCallDetails part={part} />
  if (part.type === "subtask") return <SubtaskCard part={part} />
  if (part.type === "retry") return <ErrorNotice error={part.error} />
  if (part.type === "compaction") return <SystemNotice>会话已压缩</SystemNotice>
  return null
}
```

这是结构示例，不应直接复制为生产安全实现。`SafeMarkdown`、工具输出、文件预览和错误内容都必须经过转义或净化。

## 11. Todo 和元数据展示

每个 Session 都可能包含 Todo：

```ts
type Todo = {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled" | string
  priority: "high" | "medium" | "low" | string
}
```

Todo 适合放在会话详情侧栏。模型、Token、成本、完成原因等信息可放入“详情”面板，不建议占用主对话区域。

时间字段均为 Unix 毫秒时间戳，可通过 `new Date(timestamp)` 转换。

## 12. 安全要求

Session ZIP 来自用户文件，应始终按不可信输入处理。

必须具备：

- 校验 `format` 和 `version`；
- 限制 ZIP 总大小、文件数量、单文件解压大小和总解压大小；
- 防止 ZIP Bomb；
- 拒绝绝对路径、盘符路径、`..`、NUL 字符和路径穿越；
- 校验每个 Blob 的 `size` 和 `sha256`；
- Markdown 渲染后使用 DOMPurify 等工具净化；
- 工具输出、错误和代码默认转义；
- HTML/SVG 产物使用隔离 iframe 或服务端安全转换；
- 禁止浏览器直接访问包内记录的 `file://` 地址；
- 远程 URL 默认不加载，避免泄露查看者 IP、Cookie 或访问时间；
- 不将 `sourceDirectory` 显示给无权限用户。

建议限制值：

```ts
const limits = {
  zipBytes: 500 * 1024 * 1024,
  entries: 20_000,
  oneFileBytes: 200 * 1024 * 1024,
  extractedBytes: 1024 * 1024 * 1024,
}
```

具体上限应根据部署环境调整。服务端在线分享场景还需要病毒扫描、内容审核、访问鉴权、过期时间和下载审计。

## 13. 推荐转换流水线

```text
用户选择 ZIP
  → 校验 ZIP 大小和文件数量
  → 读取并校验 manifest.json
  → 校验 Session 树和消息引用
  → 按需解压 blobs/*
  → 校验 size 与 sha256
  → 构建 Session 树
  → 构建消息时间线
  → 建立逻辑文件索引和 Object URL
  → 安全渲染 Markdown、工具记录、附件和产物
  → 页面退出时释放 Object URL
```

## 14. 最小验收清单

- 能打开包含一个主 Session 的 ZIP；
- 能切换并展示子 Session；
- 用户消息和助手消息顺序正确；
- 文本、推理、工具调用和错误状态可区分；
- 上传附件可预览或下载；
- `outputs` 中的生成产物可预览或下载；
- 相同 Blob 被多个文件引用时不会重复解压；
- ZIP 被篡改后 SHA-256 校验失败；
- HTML 产物无法读取主页面 Cookie、DOM 和本地存储；
- 旧的 `.octosession` 文件改名或直接选择后仍可按同样方式读取，因为其内部格式也是 ZIP。

## 15. 版本兼容策略

查看器应按 `manifest.version` 分派解析器，不要默认为所有未来版本都兼容：

```ts
switch (manifest.version) {
  case 1:
    return loadV1(manifest, zip)
  default:
    throw new Error(`暂不支持 Session ZIP v${manifest.version}`)
}
```

以后新增字段时应保持向后兼容；字段语义或目录布局发生不兼容变化时，应提升 `version`。浏览器查看器只读取内容，不应修改 ZIP 中的原始 ID、消息或 Blob。
