export type FeatureFlag = boolean | { enabled: boolean; editOnly?: boolean }

export type SubtypeCapabilities = {
  features: {
    refresh: FeatureFlag
    modeToggle: FeatureFlag
    viewport: FeatureFlag
    localEdit: FeatureFlag
    drawEdit: FeatureFlag
    canvasEdit: FeatureFlag
    comment: FeatureFlag
    archive: FeatureFlag
    history: FeatureFlag
    download: FeatureFlag
    fullscreen: FeatureFlag
  }
  history?: {
    files: string[]
  }
  rendering?: {
    designSystem?: string
    injectStyles?: boolean
    customBridges?: string[]
  }
}

export const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  shadcn: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      drawEdit: { enabled: true, editOnly: true },
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: false,
      download: true,
      fullscreen: true,
    },
    rendering: {
      designSystem: 'shadcn',
      injectStyles: true,
      customBridges: ['shadcn-component-editor'],
    }
  },

  url: {
    features: {
      refresh: true,
      modeToggle: false,
      viewport: false,
      localEdit: false,
      drawEdit: false,
      canvasEdit: false,
      comment: false,
      archive: false,
      history: false,
      download: false,
      fullscreen: true,
    }
  },

  prototype: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: { enabled: true, editOnly: true },
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
    },
    history: {
      files: ['./data.js'],
    },
  },

  _default: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: { enabled: true, editOnly: true },
      drawEdit: { enabled: true, editOnly: true },
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
    },
    history: {
      files: ['.'],
    },
  }
}

/** 解析 FeatureFlag：返回是否启用 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return typeof flag === "boolean" ? flag : flag.enabled
}

/** 解析 FeatureFlag：返回是否只在预览模式 */
export function isFeatureEditOnly(flag: FeatureFlag): boolean {
  return typeof flag === "boolean" ? false : !!flag.editOnly
}

export function getSubtypeConfig(subtype?: string): SubtypeCapabilities {
  if (!subtype) return SUBTYPE_CONFIG._default
  return SUBTYPE_CONFIG[subtype] ?? SUBTYPE_CONFIG._default
}
