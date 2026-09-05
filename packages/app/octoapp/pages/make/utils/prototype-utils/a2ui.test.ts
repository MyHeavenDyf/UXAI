import { afterEach, describe, expect, mock, test } from "bun:test"
import type { A2uiDocEntry, PrototypeSession } from "./types"
import type { SubtypeHandlerContext } from "../../subtype-handlers/types"
import {
  buildSiblingMap,
  commitA2uiDoc,
  findDocByElementId,
  findDocByRootId,
  getA2uiDataRelativePaths,
  loadA2uiData,
  loadA2uiDocs,
  persistA2uiDoc,
} from "./a2ui"

// ── 内存 fake DesktopApi：用 Map 模拟文件系统，记录写入/重命名 ─────────────
type FakeApi = NonNullable<ReturnType<SubtypeHandlerContext["getDesktopApi"]>>
function makeFs(initial: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial))
  const written: Array<{ path: string; content: string }> = []
  const renamed: Array<{ src: string; dst: string }> = []
  const api = {
    statFile: async (p: string) => {
      const c = store.get(p)
      return c === undefined ? null : { size: new TextEncoder().encode(c).byteLength }
    },
    readFileBuffer: async (p: string) => {
      const c = store.get(p)
      return c === undefined ? null : new TextEncoder().encode(c).buffer as ArrayBuffer
    },
    writeFileBuffer: async (p: string, b: ArrayBuffer) => {
      const content = new TextDecoder().decode(new Uint8Array(b))
      store.set(p, content)
      written.push({ path: p, content })
    },
    renameFile: async (src: string, dst: string) => {
      const c = store.get(src)
      if (c !== undefined) {
        store.set(dst, c)
        store.delete(src)
      }
      renamed.push({ src, dst })
    },
    dirExists: async () => false,
    listDirectory: async () => [] as Array<{ path: string; type: "file" | "directory"; size?: number }>,
    showOctoToast: mock(() => {}),
  } as unknown as FakeApi
  return { api, store, written, renamed }
}

function makeSession(api: FakeApi, opts: { filePath?: string } = {}): { session: PrototypeSession; ctx: SubtypeHandlerContext; posted: any[] } {
  const posted: any[] = []
  const ctx = {
    tab: { filePath: opts.filePath ?? "/proto/prototype.html", absoluteFilePath: opts.filePath ?? "/proto/prototype.html" },
    getDesktopApi: () => api,
    postMessageToIframe: (m: any) => { posted.push(m) },
    showOctoToast: (api as any).showOctoToast,
  } as unknown as SubtypeHandlerContext
  const session: PrototypeSession = { tabId: "t1", editing: true, ctx, messageHandler: null, a2uiDocs: [] }
  return { session, ctx, posted }
}

// 两个独立 A2UI doc（模拟混合页多节点）
const docA = {
  rootId: "notesCard",
  state: { activeKey: ["a"] },
  elements: [
    { id: "notesCard", props: { className: "card" }, children: ["title", "body"] },
    { id: "title", props: { value: "A" }, children: [] },
    { id: "body", props: {}, children: ["item"] },
    { id: "item", props: {}, children: [] },
  ],
}
const docB = {
  rootId: "chartCard",
  state: { open: true },
  elements: [
    { id: "chartCard", props: {}, children: ["cHeader", "cBody"] },
    { id: "cHeader", props: {}, children: [] },
    { id: "cBody", props: {}, children: [] },
  ],
}

const htmlSingle = `<!DOCTYPE html><html><body>
<script src="./previewdist/PreviewRenderer.js"></script>
<script>
var nodes = [{ container: '#slot', dataPath: './a2ui-data/metric-notes/metric-notes.json' }];
</script></body></html>`

const htmlMulti = `<!DOCTYPE html><html><body>
<script>
new PreviewRenderer({ container:'#a', dataPath:'./a2ui-data/a/a.json' });
new PreviewRenderer({ container:'#b', dataPath:'./a2ui-data/b/b.json' });
</script></body></html>`

const htmlLegacy = `<!DOCTYPE html><html><body><div id="app"></div></body></html>`

afterEach(() => { delete (window as any).api })

