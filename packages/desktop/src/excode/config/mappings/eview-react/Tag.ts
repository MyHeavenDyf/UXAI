/**
 * Tag → Tag 映射
 *
 * A2UI Tag → eview-react Tag 组件。
 *
 * ## 映射规则
 *
 * - icon → iconName（改名），size.medium → normal
 * - color 映射：error→danger, processing→primary，其余透传
 * - iconName → resolveIcon 转 CodeGenNode + hasIcon 配套开关
 * - value → children（eview-react Tag 无 value prop）
 */
import { resolveIcon } from "./Icon"

export default {
  tag: "Tag",
  import: "@nce/eview-react/Tag",

  propsMap: {
    icon: "iconName",
  },

  valueMap: {
    size: {
      medium: "normal",
      large: "large",
      small: "",
    },
    color: {
      success: "success",
      processing: "primary",
      error: "danger",
      default: "default",
      warning: "warning",
    },

  },

  defaults: {},

  transform(node: any, { rawState, iconNameMap }: { rawState?: any; iconNameMap?: Record<string, string> }) {
    const p = { ...(node.props || {}) }
    const iconMap = iconNameMap || {}
    const outputProps: Record<string, any> = {}

    // iconName → resolveIcon + __slotNode 包装 + hasIcon 配套开关
    if ("iconName" in p) {
      const iconNode = resolveIcon(p.iconName, iconMap)
      outputProps.iconName = { __slotNode: iconNode }
      outputProps.hasIcon = true
    }

    // color 处理
    if (typeof p.color === "string") {
      switch (p.color) {
        case "error":
          outputProps.color = "danger"
          break
        case "processing":
          outputProps.color = "primary"
          break
        default:
          outputProps.color = p.color
      }
    }

    if (p.variant) {
      switch (p.variant) {
        case "solid":
          outputProps.fill = "solid"
          break
        case "outlined":
          outputProps.fill = "outline"
          break
      }
    }

    if (p.size === "large") {
      outputProps.size = "large"
    }

    // className 透传
    if (p.className !== undefined) {
      outputProps.className = p.className
    }

    // value → children（eview-react Tag 无 value prop）
    let outputChildren: any[] | null = null
    if ("value" in p) {
      const val = p.value
      if (typeof val === "string") {
        outputChildren = [val]
      } else if (val && typeof val === "object" && (val.__binding || val.__varRef || val.__rawExpr)) {
        outputChildren = [val]
      } else if (val !== undefined && val !== null) {
        // 原始值（number/boolean）→ 转字符串
        outputChildren = [String(val)]
      }
    }
    return { props: outputProps, children: outputChildren }
  },
}
