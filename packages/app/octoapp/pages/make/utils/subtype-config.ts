export type FeatureFlag = boolean | { enabled: boolean; editOnly?: boolean }

export type SubtypeCapabilities = {
  features: {
    refresh: FeatureFlag
    modeToggle: FeatureFlag
    viewport: FeatureFlag
    localEdit: FeatureFlag
    modelEdit: FeatureFlag
    drawEdit: FeatureFlag
    canvasEdit: FeatureFlag
    comment: FeatureFlag
    archive: FeatureFlag
    history: FeatureFlag
    download: FeatureFlag
    fullscreen: FeatureFlag
    assessment: FeatureFlag
    /** 3D 场景编辑（scene3d 产物专用；index.3d.html 是 FIXED 容器，编辑器内置在 iframe 内） */
    scene3dEdit?: FeatureFlag
  }
  history?: {
    files: string[]
    /** 每文件保留的最大版本数（不含 init），默认 50 */
    maxVersions?: number
    /** agent 一轮对话的记录粒度：'each' 每次工具写盘记一条（默认）；'turn' 整轮只记最终态一条 */
    agentTurnRecord?: 'each' | 'turn'
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
      modelEdit: false,
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: false,
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
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
      history: false,
      download: false,
      fullscreen: true,
      assessment: false,
    }
  },

  // fastui 预览卡片(SPEC-DES-005):页面是 127.0.0.1 上的跨域 dev server,没有 bridge、
  // 没有单文件源码,所以在 url 的基础上只多开分辨率切换(纯 CSS 缩放)、下载与归档
  // (下载的是整个工程的代码包,由 fastui handler 的 handleDownload 实现,SPEC-DES-007 §8;
  //  归档只归档同一个源码 zip,由 handler 的 archiveUpload 实现,SPEC-DES-007 §7)
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
      archive: { enabled: true, editOnly: true },
      history: false,
      download: true,
      fullscreen: true,
      assessment: false,
    }
  },

  prototype: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: { enabled: true, editOnly: true },
      modelEdit: false,
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['./data.js'],
    },
  },

  components: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
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
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
      /** page 是多文件产物（样式/脚本与 html 分离）：模型一次修改写多个文件再编译，
       *  按 turn 记录最终态，避免把"css 已改、html 未编译"的中间态存成可切换版本 */
      agentTurnRecord: 'turn',
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
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
      agentTurnRecord: 'turn',
    },
  },

  gts: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
      agentTurnRecord: 'turn',
    },
  },

  'gts-ep': {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: false,
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
      agentTurnRecord: 'turn',
    },
  },

  demo: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: { enabled: true, editOnly: true },
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
    },
  },

  demoedit: {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: { enabled: true, editOnly: true },
      drawEdit: { enabled: true, editOnly: true },
      canvasEdit: { enabled: true, editOnly: true },
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: { enabled: true, editOnly: true },
    },
    history: {
      files: ['.'],
    },
  },

  // 3d: generate-3d-scene skill 产物（index.3d.html 离线预览 + source/ 源码）。
  // index.3d.html 是 FIXED 容器，内置 3D 编辑器；保存复制 scene3d-changes 到剪贴板，
  // 由 host 读剪贴板包源码定位 prompt 发给 AI 回写 scene-data.json。
  // subtype 名 '3d' 来自 extractSubtypeFromFilename("index.3d.html") → "3d"
  // （与 index.gts.html → "gts" 约定一致）。
  // 不开 modelEdit（3D 元素非 DOM 组件）、不开 localEdit（不可直接改 HTML）。
  '3d': {
    features: {
      refresh: true,
      modeToggle: true,
      viewport: true,
      localEdit: false,
      modelEdit: false,
      drawEdit: false,
      canvasEdit: false,
      comment: { enabled: true, editOnly: true },
      archive: { enabled: true, editOnly: true },
      history: { enabled: true, editOnly: true },
      download: true,
      fullscreen: true,
      assessment: false,
      scene3dEdit: { enabled: true, editOnly: true },
    },
    // files 仅供文档说明；实际快照文件集由 scene3d handler 的 onHistoryTrigger 决定
    //（index.3d.html + preview/scene-data.js + source/public/scene3d/scene-data.json）。
    history: {
      files: ['.', 'preview/scene-data.js', 'source/public/scene3d/scene-data.json'],
      agentTurnRecord: 'turn',
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
