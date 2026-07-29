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
 * | strokeColor | barStyle.backgroundColor | 转为 barStyle 对象（不透传 strokeColor） |
 * | size | — | 丢弃 |
 * | className | className | 透传 |
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'

export function createProgressMapping(pkg: string): MappingDef {
  return {
    tag: 'ProgressBar',
    import: `${pkg}/ProgressBar`,

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

      // ─── strokeColor → barStyle.backgroundColor（eview-react ProgressBar 用 barStyle，不接 strokeColor） ───
      if (props.strokeColor !== undefined) {
        const existing = outputProps.barStyle ? { ...(outputProps.barStyle as any) } : {}
        outputProps.barStyle = { ...existing, backgroundColor: props.strokeColor } as any
      }

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
}
