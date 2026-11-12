# 历史版本（History）开发指南

历史版本是 Make 页面的文件级 undo 能力：ActionBar 的「历史」按钮弹出版本列表，点击即切回该版本。
本文档自包含，读完即可为你的框架/产物类型接入完整的历史能力（或定制记录/恢复行为）。

---

## 1. 历史版本是什么

一句话：**把产物文件的关键状态存到磁盘 `.history/` 目录，用户随时可查看并切回**。

```
┌──────────────────────────────────────────────────────────┐
│  Make 页面                                                │
│  ┌───────────────────────────────┐                       │
│  │  ActionBar        [历史] ────────┐ 点击弹出              │
│  └───────────────────────┬───────┼──────────────────┐   │
│                          │       │  历史面板(popover) │   │
│  iframe (预览产物)        │       │  ● 08/14 15:30    │   │
│                          │       │  ○ 08/14 15:25    │   │
│   任意来源改动文件 ────────────────→ 版本自动追加        │   │
│                          │       │  ○ 08/14 14:00    │   │
│   点击某行 ───────────────────────→ 文件切回该版本       │   │
│                          │       └──────────────────┘   │
└──────────────────────────────────────────────────────────┘

磁盘：
  outputs/login.html                ← 源文件（当前状态）
  outputs/.history/
    ├── login.20260814-140000.init/self.html   ← 原始版本
    ├── login.20260814-153000.user/self.html   ← 用户编辑
    └── login.20260814-160000.agent/self.html  ← 模型编辑
```

记录哪些文件、什么时机记录、切换版本怎么恢复 —— 全部由 subtype handler 的两个钩子决定。

---

## 2. 快速开始

跟着下面 5 步，为一个新 subtype 接入历史功能。

### 第 1 步：了解文件命名约定

subtype 从文件名提取：`xxx.<subtype>.html` → `"mytype"`。

```
音乐网站.mytype.html   →  subtype = "mytype"
index.shadcn.html      →  subtype = "shadcn"
index.html             →  subtype = undefined（走 _default）
```

### 第 2 步：开启 feature

在 `packages/app/octoapp/pages/make/utils/subtype-config.ts` 添加分支：

```ts
mytype: {
  features: {
    // ...其他 feature 照抄 _default
    history: { enabled: true, editOnly: true },  // ← ActionBar 显示「历史」按钮（仅预览模式）
  },
  history: {
    files: ['.'],            // 每次版本记录哪些文件（相对路径，'.' = 产物文件自身）
    maxVersions: 50,         // 可选：保留上限（默认 50，init 豁免）
    agentTurnRecord: 'turn', // 可选：'each'（默认）每次写盘记一条；'turn' 一轮对话只记最终态
  },
},
```

> `history.files` 是文档性配置；实际文件集由 handler 的 `onHistoryTrigger` 钩子决定。

### 第 3 步：创建 subtype handler

新建 `packages/app/octoapp/pages/make/subtype-handlers/mytype.ts`：

```ts
import type { SubtypeHandler, SubtypeHandlerContext } from './types'
import defaultHandler from './default'
import { relativePathToId, resolveRelativePath, getExt } from '../utils/history-store'

const MY_HISTORY_FILES = ['.']  // 只记录产物文件自身

const mytypeHandler: SubtypeHandler = {
  ...defaultHandler,
  name: 'mytype',

  // 钩子 1：决定每次记录哪些文件
  onHistoryTrigger(_event, _ctx) {
    return MY_HISTORY_FILES
  },

  // 钩子 2：版本恢复——把版本文件复制回原始路径，重读产物文件到 tab
  async applyVersionFiles(ctx, files) {
    const { tab, getDesktopApi, updateTabContent } = ctx
    const api = getDesktopApi()
    if (!api?.copyFileTo || !api?.readFileBuffer || !tab.filePath) return

    for (const rel of MY_HISTORY_FILES) {
      const id = relativePathToId(rel)
      const ext = getExt(resolveRelativePath(rel, tab.filePath))
      const vf = files.find((f) => f.fileName === id + ext)
      if (!vf) continue
      try {
        await api.copyFileTo(vf.filePath, resolveRelativePath(rel, tab.filePath))
      } catch {}
    }

    const buf = await api.readFileBuffer(tab.filePath)
    if (buf && updateTabContent) {
      updateTabContent(tab.id, new TextDecoder().decode(buf))
    }
  },
}

export default mytypeHandler satisfies SubtypeHandler
```

