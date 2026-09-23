# AddonMenu 附件面板组件使用文档

跨页面可复用的"添加附件"面板:触发按钮 + 弹出菜单,内置技能库、产品资产库、设计文件、接收设计资产链接URL、添加附件五类能力,支持通过 `items` 配置显示哪些项及顺序,通过 `slots` 插入页面专属菜单项。所有与页面数据的交互均通过 props 回调完成,组件不感知页面内部实现。

## 快速上手

```tsx
import { AddonMenu } from "@/pages/make/components/addon-menu"

<AddonMenu
  selections={selections()}                      // 页面编辑器中已有的 chip(由编辑器同步)
  onSelect={handleSelect}                        // 用户选中某项 → 页面插入 chip
  onDeselect={handleDeselect}                    // 用户取消某项 → 页面移除 chip
  skillConfig={skillConfig()}                    // 技能库数据
  onSkillsOpen={loadSkillConfig}                 // 打开面板时加载技能配置
  artifactFiles={artifactFiles()}                // 设计文件数据(当前会话)
  productId={productId()}                        // 产品资产库:当前产品 id
  onDownloadProductAsset={downloadProductAsset}  // 产品资产下载(返回本地路径)
  onUpdateMentionPath={updateMentionPath}        // 下载完成后补 chip 路径
  onAddAttachment={() => fileInput.click()}      // 添加附件(原生文件选择)
  maxAttachments={maxAttachments()}              // 附件数达上限时置灰"添加附件"
  trackerModule="design"                         // 埋点 module(默认 "design")
/>
```

## 配置显示哪些项(items)

`items` 为字符串数组,控制**显示哪些项及顺序**。数组元素可以是内置项 key,也可以是插槽 key(见下文),按数组顺序渲染;缺省为全部内置项按默认顺序。

```tsx
// 只显示 4 项,urlImport 不显示
<AddonMenu items={["skills", "productAssets", "designFiles", "addAttachment"]} ... />
```

内置项 key 与各自需要的 props:

| key | 菜单项 | 需要的 props |
|-----|--------|--------------|
| `skills` | 技能库(二级:平台/自定义 → 三级:技能列表) | `skillConfig`、`onSkillsOpen` |
| `productAssets` | 产品资产库(居中弹窗:文件夹树 + 文件网格) | `productId`、`onDownloadProductAsset`、`onUpdateMentionPath` |
| `designFiles` | 设计文件(当前会话生成/上传文件列表) | `artifactFiles` |
| `urlImport` | 接收设计资产链接URL(输入 URL → 下载为附件) | `onAddAttachmentFromUrl` |
| `addAttachment` | 添加附件(原生文件选择器) | `onAddAttachment`、`maxAttachments` |

未配置某项时,该项不渲染,其子面板/弹窗/相关逻辑均不激活;对应 props 缺失时操作静默跳过。

## 插槽(slots):插入页面专属菜单项

`slots` 用于加入通用组件不感知的页面专属菜单项。每个插槽有唯一 `key`,把该 key 放进 `items` 数组的任意位置即可控制其显示位置;不在 `items` 中的插槽不渲染。

```tsx
<AddonMenu
  items={["skills", "designStrategy", "addAttachment"]}
  slots={[
    {
      key: "designStrategy",
      render: ({ closeMenu }) => (
        <button
          type="button"
          class="addon-menu-item"
          onClick={() => { closeMenu(); doSomething() }}
        >
          <span class="addon-menu-item-icon"><MyIcon /></span>
          <span class="addon-menu-item-text">我的自定义项</span>
        </button>
      ),
    },
  ]}
  ...
/>
```

- `render(ctx)` 的 `ctx.closeMenu()` 关闭整个面板(菜单项点击后通常需要调用)
- 插槽按钮使用 `addon-menu-item` / `addon-menu-item-icon` / `addon-menu-item-text` 样式类即可与内置项外观一致(样式由组件 styles.css 提供)

## Props 参考

| Prop | 类型 | 必填 | 说明 |
|------|------|------|------|
| `selections` | `MenuSelection[]` | 是 | 页面编辑器 doc 中已有的 chip 列表(由编辑器同步),驱动所有项的选中态联动 |
| `onSelect` | `(selection) => void` | 是 | 选中某项(页面负责插入 chip) |
| `onDeselect` | `(selection) => void` | 是 | 取消某项(页面负责移除 chip) |
| `items` | `string[]` | — | 菜单项编排;缺省全部内置项按默认顺序 |
| `slots` | `AddonMenuSlot[]` | — | 页面专属菜单项 |
| `disabled` | `boolean` | — | 预留整体禁用 |
| `trackerModule` | `string` | — | 埋点 module,默认 `"design"` |

### skills 项

| Prop | 类型 | 说明 |
|------|------|------|
| `skillConfig` | `AddonSkillConfig` | `{ skill?: Record<string, {name?}>, panel?: { common?, octo_make? } }`;panel.octo_make 除去与 common 重名的为平台技能 |
| `onSkillsOpen` | `() => void` | 打开面板时调用(页面懒加载技能配置) |

技能项选中态与 `selections` 联动(按 `name` 匹配),可连续选多个,菜单不关闭。

### productAssets 项

