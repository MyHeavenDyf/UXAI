import type { PanelSkill } from "@/pages/make/components/skill-config-types"

export interface SkillConfig {
  panel?: {
    common?: PanelSkill[]
    octo_make?: PanelSkill[]
    [key: string]: PanelSkill[] | undefined
  }
}

/**
 * Load skills from a specific panel key
 * - If panelKey is 'common', returns common skills
 * - If panelKey is other, returns skills excluding common skills
 * 
 * @param panelKey - The key to extract from panel (e.g., 'octo_make', 'common')
 * @returns Array of PanelSkill
 * 
 * @example
 * // Get platform skills (automatically excluding common)
 * const platformSkills = await loadSkillsFromPanel("octo_make")
 * 
 * @example
 * // Get custom skills
 * const customSkills = await loadSkillsFromPanel("common")
 */
export async function loadSkillsFromPanel(panelKey: string): Promise<PanelSkill[]> {
  try {
    const api = (window as unknown as { api?: { getSkillConfig?: () => Promise<SkillConfig> } }).api
    const config = await api?.getSkillConfig?.()
    
    if (panelKey === "common") {
      return config?.panel?.common ?? []
    }
    
    const skills = config?.panel?.[panelKey] ?? []
    const commonLabels = new Set((config?.panel?.common ?? []).map(s => s.label))
    return skills.filter(s => !commonLabels.has(s.label))
  } catch (err) {
    console.error(`[loadSkillsFromPanel] Failed to load skills for ${panelKey}:`, err)
    return []
  }
}