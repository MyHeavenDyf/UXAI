export type SubtypeCapabilities = {
  features: {
    refresh: boolean
    modeToggle: boolean
    viewport: boolean
    localEdit: boolean
    drawEdit: boolean
    canvasEdit: boolean
    comment: boolean
    archive: boolean
    history: boolean
    download: boolean
    fullscreen: boolean
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
      localEdit: false,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
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
      localEdit: true,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      history: false,
      download: true,
      fullscreen: true,
    },
  },

  _default: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      history: true,
      download: true,
      fullscreen: true,
    },
    history: {
      files: ['.'],
    },
  }
}

export function getSubtypeConfig(subtype?: string): SubtypeCapabilities {
  if (!subtype) return SUBTYPE_CONFIG._default
  return SUBTYPE_CONFIG[subtype] ?? SUBTYPE_CONFIG._default
}