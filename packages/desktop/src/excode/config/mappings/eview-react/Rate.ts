/**
 * Rate → Rating 映射
 *
 * | A2UI prop | eview-react prop | 处理 |
 * |-----------|-----------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控），event: onClick |
 * | value（字面量） | value | LiteralValue.useState（受控），event: onClick |
 * | count（DataBinding） | starCount | BindingValue 原样透传（只改名） |
 * | count（字面量） | starCount | 改名透传 |
 * | size（small/medium/large） | size（number） | small→14 / medium→20 / large→26 |
 * | disabled | disabled | 同名透传 |
 * | allowClear | — | 丢弃 |
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

// ─── size 值映射 ───
const SIZE_MAP: Record<string, number> = {
  small: 14,
  medium: 20,
  large: 26,
};

// ─── Rate → Rating 映射定义 ───

export function createRateMapping(pkg: string): MappingDef {
  return {
    tag: "Rating",
    import: `${pkg}/Rating`,

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {};
      const outputProps: Record<string, PropValue> = {};

      // 显性处理每个 A2UI prop：A2UI Rate 的 props 是封闭集合
      // (count/value/allowClear/disabled/size/className)，不做兜底透传。

      // ─── value → value（useState 受控） ───
      if ("value" in props) {
        const val = props.value;
        if (val && typeof val === "object" && val.type === "binding") {
          // DataBinding → ComputedValue + useState
          outputProps.value = Value.computed({
            path: val.path,
            pathType: val.pathType ?? "absolute",
            accessPath: val.accessPath,
            containsJSX: false,
            useState: {
              event: "onClick",
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
            transform: (raw) => Number(raw) ?? 0,
          });
        } else {
          // 字面量 → LiteralValue + useState
          outputProps.value = Value.literal({
            value: val ?? 0,
            useState: {
              event: "onClick",
              extractor: (setter) => `(val) => ${setter}(val)`,
            },
          });
        }
      }

      // ─── count → starCount（双形态透传，只改名不改值） ───
      if ("count" in props) {
        const val = props.count;
        if (val && typeof val === "object" && val.type === "binding") {
          // DataBinding → BindingValue 原样透传（只改名）
          outputProps.starCount = val as PropValue;
        } else {
          outputProps.starCount = val ?? 5;
        }
      }

      // ─── size（small/medium/large → number） ───
      if (
        props.size &&
        typeof props.size === "string" &&
        SIZE_MAP[props.size] !== undefined
      ) {
        outputProps.size = SIZE_MAP[props.size];
      }

      // ─── disabled 透传 ───
      if (props.disabled !== undefined) {
        outputProps.disabled = props.disabled;
      }

      // ─── allowClear 丢弃 ───

      // ─── className 透传 ───
      if (props.className) {
        outputProps.className = props.className;
      }

      // 不做剩余兜底透传：A2UI Rate 的 props 已逐项显性处理。

      return {
        props: outputProps,
        children: null,
      };
    },
  };
}
