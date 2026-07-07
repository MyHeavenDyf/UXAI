export function directoryHeader(directory: string): Record<string, string> {
  return { "x-opencode-directory": encodeURIComponent(directory) }
}