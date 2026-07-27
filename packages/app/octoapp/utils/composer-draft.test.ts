import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { readDraft, resetDrafts, type DraftPersist } from "./composer-draft"
import { useComposerDraft } from "@/hooks/use-composer-draft"

// 注:bun test 把 solid-js 解析到 dist/server.js(无响应式,memo 只算一次),因此断言一律打在
// **存储层**(readDraft)而不是 hook 返回的 memo 上 —— memo 只是 3 行透传,正确性归 Solid;
// 真正要守的是分桶路由、落盘过滤、恢复、LRU 释放这些本模块自己的逻辑。

type Att = {
  id: string
  previewUrl?: string
  filename: string
  status: "uploading" | "done" | "error"
  path?: string
}

type Extra = { presetId: string } | null

const att = (over: Partial<Att> & Pick<Att, "id">): Att => ({
  filename: `${over.id}.docx`,
  status: "done",
  ...over,
})

// insight 那套编解码的等价物:只落 done 态,previewUrl 不落盘、恢复时按 path 重建
const PERSIST: DraftPersist<Att, Extra> = {
  saveAttachment: (a) => (a.status === "done" ? { id: a.id, filename: a.filename, path: a.path } : undefined),
  loadAttachment: (raw) => {
    const stored = raw as { id?: string; filename?: string; path?: string } | null
    if (!stored?.id || !stored.filename) return undefined
    return {
      id: stored.id,
      filename: stored.filename,
      path: stored.path,
      status: "done",
      previewUrl: stored.path ? `local://${stored.path}` : undefined,
    }
  },
  saveExtra: (extra) => extra ?? undefined,
  loadExtra: (raw) => (raw as Extra) ?? null,
}

function mount(persist?: DraftPersist<Att, Extra>, scope = "test") {
  const [session, setSession] = createSignal<string | undefined>(undefined)
  let dispose!: () => void
  const draft = createRoot((d) => {
    dispose = d
    return useComposerDraft<Att, Extra>({ scope, session, emptyExtra: null, persist })
  })
  return { draft, setSession, dispose }
}

const bucket = (session?: string) => `test/${session ?? "__new__"}`
const storageKey = (session?: string) => `octo:composer-draft:${bucket(session)}`
const text = (session?: string) => readDraft(bucket(session))?.text ?? ""
const atts = (session?: string) => (readDraft(bucket(session))?.attachments ?? []) as Att[]
const extra = (session?: string) => (readDraft(bucket(session))?.extra ?? null) as Extra

let revoked: string[] = []
const realRevoke = URL.revokeObjectURL

beforeEach(() => {
  resetDrafts()
  localStorage.clear()
  revoked = []
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }
})

afterEach(() => {
  URL.revokeObjectURL = realRevoke
})

describe("分桶", () => {
  it("切会话不清内容,各会话互不串台", () => {
    const { draft, setSession, dispose } = mount()

    setSession("a")
    draft.setText("写给 A 的")
    draft.setAttachments([att({ id: "f1" })])
    draft.setExtra({ presetId: "key_findings" })

    setSession("b")
    draft.setText("写给 B 的")

    expect(text("a")).toBe("写给 A 的")
    expect(atts("a").map((a) => a.id)).toEqual(["f1"])
    expect(extra("a")).toEqual({ presetId: "key_findings" })

    expect(text("b")).toBe("写给 B 的")
    expect(atts("b")).toHaveLength(0)
    expect(extra("b")).toBeNull()

    dispose()
  })

  it("欢迎页(未建会话)是独立的一桶,不与任何会话共享", () => {
    const { draft, setSession, dispose } = mount()

    draft.setText("还没建会话时写的")
    setSession("a")
    draft.setText("A 的")

    expect(text(undefined)).toBe("还没建会话时写的")
    expect(text("a")).toBe("A 的")

    dispose()
  })

  it("正文清空 + 无附件 + extra 回到初值 → 空桶被删除,不留落盘记录", () => {
    const { draft, setSession, dispose } = mount(PERSIST)

    setSession("a")
    draft.setText("x")
    expect(readDraft(bucket("a"))).toBeDefined()
    expect(localStorage.getItem(storageKey("a"))).not.toBeNull()

    draft.setText("")
    expect(readDraft(bucket("a"))).toBeUndefined()
    expect(localStorage.getItem(storageKey("a"))).toBeNull()

    dispose()
  })
})

