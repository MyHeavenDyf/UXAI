# Tabs 页签使用规范

用于同一上下文中同级内容的切换。

## 使用规则

- 必须设置当前 `activeKey`；每个 TabItem 必须设置唯一 `key`，标题使用 `label`，内容使用 `content`。
- 标准内容分区使用 `types=line`；面板内强分组使用 `types=card`；需要新增或关闭页签时使用 `types=editable-card`。
- 默认使用 `tabPlacement=top`；仅在内容结构明确需要时使用 `start | end | bottom`。
- 常规页面使用 `size=medium`；同组 Tabs 尺寸一致。
- 仅在图标有助于区分标签时设置 TabItem `icon`；标签保持短且同一命名维度。

## 布局

- Tabs 紧邻所控制的内容，当前项在组内最突出。
- 页签过多时使用组件溢出能力；需要多层导航时改用 Side Navigation 或内容分组。

## Don't

- 不要用 Tabs 表示步骤流程或跨模块导航。
- 不要混合同级和非同级内容。
- 不要写 Button/Segmented 等 Tabs API 不支持的类型。
- 不要连续堆叠多层 Tabs。
