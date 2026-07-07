/**
 * Switch → Switch 映射
 *
 * A2UI Switch → eview-react Switch 组件。
 *
 * ## 映射规则
 *
 * 1. value → toggled（改名）
 *    - 配合 binding 表声明 two-way：onToggle + boolean valueExtractor
 * 2. checkedChildren → taggledChildren（改名）
 *    - API 实际命名为 taggledChildren（拼写错误，必须保留）
 * 3. unCheckedChildren → unTaggledChildren（改名）
 *    - API 实际命名为 unTaggledChildren（拼写错误，必须保留）
 * 4. size → __drop__（Switch API 不接受 size，丢弃避免 React 警告）
 * 5. 其余 prop 透传：className / disabled / required / allowPropagation /
 *    isControlToggled / style / id / label / labelPosition / data
 *
 * ## binding 表
 *
 * toggled（改名后的 prop 名）声明为 two-way：
 *   changeEvent: 'onToggle'
 *   valueExtractor: (setter) => `(checked) => ${setter}(checked)`
 *
 * 注：A2UI 当前用法均为相对路径（bindMode='readonly'，无 stateKey），
 *     two-way binding 仅在使用绝对路径（`{path: "/xxx"}`）时生效。
 *
 * ## binding key 命名约定（踩坑记录）
 *
 * `binding` 表的 key 必须是**改名后的 prop 名**，因为：
 *   - BindingResolver 在 applySchema 之后才查 binding 表
 *   - 此时 propsMap 已完成 value → toggled 改名
 *   - `getBinding(component, propKey)` 的 propKey 就是改名后的 key
 *
 * 所以是 `binding.toggled` 而非 `binding.value`。
 */
import { resolveBindingValue } from "../../../src/core/stateUtils"

/**
 * 从 DataBinding 或字面量中提取实际值
 *
 * 返回 [actualValue, stateKey | null]
 * - actualValue: 实际数组或原始值
 * - stateKey: 如果是从 state 中取的数据，返回用于删除的 path；否则 null
 */
function resolveValue(rawState: any, prop: any): [any, string | null] {
  if (prop?.__binding) {
    const path = prop.accessPath
    const value = resolveBindingValue(rawState, prop)
    return [value, path]
  }
  return [prop, null]
}

export default {
  tag: "Switch",
  import: "@nce/eview-react/Switch",

  // binding key 用改名后的 prop 名（详见文件头注释）
  binding: {
    toggled: {
      changeEvent: "onToggle",
      // Switch 的 onToggle 直接提供 boolean 值（非事件对象），
      // 因此 valueExtractor 直接接收 checked 作为入参
      valueExtractor: (setter: string) => `(checked) => ${setter}(checked)`,
    },
  },

  propsMap: {
    value: "toggled",
    checkedChildren: "taggledChildren", // API 原拼写错误，必须保留
    unCheckedChildren: "unTaggledChildren", // API 原拼写错误，必须保留
    size: "__drop__", // Switch API 不接受 size
  },

  valueMap: {},

  defaults: {},

  /**
   * transform — props 转换
   *
   * 声明式 propsMap 已完成：
   *   - value → toggled（保留 __binding 标记）
   *   - checkedChildren → taggledChildren（API 原拼写）
   *   - unCheckedChildren → unTaggledChildren（API 原拼写）
   *   - size → __drop__
   *
   * binding 表负责注入 onToggle 与 useState 绑定（绝对路径生效）。
   *
   * transform 负责：
   *   - 透传基础 prop
   *   - 处理 label / taggledChildren / unTaggledChildren 等可能含 binding 的 prop
   *     （resolveValue 把 binding 解析为字面量，避免最终 JSX 中残留 __binding 标记）
   */
  transform(node: any, { rawState, iconNameMap }: { rawState?: any; iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) }
    const outputProps: Record<string, any> = {}

    // ─── 透传基础 prop ───
    if (p.className !== undefined) outputProps.className = p.className
    if (Object.prototype.hasOwnProperty.call(p, "disabled")) outputProps.disabled = p.disabled
    if (Object.prototype.hasOwnProperty.call(p, "required")) outputProps.required = p.required
    if (Object.prototype.hasOwnProperty.call(p, "allowPropagation")) outputProps.allowPropagation = p.allowPropagation
    if (Object.prototype.hasOwnProperty.call(p, "isControlToggled")) outputProps.isControlToggled = p.isControlToggled
    if (p.style !== undefined) outputProps.style = p.style
    if (p.id !== undefined) outputProps.id = p.id

    // ─── label（可能含 binding） ───
    if (p.label !== undefined) {
      const [label] = resolveValue(rawState, p.label)
      outputProps.label = label
    }
    if (p.labelPosition !== undefined) outputProps.labelPosition = p.labelPosition
    if (p.data !== undefined) outputProps.data = p.data

    // ─── taggledChildren / unTaggledChildren（API 原拼写，可能含 binding） ───
    if (Object.prototype.hasOwnProperty.call(p, "taggledChildren")) {
      const [taggledChildren] = resolveValue(rawState, p.taggledChildren)
      outputProps.taggledChildren = taggledChildren
    }
    if (Object.prototype.hasOwnProperty.call(p, "unTaggledChildren")) {
      const [unTaggledChildren] = resolveValue(rawState, p.unTaggledChildren)
      outputProps.unTaggledChildren = unTaggledChildren
    }

    // value → toggled 由 binding 表 + propsMap 协同处理，无需手动透传

    return { props: outputProps, children: null }
  },
}