| Prop | 类型 | 说明 |
|------|------|------|
| `productId` | `number` | 当前产品 id(登录态拉取文件夹树用) |
| `onDownloadProductAsset` | `(file, onProgress, signal) => Promise<string>` | 下载单个资产到本地,**返回本地保存路径**(zip 返回解压后文件夹路径) |
| `onUpdateMentionPath` | `(id, path) => void` | 下载完成后把本地路径补进对应 chip(按 chip id 匹配) |

行为要点:
- 点击文件项只切换选中(插入/移除 chip,**不下载**);面板底部"已选 n 项"弹窗可查看/移除/清空本次选中
- 确认后关闭弹窗并按顺序批量下载(弹"资源下载中"进度弹窗),完成后把本地路径补进 chip
- 下载中可点关闭中止:未完成下载的 chip 会被移除
- chip 与文件项联动:同一文件在 doc 中的 chip 使该文件项在下次打开时保持选中(按资产唯一 id 匹配,与文件名无关)
- 登录态判断:`localStorage.uiplusToken`;非登录态使用组件内置 mock 数据

### designFiles 项

| Prop | 类型 | 说明 |
|------|------|------|
| `artifactFiles` | `{ generated, uploaded } \| null` | 当前会话的生成/上传文件列表 |

- 选中态为**面板内临时状态**:每次打开面板全部重置为未选中(与 skills/productAssets 的全局联动不同)
- hover 文件项显示预览弹窗:图片/HTML 渲染真实内容,其它格式显示"暂不支持预览"占位

### urlImport 项

| Prop | 类型 | 说明 |
|------|------|------|
| `onAddAttachmentFromUrl` | `(url, onProgress, signal) => Promise<void>` | 页面下载该 URL 并加入附件;抛错时弹窗回显错误 |

输入有效 URL 确认后弹进度弹窗(可中止),完成或中止由页面回调控制。

### addAttachment 项

| Prop | 类型 | 说明 |
|------|------|------|
| `onAddAttachment` | `() => void` | 打开页面自己的文件选择流程 |
| `maxAttachments` | `boolean` | true 时该项置灰不可点 |

## 类型导出与完整定义

```ts
import {
  type AddonMenuItemKey,   // 内置项 key 联合
  type AddonMenuSlot,      // 插槽定义
  type MenuSelection,      // chip 选择类型(与编辑器 MentionSelection 兼容)
  type AddonSkillConfig,   // skills 项配置
  type AddonMenuProps,     // 组件 Props
} from "@/pages/make/components/addon-menu"
```

### MenuSelection — chip 选择

传入 `selections`、回调参数均使用此类型。三个成员对应三类 chip:

```ts
type MenuSelection =
  | {
      type: "skill"
      name: string          // 技能标识(slash 命令名)
      label: string         // 显示名
    }
  | {
      type: "file"
      filename: string      // 文件名(chip 显示文本)
      path: string          // 文件路径;产品资产下载前为占位 id,下载后补本地路径
      id?: string           // 资产唯一 id("asset-<id>"),仅产品资产项携带
      isFolder?: boolean    // 是否文件夹(zip 解压产物),仅产品资产项携带
    }
  | {
      type: "product-asset"
      filename: string
      path: string
      s3BaseUrl: string
      convertHtmlUrl: string
      snapshot: string
    }
```

### AddonSkillConfig — skills 项配置

```ts
type AddonSkillConfig = {
  skill?: Record<
    string,
    { name?: string; skillName?: string; description?: string; import?: boolean; type?: string }
  >
  panel?: {
    common?: PanelSkill[]      // 自定义技能
    octo_make?: PanelSkill[]   // 平台技能(与 common 重名的项会被过滤)
  }
}

type PanelSkill = {
  label: string
  description?: string
  path?: string
  enable?: boolean
  id?: number
}
```

### AddonMenuSlot — 插槽定义

```ts
type AddonMenuSlot = {
  key: string                                                    // 唯一标识,用于在 items 中定位
  render: (ctx: { closeMenu: () => void }) => JSX.Element        // 渲染菜单项
}
```

### AddonMenuItemKey — 内置项 key

```ts
type AddonMenuItemKey =
  | "skills"
  | "productAssets"
  | "designFiles"
  | "urlImport"
  | "addAttachment"
```

### artifactFiles — 设计文件数据

```ts
type ArtifactFile = {
  name: string
  path: string
  relativePath: string
  sessionId: string
  kind: "folder" | "html" | "svg" | "image" | "video" | "audio" | "markdown" | "text" | "code" | "pdf" | "document" | "binary"
  isFolder: boolean
  size: number
  mtime: number
  mime: string
}

type ArtifactFiles = { generated: ArtifactFile[]; uploaded: ArtifactFile[] } | null | undefined
```

## 行为与样式说明

- 组件内部使用 `useUploadRiskGate` 做"添加附件/设计文件"的风险拦截,接入方无需配置
- 面板定位:弹出框左边缘对齐触发按钮左边缘、下边缘对齐触发按钮上边缘
- 滚动条/复选框/菜单项样式由组件 styles.css 提供,插槽内容复用 `addon-menu-item` 系列类即可保持外观一致
- 产品资产库的登录态/数据接口/下载细节见 `od-docs/make-addonmenu.md`
