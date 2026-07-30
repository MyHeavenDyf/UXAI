/**
 * Carousel → Carousel 映射（新架构）
 *
 * A2UI Carousel → eview-react Carousel 组件。
 * 子节点通过 wrapper 标记包裹 CarouselItem。
 *
 * ## Props 对照
 *
 * | A2UI prop | eview-react prop | 处理方式 |
 * |-----------|-----------------|---------|
 * | arrows | hasArrows | 改名透传 |
 * | adaptiveHeight | — | 丢弃（eview-react 无此概念） |
 * | dotPlacement | — | 丢弃（eview-react 通过 indicator/方向控制） |
 * | className | className | 透传 |
 * | children（静态数组） | children | 每个子节点附加 CarouselItem wrapper |
 * | children（循环模板） | children | LoopNode template body 子节点附加 CarouselItem wrapper |
 *
 * ## 特殊逻辑
 *
 * - 纯透传（Carousel 不做数据转换，只加包装层）
 * - 通过 `defaults` 提供 eview-react 的合理默认值
 * - wrapper 使用 `named` 模式：`import Carousel, { CarouselItem } from '@nce/eview-react/Carousel'`
 *
 * 工厂化：接收目标组件库包名 `pkg`，构建 import 路径（含 CarouselItem wrapper），便于多库复用。
 */

import type { MappingDef, TransformContext } from '../../../src/core/componentMapping'
import type { PropValue, ImportSpec } from '../../../src/core/valueTypes'
import type { RegularNode, LoopNode } from '../../../src/core/nodeTypes'

export function createCarouselMapping(pkg: string): MappingDef {
  /**
   * CarouselItem 包裹层定义
   * named import: import { CarouselItem } from '{pkg}/Carousel'
   */
  const CAROUSEL_ITEM_WRAPPER = {
    kind: 'component' as const,
    tag: 'CarouselItem',
    import: { source: `${pkg}/Carousel`, named: true } as ImportSpec,
  }

  return {
    tag: 'Carousel',
    import: `${pkg}/Carousel`,

    defaults: {
      autoplay: true,
      autoplayInterval: 3000,
      indicator: true,
      repeat: true,
    },

    transform(node: any, _ctx: TransformContext) {
      const props = node.props || {}

      // ─── props 映射 ───
      const outputProps: Record<string, PropValue> = {}

      // arrows → hasArrows
      if (props.arrows !== undefined) {
        outputProps.hasArrows = props.arrows as PropValue
      }

      // className 透传
      if (props.className) {
        outputProps.className = props.className as PropValue
      }

      // ─── children 处理 ───
      let children: RegularNode[] | LoopNode | null | undefined

      if (!node.children) {
        children = null
      } else if (Array.isArray(node.children)) {
        // 静态子节点：每个附加 CarouselItem wrapper
        children = node.children.map((child: RegularNode) => ({
          ...child,
          wrapper: CAROUSEL_ITEM_WRAPPER,
        }))
      } else if (typeof node.children === 'object' && node.children.kind === 'loop') {
        // 循环模板：template body 中的节点附加 wrapper
        const loop = node.children as LoopNode
        const newTemplate = {
          ...loop.template,
          body: loop.template.body.map((bodyNode: RegularNode) => ({
            ...bodyNode,
            wrapper: CAROUSEL_ITEM_WRAPPER,
          })),
        }
        children = {
          ...loop,
          template: newTemplate,
        } as LoopNode
      }

      return {
        props: outputProps,
        children: children ?? undefined,
      }
    },
  }
}
