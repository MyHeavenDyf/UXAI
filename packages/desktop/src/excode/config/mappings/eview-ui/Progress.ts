/**
 * eview-ui Progress → ProgressBar 映射（bespoke）
 *
 * 与 eview-react Progress 的差异：eview-ui ProgressBar **不支持** `status` 属性，丢弃
 * （eview-react 保留 status: success/exception 映射）。
 * strokeColor→barStyle.backgroundColor、percent→current+max、showInfo→labelPosition 等逻辑
 * 与 eview-react 一致（strokeColor 转换是 eview-react 工厂已修的 bug，此处保持一致）。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-ui prop | 处理方式 |
 * |-----------|--------------|---------|
 * | percent（number） | current + max | percent→current，max 固定 100 |
 * | percent（DataBinding） | current + max | 同上，BindingValue 透传 |
 * | status | — | **丢弃**（eview-ui 不支持 status） |
 * | showInfo: false | labelPosition: 'none' | 值映射 |
 * | strokeColor | barStyle.backgroundColor | 转为 barStyle 对象 |
 * | size | — | 丢弃 |
 * | className | className | 透传 |
 *
 * 这是 eview-ui 专属 bespoke 映射（非工厂、非复用 eview-react）。import 硬编码 @cloudsop/eview-ui。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue } from '../../../src/core/valueTypes'

const ProgressMapping: MappingDef = {
  tag: 'ProgressBar',
  import: '@cloudsop/eview-ui/ProgressBar',

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

    // ─── status — 丢弃（eview-ui ProgressBar 不支持 status） ───

    // ─── showInfo → labelPosition ───
    if (props.showInfo === false) {
      outputProps.labelPosition = 'none' as PropValue
    }

    // ─── strokeColor → barStyle.backgroundColor ───
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

export default ProgressMapping