describe("异步上传回调的写回归属", () => {
  it("发起上传后切走会话,回调仍写回原桶(不会永远停在 uploading)", () => {
    const { draft, setSession, dispose } = mount()

    setSession("a")
    const owner = draft.key()
    draft.setAttachments([att({ id: "f1", status: "uploading" })])

    // 上传还没回来,用户切到别的会话;回调按发起时快照的 owner 写回
    setSession("b")
    draft.updateAttachments(owner, (prev) =>
      prev.map((a) => (a.id === "f1" ? { ...a, status: "done" as const, path: "/tmp/f1.docx" } : a)),
    )

    expect(atts("a")[0]).toMatchObject({ id: "f1", status: "done", path: "/tmp/f1.docx" })
    expect(atts("b")).toHaveLength(0) // 没串到当前所视会话

    dispose()
  })
})

describe("首次发送的整桶改名", () => {
  it("欢迎页桶改名到新会话:附件与常驻 extra 都跟过去,旧桶与旧落盘记录清空", () => {
    const { draft, dispose } = mount(PERSIST)

    draft.setText("") // 发送时正文已清
    draft.setAttachments([att({ id: "f1", path: "/tmp/f1.docx" })])
    draft.setExtra({ presetId: "mindmap" })

    draft.rename(draft.key(), draft.keyOf("ses_new"))

    expect(atts("ses_new").map((a) => a.id)).toEqual(["f1"])
    expect(extra("ses_new")).toEqual({ presetId: "mindmap" })
    expect(localStorage.getItem(storageKey("ses_new"))).not.toBeNull()

    expect(readDraft(bucket(undefined))).toBeUndefined()
    expect(localStorage.getItem(storageKey(undefined))).toBeNull()

    dispose()
  })
})

describe("发送消费", () => {
  it("清空附件并释放 objectURL / 原 File 引用,正文与 extra 不动(chip 常驻)", () => {
    const { draft, setSession, dispose } = mount()

    setSession("a")
    draft.files.set("f1", new File(["x"], "f1.png"))
    draft.setText("排队中的下一条")
    draft.setAttachments([att({ id: "f1", previewUrl: "blob:preview-1" })])
    draft.setExtra({ presetId: "key_findings" })

    draft.consumeAttachments(draft.key())

    expect(atts("a")).toHaveLength(0)
    expect(revoked).toEqual(["blob:preview-1"])
    expect(draft.files.get("f1")).toBeUndefined()
    expect(text("a")).toBe("排队中的下一条")
    expect(extra("a")).toEqual({ presetId: "key_findings" })

    dispose()
  })
})

