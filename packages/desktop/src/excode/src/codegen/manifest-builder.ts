/**
 * manifest-builder — 从产物文件列表构建 CodeManifest（tree.json + content.json）
 *
 * 用途（见 PLAN-manifest.md）：设计平台右侧「推荐代码」面板需要
 *   1. 下拉框展示 src 目录树（tree）—— 故 manifest 只收 `src/` 下的文件，
 *      根级模板文件（.gitignore / package.json / vite.config.ts 等）不进 manifest；
 *   2. 代码视图展示文件内容（content）；
 *   3. 左侧框选预览节点时，下拉自动切到该节点所属文件——靠 .tsx 叶子上的
 *      `nodes`（emitted 的 A2UI 基础 id 列表）反查。
 *
 * manifest 不进 outputFiles（write-output.ts 注释明确 outputFiles 必须纯净），
 * 由 downloadHuiCode 在 runPipeline 后单独构建并返回。
 *
 * 一次 downloadHuiCode 调用 = 一个 lib → manifest 天然单 lib（lib 前缀是归档侧
 * buildArchiveSrc 加的，不在本管线产物 path 里）。
 */

import type { GeneratedFile } from '../pipeline/pipeline-context'

export interface ManifestNode {
  /**
   * 显示名，恒等于 value（保留独立字段是为展示层预留语义：未来可改成文件名等更友好形态，
   * 当前与 value 一致 = 节点路径）。
   */
  label: string
  /**
   * 标识：所有节点都有。
   *   目录=目录路径（如 'src/pages'）；叶子=产物路径（= content key，如 'src/pages/foo/index.tsx'）。
   * 建树时按 value 唯一定位目录节点（抗重名段，如不同父级下的 'components'）。
   */
  value: string
  /** 仅 .tsx/.jsx 叶子：该文件 emitted 的 A2UI 基础 id 列表；无则不带 */
  nodes?: string[]
  /** 有则文件夹节点；无则文件叶子 */
  children?: ManifestNode[]
}

export interface CodeManifest {
  /** src 目录树（按 path 的 / 段构建） */
  tree: ManifestNode[]
  /** 全量文件：value(路径) → content */
  content: Record<string, string>
}

/** 判断是否为带 nodes 的叶子扩展（.tsx/.jsx 产物文件） */
function isJsxLeaf(path: string): boolean {
  return path.endsWith('.tsx') || path.endsWith('.jsx')
}

/**
 * 从产物文件列表构建 manifest。
 *   - 只收 `src/` 目录下的文件（平台「推荐代码」下拉是 src 目录树；
 *     根级模板文件 .gitignore / package.json / vite.config.ts 等不进 manifest）。
 *   - content：{ [f.path]: f.content }（src/ 下全量）
 *   - tree：按 path 的 / 段建目录树；过滤后 src 为唯一顶层目录节点。
 *     节点统一结构：所有节点都有 value（目录=目录路径 / 叶子=产物路径），
 *     有 children 即文件夹节点、无则文件叶子；.tsx/.jsx 叶子从 f.nodeIds 取 nodes。
 */
export function buildManifest(files: GeneratedFile[]): CodeManifest {
  // 只保留 src/ 下的文件（路径分隔符恒为 /，管线产物 path 不含 lib 前缀、不用 path.join）
  const srcFiles = files.filter(f => f.path.startsWith('src/'))

  const content: Record<string, string> = {}
  for (const f of srcFiles) {
    content[f.path] = f.content
  }

  const tree: ManifestNode[] = []

  for (const f of srcFiles) {
    const segments = f.path.split('/')
    // 叶子：label=value=完整 path（不去前缀，与 content key 同一）
    const leaf: ManifestNode = { label: f.path, value: f.path }
    if (isJsxLeaf(f.path) && f.nodeIds && f.nodeIds.length > 0) {
      leaf.nodes = f.nodeIds
    }

    // 无目录段（顶层文件，如 index.html / package.json）→ 直接挂 root
    // （过滤到 src/ 后此分支不会触发——src/ 至少两段；保留兜底）
    if (segments.length === 1) {
      tree.push(leaf)
      continue
    }

    // 沿目录段创建/查找目录节点，末段挂 leaf
    let dir = tree
    let acc = '' // 累计目录路径，作目录节点 value（也是查找键，抗重名段）
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      acc = acc ? `${acc}/${seg}` : seg
      let next = dir.find(n => n.value === acc && n.children !== undefined)
      if (!next) {
        next = { label: acc, value: acc, children: [] }
        dir.push(next)
      }
      dir = next.children!
    }
    dir.push(leaf)
  }

  // 常规文件目录排序：文件夹优先，再字母序（不区分大小写）；逐层递归。
  sortTree(tree)

  return { tree, content }
}

/**
 * 递归排序目录树节点：文件夹（有 children）排在文件前，组内按 label 字母序
 * （不区分大小写）。匹配常规文件浏览器（Windows Explorer / VS Code 默认）的目录排序。
 */
function sortTree(nodes: ManifestNode[]): void {
  nodes.sort((a, b) => {
    const aDir = !!a.children
    const bDir = !!b.children
    if (aDir !== bDir) return aDir ? -1 : 1 // 文件夹优先
    const al = a.label.toLowerCase()
    const bl = b.label.toLowerCase()
    return al < bl ? -1 : al > bl ? 1 : 0
  })
  for (const n of nodes) {
    if (n.children) sortTree(n.children)
  }
}