### 第 4 步：注册 handler

在 `packages/app/octoapp/pages/make/utils/subtype-registry.ts`：

```ts
import mytypeHandler from "../subtype-handlers/mytype"

registerSubtypeHandler(mytypeHandler)
```

### 第 5 步：验证

1. 让 agent 生成 `test.mytype.html`（或从 Design Files 打开一个）
2. ActionBar 出现「历史」按钮 → 点击 → 面板列出 1 条「原始版本」（实心蓝点）
3. 让 agent 再编辑一轮 → 面板出现「模型编辑」
4. 手动做一次局部修改 → 出现「用户编辑」
5. 点击旧行 → 文件切回该版本；再点新行 → 切回

---

## 3. 核心概念

### 3.1 版本模型

历史 = append-only 的版本列表，每个版本带 **actor** 标记：

| actor | 显示 | 产生时机 |
|-------|------|---------|
| `init` | 原始版本 | 打开时该文件无任何历史 → 建一条（不要求 tab 首次打开） |
| `user` | 用户编辑 | 局部修改 / iframe 内编辑 / inspect 面板 / undo-redo（所有 `onContentChange` 路径） |
| `agent` | 模型编辑 | agent 重输出 artifact，或 write/edit 工具改盘（`file.edited` / `session.idle` 等事件） |

规则：
- **切换版本只移动当前指针**，不产生新版本
- **50 个上限**（`maxVersions` 可配），滑动窗口清理最旧；**init 豁免**，永久保留
- **有 user/agent 版本但缺 init 时不补建**——补建的 init 内容是编辑过的，是错的
- 版本时间戳 = 源文件 mtime（内容真实写入时刻），编码在版本文件夹名里

### 3.2 磁盘存储格式

```
outputs/login.html                       ← 源文件
outputs/.history/                        ← 历史目录（源文件同目录）
  ├── login.20260814-140000.init/        ← 版本文件夹 {baseName}.{YYYYMMDD-HHMMSS}.{actor}
  │    └── self.html                     ← 版本文件
  ├── login.20260814-153000.user/
  │    ├── self.html
  │    └── style.css                     ← 多文件 subtype 会有多个
  └── login.20260814-160000.agent/
       └── self.html
```

**文件 ID 生成**（相对路径 → 版本文件夹内文件名，保留原扩展名）：

| 相对路径 | 文件 ID | 版本内文件名 |
|---------|---------|-------------|
| `'.'` | `self` | `self.html` |
| `'./style.css'` | `style` | `style.css` |
| `'./src/App.vue'` | `src_App.vue` | `src_App.vue`（路径分隔符转 `_`） |

> `list-directory` IPC 是**递归遍历**且返回**相对路径**——版本文件夹的枚举从文件路径第一段反推，且按 baseName 前缀过滤，同目录多个文件的历史互不干扰。

### 3.3 记录触发点（三条路径）

| 路径 | 触发 | actor | 说明 |
|------|------|-------|------|
| A. tab 打开 / agent 重输出 artifact | `handleOpenResult` → `onTabOpen` | `init` / `agent` | 无历史建 init；内容变了记 agent-update |
| B. 用户编辑 | `onContentChange` → `onUserEdit` | `user` | 先同步内存再写盘再记录；内容未变守卫防重复 |
| C. agent 工具改盘 | `file.edited` / `watcher` / `step.ended` / `session.idle` → `onFileRefresh` | `agent` | 对比文件集合并 hash 基线；首次只建基线 |

