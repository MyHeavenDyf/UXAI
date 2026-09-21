import { readFileSync } from "node:fs"

const content = readFileSync(new URL("../release-notes.env", import.meta.url), "utf8")
const match = content.match(/(?:^|\n)OCTO_RELEASE_NOTES=(?:"([\s\S]*?)"|([^\r\n]*))/)

export const releaseNotes = (process.env.OCTO_RELEASE_NOTES ?? match?.[1] ?? match?.[2])?.replaceAll("\r\n", "\n").trim()

if (!releaseNotes) throw new Error("OCTO_RELEASE_NOTES is required")
