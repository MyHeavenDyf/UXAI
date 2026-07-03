export function stripFollowUpTags(text: string): string {
  return text.replace(/<follow-up[\s\S]*?<\/follow-up>\s*/gi, "")
}
