import type { MentionAttrs } from '../components/prosemirror-editor/schema'

export function processMentions(text: string, mentions: MentionAttrs[]): { processed: string; display: string } {
  let processedText = text
  let displayText = text
  const skillCommands: string[] = []
  const skillDisplays: string[] = []

  for (const sel of mentions) {
    if (sel.type === 'skill') {
      processedText = processedText.replace(`@${sel.name}`, ' ')
      const display = sel.label && sel.label !== sel.name ? `@${sel.label}` : `@${sel.name}`
      displayText = displayText.replace(`@${sel.name}`, ' ')
      skillCommands.push(`/${sel.name}`)
      skillDisplays.push(display)
    } else {
      const noun = sel.type === 'folder' ? '这个文件夹' : '这个文件'
      processedText = processedText.replace(`@${sel.name}`, ` 读取${sel.path} ${noun} `)
    }
  }

  if (skillCommands.length > 0) {
    processedText = skillCommands.join(' ') + ' ' + processedText
    displayText = skillDisplays.join(' ') + ' ' + displayText
  }

  processedText = processedText.replace(/\u200b/g, '').replace(/  +/g, ' ').trim()
  displayText = displayText.replace(/\u200b/g, '').replace(/  +/g, ' ').trim()

  return { processed: processedText, display: displayText }
}
