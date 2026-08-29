/**
 * Tag → Tag 映射
 *
 * A2UI Tag → eview-react Tag 组件。参考 md/eview-react/Tag.md + md/a2ui/api/DataDisplay/Tag.json。
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（string/DataBinding） | children | value→children 下沉（TextNode） |
 * | color（string） | color | 枚举值直接透传（default/info/error/alert/warning/success/disabled/green/rose/pink/purple/indigo/cyan/#HEX） |
 * | color（DataBinding） | color | 枚举值直接透传，ComputedValue 无 transform |
 * | icon（string/DataBinding） | iconName + hasIcon | resolveIcon → BuildNode / ComputedValue；hasIcon:true |
 * | size（large/medium/small） | size（large/normal/small） | medium→normal 值映射 |
 * | variant（solid/filled/outlined） | fill（solid/outline） | 值映射（filled/outlined→outline；缺省→outline；eview-react Tag 用 fill，无 variant） |
 * | closable | closable | 同名透传 |
 * | closeIcon | — | 丢弃（eview-react Tag 用默认关闭图标） |
 * | className | className | 同名透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type {
  MappingDef,
  TransformContext,
} from "../../../src/core/component-mapping";
import type { PropValue } from "../../../src/core/value-types";
import { Value } from "../../../src/core/value-factory";
import { Node } from '../../../src/core/node-factory'

/**
 * 解析 icon prop（字面量或 DataBinding）→ prop val
 * - 字面量 → ctx.resolveIcon() 出 BuildNode
 * - DataBinding → ComputedValue + containsJSX（编译期 resolveIcon）
 */
function resolveIconProp(
  iconProp: any,
  ctx: TransformContext,
): PropValue | null {
  if (!iconProp) return null;

  if (typeof iconProp === "object" && iconProp.type === "binding") {
    return Value.computed({
      path: iconProp.path,
      pathType: iconProp.pathType ?? "absolute",
      accessPath: iconProp.accessPath,
      containsJSX: true,
      transform: (rawValue, cvCtx) => {
        const rIcon = cvCtx?.resolveIcon ?? ctx.resolveIcon;
        return typeof rawValue === "string" ? rIcon(rawValue) : null;
      },
    });
  }

  if (typeof iconProp === "string") {
    return ctx.resolveIcon(iconProp) as any;
  }

  return null;
}

// ─── color：枚举值直接透传，无效值回退 default ───
// A2UI color 枚举值直接作为 eview-react color 传入，不做值映射
const COLOR_ENUM = new Set([
  "default", "info", "error", "alert", "warning", "success", "disabled",
  "green", "rose", "pink", "purple", "indigo", "cyan",
]);

// ─── size 值映射 ───
const SIZE_MAP: Record<string, string> = {
  small: "small",
  medium: "normal",
  large: "large",
};
// ─── variant → fill 值映射 ───
// A2UI variant: solid/filled/outlined → eview-react fill: solid/outline/outline
const FILL_MAP: Record<string, string> = {
  solid: "solid",
  filled: "outline",
  outlined: "outline",
};

// ─── Tag 映射定义 ───

export function createTagMapping(pkg: string): MappingDef {
  return {
    tag: "Tag",
    import: `${pkg}/Tag`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {};
      const outputProps: Record<string, PropValue> = {};
      let childrenVal: any = null;

      // 显性处理每个 A2UI prop：A2UI Tag 的 props 是封闭集合
      // (value/color/icon/size/variant/closable/closeIcon/className)，不做兜底透传，
      // 避免 variant 等目标库不支持的 prop 漏传给 eview-react Tag。

      // ─── value → children（双形态） ───
      if ("value" in props) {
        const val = props.value;
        if (val && typeof val === "object" && val.type === "binding") {
          // DataBinding：透传原始 BindingValue，管线自动渲染为 {path}
          childrenVal = val;
        } else if (typeof val === "string") {
          childrenVal = val;
        }
      }

      // ─── color（枚举值直接透传，非枚举值回退 default） ───
      if (props.color) {
        const c = props.color;
        if (typeof c === "string") {
          outputProps.color = COLOR_ENUM.has(c) ? c : "default";
        } else if (c && typeof c === "object" && c.type === "binding") {
          outputProps.color = Value.computed({
            path: c.path,
            pathType: c.pathType ?? "absolute",
            accessPath: c.accessPath ?? "tagColor",
            containsJSX: false,
            transform: (raw) => (typeof raw === "string" && COLOR_ENUM.has(raw)) ? raw : "default",
          });
        } else {
          outputProps.color = "default";
        }
      } else {
        outputProps.color = "default";
      }

      // ─── icon → iconName + hasIcon（双形态） ───
      if ("icon" in props) {
        const iconProp = resolveIconProp(props.icon, ctx);
        if (iconProp) {
          outputProps.iconName = iconProp;
          outputProps.hasIcon = true;
        }
      }



      // ─── size 值映射（medium→normal） ───
      if (props.size && typeof props.size === "string") {
        const mapped = SIZE_MAP[props.size];
        if (mapped) {
          outputProps.size = mapped;
        }
      }

      // ─── closable 透传 ───
      if (props.closable !== undefined) {
        outputProps.closable = props.closable;
      }


      // ─── variant → fill ───
      if (props.variant && typeof props.variant === "string") {
        const mapped = FILL_MAP[props.variant];
        outputProps.fill = mapped ?? "outline";
      } else {
        outputProps.fill = "outline";
      }
      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className;
      }

      // ─── closeIcon 丢弃（eview-react Tag 用默认关闭图标） ───

      // 不做剩余兜底透传：A2UI Tag 的 props 已逐项显性处理。
      // （原先兜底循环会把 variant 原样漏传给 eview-react Tag——该组件用 fill 而非
      //   variant，已移除循环，variant 只经上方 FILL_MAP 转 fill 后丢弃。）

      return {
        props: outputProps,
        children: childrenVal !== null ? [Node.text({ value: childrenVal })] : null,
      };
    },
  };
}
