export type SharedSessionModule = "design" | "insight" | "pattern"
export type PreparedSharedSession = { token: string; agent?: string; module: SharedSessionModule }

/** Do not restore any session/files until its owning module has finished switching context. */
export async function openPreparedSharedSession<T>(input: {
  prepare: () => Promise<PreparedSharedSession>
  select: (module: SharedSessionModule) => void
  ready: (module: SharedSessionModule) => Promise<string>
  importSession: (prepared: PreparedSharedSession, directory: string) => Promise<T | undefined | null>
  open: (result: T, module: SharedSessionModule) => void
  release: (token: string) => Promise<void>
}) {
  const prepared = await input.prepare()
  try {
    input.select(prepared.module)
    const directory = await input.ready(prepared.module)
    const result = await input.importSession(prepared, directory)
    if (result) input.open(result, prepared.module)
    return result
  } finally {
    await input.release(prepared.token).catch((error) => console.warn("[octo:share] release failed", error))
  }
}