所有路径最终都走 controller 的 `trigger` → handler 的 `onHistoryTrigger` 拿文件集 → `recordVersion` 复制文件到 `.history/`。

内置防护（无需关心，但改代码时别破坏）：
- **同内容同 actor 去重**：一次模型编辑并发触发多路事件只记一条
- **`writingTabs`**：用户编辑/切版本写盘期间跳过路径 C，防误判
- **`onFileRefresh` 串行化 + settle**：事件突发合并；turnEnd 丢失时 1.5s 静默期兜底记录
- **复制写后校验**：源/目标字节数一致才算成功，失败多级退避，全失败返回 null（不留错误版本）

### 3.4 切换版本

用户点击某行 → `switchVersion` → handler 的 `applyVersionFiles(ctx, files)` 恢复 → 刷新 iframe + 推进 hash 基线。**不追加新版本**。

---

## 4. 进阶：多文件记录

数据驱动型产物（HTML + 数据文件 + 源码）应该把整个文件集存进版本。

### 4.1 静态文件集

```ts
const MY_FILES = [
  '.',
  './data.json',
  './src/main.js',
]
onHistoryTrigger(_event, _ctx) {
  return MY_FILES
}
```

### 4.2 静态 + 动态发现（gts 模式）

产物特定文件数量不定（views/api/mock/locales/icons）时，用 `listDirectory` 递归发现 + 正则匹配：

```ts
const DYNAMIC_PATTERNS = [
  /^src\/api\/[^/]+\.js$/,
  /^mock\/modules\/[^/]+\.js$/,
]

async function discoverDynamicFiles(ctx: SubtypeHandlerContext): Promise<string[]> {
  const api = getDesktopApi()
  if (!api?.listDirectory || !ctx.tab.filePath) return []
  const dir = ctx.tab.filePath.replace(/[\\/][^\\/]+$/, '')
  const entries = await api.listDirectory(dir)   // 递归，返回相对路径
  return entries
    .filter((e) => e.type === 'file')
    .map((e) => e.path.replace(/\\/g, '/'))
    .filter((p) => DYNAMIC_PATTERNS.some((re) => re.test(p)))
    .map((p) => './' + p)
}

onHistoryTrigger: async (_event, ctx) => [
  ...STATIC_FILES,
  ...(await discoverDynamicFiles(ctx)),
],
```

文件集同时决定 **agent 改盘检测的 hash 监控范围**（`onFileRefresh` 对文件集做合并 hash）——数据文件变化即使 HTML 未变也会产生版本。

### 4.3 跳过某些事件

```ts
onHistoryTrigger(event, ctx) {
  if (event.type === 'agent-update') return null  // 重输出场景磁盘可能滞后，跳过
  return MY_FILES
}
```

> 返回 `null` 表示本次不记录。对 `agent-update` 返回 null 时，重输出场景的记录交给路径 C 的 hash 检测兜底。

---

## 5. 进阶：非标准场景

### 5.1 写了文件但不想要历史版本

prototype 的状态同步落盘（防抖 persist 写 data.js，非用户编辑意图）用 `syncFileHash`：写盘后把 hash 基线推进到写后值，随后的 `file.edited` 就不会误记为 agent 编辑。

### 5.2 tab 关闭期间的 agent 编辑

`onFileRefresh` 只遍历打开的 tab——tab 关闭后 agent 的改动不会实时产生版本。`trigger` 的 open 分支在重开时对比当前文件集 hash 与最新版本 hash，不一致自动补记一条 `agent` 版本（时间戳 = 源文件 mtime）。无需 subtype 做任何事。

### 5.3 'turn' 模式：一轮对话只记一条

`agentTurnRecord: 'turn'` 时，agent 轮内（`file.edited` 等）只同步内容 + 刷新预览不记录；轮结束信号（`session.idle` / `step.ended`）统一记一条最终态。若 agent 两次工具调用间隔超过 1.5s（settle 静默期），会各记一条——可接受。

