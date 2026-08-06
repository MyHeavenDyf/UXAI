export type SubtypeCapabilities = {
  features: {
    refresh: boolean
    modeToggle: boolean
    viewport: boolean
    localEdit: boolean
    drawEdit: boolean
    canvasEdit: boolean
    download: boolean
    fullscreen: boolean
  }
  rendering?: {
    designSystem?: string
    injectStyles?: boolean
  }
}

export const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  shadcn: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      drawEdit: false,
      canvasEdit: true,
      download: true,
      fullscreen: true,
    },
    rendering: {
      designSystem: 'shadcn',
      injectStyles: true,
    }
  },
  
  _default: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      drawEdit: true,
      canvasEdit: true,
      download: true,
      fullscreen: true,
    }
  }
}

export function getSubtypeConfig(subtype?: string): SubtypeCapabilities {
  if (!subtype) return SUBTYPE_CONFIG._default
  return SUBTYPE_CONFIG[subtype] ?? SUBTYPE_CONFIG._default
}