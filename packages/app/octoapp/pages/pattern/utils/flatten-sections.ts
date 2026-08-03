// 兜底归一化：保证 intent 的 sections 为一维扁平结构，解决 proto_intent 偶发输出嵌套 section 的问题。

type Section = {
  id?: string
  patternId?: string | number
  data?: Record<string, unknown> | null
  sections?: Section[]
  [key: string]: unknown
}

function isLeafSection(s: Section): boolean {
  const hasPatternId = s.patternId !== undefined && s.patternId !== null
  const hasData =
    s.data != null && typeof s.data === "object" && Object.keys(s.data as Record<string, unknown>).length > 0
  return hasPatternId || hasData
}

export function flattenSections(sections: unknown): { sections: Section[]; changed: boolean } {
  const list = Array.isArray(sections) ? (sections as Section[]) : []
  const out: Section[] = []
  let changed = false

  for (const s of list) {
    if (!s || typeof s !== "object") continue
    const nested = Array.isArray((s as Section).sections) ? ((s as Section).sections as Section[]) : undefined

    if (nested) {
      changed = true
      const rest = { ...s } as Section
      delete rest.sections
      const child = flattenSections(nested)
      if (child.changed) changed = true
      if (isLeafSection(rest)) out.push(rest)
      out.push(...child.sections)
    } else if (isLeafSection(s as Section)) {
      out.push(s as Section)
    } else {
      changed = true
    }
  }

  return { sections: out, changed }
}
