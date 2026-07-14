declare module 'virtual:test-files' {
  interface TreeNode {
    label: string
    path: string
    isDirectory: boolean
    children?: TreeNode[]
    content?: any
  }

  const treeData: TreeNode[]
  export default treeData
}

declare module '@hui/charts' {
  class HuiCharts {
    init(el: HTMLElement, config?: { renderer?: string }): void
    setSimpleOption(type: string, option: any, extra?: any): void
    render(): void
  }
  export default HuiCharts
}

declare module '@dom-picker/vue' {
  export function installVueDomPicker(): void
}

declare module '*.json' {
  const value: any
  export default value
}

declare module '*gauge-core.js' {
  export class GaugeChart {
    constructor(el: HTMLElement, options?: any)
    render(value: number): void
    destroy(): void
  }
}

declare module '*stacked-bar-core.js' {
  export class StackedBarChart {
    constructor(el: HTMLElement, options?: any)
    render(data: any[]): void
    destroy(): void
  }
}

declare module 'd3' {
  const d3: any
  export default d3
  export * from 'd3'
}

// ===== 可选依赖 @hui/icon-plus-vue 类型声明 =====
declare module '@hui/icon-plus-vue' {
  import type { Component } from 'vue'
  const iconPlus: Record<string, Component>
  export default iconPlus
  export {}
}

// 单个图标组件按需导入类型
declare module '@hui/icon-plus-vue/icons/*' {
  import type { Component } from 'vue'
  const component: Component
  export default component
}
declare const __HAS_ICONPLUS__: boolean