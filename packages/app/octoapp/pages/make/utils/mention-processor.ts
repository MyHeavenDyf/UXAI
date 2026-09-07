import type { MentionAttrs } from '../components/prosemirror-editor/schema'

export function processMentions(text: string, mentions: MentionAttrs[]): { processed: string; display: string } {
  let processedText = text
  let displayText = text

  for (const sel of mentions) {
    if (sel.type === 'skill') {
      processedText = processedText.replace(`@${sel.name}`, ` /${sel.name} `)
      if (sel.label && sel.label !== sel.name) {
        displayText = displayText.replace(`@${sel.name}`, () => `@${sel.label}`)
      }
    } else {
      const noun = sel.type === 'folder' ? '这个文件夹' : '这个文件'
      processedText = processedText.replace(`@${sel.name}`, ` 读取${sel.path} ${noun} `)
    }
  }
  processedText = processedText.replace(/\u200b/g, '').replace(/  +/g, ' ').trim()

  return { processed: processedText, display: displayText }
}
