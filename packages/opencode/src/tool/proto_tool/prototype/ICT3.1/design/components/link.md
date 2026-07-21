# link 文字链接使用规范

## Props

表格行内操作 / 轻量动作链接（基于 Button，`types=link`）：

- `value`: string
- `color`: `default | primary | danger`
- `size`: `large | medium | small`
- `icon`: string
- `iconPlacement`: `start | end`

导航 / 外部跳转链接（基于 H5，`component=a`）：

- `href`: string
- `target`: `_blank | _self | _parent | _top`
- `title`: string

### 用途

用于跳转、引用、详情查看、下载和轻量操作。

### 类型

- 纯文字链接
- 图标 + 文字链接

### 常见用法

- 跳转详情：如资源名称、任务名称、报告标题。
- 下载/复制/引用：轻量辅助动作。
- 表格行内操作：使用按钮的 `types=link` 形态，保持操作列一致。
- 外部链接：需要通过文案或图标说明跳出当前系统。

### 文案

- 链接文案要说明目标或动作。
- 避免“点击这里”“查看”等脱离上下文的文案。
- 表格行操作应使用按钮的 `types=link` 形态。

### 状态

- 默认态使用品牌链接色。
- Hover 可出现下划线或更深品牌色。
- Disabled 弱化且不可交互。
- Visited 仅在访问历史有实际价值时使用。

### Do

- 跳转详情使用链接，如资源名称、任务名称、报告标题。
- 表格行内操作使用 `Button types=link`，保持操作列一致。
- 外部链接通过文案或图标说明跳出当前系统，使用 `target=_blank`。
- 链接文案说明目标或动作，避免“点击这里”“查看”等脱离上下文的文案。
- Hover 可出现下划线或更深品牌色，Disabled 弱化且不可交互。

### Don't

- 不要用 Link 做主操作。
- 不要在密集表格中滥用下划线。
- 没有跳转或明确动作时不要伪装成链接。
