// Subtype → bridge 注入映射的配置表（主进程版）。
// ★ Source of truth：packages/app/octoapp/pages/make/utils/subtype-config.ts。
// 渲染端 FeatureFlag（boolean | { enabled, editOnly }）在此处按 isFeatureEnabled 语义展平为
// boolean（editOnly 只影响 UI 可见性，与 bridge 注入无关，直接取 enabled）。
// 两处配置需同步修改：新增 subtype 或调整 features 时，同时更新本文件与渲染端配置，
// 否则缺条目会静默回退 _default，注入渲染端已关闭的 bridge（drift 无报错，只能靠
// bridge-config.test.ts 断言捕获）。

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
      drawEdit: false,
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

  // fastui 预览卡片：页面跑在 127.0.0.1 跨域 dev server 上，不经 local:// 协议加载，
  // 此条目不实际生效（inert），仅与渲染端 subtype-config.ts 保持对齐防止漂移。
  fastui: {
    features: {
      refresh: true,
      modeToggle: false,
      viewport: true,
      localEdit: false,
      modelEdit: false,
      drawEdit: false,
      canvasEdit: false,
      comment: false,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  prototype: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: true,
      modelEdit: false,
      drawEdit: false,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  components: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: true,
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

  page: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: true,
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
      localEdit: false,
      modelEdit: true,
      drawEdit: false,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  gts: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: true,
      drawEdit: false,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  'gts-ep': {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: true,
      drawEdit: false,
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
      localEdit: false,
      modelEdit: true,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  demoedit: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: true,
      drawEdit: true,
      canvasEdit: true,
      comment: true,
      archive: true,
      download: true,
      fullscreen: true,
    }
  },

  // 3d: generate-3d-scene skill 产物（index.3d.html 离线预览容器）。
  // 3D 编辑器内置在 iframe 里（URL ?edit=1 由产物 entry.ts 分流挂载），3D 元素非 DOM 组件，
  // localEdit/modelEdit/drawEdit/canvasEdit 全关 → 不注入 edit/modelEdit/resourceCollector bridge；
  // 保留 comment（标注 feature 开启）与 snapshot（归档截图依赖）。
  '3d': {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: false,
      drawEdit: false,
      canvasEdit: false,
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
  
  const editOrModelEdit = features.localEdit || features.drawEdit || features.canvasEdit || features.modelEdit
  const customBridges = rendering?.customBridges || []
  
  return {
    injectSandbox: true,
    injectAnnotate: true,
    injectPicker: true,
    injectInspect: true,
    
    injectEdit: editOrModelEdit,
    injectEditStyle: editOrModelEdit,
    injectModelEdit: features.modelEdit,
    
    injectComment: features.comment && !customBridges.includes('custom-comment'),
    injectSnapshot: (features.drawEdit || features.archive) && !customBridges.includes('custom-snapshot'),
    injectResourceCollector: features.canvasEdit,
    
    customBridges
  }
}