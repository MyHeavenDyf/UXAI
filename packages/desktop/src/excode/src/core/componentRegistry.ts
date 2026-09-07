/**
 * ComponentRegistry — 组件转换注册中心（简化版）
 *
 * 管理 MappingDef 注册和 transform 调用。
 * 新架构中 MappingDef 精简为 tag + import + defaults + transform 四个字段。
 */

import type { MappingDef, TransformContext, TransformResult } from './componentMapping'
import type { BuildNode } from './nodeTypes'

export class ComponentRegistry {
  #mappingDefs: Map<string, MappingDef> = new Map()

  /**
   * 加载 MappingDef 集合
   */
  loadMappings(mappings: Record<string, MappingDef>): void {
    for (const [component, def] of Object.entries(mappings)) {
      this.#mappingDefs.set(component, def)
    }
  }

  /**
   * 转换一个节点
   *
   * 流程：
   *   1. defaults 填充 node.props
   *   2. 调用 transform（如果存在）
   *   3. 合并返回值（tag/import override 静态字段）
   *
   * @param componentName A2UI 组件名
   * @param node          原始节点数据
   * @param ctx           transform 上下文
   * @returns             TransformResult 或 null
   */
  transform(
    componentName: string,
    node: any,
    ctx: TransformContext
  ): TransformResult | null {
    const def = this.#mappingDefs.get(componentName)

    // ── 未注册组件 → 小写开头为 HTML，大写开头为 A2UI 默认兜底 ──
    if (!def) {
      if (!node || !node.props) return null
      if (/^[a-z]/.test(componentName)) {
        // HTML 标签兜底
        return {
          tag: componentName,
          props: node.props || {},
          children: node.children || null,
        }
      }
      // 大写开头 → A2UI 默认兜底
      return {
        tag: componentName,
        import: `@/components/${componentName}`,
        props: node.props || {},
        children: node.children || null,
      }
    }

    // ── 已注册组件 ──

    // 1. defaults 填充 props
    let filledProps = { ...(node.props || {}) }
    if (def.defaults) {
      for (const [k, v] of Object.entries(def.defaults)) {
        if (!(k in filledProps)) filledProps[k] = v
      }
    }

    // 2. 调用 transform（无 transform 时使用透传）
    if (typeof def.transform === 'function') {
      const schemaNode = { ...node, props: filledProps }
      const result = def.transform(schemaNode, ctx)
      if (!result) return null

      return {
        tag: result.tag ?? def.tag,
        import: result.import ?? def.import,
        props: result.props ?? filledProps,
        children: result.children,
        wrapper: result.wrapper,
        selfClosing: result.selfClosing,
        propRoute: result.propRoute,
      }
    }

    // 无 transform → 纯透传
    return {
      tag: def.tag,
      import: def.import,
      props: filledProps,
      children: node.children || null,
    }
  }

  /**
   * 查询组件是否已注册
   */
  has(componentName: string): boolean {
    return this.#mappingDefs.has(componentName)
  }

  /**
   * 统计数据
   */
  getStats(): { registeredCount: number } {
    return { registeredCount: this.#mappingDefs.size }
  }
}
