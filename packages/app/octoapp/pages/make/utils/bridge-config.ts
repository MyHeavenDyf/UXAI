import { getSubtypeConfig, isFeatureEnabled } from './subtype-config'

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

  const localEdit = isFeatureEnabled(features.localEdit)
  const drawEdit = isFeatureEnabled(features.drawEdit)
  const canvasEdit = isFeatureEnabled(features.canvasEdit)
  const editEnabled = localEdit || drawEdit || canvasEdit

  return {
    injectSandbox: true,
    injectAnnotate: true,
    injectPicker: true,
    injectInspect: true,

    injectEdit: editEnabled,
    injectEditStyle: editEnabled,

    injectComment: isFeatureEnabled(features.comment),
    injectSnapshot: drawEdit || isFeatureEnabled(features.archive),
    injectResourceCollector: canvasEdit,

    customBridges: config.rendering?.customBridges || []
  }
}