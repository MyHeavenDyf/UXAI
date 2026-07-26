# Timeline 时间轴使用规范

用于按时间顺序展示事件、操作历史和状态流转。

## 使用规则

- 历史记录建议使用 `orientation=vertical`；短流程且横向空间充足时使用 `horizontal`。
- 内容在轴线同侧时使用 `mode=start | end`；需要交替排布时使用 `mode=alternate`。
- 节点样式通过 `variant=filled | outlined` 选择，同一时间轴保持一致。
- 每个 TimelineItem 必须设置 `title` 和 `content`；只有图标帮助识别时设置 `icon`。
- 仅在事件有明确状态语义时设置 `color`；内容位置通过 `placement=start | end` 设置。
- 时间格式保持一致，当前进行中节点清晰，历史节点适当弱化。

## 布局

- 时间、标题和说明对齐；长说明保持可读行宽，不挤压时间列。

## Don't

- 不要用于没有时间或顺序关系的列表。
- 不要为了装饰给每个节点使用不同颜色或图标。
- 不要只用颜色区分关键状态。
- 不要使用开发组件不存在的属性或枚举值。
