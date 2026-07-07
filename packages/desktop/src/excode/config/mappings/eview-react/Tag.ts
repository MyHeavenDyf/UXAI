/**
 * Tag → Tag 映射
 *
 * A2UI Tag → eview-react Tag 组件。
 *
 * ## 映射规则
 *
 * 1. icon → iconName（改名）
 * 2. size.medium → normal（枚举映射，small/large 透传）
 * 3. color 枚举映射：
 *    - error → danger（A2UI 用 antd 风命名，eview-react 用 danger）
 *    - processing → primary（A2UI antd 命名，eview-react 用 primary）
 *    - 其他预设（primary/success/warning/danger/caution/default）透传
 *    - HEX 色（#RRGGBB）→ style.--background（CSS 变量，自定义色优先级高于预设）
 * 4. iconName → resolveIcon 转 CodeGenNode + hasIcon 配套开关
 * 5. value 保持为 prop（详见下方"value 处理"说明）
 *
 * ## value 处理（与 docs §3.6.3 的差异）
 *
 * docs §3.6.3 范式 `value → children 文本节点` 仅适用于字面量字符串值。
 * 对于 DataBinding 值（__binding 标记）：
 *   - JsxSerializer._resolveChildren 调用 renderNode，无法渲染裸 binding 对象
 *   - 必须保留为 prop，让 JsxSerializer._generateProps._isBinding 处理
 *
 * 与 Table.ts 中手工 CodeGenNode 一致：
 *   ```
 *   <Tag color={statusTag.color} value={statusTag.text} />
 *   ```
 *
 * ## icon 处理（与 docs §9.4 + Button.ts 一致）
 *
 * 调用 resolveIcon 把 iconName 转为 CodeGenNode（@hui/icon-plus 的命名导出组件），
 * 通过 `__slotNode` 包装嵌入 iconName prop，让 JsxSerializer 渲染为 JSX。
 *
 * 同时设置 hasIcon=true 触发 eview-react Tag 的 icon 显示开关。
 *
 * 与 Button.ts 的 leftIcon/rightIcon 包装模式同构：
 *   ```
 *   // Button.ts
 *   p.leftIcon = { __slotNode: iconNode };
 *
 *   // Tag.ts
 *   p.iconName = { __slotNode: iconNode };
 *   ```
 */
import { resolveIcon } from "./Icon"

/**
 * HEX 颜色正则（匹配 #RGB / #RRGGBB / #RRGGBBAA）
 */
const HEX_COLOR_REGEX = /^#[0-9a-f]{3,8}$/i

export default {
  tag: "Tag",
  import: "@nce/eview-react/Tag",

  propsMap: {
    icon: "iconName",
  },

  valueMap: {
    size: {
      medium: "normal",
    },
    color: {
      error: "danger", // A2UI antd 风命名 → eview-react 命名
      processing: "primary", // A2UI antd 风命名 → eview-react 命名
      // primary / success / warning / danger / caution / default 透传
    },
  },

  defaults: {},

  /**
   * transform — props 转换
   */
  transform(node: any, { iconNameMap }: { iconNameMap?: Record<string, string> } = {}) {
    const p = { ...(node.props || {}) }
    const iconMap = iconNameMap || {}

    // ─── 1. iconName → resolveIcon + __slotNode 包装 + hasIcon 配套开关 ───
    if ("iconName" in p) {
      const iconNode = resolveIcon(p.iconName, iconMap)
      p.iconName = { __slotNode: iconNode }
      p.hasIcon = true
    }

    // ─── 2. color HEX → style.--background ───
    // 必须在 valueMap 之后执行（valueMap 先做预设色映射，这里只处理剩下的 HEX）
    if ("color" in p && typeof p.color === "string" && HEX_COLOR_REGEX.test(p.color)) {
      p.style = { ...(p.style || {}), "--background": p.color }
      delete p.color
    }

    // ─── 3. value 保持为 prop（JsxSerializer._isBinding 渲染 binding 对象） ───
    // 子节点（如有）透传
    return { props: p, children: null }
  },
}
