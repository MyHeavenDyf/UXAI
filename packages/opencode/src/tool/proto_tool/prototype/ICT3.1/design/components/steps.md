# Steps 步骤条使用规范

用于表达有明确顺序的流程进度与阶段状态。

## 使用规则

- 标准流程使用 `types=default`；轻量进度使用 `types=dot`；紧凑流程使用 `types=inline`；支持步骤导航时使用 `types=navigation`；阶段面板使用 `types=panel`。
- 横向流程使用 `orientation=horizontal`；步骤多、标题长或需要说明时使用 `orientation=vertical`。
- 使用 `current` 指定当前步骤；整体异常使用 `status=error`，其他状态使用 `wait | process | finish`。
- 需要区分实心或描边节点时使用 `variant=filled | outlined`，同一流程保持一致。
- 常规页面使用 `size=medium`；紧凑场景使用 `size=small`；同组步骤条尺寸一致。
- 每个 StepItem 必须设置 `title`；补充说明使用 `content`，仅在图标能帮助识别时设置 `icon`。
- 错误步骤必须同时提供原因或下一步动作，不能只靠颜色表达。

## 布局

- 横向 Steps 不承载长文案；长说明放在步骤下方内容区。
- 当前步骤最突出，完成步骤不能比当前步骤更抢眼。
- 横向空间不足时改用纵向，不压缩步骤或截断关键信息。

## Don't

- 不要用 Steps 替代 Tabs 或普通导航。
- 不要把非线性状态强行组织成步骤。
- 不要在步骤节点内放复杂表单或图表。
- 不要使用开发组件不存在的属性或枚举值。