// ── getA2uiDataRelativePaths（history 文件集发现） ─────────────────────
describe("getA2uiDataRelativePaths", () => {
  test("混合页：返回 a2ui-data 下各 .json + .data.js 孪生相对路径", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.json": JSON.stringify(docA),
      "/proto/a2ui-data/metric-notes/metric-notes.data.js": `window.__A2UI_FILE_DATA__ = ${JSON.stringify(docA)};`,
    })
    const { ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const rels = await getA2uiDataRelativePaths(ctx)
    expect(rels).toContain("./a2ui-data/metric-notes/metric-notes.json")
    expect(rels).toContain("./a2ui-data/metric-notes/metric-notes.data.js")
  })
  test("混合页多节点：每个节点的 json + 孪生都纳入", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlMulti,
      "/proto/a2ui-data/a/a.json": JSON.stringify(docA),
      "/proto/a2ui-data/b/b.json": JSON.stringify(docB),
    })
    const { ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const rels = await getA2uiDataRelativePaths(ctx)
    expect(rels).toContain("./a2ui-data/a/a.json")
    expect(rels).toContain("./a2ui-data/b/b.json")
  })
  test("纯 A2UI 页（无 dataPath）→ 回退 ['./data.js']", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlLegacy,
      "/proto/data.js": `window.__A2UI_DATA__ = ${JSON.stringify(docA)};`,
    })
    const { ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const rels = await getA2uiDataRelativePaths(ctx)
    expect(rels).toEqual(["./data.js"])
  })
})

// ── buildSiblingMap ────────────────────────────────────────────────────
describe("buildSiblingMap", () => {
  test("单 doc 构建 siblingMap（仅 ≥2 兄弟的组）", () => {
    const entries: A2uiDocEntry[] = [{ doc: docA, loadSize: null, jsonPath: "", dataJsPath: null, rootId: "notesCard", persistTimer: null, persistPending: false }]
    const map = buildSiblingMap(entries)
    expect(map).toBeDefined()
    expect(map!["title"]).toEqual(["title", "body"])
    expect(map!["body"]).toEqual(["title", "body"])
    expect(map!["item"]).toBeUndefined()
  })

  test("多 doc 合并（id 全页唯一）", () => {
    const entries: A2uiDocEntry[] = [
      { doc: docA, loadSize: null, jsonPath: "a", dataJsPath: null, rootId: "notesCard", persistTimer: null, persistPending: false },
      { doc: docB, loadSize: null, jsonPath: "b", dataJsPath: null, rootId: "chartCard", persistTimer: null, persistPending: false },
    ]
    const map = buildSiblingMap(entries)
    expect(map!["title"]).toEqual(["title", "body"])
    expect(map!["cHeader"]).toEqual(["cHeader", "cBody"])
  })

  test("空 entries 返回 undefined", () => {
    expect(buildSiblingMap([])).toBeUndefined()
  })
})

// ── findDocByElementId / findDocByRootId ───────────────────────────────
describe("findDocByElementId", () => {
  const entries: A2uiDocEntry[] = [
    { doc: docA, loadSize: null, jsonPath: "a", dataJsPath: null, rootId: "notesCard", persistTimer: null, persistPending: false },
    { doc: docB, loadSize: null, jsonPath: "b", dataJsPath: null, rootId: "chartCard", persistTimer: null, persistPending: false },
  ]
  test("按 baseId 命中所属 entry", () => {
    expect(findDocByElementId(entries, "title")?.rootId).toBe("notesCard")
    expect(findDocByElementId(entries, "cBody")?.rootId).toBe("chartCard")
  })
  test("循环实例 :N 后缀被剥离再匹配", () => {
    expect(findDocByElementId(entries, "item:0")?.rootId).toBe("notesCard")
    expect(findDocByElementId(entries, "item:0:1")?.rootId).toBe("notesCard")
  })
  test("未命中返回 null", () => {
    expect(findDocByElementId(entries, "nope")).toBeNull()
  })
})

