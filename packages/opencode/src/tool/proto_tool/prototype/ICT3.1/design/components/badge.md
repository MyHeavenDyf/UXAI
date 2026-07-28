# Badge 徽标使用规范

用于依附在图标、头像或文字上的通知点和数量提示。

## 使用规则

- 必须设置 `count`；只表达“有新内容”时使用 `dot=true`，表达数量时显示 `count`。
- 数量超过展示上限时设置 `overflowCount`；只有业务需要显示 0 时才使用 `showZero=true`。
- 有明确状态时使用 `status=success | processing | default | error | warning`，不要用任意 `color` 替代语义状态。
- 默认放在锚点右上角；仅在遮挡锚点时使用 `offset=[x, y]` 微调。

## 布局

- Badge 必须依附明确锚点，不单独占据内容区域。
- 同组 Badge 的位置与上限规则保持一致。

## Don't

- 不要在 Table 内使用 Badge。
- 不要用 Badge 表达分类或普通状态；此类信息使用 Tag。
- 不要让 Badge 抢过锚点本身的视觉权重。
