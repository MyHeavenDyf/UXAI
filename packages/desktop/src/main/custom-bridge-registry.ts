type CustomBridge = {
  script: string
  style?: string
  position?: 'head' | 'body'
}

const CUSTOM_BRIDGES = new Map<string, CustomBridge>()

export function registerCustomBridge(id: string, bridge: CustomBridge) {
  CUSTOM_BRIDGES.set(id, bridge)
}

export function getCustomBridge(id: string): CustomBridge | undefined {
  return CUSTOM_BRIDGES.get(id)
}

registerCustomBridge('shadcn-component-editor', {
  script: `
(function() {
  console.log('[ShadcnBridge] Loaded')
  
  window.addEventListener('message', function(e) {
    if (e.data.type === 'od:shadcn-edit') {
      console.log('[ShadcnBridge] Edit mode:', e.data.enabled)
    }
  })
  
  document.addEventListener('click', function(e) {
    const target = e.target
    if (target && target.matches('[data-shadcn-component]')) {
      e.preventDefault()
      e.stopPropagation()
      window.parent.postMessage({
        type: 'od:shadcn-component-selected',
        component: target.getAttribute('data-shadcn-component')
      }, '*')
    }
  }, true)
})()
  `,
  style: `
[data-shadcn-component]:hover {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  cursor: pointer;
}
  `,
  position: 'body'
})

registerCustomBridge('components-theme', {
  script: `
(function() {
  console.log('[ComponentsTheme] Loaded')
  window.parent.postMessage({ type: 'od:components-theme-loaded' }, '*')
  window.addEventListener('message', function(e) {
    var d = e && e.data
    if (!d || d.type !== 'od:toggle-theme') return
    document.documentElement.classList.toggle('dark')
  })
})()
  `,
  position: 'body'
})