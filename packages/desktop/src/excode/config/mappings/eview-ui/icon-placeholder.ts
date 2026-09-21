/**
 * eview-ui 图标占位 URL（统一常量）
 *
 * eview-ui npm 包（`@cloudsop/eview-ui`）自带的组件，其 icon 相关属性**只接 URL 字符串、
 * 不接 React DOM**（与 eview-react 不同——后者用 `resolveIcon` 产 BuildNode）。
 *
 * 当前阶段：**所有 icon 一律用这个统一占位 URL**，不管输入 json 是字面量图标名、
 * DataBinding、还是 iconType 值——transform 产出的图标都是这个写死的字符串。
 * 用的地方引用本常量，路径写死在此处，便于后续统一替换为真实图标 URL 解析。
 *
 * 涉及的 eview-ui 映射（凡原 eview-react 用到 `resolveIcon` 的）：
 *   - 本地工厂副本：Input(suffix) / Menu(Accordion dataItem.icon) / TabItem(icon) /
 *     Timeline(自定义 icon，iconType 枚举保留) / Tree(节点 icon，**属性名
 *     treeNodePrefix→icon**，递归 normalizeTreeNode)
 *   - bespoke：Button(leftIcon/rightIcon) / Dropdown(Menu.Item icon) / Steps(iconUrl)
 *
 * 不涉及（无需引用本常量）：
 *   - Icon 组件本身（独立映射，单独处理）
 *   - `@/shared` 共享实现（Badge/Tag/Divider/Chart）——共享组件能接 React DOM icon，
 *     不属 eview-ui 包组件（见 [AGENTS.md](../../../AGENTS.md) §7 icon-URL 边界）
 *   - Switch bespoke（已丢弃 checkedChildrenIcon/unCheckedChildrenIcon）
 *   - DatePicker/Rate/Progress/TextArea bespoke 及所有复用工厂（均不调 resolveIcon）
 */
export const PLACEHOLDER_ICON_URL = '/icons/placeholder.svg'
