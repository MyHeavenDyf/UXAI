/**
 * Switch → Switch 映射
 *
 * A2UI Switch → eview-react Switch 组件。
 *
 * ## 映射规则
 *
 * - value → toggled，checkedChildren → taggledChildren，unCheckedChildren → unTaggledChildren
 * - size → 丢弃（Switch API 不接受 size）
 * - binding key 必须是改名后的 prop 名（toggled 而非 value），
 *   因为 BindingResolver 在 applySchema 之后才查 binding 表
 *
 * ## binding 表
 *
 * toggled 声明为 two-way：onToggle + boolean valueExtractor
 */
import { resolveBindingValue } from "../../../src/core/stateUtils"
import { resolveIcon } from './Icon';

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

  // binding key 用改名后的 prop 名：toggled 而非 value
  binding: {
    toggled: {
      changeEvent: "onToggle",
      valueExtractor: (setter: string) => `(checked) => ${setter}(checked)`,
    },
  },

  propsMap: {
    value: "toggled",
    checkedChildren: "taggledChildren",
    unCheckedChildren: "unTaggledChildren",
  },

  valueMap: {},

  defaults: {},

  transform(node: any, { rawState, iconNameMap }: { rawState?: any; iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) }
    const iconMap = iconNameMap || {}
    const outputProps: Record<string, any> = {}

    // ─── 透传基础 prop ───
    if (p.className !== undefined) outputProps.className = p.className
 if (Object.hasOwn(p, "checkedChildren")) {
      outputProps.taggledChildren = p.checkedChildren
    }
    if (Object.hasOwn(p, "unCheckedChildren")) {
      outputProps.unTaggledChildren = p.unCheckedChildren
    }

    if (Object.hasOwn(p, "checkedChildrenIcon")) {
      const iconName = resolveValue(rawState, p.checkedChildrenIcon)[0]
      outputProps.taggledChildren = resolveIcon(iconName, iconMap)
    }
    if (Object.hasOwn(p, "unCheckedChildrenIcon")) {
      const iconName = resolveValue(rawState, p.unCheckedChildrenIcon)[0]
      outputProps.unTaggledChildren = resolveIcon(iconName, iconMap)
    }

    if (Object.hasOwn(p, "value")) {
      outputProps.toggled = resolveValue(rawState, p.value)[0]
    }

    return { props: outputProps, children: null }
  },
}
