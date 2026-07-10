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