describe("findDocByRootId", () => {
  const entries: A2uiDocEntry[] = [
    { doc: docA, loadSize: null, jsonPath: "a", dataJsPath: null, rootId: "notesCard", persistTimer: null, persistPending: false },
    { doc: docB, loadSize: null, jsonPath: "b", dataJsPath: null, rootId: "chartCard", persistTimer: null, persistPending: false },
  ]
  test("按 rootId 命中", () => {
    expect(findDocByRootId(entries, "chartCard")?.rootId).toBe("chartCard")
  })
  test("空 rootId 回退首个 entry（旧 iframe 兼容）", () => {
    expect(findDocByRootId(entries, "")?.rootId).toBe("notesCard")
    expect(findDocByRootId(entries, undefined)?.rootId).toBe("notesCard")
  })
})

// ── loadA2uiDocs：发现 + 加载 ──────────────────────────────────────────
describe("loadA2uiDocs discovery", () => {
  test("混合页单节点：解析 prototype.html 的 dataPath，读裸 .json，识别 .data.js 孪生", async () => {
    const { api, store } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.json": JSON.stringify(docA),
      "/proto/a2ui-data/metric-notes/metric-notes.data.js": `window.__A2UI_FILE_DATA__ = ${JSON.stringify(docA)};`,
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const entries = await loadA2uiDocs(session, ctx)
    expect(entries).toHaveLength(1)
    expect(entries[0].rootId).toBe("notesCard")
    expect(entries[0].jsonPath).toBe("/proto/a2ui-data/metric-notes/metric-notes.json")
    expect(entries[0].dataJsPath).toBe("/proto/a2ui-data/metric-notes/metric-notes.data.js")
    expect(store.get("/proto/a2ui-data/metric-notes/metric-notes.json")).toBe(JSON.stringify(docA))
  })

  test("仅 .data.js 孪生（file://，无 .json）：回退读孪生并剥包装", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.data.js": `window.__A2UI_FILE_DATA__ = ${JSON.stringify(docA)};`,
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const entries = await loadA2uiDocs(session, ctx)
    expect(entries).toHaveLength(1)
    expect(entries[0].rootId).toBe("notesCard")
    expect(entries[0].doc).toEqual(docA)
  })

  test("混合页多节点：两条 dataPath 各加载一条 entry", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlMulti,
      "/proto/a2ui-data/a/a.json": JSON.stringify(docA),
      "/proto/a2ui-data/b/b.json": JSON.stringify(docB),
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const entries = await loadA2uiDocs(session, ctx)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.rootId).sort()).toEqual(["chartCard", "notesCard"])
  })

  test("旧全 A2UI 页：无 dataPath → 回退 <protoDir>/data.js（__A2UI_DATA__ 包装）", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlLegacy,
      "/proto/data.js": `window.__A2UI_DATA__ = ${JSON.stringify(docA)};`,
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const entries = await loadA2uiDocs(session, ctx)
    expect(entries).toHaveLength(1)
    expect(entries[0].rootId).toBe("notesCard")
    expect(entries[0].jsonPath).toBe("/proto/data.js")
    expect(entries[0].dataJsPath).toBeNull()
  })

  test("命中缓存：stat size 不变则复用 entry 不重读", async () => {
    const { api, store } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.json": JSON.stringify(docA),
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    await loadA2uiDocs(session, ctx)
    const first = session.a2uiDocs[0]
    ;(first.doc as any).state = { hacked: true }
    await loadA2uiDocs(session, ctx)
    expect((session.a2uiDocs[0].doc as any).state).toEqual({ hacked: true })
    expect(store.get("/proto/a2ui-data/metric-notes/metric-notes.json")).toBe(JSON.stringify(docA))
  })
})

// ── loadA2uiData 合并 ──────────────────────────────────────────────────
describe("loadA2uiData merge", () => {
  test("单 doc 原样返回", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.json": JSON.stringify(docA),
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const merged = await loadA2uiData(session, ctx)
    expect(merged).toEqual(docA)
  })
  test("多 doc 合并 elements + shallow merge state", async () => {
    const { api } = makeFs({
      "/proto/prototype.html": htmlMulti,
      "/proto/a2ui-data/a/a.json": JSON.stringify(docA),
      "/proto/a2ui-data/b/b.json": JSON.stringify(docB),
    })
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    const merged = (await loadA2uiData(session, ctx)) as { elements: any[]; state: any; rootId: string }
    expect(merged.elements).toHaveLength(docA.elements.length + docB.elements.length)
    expect(merged.state.activeKey).toEqual(["a"])
    expect(merged.state.open).toBe(true)
    expect(merged.rootId).toBe("notesCard")
  })
})

