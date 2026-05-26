export type DesignSystemEntry = {
  id: string
  title: string
}

export type DesignSystemContent = {
  design: string
  tokens: string
}

// Vite glob import — lazy-loaded, each file fetched only when accessed
const designModules = import.meta.glob<{ default: string }>(
  "../../../design-systems/*/DESIGN.md",
  { query: "?raw", import: "default", eager: false },
)

const tokenModules = import.meta.glob<{ default: string }>(
  "../../../design-systems/*/tokens.css",
  { query: "?raw", import: "default", eager: false },
)

// Extract design system IDs from the glob keys
function idFromPath(path: string): string {
  const match = path.match(/design-systems\/([^/]+)\//)
  return match ? match[1] : ""
}

let indexCache: DesignSystemEntry[] | null = null

export function loadDesignSystemIndex(): DesignSystemEntry[] {
  if (indexCache) return indexCache
  const ids = new Set<string>()
  for (const key of Object.keys(designModules)) {
    const id = idFromPath(key)
    if (id) ids.add(id)
  }
  indexCache = [...ids].sort().map((id) => ({
    id,
    title: `Design System Inspired by ${id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ")}`,
  }))
  return indexCache
}

export async function loadDesignSystem(id: string): Promise<DesignSystemContent> {
  const designKey = `../../../design-systems/${id}/DESIGN.md`
  const tokensKey = `../../../design-systems/${id}/tokens.css`

  const designLoader = designModules[designKey]
  if (!designLoader) throw new Error(`Design system "${id}" not found`)

  const [designModule, tokensModule] = await Promise.all([
    designLoader(),
    tokenModules[tokensKey]?.() ?? Promise.resolve({ default: "" }),
  ])

  return {
    design: designModule.default,
    tokens: tokensModule.default,
  }
}
