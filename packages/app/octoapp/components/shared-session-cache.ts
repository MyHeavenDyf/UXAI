type SharedSessionRef = { sessionID: string; directory: string; agent?: string }

export function createSharedSessionCache<T extends { id: string; directory: string; agent?: string }>(input: {
  importSession: (
    uniqueId: string,
    directory: string,
    token?: string,
    operationID?: string,
  ) => Promise<SharedSessionRef | null | undefined>
  readSession: (result: SharedSessionRef) => Promise<T | undefined>
  isDeleted: (result: SharedSessionRef) => boolean
}) {
  const completed = new Map<string, SharedSessionRef>()

  return {
    invalidate(directory: string, sessionID: string) {
      for (const [key, result] of completed) {
        if (result.directory === directory && result.sessionID === sessionID) completed.delete(key)
      }
    },
    async open(
      server: string,
      uniqueId: string,
      directory: string,
      module?: string,
      token?: string,
      operationID?: string,
    ) {
      const key = JSON.stringify([server, directory, uniqueId, module])
      const cached = completed.get(key)
      if (cached && !input.isDeleted(cached)) {
        const session = await input.readSession(cached)
        if (session && completed.get(key) === cached && !input.isDeleted(cached)) {
          return { ...cached, agent: session.agent, session }
        }
      }
      completed.delete(key)
      const result = await input.importSession(uniqueId, directory, token, operationID)
      if (!result) return
      const session = await input.readSession(result)
      if (!session) throw new Error("导入的对话不存在，请重新打开分享链接")
      completed.set(key, result)
      return { ...result, agent: session.agent, session }
    },
  }
}
