import { getSubtypeConfig } from './subtype-config'

export type BridgeInjectConfig = {
  injectSandbox: boolean
  injectAnnotate: boolean
  injectEdit: boolean
  injectEditStyle: boolean
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
    
    injectComment: features.comment && !customBridges.includes('custom-comment'),
    injectSnapshot: (features.drawEdit || features.archive) && !customBridges.includes('custom-snapshot'),
    injectResourceCollector: features.canvasEdit,
    
    customBridges
  }
}