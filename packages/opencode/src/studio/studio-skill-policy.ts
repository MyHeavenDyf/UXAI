import path from "path"

export function disabled(directory: string, octoConfig: string) {
  // Match the dedicated directory, including Windows drive/UNC path semantics.
  const paths = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(octoConfig) ? path.win32 : path.posix
  return paths.relative(paths.resolve(octoConfig, "sessions"), paths.resolve(directory)) === ""
}

export * as StudioSkillPolicy from "./studio-skill-policy"
