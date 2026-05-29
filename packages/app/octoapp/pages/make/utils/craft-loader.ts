const craftModules = import.meta.glob<{ default: string }>(
  "../../crafts/*.md",
  { query: "?raw", import: "default", eager: false },
)

const cache = new Map<string, string>()

export async function loadCraft(slug: string): Promise<string | null> {
  const hit = cache.get(slug)
  if (hit !== undefined) return hit

  const key = `../../crafts/${slug}.md`
  const loader = craftModules[key]
  if (!loader) return null

  const mod = await loader()
  const content = typeof mod === "string" ? mod : mod.default ?? ""
  cache.set(slug, content)
  return content
}

export async function loadCrafts(slugs: string[]): Promise<string> {
  const results = await Promise.all(slugs.map(loadCraft))
  return results.filter((c): c is string => c !== null).join("\n\n---\n\n")
}
