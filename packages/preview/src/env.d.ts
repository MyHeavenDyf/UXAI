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