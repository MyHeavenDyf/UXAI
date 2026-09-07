/**
 * fileKeys — 文件单元 key 工具
 *
 * 文件单元（FileUnit）的 key 在整个管线中三处使用：
 *   state-builder    → 识别当前走树时归属哪个文件
 *   tree-finalizer   → 路由 propRoute / extract 产生的 const
 *   file-assembler   → 按文件单元组装产物
 *
 * 统一从这里取 key，保证三处一致。
 */

import type { ExtractNode } from './nodeTypes'

export const fileKeyOf = {
  /** 主页面文件 */
  main: (): string => 'main',

  /** splitMeta 提取出的模块文件（purpose: 'module'） */
  module: (componentName: string): string => `modules/${componentName}`,

  /** 循环模板文件（purpose: 'component'） */
  loopTemplate: (componentName: string): string => `components/${componentName}`,

  /** 从 ExtractNode 推导其文件 key */
  extract: (node: ExtractNode): string =>
    node.purpose === 'module'
      ? `modules/${node.componentName}`
      : `components/${node.componentName}`,
}
