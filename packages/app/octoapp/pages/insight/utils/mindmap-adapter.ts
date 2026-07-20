import { stripCodeFence, tryParseJSON } from "./detect"

type MindmapNode = { name?: string; children?: MindmapNode[] }

export function uxrJsonToMarkdown(text: string): string | null {
  const json = tryParseJSON(stripCodeFence(text))
  if (json == null) return null

  const roots = collectRoots(json)
  if (roots.length === 0) return null

  return roots.map((node) => renderNode(node, 0)).join("\n")
}

/**
 * 是否值得出"思维导图"卡 = 是否真能渲染成 markmap。
 * 检测与渲染共用 uxrJsonToMarkdown 这一条规则 —— 避免"判定命中但渲染为空"的漂移
 * (历史 bug:detect.hasMindmapShape 对 {nodes:[]} / 空 mindmaps 判 true,但 collectRoots 收不到根 → 渲染失败兜底)。
 */
export function isMindmapJSON(text: string): boolean {
  return uxrJsonToMarkdown(text) != null
}

/** Octo 内网白板导入格式:节点用 `text` 字段(思维导图用 `name`),children 结构一致。 */
export type OctoWhiteboardNode = { text: string; children?: OctoWhiteboardNode[] }

/**
 * 思维导图 JSON → Octo 白板导入 JSON。
 * 与渲染/判定共用 collectRoots 同一条规则(覆盖 {name,children} / {mindmaps:[…]} / {nodes:[…]} / 顶层裸树),
 * 只把节点字段 name → text 递归改写。
 * 多根(mindmaps 可能多棵树)时,Octo 白板根为单对象,用 centerTitle 合成一个中心主题包住所有根。
 * 无法解析(非导图 shape)→ 返回 null,由调用方决定报错文案。
 */
export function uxrJsonToOctoWhiteboard(text: string, centerTitle = "思维导图"): OctoWhiteboardNode | null {
  const json = tryParseJSON(stripCodeFence(text))
  if (json == null) return null

  const roots = collectRoots(json)
  if (roots.length === 0) return null

  if (roots.length === 1) return toOctoNode(roots[0])
  return { text: (centerTitle.trim() || "思维导图"), children: roots.map(toOctoNode) }
}

// leaf 节点不带 children 键(与 Octo 示例一致:{ "text": "子主题" });与 renderNode 的空节点兜底对齐((空))。
function toOctoNode(node: MindmapNode): OctoWhiteboardNode {
  const text = (node.name ?? "(空)").trim() || "(空)"
  const children = Array.isArray(node.children) ? node.children.map(toOctoNode) : []
  return children.length > 0 ? { text, children } : { text }
}

// declared = 是否处在「显式 mindmap 容器」(mindmaps / nodes 数组)内。
// 容器内的元素是服务端**已声明**的导图节点(内网 MCP 强契约),沿用旧的宽松规则(name 或 children 任一即收),
// 保证 MCP 返回的确定格式渲染**零变化**;只有顶层裸对象(无容器包裹)才收紧,杜绝普通 JSON 误判(见下)。
function collectRoots(json: unknown, declared = false): MindmapNode[] {
  if (Array.isArray(json)) {
    return json.flatMap((item) => collectRoots(item, declared))
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    // 内网 MCP mindmap 工具 shape:{ mindmaps: [{name, children}, ...] }
    // 以 mindmaps 字段为准:数组里每个元素自带根节点(name + children),递归展开即可。
    // file 字段(若存在)忽略 —— 不作为额外的"文件根节点",避免在 mindmap 树顶部加一层冗余节点。
    // 命中容器即认定其元素为已声明导图节点(declared=true 透传)。
    if (Array.isArray(obj.mindmaps)) {
      return obj.mindmaps.flatMap((m) => collectRoots(m, true))
    }
    if (Array.isArray(obj.nodes)) {
      return obj.nodes.flatMap((n) => collectRoots(n, true))
    }
    // 已声明容器内的节点:旧规则(name 或 children 任一),不动 MCP 行为。
    if (declared) {
      if (typeof obj.name === "string" || Array.isArray(obj.children)) {
        return [obj as MindmapNode]
      }
      return []
    }
    // 顶层裸对象(无 mindmaps/nodes 包裹):必须带 children 数组(树边)才算导图根。
    // 收紧动机:旧规则「有 name 字段即根」会把 { name, version, ... } 这类普通配置 JSON 误判成
    // 单根思维导图(渲出一个孤零零的标题)。业界一致 —— 导图由 父→children 树关系定义,而非单个 name 字段
    // (jsMind 用 format:"node_tree" + topic/children;mind-elixir 用 nodeData.children)。详见 output-renderers.md §2.2。
    if (Array.isArray(obj.children)) {
      return [obj as MindmapNode]
    }
  }
  return []
}

function renderNode(node: MindmapNode, depth: number): string {
  const name = (node.name ?? "(空)").trim() || "(空)"
  const prefix = depth === 0 ? "# " : "  ".repeat(depth - 1) + "- "
  const line = prefix + name
  const children = Array.isArray(node.children) ? node.children : []
  const childLines = children.map((c) => renderNode(c, depth + 1))
  return [line, ...childLines].join("\n")
}
