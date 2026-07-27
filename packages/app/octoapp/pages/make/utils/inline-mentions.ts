export type MentionPart =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; name: string; label: string; text: string }

export interface MentionEntity {
  name: string
  label: string
}

export function buildMentionParts(
  text: string,
  mentions: MentionEntity[],
): MentionPart[] | null {
  if (!text || mentions.length === 0) return null

  const parts: MentionPart[] = []
  let index = 0
  let found = false

  while (index < text.length) {
    let matched: { entity: MentionEntity; start: number; token: string } | null = null

    for (const entity of mentions) {
      const token = `@${entity.name}`
      let start = text.indexOf(token, index)

      while (start !== -1 && !isMentionBoundary(text, start)) {
        start = text.indexOf(token, start + 1)
      }

      if (start !== -1 && start === index) {
        if (!matched || token.length > matched.token.length) {
          matched = { entity, start, token }
        }
      } else if (start !== -1 && matched === null) {
        matched = { entity, start, token }
      }
    }

    if (!matched) {
      const nextMention = findNextMentionStart(text, mentions, index)
      if (nextMention === -1) {
        parts.push({ kind: 'text', text: text.slice(index) })
        break
      }
      parts.push({ kind: 'text', text: text.slice(index, nextMention) })
      index = nextMention
      continue
    }

    if (matched.start > index) {
      parts.push({ kind: 'text', text: text.slice(index, matched.start) })
    }

    parts.push({
      kind: 'mention',
      name: matched.entity.name,
      label: matched.entity.label,
      text: matched.token,
    })
    found = true
    index = matched.start + matched.token.length
  }

  return found ? coalesceTextParts(parts) : null
}

function isMentionBoundary(text: string, start: number): boolean {
  if (start === 0) return true
  return /[\s([{"']/.test(text[start - 1] ?? '')
}

function findNextMentionStart(
  text: string,
  mentions: MentionEntity[],
  from: number,
): number {
  let minStart = -1
  for (const entity of mentions) {
    const token = `@${entity.name}`
    let start = text.indexOf(token, from)
    while (start !== -1 && !isMentionBoundary(text, start)) {
      start = text.indexOf(token, start + 1)
    }
    if (start !== -1 && (minStart === -1 || start < minStart)) {
      minStart = start
    }
  }
  return minStart
}

function coalesceTextParts(parts: MentionPart[]): MentionPart[] {
  const result: MentionPart[] = []
  for (const part of parts) {
    const last = result[result.length - 1]
    if (last && last.kind === 'text' && part.kind === 'text') {
      last.text += part.text
    } else {
      result.push(part)
    }
  }
  return result
}