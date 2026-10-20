/**
 * 每 session tab 状态持久化测试。
 *
 * 覆盖:round-trip、design-plan 排除、内容内联规则(无 filePath 才内联 + 大小上限)、
 * tab 数量上限(activeId 兜底保留)、配额降级、脏数据防御、清理。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/tab-state-store.test.ts(在 packages/app 下)
 */
import { beforeEach, describe, expect, test } from "bun:test"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { clearSessionTabs, loadSessionTabs, saveSessionTabs } from "./tab-state-store"

function makeTab(overrides: Partial<ResultTab> & { id: string }): ResultTab {
  return {
    title: "tab",
    type: "html",
    content: "",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  }
}

/** 用可编程 stub 替换 globalThis.localStorage(happy-dom 下补丁 Storage.prototype 不生效) */
function withLocalStorageStub(
  setItem: (store: Map<string, string>, k: string, v: string) => void,
  run: () => void,
) {
  const original = globalThis.localStorage
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => setItem(store, k, v),
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true })
  try {
    run()
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true, writable: true })
  }
}

describe("tab-state-store", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test("round-trip:无 filePath 的 tab 内联内容,有 filePath 的只存元数据", () => {
    saveSessionTabs("s1", [
      makeTab({ id: "html-1", type: "html", filePath: "D:/p/.octo/s1/outputs/a.html", content: "<html>x</html>" }),
      makeTab({ id: "diagram-1", type: "diagram", content: "flowchart TD" }),
    ], "diagram-1")

    const loaded = loadSessionTabs("s1")!
    expect(loaded.tabs).toHaveLength(2)
    expect(loaded.activeId).toBe("diagram-1")
    // createdAt 还原为 Date
    expect(loaded.tabs[0].createdAt instanceof Date).toBe(true)
    // filePath tab 内容置空(恢复时由调用方从磁盘水合)
    expect(loaded.tabs[0].content).toBe("")
    expect(loaded.tabs[0].filePath).toBe("D:/p/.octo/s1/outputs/a.html")
    // 无 filePath 的 tab 内容内联保留
    expect(loaded.tabs[1].content).toBe("flowchart TD")
  })

  test("design-plan 不纳入持久化", () => {
    saveSessionTabs("s1", [
      makeTab({ id: "plan:s1:plan-x", type: "design-plan", content: "# 方案" }),
      makeTab({ id: "html-1", type: "html", filePath: "a.html" }),
    ], "html-1")

    const loaded = loadSessionTabs("s1")!
    expect(loaded.tabs.map((t) => t.type)).toEqual(["html"])
  })

  test("无 filePath 但内容超限 → 内容置空(降级为不可恢复内容)", () => {
    const big = "x".repeat(128 * 1024 + 1)
    saveSessionTabs("s1", [makeTab({ id: "d1", type: "diagram", content: big })], null)

    const loaded = loadSessionTabs("s1")!
    expect(loaded.tabs[0].content).toBe("")
  })

  test("tab 数量上限:按 lastActivatedAt 保留最近 20 个,activeId 兜底保留", () => {
    const tabs = Array.from({ length: 25 }, (_, i) =>
      makeTab({ id: `t${i}`, type: "html", filePath: `f${i}.html`, lastActivatedAt: i }),
    )
    saveSessionTabs("s1", tabs, "t24")

    const loaded = loadSessionTabs("s1")!
    expect(loaded.tabs).toHaveLength(20)
    expect(loaded.activeId).toBe("t24")

    // activeId 不在 top 20 时仍保留该 tab
    saveSessionTabs("s1", tabs, "t0")
    const loaded2 = loadSessionTabs("s1")!
    expect(loaded2.tabs).toHaveLength(21)
    expect(loaded2.tabs.some((t) => t.id === "t0")).toBe(true)
    expect(loaded2.activeId).toBe("t0")
  })

  test("保存顺序保留(不按 lastActivatedAt 重排)", () => {
    saveSessionTabs("s1", [
      makeTab({ id: "a", type: "html", filePath: "a.html", lastActivatedAt: 99 }),
      makeTab({ id: "b", type: "html", filePath: "b.html", lastActivatedAt: 1 }),
    ], "a")

    const loaded = loadSessionTabs("s1")!
    expect(loaded.tabs.map((t) => t.id)).toEqual(["a", "b"])
  })

  test("配额不足:首次写失败 → 降级去内容重试成功", () => {
    let call = 0
    withLocalStorageStub(
      (store, k, v) => {
        call++
        if (call === 1) throw new Error("QuotaExceededError")
        store.set(k, v)
      },
      () => {
        saveSessionTabs("s1", [makeTab({ id: "d1", type: "diagram", content: "mermaid" })], "d1")
        const loaded = loadSessionTabs("s1")!
        expect(loaded.tabs[0].content).toBe("")
      },
    )
  })

  test("配额持续不足:不抛异常,静默放弃", () => {
    withLocalStorageStub(
      () => {
        throw new Error("QuotaExceededError")
      },
      () => {
        expect(() => saveSessionTabs("s1", [makeTab({ id: "d1", type: "diagram" })], null)).not.toThrow()
        expect(loadSessionTabs("s1")).toBeNull()
      },
    )
  })

  test("脏数据防御:非法 JSON / 版本不匹配 / 缺 id / 非法日期", () => {
    localStorage.setItem("octo:make:tabs:bad-json", "{not json")
    expect(loadSessionTabs("bad-json")).toBeNull()

    localStorage.setItem("octo:make:tabs:bad-version", JSON.stringify({ version: 2, activeId: null, tabs: [] }))
    expect(loadSessionTabs("bad-version")).toBeNull()

    localStorage.setItem(
      "octo:make:tabs:bad-tabs",
      JSON.stringify({
        version: 1,
        activeId: "a",
        tabs: [
          { id: "", type: "html", content: "", createdAt: "2026-01-01T00:00:00Z" },
          { id: "ok", type: "html", content: "", createdAt: "2026-01-01T00:00:00Z" },
          { id: "bad-date", type: "html", content: "", createdAt: "not-a-date" },
        ],
      }),
    )
    const loaded = loadSessionTabs("bad-tabs")!
    expect(loaded.tabs.map((t) => t.id)).toEqual(["ok"])
    // activeId 指向的 tab 不在列表中 → 置空
    expect(loaded.activeId).toBeNull()
  })

  test("保存空列表后 load 返回空态(不复活)", () => {
    saveSessionTabs("s1", [makeTab({ id: "a", type: "html", filePath: "a.html" })], "a")
    saveSessionTabs("s1", [], null)
    const loaded = loadSessionTabs("s1")!
    expect(loaded.tabs).toHaveLength(0)
    expect(loaded.activeId).toBeNull()
  })

  test("clearSessionTabs 清理 key", () => {
    saveSessionTabs("s1", [makeTab({ id: "a", type: "html", filePath: "a.html" })], "a")
    clearSessionTabs("s1")
    expect(loadSessionTabs("s1")).toBeNull()
    expect(localStorage.getItem("octo:make:tabs:s1")).toBeNull()
  })
})
