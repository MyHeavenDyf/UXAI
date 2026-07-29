/**
 * Tag → Tag 映射
 *
 * A2UI Tag → eview-react Tag 组件。参考 md/eview-react/Tag.md + md/a2ui/api/DataDisplay/Tag.json。
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（string/DataBinding） | children | value→children 下沉（TextNode） |
 * | color（string） | color | 值映射：A2UI success/processing/error/default/warning → eview-react success/primary/danger/default/warning；#HEX 透传 |
 * | color（DataBinding） | color | **ComputedValue** 编译期映射运行时 color 值（同字面量映射规则） |
 * | icon（string/DataBinding） | iconName + hasIcon | resolveIcon → BuildNode / ComputedValue；hasIcon:true |
 * | size（large/medium/small） | size（large/normal/small） | medium→normal 值映射 |
 * | variant（filled/solid/outlined） | fill（solid/outline） | filled/solid→solid / outlined→outline |
 * | closable | closable | 同名透传 |
 * | closeIcon | — | 丢弃（eview-react Tag 用默认关闭图标） |
 * | className | className | 同名透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
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
// A2UI: success / processing / error / default / warning / #HEX
// eview-react: default / primary / success / warning / danger / caution / 自定义
const COLOR_MAP: Record<string, string> = {
  success: "success",
  processing: "primary",
  error: "danger",
  default: "default",
  warning: "warning",
  // #HEX / 其他自定义颜色字符串 → 不在表内，mapColor 兜底原样透传
};

/** 把 A2UI color 值映射为 eview-react color 值（字面量与 DataBinding transform 共用） */
function mapColor(raw: any): string {
  if (typeof raw !== "string") return raw;
  return COLOR_MAP[raw] ?? raw; // success/processing/... 命中映射；#HEX / 其他原样透传
}

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

      // ─── color（字面量值映射 / DataBinding 编译期映射 + #HEX 透传） ───
      if (props.color) {
        const c = props.color;
        if (typeof c === "string") {
          // 字面量：直接映射
          outputProps.color = mapColor(c);
        } else if (c && typeof c === "object" && c.type === "binding") {
          // DataBinding：运行时值为 A2UI color（success/processing/.../#HEX），需编译期映射
          outputProps.color = Value.computed({
            path: c.path,
            pathType: c.pathType ?? "absolute",
            accessPath: c.accessPath ?? "tagColor",
            containsJSX: false,
            transform: (raw) => mapColor(raw),
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

      // ─── closeIcon 丢弃（eview-react Tag 用默认关闭图标） ───

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
}
