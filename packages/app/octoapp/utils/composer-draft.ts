import { createSignal, untrack } from "solid-js"

/**
 * 输入区草稿存储 —— per 会话分桶,跨会话 / 跨顶层 tab / 跨重启存活
 *
 * 解决的问题:各模块自实现的 composer(insight / make / pattern / studio)把正文、附件、附加态
 * 都放在页面组件的 signal 里,于是
 *   - 切会话:同一个路由组件换 params.id,组件不卸载但 signal 是页面级单例,只能清空;
 *   - 切顶层 tab(chat / cowork / make / studio):路由整页卸载,signal 一并销毁。
 * 两种情况用户都会丢正在写的内容。上游 chat 不丢,是因为它把草稿放在路由之上的分桶 store
 * (context/prompt.tsx,per (dir, sessionID) + LRU + 落盘);本模块是同款结构的兄弟实现,
 * 数据模型换成「textarea 正文 + Attachment[] + 页面自定义附加态」。
 *
 * 与上游的一处刻意分歧:上游走 utils/persist 的 persisted(),它要 usePlatform() 与 SolidJS owner,
 * 因此必须 Provider 化、且桌面端是异步存储(要 ready 门闸,否则首帧空、还可能覆盖用户已键入的字)。
 * 本模块直接用同步 localStorage —— 与 make 的 prompt 草稿、两处 chat-width 同款做法,桌面端已验证 ——
 * 换来「import 即用、无 Provider、无异步门闸、无首帧闪烁」。代价是不与桌面 store 统一,可接受:
 * 只存元数据(文件名 / 本地路径 / S3 url),不存任何 blob,20 个桶撑死几 KB。
 *
 * 注意:模块级 createSignal 没有 SolidJS owner,但只持有纯数据、无 timer / 订阅,无需 onCleanup;
 * 在反应式上下文里读 readDraft() 会自动追踪变化。
 */

/**
 * 草稿对附件的最小要求:id 用来关联原 File 引用,previewUrl 用来释放 objectURL。
 * 各页面的 Attachment 结构不同(insight 有 path/url/status,make 有 source …),
 * 完整类型由调用方作为泛型传入,本层只认这两个字段。
 */
export type DraftAttachment = { id: string; previewUrl?: string }

export type ComposerDraft<A extends DraftAttachment = DraftAttachment, E = unknown> = {
  text: string
  attachments: A[]
  /** 页面自定义的附加输入态(insight = MCP chip 选择;不需要就传 undefined) */
  extra: E
}

/**
 * 落盘编解码。不提供 = 该 scope 纯内存(切会话 / 切 tab 保留,整页刷新重置)。
 *
 * 为什么编解码由页面给:能不能落盘是**语义**问题而非结构问题 —— 只有页面知道哪些附件态跨得过
 * 重启(insight:只有 done 态跨得过,uploading 物理上不可能,error 态的重试依赖进程内的原 File 引用),
 * 以及缩略图该怎么重建。本层只负责调用与存取。
 */
export type DraftPersist<A extends DraftAttachment = DraftAttachment, E = unknown> = {
  /** 附件 → 可序列化形态;返回 undefined = 这条不落盘 */
  saveAttachment: (attachment: A) => unknown
  /** 反序列化;返回 undefined = 丢弃这条(落盘字段已不合法 / 恢复了也没用) */
  loadAttachment: (raw: unknown) => A | undefined
  /** 附加态的存取;不给则 extra 不落盘 */
  saveExtra?: (extra: E) => unknown
  loadExtra?: (raw: unknown) => E
}

type AnyDraft = ComposerDraft<DraftAttachment>
// 注册表要同时容纳各页面不同的 A / E,泛型在这一层必然被擦除;any 只出现在此边界,不外泄。
type AnyPersist = DraftPersist<any, any>

/** 落盘记录(每桶一条 localStorage 项) */
type StoredDraft = {
  /** schema 版本:字段不兼容变更时递增,旧记录直接丢弃(草稿丢一次可接受,不值得写迁移) */
  v: number
  /** 最后写入时刻:重启后据此还原 LRU 顺序 */
  at: number
  text: string
  attachments: unknown[]
  extra?: unknown
}

