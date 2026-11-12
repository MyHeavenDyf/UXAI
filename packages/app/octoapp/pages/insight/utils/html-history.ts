import type { DesktopApi } from "../lib/electron-api"
import type { VersionEntry, HistoryActor } from "../../make/utils/history-store"

const queues = new Map<string, Promise<unknown>>()
let lastTimestamp = 0
const equal = (a: ArrayBuffer, b: ArrayBuffer) => {
  const bytes = new Uint8Array(b)
  return a.byteLength === b.byteLength && new Uint8Array(a).every((value, index) => value === bytes[index])
}

/** 只记录本地 HTML 本身。独立目录/UUID 防止与 Design 快照及同秒版本冲突。 */
export function createHtmlHistory(filePath: string, api: DesktopApi) {
  const path = filePath.replace(/\\/g, "/")
  const slash = path.lastIndexOf("/")
  if (slash < 0 || !/^(?:[a-z]:\/|\/)/i.test(path) || path.split("/").includes("..")) throw new Error("历史版本需要本地绝对路径")
  const directory = `${path.slice(0, slash)}/.history/${path.slice(slash + 1)}.insight`
  const key = /^[a-z]:\//i.test(path) ? path.toLowerCase() : path
  const read = async (source: string) => {
    const bytes = await api.readFileBuffer?.(source)
    if (!bytes) throw new Error("无法读取 HTML 历史文件")
    return bytes
  }
  const list = async (): Promise<VersionEntry[]> => {
    if (!api.listDirectory || !api.dirExists) throw new Error("当前环境不支持历史版本")
    if (!await api.dirExists(directory)) return []
    return (await api.listDirectory(directory)).flatMap(entry => {
      const name = entry.path.replace(/\\/g, "/").split("/").pop() ?? ""
      const match = /^(\d+)\.(init|user|agent)\.([a-f0-9-]+)\.html\.ready$/.exec(name)
      return entry.type === "file" && match
        ? [{ id: name.slice(0, -6), folderPath: `${directory}/${name.slice(0, -6)}`, timestamp: Number(match[1]), actor: match[2] as HistoryActor }] : []
    }).sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
  }
  const find = async (bytes: ArrayBuffer, entries: VersionEntry[]) => {
    for (const entry of entries) {
      if (equal(bytes, await read(entry.folderPath))) return entry
    }
  }
  const write = async (bytes: ArrayBuffer, actor: HistoryActor) => {
    if (!api.writeFileBuffer) throw new Error("当前环境不支持保存历史版本")
    const timestamp = Math.max(Date.now(), lastTimestamp + 1)
    lastTimestamp = timestamp
    const id = `${timestamp}.${actor}.${crypto.randomUUID()}.html`
    const folderPath = `${directory}/${id}`
    await api.writeFileBuffer(folderPath, bytes)
    if (!equal(bytes, await read(folderPath))) throw new Error("历史版本保存校验失败")
    // 验证完成才发布条目，失败或中断的写入不进入可恢复列表。
    await api.writeFileBuffer(`${folderPath}.ready`, new Uint8Array([1]).buffer)
    return { id, folderPath, timestamp, actor }
  }
  const serial = <T>(task: () => Promise<T>) => {
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
    queues.set(key, pending)
    void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key) }).catch(() => {})
    return pending
  }
  return {
    list,
    record: (actor: HistoryActor = "user") => serial(async () => {
      const bytes = await read(path)
      const entries = await list()
      // 恢复旧版本及重新打开文件时，复用内容匹配的已有版本。
      return await find(bytes, entries) ?? write(bytes, entries.length ? actor : "init")
    }),
    restore: (id: string) => serial(async () => {
      const entries = await list()
      const entry = entries.find(item => item.id === id)
      if (!entry) throw new Error("历史版本不存在，请刷新后重试")
      const target = await read(entry.folderPath)
      const current = await read(path)
      if (equal(current, target)) return
      // 恢复前先留存当前文件；备份失败时不得覆盖原文件。
      if (!await find(current, entries)) await write(current, "user")
      if (!api.writeFileBuffer) throw new Error("当前环境不支持恢复历史版本")
      await api.writeFileBuffer(path, target)
      if (!equal(target, await read(path))) throw new Error("恢复校验失败，请从历史版本重试")
    }),
  }
}
