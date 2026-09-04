type SubtypeCapabilities = {
  features: {
    refresh: boolean
    modeToggle: boolean
    viewport: boolean
    localEdit: boolean
    modelEdit: boolean
    drawEdit: boolean
    canvasEdit: boolean
    comment: boolean
    archive: boolean
    download: boolean
    fullscreen: boolean
  }
  rendering?: {
    designSystem?: string
    injectStyles?: boolean
    customBridges?: string[]
  }
}

const SUBTYPE_CONFIG: Record<string, SubtypeCapabilities> = {
  shadcn: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: false,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
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
      modelEdit: false,
      drawEdit: false,
      canvasEdit: false,
      comment: false,
      archive: false,
      download: false,
      fullscreen: true,
    }
  },

  components: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: false,
      drawEdit: false,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    },
    rendering: {
      customBridges: ['components-theme'],
    },
  },

  _default: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      modelEdit: false,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  demo: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      modelEdit: true,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  }
}

function getSubtypeConfig(subtype?: string): SubtypeCapabilities {
  if (!subtype) return SUBTYPE_CONFIG._default
  return SUBTYPE_CONFIG[subtype] ?? SUBTYPE_CONFIG._default
}

export type BridgeInjectConfig = {
  injectSandbox: boolean
  injectAnnotate: boolean
  injectEdit: boolean
  injectEditStyle: boolean
  injectModelEdit: boolean
  injectInspect: boolean
  injectPicker: boolean
  injectComment: boolean
  injectSnapshot: boolean
  injectResourceCollector: boolean
  customBridges: string[]
}

export function getBridgeConfigForSubtype(subtype?: string): BridgeInjectConfig {
  const config = getSubtypeConfig(subtype)
  const { features, rendering } = config
  
  const editEnabled = features.localEdit || features.drawEdit || features.canvasEdit
  const customBridges = rendering?.customBridges || []
  
  return {
    injectSandbox: true,
    injectAnnotate: true,
    injectPicker: true,
    injectInspect: true,
    
    injectEdit: editEnabled,
    injectEditStyle: editEnabled,
    injectModelEdit: features.modelEdit,
    
    injectComment: features.comment && !customBridges.includes('custom-comment'),
    injectSnapshot: (features.drawEdit || features.archive) && !customBridges.includes('custom-snapshot'),
    injectResourceCollector: features.canvasEdit,
    
    customBridges
  }
}