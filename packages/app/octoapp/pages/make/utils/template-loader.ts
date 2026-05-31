export type TemplateEntry = {
  id: string
  title: string
  mode: string
  category: string
}

const templateModules = import.meta.glob<{ default: string }>(
  "../../../templates/*/SKILL.md",
  { query: "?raw", import: "default", eager: false },
)

function idFromPath(path: string): string {
  const m = path.match(/templates\/([^/]+)\//)
  return m ? m[1] : ""
}

let indexCache: TemplateEntry[] | null = null

export function loadTemplateIndex(): TemplateEntry[] {
  if (indexCache) return indexCache
  const ids = new Set<string>()
  for (const key of Object.keys(templateModules)) {
    const id = idFromPath(key)
    if (id) ids.add(id)
  }
  indexCache = [...ids].sort().map((id) => ({
    id,
    title: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    mode: "prototype",
    category: "misc",
  }))
  return indexCache
}

const templateCache = new Map<string, string>()

export async function loadTemplate(id: string): Promise<string | null> {
  const hit = templateCache.get(id)
  if (hit !== undefined) return hit

  const key = `../../../templates/${id}/SKILL.md`
  const loader = templateModules[key]
  if (!loader) return null

  const mod = await loader()
  const content = typeof mod === "string" ? mod : mod.default ?? ""
  templateCache.set(id, content)
  return content
}
