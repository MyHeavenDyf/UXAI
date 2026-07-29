/**
 * Tag → Tag 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（string/DataBinding） | children | value→children 下沉 |
 * | color | color | 值映射：processing→primary / error→danger / 余同名 |
 * | icon（string/DataBinding） | iconName + hasIcon | 同名透传 + hasIcon:true |
 * | size（large/medium/small） | size（large/normal/small） | medium→normal 值映射 |
 * | variant（filled/solid/outlined） | fill（solid/outline） | filled→solid / outlined→outline |
 * | closable | closable | 同名透传 |
 * | closeIcon | — | 丢弃 |
 * | className | className | 同名透传 |
 */

import type {
  MappingDef,
  TransformContext,
} from "../../../src/core/componentMapping";
import type { PropValue } from "../../../src/core/valueTypes";
import { Value } from "../../../src/core/value";
import { Node } from '../../../src/core/node'
/**
 * 解析 icon prop（字面量或 DataBinding）→ prop val
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

// ─── color 值映射 ───
const COLOR_MAP: Record<string, string> = {
  processing: "primary",
  error: "danger",
  // success / default / warning → 同名
};

// ─── variant → fill 值映射 ───
const FILL_MAP: Record<string, string> = {
  filled: "solid",
  solid: "solid",
  outlined: "outline",
};

// ─── size 值映射 ───
const SIZE_MAP: Record<string, string> = {
  small: "small",
  medium: "normal",
  large: "large",
};

// ─── Tag 映射定义 ───

const TagMapping: MappingDef = {
  tag: "Tag",
  import: "@nce/eview-react/Tag",

  transform(node: any, ctx: TransformContext) {
    const props = node.props || {};
    const outputProps: Record<string, PropValue> = {};
    let childrenVal: any = null;
    const SKIP_KEYS = new Set([
      "value",
      "color",
      "icon",
      "size",
      "variant",
      "closable",
      "closeIcon",
      "className",
    ]);

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

    // ─── color（值映射 + #HEX 透传） ───
    if (props.color) {
      const c = props.color;
      if (typeof c === "string") {
        outputProps.color = COLOR_MAP[c] ?? c;
      } else {
        outputProps.color = c;
      }
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

    // ─── variant → fill ───
    if (props.variant && typeof props.variant === "string") {
      const mapped = FILL_MAP[props.variant];
      if (mapped) {
        outputProps.fill = mapped;
      }
    }

    // ─── closable 透传 ───
    if (props.closable !== undefined) {
      outputProps.closable = props.closable;
    }

    // ─── closeIcon 丢弃 ───

    // ─── className 透传 ───
    if (props.className) {
      outputProps.className = props.className;
    }

    // ─── 剩余 prop 透传 ───
    for (const [key, value] of Object.entries(props)) {
      if (!SKIP_KEYS.has(key)) {
        outputProps[key] = value as PropValue;
      }
    }

    return {
      props: outputProps,
      children: childrenVal !== null ? [Node.text({ value: childrenVal })] : null,
    };
  },
};

export default TagMapping;
