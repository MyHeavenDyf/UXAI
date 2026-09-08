# 图标选择弹窗（IconPickerPopup）使用说明

## 一、概述

图标选择弹窗用于在属性面板（PropertyEditorPopup）中为图标类组件挑选图标，并提供 **形状 / 尺寸 / 颜色** 的实时预览与参数回传。数据源分两种模式：

- **online**：联通 icon-plus 资产服务（`https://octo.hdesign.huawei.com`），图标来自后端
- **offline**：`getConfig` 探测失败时自动回退本地 lucide 图标集（202 个）

## 二、如何打开

属性面板中，图标类组件的图标属性渲染为**下拉框样式的触发器**（图标 16px 预览 + 名称 + 下拉箭头，独占一行、高 36px），点击即打开弹窗。

图标属性由 `constants.ts` 的 `ICON_PICKER_PROP_KEYS` 决定（格式 `组件类型.属性名`）：

```
Icon.name / Button.icon / Tag.icon / TimelineItem.icon / Collapse.expandIcon / Input.prefix / Input.suffix
```

> 注意：图标类组件（上表命中）在属性面板中 **不展示** shape / color 行与「宽高」组——这些由图标弹窗统一接管。

## 三、弹窗结构（自上而下）

| 区域 | 说明 |
| --- | --- |
| 标题栏 | 「图标」+ 关闭按钮 |
| 筛选 + 搜索 | 分类树选择器（109px）+ 搜索框（231px，placeholder「请搜索...」），高 36、全圆角 |
| 一级 tab | **官方 / 自定义**，间距 32，选中 #0A59F7 + 下划线（距文字底部 4px），未选中 #777777，行高 20 |
| 二级 tab（仅官方） | 后端 tags 生成的来源 tab（基础图标/质感图标/2.5D/天气等，无「自定义」）；选中蓝字 + 10% 底色胶囊；超宽时两侧渐变箭头点击滚动（无滚动条） |
| 主内容区 | 图标网格：容器 60px 高、圆角 12、#F2F3F5 底，一行五个；hover 出现深色气泡（图标名称 + 类名）；点击选中（蓝色描边） |
| 底部筛选组 | 形状（线性/线性双色/方拖底/圆拖底，值为旧枚举 outline/two-tone/square/circle）、尺寸（12~40px）、颜色（14 项语义色板：18px 圆点 + 名称） |
| 按钮组 | 取消（关窗）/ 确认（回传并关窗），高 28、圆角 28、间距 8 |
| 自定义 tab 内容 | 「自定义图标」标题 + 上传按钮（hover 气泡提示支持格式）；已上传列表（一行五个，hover 右上角删除按钮）；空态展示 noDataEmpty.svg 占位图 |

**预览联动**：形状 / 颜色 / 尺寸筛选 **只作用于当前选中的图标**，未选中图标保持默认样式（24px 线性 #191919）。

## 四、组件 API

```ts
<IconPickerPopup
  current={string}        // 当前图标名（展示用）
  currentId={string}      // 当前图标唯一 id（回显匹配用）
  anchor={HTMLElement}    // 触发元素，弹窗锚定在其左侧
  initialSize={string}    // 带入尺寸，如 "24"
  initialStyle={string}   // 带入形状（旧枚举值 outline/two-tone/square/circle）
  initialColor={string}   // 带入颜色（hex 或语义 token）
  onPick={(pick) => ...}  // 点确认时回调，pick 为单一对象：
                          // { name, id?, size, style, color }
  onClose={() => ...}     // 关闭回调
  onConfirm={() => ...}   // 确认事件预留（onPick 之后、onClose 之前触发）
/>
```

## 五、选中与回传

### 唯一索引

图标以 **id** 为唯一索引，优先级：`id ?? icon_id ?? name`（offline lucide 无 id，以 name 充当）。名称仅用于展示，可重复。

### 打开时带入（property-editor-popup.tsx）

| prop | 读取顺序 |
| --- | --- |
| current | `editProps[key]`（名称） |
| currentId | `editProps[${key}Id]` |
| initialSize | `${key}Size` → 元素实际高度 px（`editHeightPx`，无高取宽）→ 组件 `size` 属性 → `'24'` |
| initialStyle | `${key}Style` → 旧 `shape` 属性 → `'outline'` |
| initialColor | `${key}Color` → 旧 `color` 属性（token/大写/hex 均兼容） → Default 色 |

### 确认时回传（handleIconPick）

写入 `editProps`：

- `key` = 图标名称（展示）
- `${key}Id` / `${key}Size` / `${key}Style` / `${key}Color` = 唯一 id / 尺寸 / 形状（枚举值）/ 颜色（hex）
- **宽高同步**：size(px) 写入 `editWidthPx/editHeightPx` 并标记 dirty，元素样式生成 `width/height: Npx`
- **旧字段同步**（仅当组件枚举包含对应值时）：`shape` ← 形状枚举值；`color` ← hex 反查的小写语义 token

## 六、颜色体系（icon-colors.ts）

- `iconColors`：14 组语义色，键 = 旧 `Icon.color` 枚举值（default/brand/info/error/alert/warning/success/disabled/rose/pink/purple/indigo/cyan/green），每项含 `label`（展示名首字母大写）+ `color/twoColor/threeColor`（hex 列表，双色/三色预留）
- `iconCssColor(key)`：取语义色主色 hex
- `themeColors`：完整主题 token 表（previewpc 迁移），供后续按 CSS 变量取色

## 七、相关文件

| 文件 | 职责 |
| --- | --- |
| `icon-picker-popup.tsx` | 弹窗主体（布局 / 网格 / 底部筛选 / 确认回传） |
| `icon-plus-fetch.ts` | icon-plus 服务封装（getConfig/tags/groups/getIconInfo/getIcon），online 探测与 svg 缓存，id 归一化 |
| `icon-colors.ts` | 语义色板 + 主题色表 |
| `icon-category-select.tsx` | 分类树选择器（数据源 `iconStore.groups`，未返回时用内置兜底树） |
| `property-editor-popup.tsx` | 接入方：触发器渲染、`handleIconPick` 回写、带入参数 |
| `assets/images/noDataEmpty.svg` / `delete.svg` | 空态占位图 / 删除图标 |
| `lucide-icons.ts` | offline 本地图标集 |

## 八、自定义图标

- 仅上传按钮（图标 + 文字）可触发文件选择，支持 SVG/PNG/JPG 单张与批量
- 已上传项以 objectURL 展示，hover 出现右上角删除按钮（距边 6px）
- 弹窗关闭时自动 revoke 全部 objectURL
