import { installDomPicker } from '@dom-picker/core/runtime'

export function installVueDomPicker() {
  installDomPicker({
    logPrefix: 'dom-picker-vue',
    idleHint: 'Move over Vue-rendered DOM (file:startLine:endLine)',
  })
}