const STORAGE_PREFIX = "octo:composer-draft:"
const STORAGE_VERSION = 1

/** 每个 scope 最多保留多少个桶(LRU),对齐上游 context/prompt.tsx 的 MAX_PROMPT_SESSIONS。
 *  按 scope 而非全局计:多个模块共用本 store,全局计会让活跃模块把别的模块的草稿挤掉。 */
const MAX_DRAFTS = 20

const [drafts, setDrafts] = createSignal<Record<string, AnyDraft>>({})

/** 附件原 File 引用(重传用):id 是 uuid、全局唯一,不必分桶;不进 Attachment 类型以免污染渲染 */
const rawFiles = new Map<string, File>()

/** scope → 落盘编解码;没登记的 scope 纯内存 */
const persisters = new Map<string, AnyPersist>()

/** 已读过盘的 scope:页面重新挂载(切 tab 回来)时内存里就是最新的,不能再读盘覆盖 */
const hydrated = new Set<string>()

/**
 * 登记一个模块的草稿 scope,并在首次登记时把该 scope 已落盘的草稿同步读回内存。
 * 幂等:重复调用(页面重新挂载)只登记、不重复读盘。
 */
export function registerDraftScope(scope: string, persist?: AnyPersist): void {
  if (persist) persisters.set(scope, persist)
  if (hydrated.has(scope)) return
  hydrated.add(scope)
  if (persist) hydrate(scope, persist)
}

/** reactive:读一个桶(不存在返回 undefined,由上层回落到空草稿) */
export function readDraft(key: string): AnyDraft | undefined {
  return drafts()[key]
}

/** 写入 / 覆盖一个桶;顺带把它置为最近使用(超额时淘汰最久未写的桶) */
export function writeDraft(key: string, draft: AnyDraft): void {
  setDrafts((all) => {
    const { [key]: _previous, ...rest } = all
    return evict({ ...rest, [key]: draft }, key)
  })
  persist(key, draft)
}

/** 丢弃一个桶(含落盘记录);**不释放**附件资源 —— 内容可能正被发送消费,释放由消费方决定 */
export function dropDraft(key: string): void {
  setDrafts((all) => {
    if (!(key in all)) return all
    const { [key]: _removed, ...rest } = all
    return rest
  })
  removeItem(STORAGE_PREFIX + key)
}

/**
 * 整桶改名。用于「欢迎页写的草稿 → 刚建出来的真实会话」:会话是发送那一刻才创建的,
 * 待发送附件要留给本次发送消费,常驻的附加态(如 MCP chip)也得跟着进新会话名下。
 */
export function renameDraft(from: string, to: string): void {
  if (from === to) return
  // untrack:改名是命令式操作,不该让调用方(可能在 effect 里)订阅上整张草稿表
  const moving = untrack(() => drafts()[from])
  if (!moving) return
  setDrafts((all) => {
    const { [from]: _moved, [to]: _replaced, ...rest } = all
    return evict({ ...rest, [to]: moving }, to)
  })
  removeItem(STORAGE_PREFIX + from)
  persist(to, moving)
}

/** 释放这批附件占用的资源:图片缩略图 objectURL + 重传用的原 File 引用 */
export function disposeAttachments(list: readonly DraftAttachment[]): void {
  for (const attachment of list) {
    // 非 blob: 的 url(恢复出来的 local:// / https://)revoke 是 no-op,无需分支
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    rawFiles.delete(attachment.id)
  }
}

/** 附件原 File 引用表(重传用):按附件 id 存取 */
export const draftFiles = {
  get: (id: string) => rawFiles.get(id),
  set: (id: string, file: File) => {
    rawFiles.set(id, file)
  },
  delete: (id: string) => {
    rawFiles.delete(id)
  },
}

/**
 * 仅测试用:清空**内存**状态(草稿 / File 引用 / scope 登记)。
 * 刻意不动 localStorage —— 测试要靠「清内存、留盘」来模拟整页刷新;要连盘一起清由测试自己
 * localStorage.clear()。
 */
export function resetDrafts(): void {
  setDrafts({})
  rawFiles.clear()
  persisters.clear()
  hydrated.clear()
}

// ── 内部 ────────────────────────────────────────────────────────────

