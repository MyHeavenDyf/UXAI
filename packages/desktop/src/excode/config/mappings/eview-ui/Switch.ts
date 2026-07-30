/**
 * eview-ui Switch → Toggle 映射（bespoke）
 *
 * 与 eview-react Switch 的差异：
 *   1. eview-ui 映射到 **Toggle** 组件（eview-react 是 Switch 组件）——tag/import 改为 Toggle。
 *   2. eview-ui 无 `taggledChildren` / `unTaggledChildren`（eview-react 特有"taggled"拼写 prop），
 *      故 A2UI 的 checkedChildren / unCheckedChildren / checkedChildrenIcon / unCheckedChildrenIcon
 *      四个源 prop 在 eview-ui 下**全部丢弃**（无对应目标 prop）。
 * value→toggled 受控、onToggle 事件、size 丢弃、className 透传等其余逻辑与 eview-react 一致。
 *
 * | A2UI prop | eview-ui Toggle prop | 处理 |
 * |-----------|----------------------|------|
 * | value（字面量 boolean） | toggled | 改名透传 + LiteralValue.useState |
 * | value（DataBinding） | toggled | ComputedValue.useState + onToggle，编译期取值作初始值 |
 * | checkedChildren | — | **丢弃**（eview-ui 无 taggledChildren） |
 * | unCheckedChildren | — | **丢弃**（eview-ui 无 unTaggledChildren） |
 * | checkedChildrenIcon | — | **丢弃** |
 * | unCheckedChildrenIcon | — | **丢弃** |
 * | size | — | 丢弃 |
 * | className | className | 透传 |
 * | — | onToggle | 由 useState.event 自动注入 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'
import { Value } from '../../../src/core/value'

const SwitchMapping: MappingDef = {
  tag: 'Toggle',
  import: '@cloudsop/eview-ui/Toggle',

  transform(node: any, _ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}
    const SKIP_KEYS = new Set([
      'value', 'size',
      'checkedChildren', 'unCheckedChildren',
      'checkedChildrenIcon', 'unCheckedChildrenIcon',
      'className',
    ])

    // ─── value → toggled（双形态 + useState） ───
    // Switch 是受控组件，必须产生 useState
    //   字面量 → Value.literal（初始值为 hardcode）
    //   DataBinding → Value.computed + useState（初始值从 state.js 取值）
    if ('value' in props) {
      const val = props.value

      if (val && typeof val === 'object' && val.type === 'binding') {
        // DataBinding → ComputedValue + useState
        // 值进 state.js，useState 初始值引用 initialState.{accessPath}
        outputProps.toggled = Value.computed({
          path: val.path,
          pathType: val.pathType ?? 'absolute',
          accessPath: val.accessPath,
          containsJSX: false,
          useState: {
            event: 'onToggle',
            extractor: (setter) => `(checked) => ${setter}(checked)`,
          },
          transform: (rawValue) => !!rawValue,
        })
      } else {
        // 字面量 → Value.literal + useState
        outputProps.toggled = Value.literal({
          value: val ?? false,
          useState: {
            event: 'onToggle',
            extractor: (setter) => `(checked) => ${setter}(checked)`,
          },
        })
      }
    }

    // ─── checkedChildren / unCheckedChildren / *Icon — 丢弃（eview-ui 无对应 prop） ───

    // ─── size 丢弃（Switch API 不接受 size） ───

    // ─── className 透传 ───
    if (props.className) {
      outputProps.className = props.className
    }

    // ─── 透传剩余 prop ───
    for (const [key, value] of Object.entries(props)) {
      if (!SKIP_KEYS.has(key)) {
        outputProps[key] = value as PropValue
      }
    }

    return {
      props: outputProps,
      children: null,
    }
  },
}

export default SwitchMapping
