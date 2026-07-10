# 选中项目信息 Hook 接入指南

获取「当前选中项目信息」的公共方法封装在 `packages/app/octoapp/hooks/use-project-selection.ts`，参考 `components/project-info.tsx` 的获取模式：onboarding 弹窗或本地选择弹窗显示时冻结快照、全部关闭后回退到 `server.projects.lastSelection()`，避免用户在弹窗里编辑选择时外层显示抖动。返回的快照包含完整的保存信息（`domain` / `productLine` / `product` / `version`）。

## 快速接入

```ts
import { useProjectSelection } from "@/hooks/use-project-selection"
```

## API

### `useProjectSelection` — 获取选中项目信息

返回一个 `Accessor<ProjectSelection | undefined>`，在组件内响应式读取即可拿到完整的领域 / 产品线 / 产品 / 版本信息：

```ts
import { useProjectSelection } from "@/hooks/use-project-selection"

const selection = useProjectSelection()

const productName = () => selection()?.product?.name ?? ""
const versionLabel = () => selection()?.version?.name ?? ""
const versionId = () => selection()?.version?.id
```

### `keepFrozen` — 本地弹窗打开期间保持冻结

默认冻结行为只跟随全局 `layout.onboarding.show()`。若组件自身也会弹出一个选择弹窗（例如 `project-info.tsx` 点击卡片打开 `DialogProjectOnboarding`），传入该弹窗的可见状态，使其打开期间自动冻结、关闭后（且全局 onboarding 也已关闭）回退到最新选择：

```ts
import { createSignal } from "solid-js"
import { useProjectSelection } from "@/hooks/use-project-selection"

const [visible, setVisible] = createSignal(false)
const selection = useProjectSelection({ keepFrozen: visible })

// 点击打开本地弹窗时自动冻结快照
setVisible(true)
// 弹窗 onSelect 关闭后，若全局 onboarding 也已关闭，则自动解冻回退到最新选择
setVisible(false)
```

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `options.keepFrozen` | `Accessor<boolean>` | — | `() => false` | 本地弹窗可见状态；为 `true` 期间冻结快照，与全局 onboarding 取并集 |

## 冻结规则

`useProjectSelection` 内部 `createEffect` 行为（`keepFrozen` 与 `layout.onboarding.show()` 取或）：

| `layout.onboarding.show()` | `keepFrozen()` | 结果 |
|------|------|------|
| `true` | 任意 | 首次进入冻结态，快照取自 `lastSelection()` |
| `false` | `true` | 保持冻结（本地弹窗仍打开） |
| `false` | `false` | 解冻，回退到 `server.projects.lastSelection()` |

返回值：`frozen() ?? server.projects.lastSelection()`。

## 类型定义

### `ProjectSelection`

定义在 `packages/app/octoapp/hooks/use-project-selection.ts`，与 `server.projects.lastSelection()` / `saveSelection()` 的入参形状一致：

```ts
type ProjectSelection = {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
}
```

### `Version`

定义在 `packages/app/octoapp/network/types.ts`：

```ts
type Version = {
  id: number
  name: string
  productId: number
  productName: string
  deliveryTypeId: number
  industryId: number | null
  isEnd: boolean
  isTop: boolean
  modelId: number
  permissionFlag: boolean
  baseTeam: number
  sort: number
  spaceId: number
  userTeamType: number | null
  workflowRoleList: number[]
}
```

### `Options`

```ts
interface Options {
  keepFrozen?: Accessor<boolean>
}
```

## 参考实现

`components/project-info.tsx` 即采用本 Hook 输出全部字段（产品名 / 领域·产品线 / 版本标签），不再保留任何本地冻结逻辑：

```ts
const [visible, setVisible] = createSignal(false)
const selection = useProjectSelection({ keepFrozen: visible })

const productName = () => selection()?.product?.name ?? ""
const domainProductLine = () => { /* 拼 domain / productLine 名称 */ }
const versionLabel = () => selection()?.version?.name ?? ""
```

## 验证

### 外网 dev

`bun run dev` 启动后，打开项目 onboarding 弹窗选择产品版本并确认，关闭弹窗后外层 `ProjectInfo` 的「当前版本」标签应正确显示最新选中版本；弹窗打开期间标签保持冻结不抖动。

### 内网 beta

配置 `VITE_OCTO_BASE_URL` 后 `bun run dev:beta` 走真实接口，`lastSelection` 持久化在 `server` store 中，切换 server / 项目目录时整个选中信息随之切换。
