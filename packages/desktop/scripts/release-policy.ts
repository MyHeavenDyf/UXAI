import { readFileSync } from "node:fs"

export function parseForceUpdate(value?: string) {
  if (value === undefined || value.trim() === "false") return false
  if (value.trim() === "true") return true
  throw new Error("OCTO_FORCE_UPDATE must be true or false")
}

export const forceUpdate = parseForceUpdate(process.env.OCTO_FORCE_UPDATE ??
  readFileSync(new URL("../release-notes.env", import.meta.url), "utf8")
    .match(/(?:^|\n)OCTO_FORCE_UPDATE=([^\r\n]*)/)?.[1])
