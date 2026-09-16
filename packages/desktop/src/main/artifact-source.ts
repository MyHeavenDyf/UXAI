import { createHash, randomUUID } from "node:crypto"
import { writeFile, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/** Local-only version receipt. No URI/account; a download failure never becomes a script write. */
export async function recordArtifactSource(file: string, digest: string, pending: boolean) {
  const name = basename(file)
  const key = createHash("sha256")
    .update(process.platform === "win32" ? name.toLowerCase() : name)
    .digest("hex")
  const dest = join(dirname(file), `.artifact-source-${key}.json`)
  const temp = `${dest}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ file: name, digest, pending, recordedAt: Date.now() }))
  await rename(temp, dest)
}
