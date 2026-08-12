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
  const { features } = config
  
  const editEnabled = features.localEdit || features.drawEdit || features.canvasEdit
  
  return {
    injectSandbox: true,
    injectAnnotate: true,
    injectPicker: true,
    injectInspect: true,
    
    injectEdit: editEnabled,
    injectEditStyle: editEnabled,
    
    injectComment: features.comment,
    injectSnapshot: features.drawEdit || features.archive,
    injectResourceCollector: features.canvasEdit,
    
    customBridges: config.rendering?.customBridges || []
  }
}