/** 桶 key 形如 `<scope>/<bucket>`(见 hooks/use-composer-draft) */
function scopeOf(key: string): string {
  const slash = key.indexOf("/")
  return slash === -1 ? key : key.slice(0, slash)
}

/**
 * 同 scope 内超过 MAX_DRAFTS 时,按插入顺序(= 最久未写)淘汰,淘汰前释放该桶附件资源。
 * keep(本次写入的桶)永不淘汰。别的 scope 的桶不参与计数也不会被挤掉。
 */
function evict(all: Record<string, AnyDraft>, keep: string): Record<string, AnyDraft> {
  const scope = scopeOf(keep)
  const siblings = Object.keys(all).filter((key) => scopeOf(key) === scope)
  let size = siblings.length
  if (size <= MAX_DRAFTS) return all
  const next = { ...all }
  for (const key of siblings) {
    if (size <= MAX_DRAFTS) break
    if (key === keep) continue
    disposeAttachments(next[key].attachments)
    delete next[key]
    removeItem(STORAGE_PREFIX + key)
    size--
  }
  return next
}

function persist(key: string, draft: AnyDraft): void {
  const codec = persisters.get(scopeOf(key))
  if (!codec) return

  const attachments: unknown[] = []
  for (const attachment of draft.attachments) {
    const raw = codec.saveAttachment(attachment)
    if (raw !== undefined) attachments.push(raw)
  }
  const extra = codec.saveExtra?.(draft.extra)

  // 过滤后什么都不剩(例如整桶只有上传中 / 失败的附件)→ 别留空记录
  if (!draft.text && attachments.length === 0 && extra === undefined) {
    removeItem(STORAGE_PREFIX + key)
    return
  }

  const stored: StoredDraft = { v: STORAGE_VERSION, at: Date.now(), text: draft.text, attachments, extra }
  setItem(STORAGE_PREFIX + key, JSON.stringify(stored))
}

function hydrate(scope: string, codec: AnyPersist): void {
  const prefix = STORAGE_PREFIX + scope + "/"
  let storageKeys: string[]
  try {
    storageKeys = Object.keys(localStorage)
  } catch {
    return
  }

  const restored: Array<{ key: string; at: number; draft: AnyDraft }> = []
  for (const storageKey of storageKeys) {
    if (!storageKey.startsWith(prefix)) continue
    const stored = parse(storageKey)
    if (!stored) {
      removeItem(storageKey)
      continue
    }
    const attachments: DraftAttachment[] = []
    for (const raw of stored.attachments) {
      const attachment = codec.loadAttachment(raw)
      if (attachment) attachments.push(attachment)
    }
    restored.push({
      key: storageKey.slice(STORAGE_PREFIX.length),
      at: stored.at,
      draft: { text: stored.text, attachments, extra: codec.loadExtra?.(stored.extra) },
    })
  }
  if (restored.length === 0) return

  // 旧 → 新插入,插入顺序即 LRU 顺序;超额的从最旧一头丢(连落盘记录一起)
  restored.sort((a, b) => a.at - b.at)
  const overflow = restored.length - MAX_DRAFTS
  for (let i = 0; i < overflow; i++) removeItem(STORAGE_PREFIX + restored[i].key)

  setDrafts((all) => {
    const next = { ...all }
    for (const entry of restored.slice(Math.max(0, overflow))) {
      // 内存里已有的桶更新(页面在本进程内已经写过),不拿盘上的旧值盖掉
      if (entry.key in next) continue
      next[entry.key] = entry.draft
    }
    return next
  })
}

function parse(storageKey: string): StoredDraft | undefined {
  const raw = getItem(storageKey)
  if (raw === null) return undefined
  try {
    const value = JSON.parse(raw) as StoredDraft
    if (!value || value.v !== STORAGE_VERSION) return undefined
    if (typeof value.text !== "string" || !Array.isArray(value.attachments)) return undefined
    return { ...value, at: typeof value.at === "number" ? value.at : 0 }
  } catch {
    return undefined
  }
}

// localStorage 在隐私模式 / 配额耗尽时会抛;草稿丢失不该影响输入本身,一律吞掉。
function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 配额 / 隐私模式:降级为纯内存草稿 */
  }
}

function removeItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 同上 */
  }
}
