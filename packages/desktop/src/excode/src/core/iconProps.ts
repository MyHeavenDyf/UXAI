/**
 * icon-props — 手动维护的 A2UI 图标属性映射表
 *
 * 依据 md/a2ui/api/ 下的 schema 逐个分析得出，覆盖明确使用 Lucide 图标名
 * (kebab-case, 如 'chevron-right') 作为 prop 值的组件。
 *
 * 字段语义：
 *   - 字符串类型直接作为图标 prop 名
 *   - 数组内嵌（如 `items[].icon`）记为 'items.icon' 形式
 *
 * 收集策略（BuildTrees 中）：
 *   1. 节点 props 中的直接图标 prop：props[iconPropName] 字面量
 *   2. 字面量数组中的 icon：items[].icon
 *   3. state 全量递归：state.* 中所有 icon 字段
 *
 */

/**
 * 组件直接 prop 中的图标字段
 * 例：Button.props.icon 是 Lucide 图标名（kebab-case）
 */
export const ICON_PROPS_BY_COMPONENT: Record<string, string[]> = {
  // 直接 prop
  Icon: ['name'],
  Button: ['icon'],
  Input: ['prefix', 'suffix'],
  Switch: ['checkedChildrenIcon', 'unCheckedChildrenIcon'],
  TabItem: ['icon'],
  StepItem: ['icon'],
  Tag: ['icon', 'closeIcon'],
  TimelineItem: ['icon'],
  Collapse: ['expandIcon'],
}

/**
 * 数组内嵌的 icon 字段（如 Menu.items[]，每个 item 都有 icon 字段）
 * 收集时遍历顶层 prop 的数组元素，取 item.icon（icon 字段名为约定）
 */
export const ICON_PROPS_NESTED_IN_ARRAYS: Record<string, string[]> = {
  Menu: ['items'],       // props.items[] 数组元素的 icon
  Dropdown: ['menu'],     // props.menu[] 数组元素的 icon
  Segmented: ['options'], // props.options[] 数组元素的 icon
  Tree: ['options'],      // props.options[] 数组元素的 icon
}

/**
 * HTML 元素 value 下沉到 children TextNode 的集合
 */
export const HTML_TEXT_ELEMENTS: Set<string> = new Set([
  'span', 'div', 'p', 'label',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'footer', 'nav', 'section', 'article', 'aside',
  'main', 'strong', 'em', 'b', 'i', 'u',
  'small', 'mark', 'del', 'ins', 'sub', 'sup',
  'td', 'th', 'caption', 'figcaption', 'legend',
  'a', 'cite', 'code', 'pre', 'blockquote', 'q',
  'abbr', 'address', 'time', 'li', 'dt', 'dd', 'summary',
])

/** 有原生 value 属性的 HTML 元素（不参与下沉） */
export const HTML_VALUE_ATTRIBUTE_ELEMENTS: Set<string> = new Set([
  'button',
  'data',
  'input',
  'li',
  'meter',
  'option',
  'progress',
  'param',
])