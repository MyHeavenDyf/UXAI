/**
 * Tag → Tag 映射
 *
 * A2UI Tag → eview-react Tag 组件。参考 md/eview-react/Tag.md + md/a2ui/api/DataDisplay/Tag.json。
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（string/DataBinding） | children | value→children 下沉（TextNode） |
 * | color（string） | color / style | 语义色 default/info/error/alert/warning/success/disabled → eview-react color 值映射；自定义色 green/rose/pink/purple/indigo/cyan → 移除 color，改用 style 的 color/background/borderColor；#HEX 透传 |
 * | color（DataBinding） | color / style | **ComputedValue** 编译期映射：语义色→color；自定义色→style（color/background/borderColor）；#HEX 透传 |
 * | icon（string/DataBinding） | iconName + hasIcon | resolveIcon → BuildNode / ComputedValue；hasIcon:true |
 * | size（large/medium/small） | size（large/normal/small） | medium→normal 值映射 |
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

// ─── color 值映射：A2UI enum → eview-react enum ───
// A2UI: default / info / error / alert / warning / success / disabled / green / rose / pink / purple / indigo / cyan / #HEX
// eview-react: default / primary / success / warning / danger / caution / 自定义颜色
const COLOR_MAP: Record<string, string> = {
  default: "default",
  info: "primary",
  error: "danger",
  alert: "caution",
  warning: "warning",
  success: "success",
  disabled: "default",
  green: "green",
  rose: "rose",
  pink: "pink",
  purple: "purple",
  indigo: "indigo",
  cyan: "cyan",
};


/** 把 A2UI color 值映射为 eview-react color 值（仅语义色；自定义色不在表内） */
function mapColor(raw: any): string {
  if (typeof raw !== "string") return raw;
  return COLOR_MAP[raw] ?? raw; // default/info/error/alert/warning/success/disabled 命中映射；#HEX / 其他原样透传
}

// ─── size 值映射 ───
const SIZE_MAP: Record<string, string> = {
  small: "small",
  medium: "normal",
  large: "large",
};
// ─── variant → fill 值映射 ───
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
      const SKIP_KEYS = new Set([
        "value",
        "color",
        "icon",
        "size",
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

      // ─── color（语义色→color 值映射 / 自定义色→style CSS 变量 / #HEX 透传） ───
      if (props.color) {
        const c = props.color;
        if (typeof c === "string") {
          outputProps.color = mapColor(c);
        } else if (c && typeof c === "object" && c.type === "binding") {
          outputProps.color = Value.computed({
            path: c.path,
            pathType: c.pathType ?? "absolute",
            accessPath: c.accessPath ?? "tagColor",
            containsJSX: false,
            transform: (raw) => {
              return mapColor(raw);
            },
          });
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

      // ─── closable 透传 ───
      if (props.closable !== undefined) {
        outputProps.closable = props.closable;
      }


      // ─── variant → fill ───
      if (props.variant && typeof props.variant === "string") {
        const mapped = FILL_MAP[props.variant];
        if (mapped) {
          outputProps.fill = mapped;
        }
      }
      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className;
      }

      // ─── closeIcon 丢弃（eview-react Tag 用默认关闭图标） ───

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
}
