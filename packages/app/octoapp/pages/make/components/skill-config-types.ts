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