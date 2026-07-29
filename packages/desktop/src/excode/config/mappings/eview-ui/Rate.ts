/**
 * eview-ui Rate → Rating 映射（bespoke）
 *
 * 与 eview-react Rate 的差异：eview-ui 的 Rating **支持** A2UI 的 `allowClear` 属性，直接透传；
 * 而 eview-react 的 Rating 不支持，eview-react 映射将其丢弃。其余 prop 处理与 eview-react 一致。
 *
 * | A2UI prop | eview-ui prop | 处理 |
 * |-----------|--------------|------|
 * | value（DataBinding） | value | ComputedValue.useState（受控），event: onClick |
 * | value（字面量） | value | LiteralValue.useState（受控），event: onClick |
 * | count（DataBinding） | starCount | BindingValue 原样透传（只改名） |
 * | count（字面量） | starCount | 改名透传 |
 * | size（small/medium/large） | size（number） | small→14 / medium→20 / large→26 |
 * | disabled | disabled | 同名透传 |
 * | allowClear | allowClear | **透传**（eview-ui Rating 支持；eview-react 不支持故丢弃） |
 * | className | className | 同名透传 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type {
  MappingDef,
  TransformContext,
} from "../../../src/core/componentMapping";
import type { PropValue } from "../../../src/core/valueTypes";
import { Value } from "../../../src/core/value";

// ─── size 值映射 ───
const SIZE_MAP: Record<string, number> = {
  small: 14,
  medium: 20,
  large: 26,
};

// ─── eview-ui Rate → Rating 映射定义 ───

const RateMapping: MappingDef = {
  tag: "Rating",
  import: "@cloudsop/eview-ui/Rating",

  transform(node: any, _ctx: TransformContext) {
    const props = node.props || {};
    const outputProps: Record<string, PropValue> = {};
    const SKIP_KEYS = new Set(["value", "count", "size", "allowClear", "disabled", "className"]);

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

    // ─── allowClear 透传（eview-ui Rating 支持，与 eview-react 差异点） ───
    if (props.allowClear !== undefined) {
      outputProps.allowClear = props.allowClear;
    }

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
      children: null,
    };
  },
};

export default RateMapping;
