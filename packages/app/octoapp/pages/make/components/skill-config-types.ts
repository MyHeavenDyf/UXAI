export type PanelSkill = {
  label: string
  description?: string
  path?: string
  enable?: boolean
  id?: number
}

export type SkillConfigEntry = {
  name?: string
  skillName?: string
  description?: string
  import?: boolean
  type?: string
}

export type SkillConfig = {
  skill?: Record<string, SkillConfigEntry>
  agent?: Record<string, string[]>
  panel?: {
    octo_insight?: PanelSkill[]
    octo_make?: PanelSkill[]
    octo_studio?: PanelSkill[]
    common?: PanelSkill[]
  }
}

/**
 * 查 skillName → displayName 的映射。
 *
 * skill_config.json 的 `skill` 字典有两种写法:
 *  ① key = skillName,entry.skillName 缺失(如 design-basics)
 *  ② key = skillName,entry.skillName 也填了(如 html-prototype)
 * 两种情况下 dict key 都是 skillName。displayName 在 entry.name,缺失时回退到 dict key。
 *
 * 后端 skill 工具的 input.name = params.name = skillName,前端 panel[i].label 也是 skillName。
 * UI 显示(菜单项、@chip、卡片)统一走 displayName,模型调用走 skillName。
 */
export function lookupDisplayName(
  skillData: Record<string, SkillConfigEntry> | undefined,
  skillName: string | undefined,
): string | undefined {
  if (!skillName || !skillData) return undefined
  for (const [key, entry] of Object.entries(skillData)) {
    if (!entry || typeof entry !== "object") continue
    const matches = entry.skillName === skillName || key === skillName
    if (!matches) continue
    return entry.name ?? key
  }
  return undefined
}