import { getSubtypeConfig, isFeatureEnabled } from './subtype-config'

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
  const { features } = config

  const localEdit = isFeatureEnabled(features.localEdit)
  const modelEdit = isFeatureEnabled(features.modelEdit)
  const drawEdit = isFeatureEnabled(features.drawEdit)
  const canvasEdit = isFeatureEnabled(features.canvasEdit)
  const editEnabled = localEdit || drawEdit || canvasEdit || modelEdit
  const customBridges = config.rendering?.customBridges || []

  return {
    injectSandbox: true,
    injectAnnotate: true,
    injectPicker: true,
    injectInspect: true,

    injectEdit: editEnabled,
    injectEditStyle: editEnabled,
    injectModelEdit: modelEdit,

    injectComment: isFeatureEnabled(features.comment) && !customBridges.includes('custom-comment'),
    injectSnapshot: (drawEdit || isFeatureEnabled(features.archive)) && !customBridges.includes('custom-snapshot'),
    injectResourceCollector: canvasEdit,

    customBridges
  }
}