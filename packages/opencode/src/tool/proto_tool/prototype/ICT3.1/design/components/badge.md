# badge 徽标使用规范

## Props

- `status`: `success | processing | default | error | warning`
- `dot`: boolean
- `count`: string | number
- `overflowCount`: number
- `showZero`: boolean
- `offset`: array
- `color`: string

### 用途

用于通知点、未读数或附着在元素上的小型数量提示。

### 类型

- Dot badge：只表达“有”。
- Number badge：表达数量。
- Dot badge 用于未读、待处理、提醒存在性。
- Number badge 用于通知数量、待办数量、消息数量；数量过大按组件上限显示。

### 规则

- 依附于图标、头像、Tab 或紧凑文本。
- 通常位于锚点右上角。
- 大数字按组件能力显示上限，如 `99+`。
- Badge 是锚点的附属信息，不应成为主内容。

### Do

- 依附于图标、头像、Tab 或紧凑文本，位于锚点右上角。
- 未读、待处理使用 `dot` 表达存在性。
- 通知、待办数量使用 `count` 表达具体数量。
- 大数字使用 `overflowCount` 显示上限，如 `99+`。
- Badge 作为锚点附属信息，不抢主内容视觉权重。

### Don't

- 不要在 Table 内使用 Badge。
- 不要把 Badge 当通用状态标签。
- 不要让 Badge 没有明确锚点。