describe("落盘与恢复", () => {
  it("只落 done 态附件:uploading / error 不落盘(它们活不过整页刷新)", () => {
    const { draft, setSession, dispose } = mount(PERSIST)

    setSession("a")
    draft.setAttachments([
      att({ id: "ok", path: "/tmp/ok.docx" }),
      att({ id: "pending", status: "uploading" }),
      att({ id: "bad", status: "error" }),
    ])

    const stored = JSON.parse(localStorage.getItem(storageKey("a"))!)
    expect(stored.attachments.map((a: { id: string }) => a.id)).toEqual(["ok"])
    // 内存里三条都还在,只是不落盘
    expect(atts("a")).toHaveLength(3)

    dispose()
  })

  it("整桶只剩上传中 / 失败的附件 → 不留空的落盘记录", () => {
    const { draft, setSession, dispose } = mount(PERSIST)

    setSession("a")
    draft.setAttachments([att({ id: "pending", status: "uploading" })])

    expect(readDraft(bucket("a"))).toBeDefined()
    expect(localStorage.getItem(storageKey("a"))).toBeNull()

    dispose()
  })

  it("整页刷新后恢复正文 / done 附件 / extra,previewUrl 按 path 重建", () => {
    const first = mount(PERSIST)
    first.setSession("a")
    first.draft.setText("刷新前写的")
    first.draft.setAttachments([att({ id: "f1", path: "/tmp/f1.docx", previewUrl: "blob:gone-after-reload" })])
    first.draft.setExtra({ presetId: "mindmap" })
    first.dispose()

    // 模拟整页刷新:内存全丢,localStorage 还在
    resetDrafts()
    const second = mount(PERSIST)

    expect(text("a")).toBe("刷新前写的")
    expect(extra("a")).toEqual({ presetId: "mindmap" })
    expect(atts("a")[0]).toMatchObject({
      id: "f1",
      status: "done",
      previewUrl: "local:///tmp/f1.docx", // objectURL 没了,按 path 重建
    })

    second.dispose()
  })

  it("落盘记录损坏 / 版本不符 → 丢弃且清掉,不炸恢复流程", () => {
    localStorage.setItem(storageKey("broken"), "{ not json")
    localStorage.setItem(storageKey("old"), JSON.stringify({ v: 0, at: 1, text: "旧版本", attachments: [] }))

    const { dispose } = mount(PERSIST)

    expect(readDraft(bucket("broken"))).toBeUndefined()
    expect(readDraft(bucket("old"))).toBeUndefined()
    expect(localStorage.getItem(storageKey("broken"))).toBeNull()
    expect(localStorage.getItem(storageKey("old"))).toBeNull()

    dispose()
  })

  it("不登记 persist 的 scope 纯内存:不落盘、刷新后不恢复", () => {
    const first = mount()
    first.setSession("a")
    first.draft.setText("不该落盘")
    expect(localStorage.getItem(storageKey("a"))).toBeNull()
    first.dispose()

    resetDrafts()
    const second = mount()
    expect(text("a")).toBe("")
    second.dispose()
  })
})

describe("LRU 上限", () => {
  it("超过 20 桶淘汰最久未写的,并释放其 objectURL / 原 File 引用 / 落盘记录", () => {
    const { draft, setSession, dispose } = mount(PERSIST)

    // 第 1 桶带一个图片附件,用来验证淘汰时资源被释放
    setSession("s0")
    draft.files.set("f0", new File(["x"], "f0.png"))
    draft.setAttachments([att({ id: "f0", path: "/tmp/f0.png", previewUrl: "blob:oldest" })])

    for (let i = 1; i <= 20; i++) {
      setSession(`s${i}`)
      draft.setText(`draft ${i}`)
    }

    expect(readDraft(bucket("s0"))).toBeUndefined()
    expect(revoked).toContain("blob:oldest")
    expect(draft.files.get("f0")).toBeUndefined()
    expect(localStorage.getItem(storageKey("s0"))).toBeNull()

    // 后写的桶都还在
    expect(text("s1")).toBe("draft 1")
    expect(text("s20")).toBe("draft 20")

    dispose()
  })

  it("上限按 scope 独立计:活跃模块写满 20 桶不会挤掉别的模块的草稿", () => {
    const other = mount(undefined, "another")
    other.setSession("keep-me")
    other.draft.setText("别的模块的草稿")

    const { draft, setSession, dispose } = mount()
    for (let i = 0; i <= 25; i++) {
      setSession(`s${i}`)
      draft.setText(`draft ${i}`)
    }

    expect(readDraft("another/keep-me")?.text).toBe("别的模块的草稿")

    dispose()
    other.dispose()
  })

  it("重写某个桶会刷新它的最近使用,不会被后来的写入挤掉", () => {
    const { draft, setSession, dispose } = mount()

    setSession("s0")
    draft.setText("最早建、但一直在改")

    for (let i = 1; i <= 19; i++) {
      setSession(`s${i}`)
      draft.setText(`draft ${i}`)
    }
    setSession("s0")
    draft.setText("又改了一次") // 刷新 s0 的最近使用

    setSession("s20")
    draft.setText("draft 20") // 触发淘汰:该出局的是 s1 而不是 s0

    expect(text("s0")).toBe("又改了一次")
    expect(readDraft(bucket("s1"))).toBeUndefined()

    dispose()
  })
})