### 5.4 Agent 重输出 artifact（相同 identifier）

走 `handleOpenResult` → `onTabOpen` 的 agent-update。若产物磁盘内容与消息内容有时序差（tab 先变、盘后变），推荐像 gts 一样对 `agent-update` 返回 `null`，交给路径 C 的 hash 检测兜底——避免复制到旧文件。

---

## 6. 类型速查

### HistoryTriggerEvent

```ts
| { type: 'open'; isNew: boolean }  // tab 打开（isNew = tabStore 中此前不存在）
| { type: 'edit' }                   // 用户编辑（含 undo/redo）
| { type: 'agent-update' }           // agent 重输出 artifact
| { type: 'agent-file-edit' }        // agent 工具直接改盘（hash 检测）
```

### VersionEntry（版本列表条目）

| 字段 | 说明 |
|------|------|
| `id` | 版本文件夹名 `{baseName}.{YYYYMMDD-HHMMSS}.{actor}` |
| `folderPath` | 版本文件夹完整路径 |
| `timestamp` | 源文件 mtime（内容真实写入时刻），ms |
| `actor` | `init` / `user` / `agent` |

### VersionFile（版本内文件，`getVersionFiles` 返回）

| 字段 | 说明 |
|------|------|
| `id` / `fileName` | 文件 ID / 版本文件夹内文件名 |
| `filePath` | 版本文件夹内的完整路径 |
| `originalPath` | 原始绝对路径（恢复目标） |
| `relativePath` | config 中的相对路径 |

### SubtypeHandler 新增钩子

| 钩子 | 签名 | 用途 |
|------|------|------|
| `onHistoryTrigger` | `(event, ctx) => string[] \| null` | 文件集（相对路径，`'.'` = 产物文件）；`null` = 本次不记录。同时决定 agent 改盘检测的 hash 监控范围 |
| `applyVersionFiles` | `(ctx, files: VersionFile[]) => Promise<void>` | 恢复逻辑：复制回原路径 + 重读到 tab |

### SubtypeHandlerContext 新增字段

| 字段 | 说明 |
|------|------|
| `updateTabContent(id, content)` | 恢复版本后更新 tab 内存内容（渲染用） |

---

## 7. 参考实现

| 文件 | 场景 | 要点 |
|------|------|------|
| `subtype-handlers/default.ts` | 单文件（HTML 自身） | 最简实现：`['.']` + 通用恢复 |
| `subtype-handlers/gts.ts` | 多文件 + 动态发现 | 静态文件集 + `listDirectory` 正则发现；`agent-update` 返回 null 交给 hash 兜底 |
| `subtype-handlers/prototype.tsx` | 数据驱动产物 | 多文件 + `syncFileHash` 屏蔽状态同步落盘 |
| `subtype-handlers/history-controller.ts` | 通用调度层 | 触发/去重/竞态/hash 基线/串行化——subtype 开发者**不需要改这里** |
| `utils/history-store.ts` | 磁盘读写 | `recordVersion` / `listVersions` / `getVersionFiles` / `prune` |

---

## 8. 注意事项

1. **桌面 API 依赖**：`copyFileTo` / `readFileBuffer` / `listDirectory` / `deleteFile` / `statFile` 只在 Electron 桌面端可用；纯 web 环境所有历史操作静默失败
2. **开关状态在 ActionBar 内部**：`historyOpen` 是局部 signal，随组件卸载自动销毁——切 tab/会话不残留节点。**不要**把开关状态提升到页面级（会出现重复面板节点）
3. **新产物打开入口必须接 `onTabOpen`**：init/agent-update 都从 `handleOpenResult` 系列路径触发。新增打开方式（如某种预览卡片）时漏接 `onTabOpen` 会导致该入口打开的页面永远没有 init
4. **桌面端主进程改动需重启**：`statFile` 返回 `mtimeMs` 等依赖主进程 IPC，改了 `packages/desktop` 后要重启 Electron
