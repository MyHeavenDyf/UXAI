/**
 * Badge → Badge 映射（新架构）
 *
 * A2UI Badge → eview-react Badge 组件。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | count（字面量 string/number） | content | 改名透传 |
 * | count（DataBinding） | content | 保持 BindingValue 原样（纯改名，不需转换） |
 * | overflowCount | max | 改名 |
 * | status: success/processing/default/error/warning | status: success/default/... | processing→default，其余同名 |
 * | color: #HEX | badgeStyle.backgroundColor | 转为 style 对象 |
 * | dot | dot | 透传 |
 * | offset | offset | 透传 |
 * | showZero | showZero | 透传 |
 * | className | className | 透传 |
 * | children（A2UI 有且仅有一个子节点） | children | 透传，Badge 包裹子元素 |
 *
 * ## 特殊逻辑
 *
 * - count DataBinding 为纯改名不改值，保持 BindingValue 原样
 * - color → badgeStyle.backgroundColor，与已有的 badgeStyle 合并
 * - status processing 在 eview-react 中无对应枚举，降级为 default
 * - children 透传（Badge 需要包裹一个子元素）
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径，便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/component-mapping'
import type { PropValue } from '../../../src/core/value-types'

// ─── 值映射 ───

const STATUS_MAP: Record<string, string> = {
  processing: 'default',
  success: 'success',
  default: 'default',
  error: 'error',
  warning: 'warning',
}

// ─── Badge 映射定义 ───

export function createBadgeMapping(pkg: string): MappingDef {
  return {
    tag: 'Badge',
    import: `${pkg}/Badge`,

    transform(node: any, ctx: TransformContext) {
      const props = node.props || {}
      const outputProps: Record<string, PropValue> = {}

      // 显性处理每个 A2UI prop：A2UI Badge 的 props 是封闭集合
      // (color/count/dot/offset/overflowCount/showZero/status/className)，不做兜底透传。

      // ─── count → content（双形态） ───
      if ('count' in props) {
        // DataBinding → 保持原样；字面量 → 直接赋值
        outputProps.content = props.count as PropValue
      }

      // ─── overflowCount → max ───
      if (props.overflowCount !== undefined) {
        outputProps.max = props.overflowCount
      }

      // ─── status 值映射 ───
      if (props.status) {
        outputProps.status = STATUS_MAP[props.status] ?? props.status
      }

      // ─── color → badgeStyle.backgroundColor ───
      if ('color' in props && typeof props.color === 'string') {
        const existingStyle = outputProps.badgeStyle
          ? { ...(outputProps.badgeStyle as any) }
          : {}
        outputProps.badgeStyle = {
          ...existingStyle,
          backgroundColor: props.color,
        } as any
      }

      // ─── dot / offset / showZero 透传 ───
      if (props.dot !== undefined) outputProps.dot = props.dot
      if (props.offset !== undefined) outputProps.offset = props.offset
      if (props.showZero !== undefined) outputProps.showZero = props.showZero

      // ─── className 透传 ───
      if (props.className) outputProps.className = props.className

      // 不做剩余兜底透传：A2UI Badge 的 props 已逐项显性处理。

      return {
        props: outputProps,
        // children 透传（Badge 需要包裹子元素）
      }
    },
  }
}
