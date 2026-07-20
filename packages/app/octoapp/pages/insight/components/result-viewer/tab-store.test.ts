import { describe, expect, it, mock, beforeEach } from "bun:test"
import type { OutputCard } from "../insight-turn"

// materializedLocalPath 是「uri 卡已 eager 落盘」的唯一事实来源;用例按需摆布它,
// 免去在测试里拉起 Electron IPC / 真下载。
const materialized = new Map<string, string>()
mock.module("../../utils/local-resource", () => ({
  materializedLocalPath: (cardId: string) => materialized.get(cardId),
}))

const { createTabStore } = await import("./tab-store")

function card(over: Partial<OutputCard> & Pick<OutputCard, "id" | "source">): OutputCard {
  return {
    title: "t",
    type: "file",
    createdAt: new Date(),
    ...over,
  } as OutputCard
}

describe("openTab 跨入口去重", () => {
  beforeEach(() => materialized.clear())

  it("uri 卡已落盘 → 文件管理打开同一文件不再新开 tab", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/user-quotes.xlsx"
    materialized.set("card-1", local)

    const uriId = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/x.xlsx", fileName: "user-quotes.xlsx" }))
    const pathId = store.openTab(card({ id: "fm-uuid", source: "path", filePath: local, fileName: "user-quotes.xlsx" }))

    expect(pathId).toBe(uriId)
    expect(store.tabs()).toHaveLength(1)
  })

  it("反向:先从文件管理打开,再点对话区 uri 卡 → 收敛到同一个 tab", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/user-quotes.xlsx"
    materialized.set("card-1", local)

    const pathId = store.openTab(card({ id: "fm-uuid", source: "path", filePath: local }))
    const uriId = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/x.xlsx" }))

    expect(uriId).toBe(pathId)
    expect(store.tabs()).toHaveLength(1)
  })

  it("路径分隔符写法不同(Windows 反斜杠)仍去重", () => {
    const store = createTabStore()
    materialized.set("card-1", "C:\\proj\\insight\\ses_1\\outputs\\a.xlsx")

    const uriId = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/a.xlsx" }))
    const pathId = store.openTab(card({ id: "fm-uuid", source: "path", filePath: "C:/proj/insight/ses_1/outputs/a.xlsx" }))

    expect(pathId).toBe(uriId)
    expect(store.tabs()).toHaveLength(1)
  })

  it("同一文件不同 type 仍并存(mindmap json 双卡不能被误合)", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/mindmap.json"
    materialized.set("card-json", local)
    materialized.set("card-mm", local)

    store.openTab(card({ id: "card-json", source: "uri", uri: "https://mcp/m.json", type: "json" }))
    store.openTab(card({ id: "card-mm", source: "uri", uri: "https://mcp/m.json", type: "mindmap" }))

    expect(store.tabs()).toHaveLength(2)
  })

  // 慢文件回归:eager 落盘是异步的,几十 MB 的 xlsx 下完要数秒~数十秒。用户在下载完成前
  // 点开卡片(最自然的操作),uri tab 建出来时注册表还没值 → 若只信建 tab 那刻的快照,
  // 稍后从文件管理打开同一文件必然双开。去重必须回查注册表。
  it("开 tab 时还没落盘完,之后落完 → 文件管理打开同一文件仍去重(慢文件不双开)", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/big.xlsx"

    // t0:下载还在途中,注册表无值
    const uriId = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/big.xlsx" }))
    expect(store.tabs()[0]?.filePath).toBeUndefined()

    // t1:下载完成,materializeUriCardToOutputs 登记
    materialized.set("card-1", local)

    // t2:用户从文件管理打开同一文件
    const pathId = store.openTab(card({ id: "fm-uuid", source: "path", filePath: local }))

    expect(pathId).toBe(uriId)
    expect(store.tabs()).toHaveLength(1)
  })

  it("落盘中途开的 uri tab,不会去重掉另一个无关的本地文件", () => {
    const store = createTabStore()
    materialized.set("card-1", "/proj/insight/ses_1/outputs/a.xlsx")
    store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/a.xlsx" }))

    store.openTab(card({ id: "fm-uuid", source: "path", filePath: "/proj/insight/ses_1/outputs/b.xlsx" }))

    expect(store.tabs()).toHaveLength(2)
  })

  it("uri 卡未落盘 → 不补 filePath,退回原 (uri,type) 去重", () => {
    const store = createTabStore()
    const id = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/x.xlsx" }))

    expect(store.tabs()[0]?.filePath).toBeUndefined()
    expect(store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/x.xlsx" }))).toBe(id)
    expect(store.tabs()).toHaveLength(1)
  })

  it("补 filePath 不改 source(渲染路由 / FileFallback isPath 按 source 判定)", () => {
    const store = createTabStore()
    materialized.set("card-1", "/proj/insight/ses_1/outputs/a.xlsx")

    store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/a.xlsx" }))

    expect(store.tabs()[0]?.source).toBe("uri")
    expect(store.tabs()[0]?.filePath).toBe("/proj/insight/ses_1/outputs/a.xlsx")
  })
})
