/**
 * Progress → ProgressBar 映射（新架构）
 *
 * A2UI Progress → eview-react ProgressBar 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | percent（number） | current + max | percent→current，max 固定 100 |
 * | percent（DataBinding） | current + max | 同上，BindingValue 透传 |
 * | status: success | status: success | 值映射 |
 * | status: exception | status: exception | 值映射 |
 * | status: normal/active | — | 丢弃 |
 * | showInfo: false | labelPosition: 'none' | 值映射 |
 * | strokeColor | strokeColor | 透传 |
 * | size | — | 丢弃 |
 * | className | className | 透传 |
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'

const ProgressMapping: MappingDef = {
  tag: 'ProgressBar',
  import: '@nce/eview-react/ProgressBar',

  transform(node: any, _ctx: TransformContext) {
    const props = node.props || {}
    const outputProps: Record<string, PropValue> = {}
    const SKIP_KEYS = new Set(['percent', 'status', 'showInfo', 'strokeColor', 'size'])

    // ─── percent → current + max ───
    if (props.percent !== undefined) {
      const pct = props.percent
      outputProps.current = (pct && typeof pct === 'object' && pct.type === 'binding')
        ? pct
        : (pct as PropValue)
    }
    outputProps.max = 100

    // ─── status ───
    if (props.status) {
      if (props.status === 'success' || props.status === 'exception') {
        outputProps.status = props.status as PropValue
      }
      // normal / active → 丢弃
    }

    // ─── showInfo → labelPosition ───
    if (props.showInfo === false) {
      outputProps.labelPosition = 'none' as PropValue
    }

    // ─── strokeColor ───
    if (props.strokeColor) outputProps.strokeColor = props.strokeColor as PropValue

    // ─── className ───
    if (props.className) outputProps.className = props.className as PropValue

    // 透传剩余
    for (const [key, value] of Object.entries(props)) {
      if (!SKIP_KEYS.has(key)) outputProps[key] = value as PropValue
    }

    return {
      props: outputProps,
      children: null,
    }
  },
}

export default ProgressMapping
