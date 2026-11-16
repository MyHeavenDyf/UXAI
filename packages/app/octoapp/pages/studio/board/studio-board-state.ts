export type BoardReference = { sourceID: string; title: string; image: string }

export type BoardCard = {
  id: string
  title: string
  prompt: string
  status: "draft" | "running" | "succeeded"
  progress: number
  image?: string
  inputs?: BoardReference[]
}

export type BoardEdge = { id: string; sourceID: string; targetID: string }

export function boardReferences(cards: BoardCard[], edges: BoardEdge[], targetID: string): BoardReference[] {
  const target = cards.find((card) => card.id === targetID)
  if (target?.inputs) return target.inputs
  return edges
    .filter((edge) => edge.targetID === targetID)
    .flatMap((edge) => {
      const source = cards.find((card) => card.id === edge.sourceID)
      return source?.image ? [{ sourceID: source.id, title: source.title, image: source.image }] : []
    })
}

export function boardConnectionError(cards: BoardCard[], edges: BoardEdge[], sourceID: string, targetID: string) {
  if (sourceID === targetID) return "不能连接到自身"
  const source = cards.find((card) => card.id === sourceID)
  const target = cards.find((card) => card.id === targetID)
  if (!source?.image || source.status !== "succeeded") return "请先生成上游图片"
  if (!target || target.status !== "draft") return "只能连接到尚未生成的图片卡片"
  if (edges.some((edge) => edge.sourceID === sourceID && edge.targetID === targetID)) return "这两张卡片已经连接"
  const visited = new Set<string>()
  const reachesSource = (id: string): boolean => {
    if (id === sourceID) return true
    if (visited.has(id)) return false
    visited.add(id)
    return edges.filter((edge) => edge.sourceID === id).some((edge) => reachesSource(edge.targetID))
  }
  if (reachesSource(targetID)) return "不能创建循环连接"
  return undefined
}