// ── persistA2uiDoc 格式 / 脏检 / 原子写 ────────────────────────────────
describe("persistA2uiDoc", () => {
  test("混合页 .json：写裸 JSON 到 jsonPath + __A2UI_FILE_DATA__ 到孪生", async () => {
    const { api, store, renamed } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.json": JSON.stringify(docA),
      "/proto/a2ui-data/metric-notes/metric-notes.data.js": `window.__A2UI_FILE_DATA__ = ${JSON.stringify(docA)};`,
    })
    ;(window as any).api = api
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    await loadA2uiDocs(session, ctx)
    const entry = session.a2uiDocs[0]
    const modified = JSON.parse(JSON.stringify(docA)) as any
    modified.elements[1].props.value = "changed"
    entry.doc = modified
    await persistA2uiDoc(session, entry)

    // 临时文件 → rename 到目标（原子写）
    expect(renamed.some((r) => r.dst === entry.jsonPath)).toBe(true)
    expect(renamed.some((r) => r.dst === entry.dataJsPath)).toBe(true)
    // 最终内容落在 store（rename 后）：裸 JSON + 孪生 wrapper
    expect(store.get(entry.jsonPath)!.trim()).toBe(JSON.stringify(modified))
    expect(store.get(entry.dataJsPath!)).toBe(`window.__A2UI_FILE_DATA__ = ${JSON.stringify(modified)};\n`)
    // loadSize = 最终文件 stat size（裸 JSON + 写入时尾部 \n）
    expect(entry.loadSize).toBe(new TextEncoder().encode(JSON.stringify(modified) + "\n").byteLength)
  })

  test("旧 data.js：写 __A2UI_DATA__ 包装（非裸 JSON）", async () => {
    const { api, store } = makeFs({
      "/proto/prototype.html": htmlLegacy,
      "/proto/data.js": `window.__A2UI_DATA__ = ${JSON.stringify(docA)};`,
    })
    ;(window as any).api = api
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    await loadA2uiDocs(session, ctx)
    const entry = session.a2uiDocs[0]
    const modified = JSON.parse(JSON.stringify(docA)) as any
    modified.elements[0].props.className = "modified"
    entry.doc = modified
    await persistA2uiDoc(session, entry)
    expect(store.get(entry.jsonPath)).toBe(`window.__A2UI_DATA__ = ${JSON.stringify(modified)};\n`)
  })

  test("脏检：stat size 与 loadSize 不一致 → 中止写盘 + toast + 清缓存", async () => {
    const { api, written, store } = makeFs({
      "/proto/prototype.html": htmlSingle,
      "/proto/a2ui-data/metric-notes/metric-notes.json": JSON.stringify(docA),
    })
    ;(window as any).api = api
    const { session, ctx } = makeSession(api, { filePath: "/proto/prototype.html" })
    await loadA2uiDocs(session, ctx)
    const entry = session.a2uiDocs[0]
    store.set(entry.jsonPath, JSON.stringify({ ...docA, elements: [] }))
    const before = written.length
    await persistA2uiDoc(session, entry)
    expect(written.length).toBe(before)
    expect((api as any).showOctoToast).toHaveBeenCalled()
    expect(session.a2uiDocs.find((e) => e === entry)).toBeUndefined()
  })
})

// ── commitA2uiDoc ──────────────────────────────────────────────────────
describe("commitA2uiDoc", () => {
  test("更新 entry.doc/rootId 并发 od:a2ui-update", () => {
    const { api } = makeFs({})
    const { session, posted } = makeSession(api, { filePath: "/proto/prototype.html" })
    const entry: A2uiDocEntry = { doc: docA, loadSize: 10, jsonPath: "x", dataJsPath: null, rootId: "old", persistTimer: null, persistPending: false }
    session.a2uiDocs = [entry]
    const modified = { ...docA, rootId: "notesCard" } as any
    commitA2uiDoc(session, entry, modified)
    expect(entry.doc).toBe(modified)
    expect(entry.rootId).toBe("notesCard")
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe("od:a2ui-update")
    expect(posted[0].payload).toBe(modified)
    expect(entry.persistPending).toBe(true)
    expect(entry.persistTimer).not.toBeNull()
  })
})
