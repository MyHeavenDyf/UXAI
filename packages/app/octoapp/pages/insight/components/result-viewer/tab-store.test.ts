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

  // V6:一个磁盘文件 = 一个 tab,**去重不看 type**(§6.1)。
  // 旧规则「同一 URI 不同 type 各留一个 tab」在保护一个现网不存在的场景
  // (一个 resource_link 只产一张卡),代价是同一份磁盘文件从两个入口打开必然双开。
  it("同一磁盘路径、不同 type → 只有 1 个 tab", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/data.json"
    materialized.set("card-json", local)
    materialized.set("card-code", local)

    const jsonId = store.openTab(card({ id: "card-json", source: "uri", uri: "https://mcp/m.json", type: "json" }))
    const codeId = store.openTab(card({ id: "card-code", source: "uri", uri: "https://mcp/m2.json", type: "code" }))

    expect(codeId).toBe(jsonId)
    expect(store.tabs()).toHaveLength(1)
  })

  // V6 的顺序无关性:同样两步操作,换个顺序结果必须相同 —— 否则合并语义就是「谁先开谁赢」的
  // 隐式行为。这里显式断言:两种顺序都留下 1 个 tab,且保留的都是**先开的那一个**。
  it("交换两次 openTab 的顺序,结果相同(顺序无关)", () => {
    const local = "/proj/insight/ses_1/outputs/data.json"
    const uriCard = card({ id: "card-json", source: "uri", uri: "https://mcp/m.json", type: "json" })
    const pathCard = card({ id: "fm-uuid", source: "path", filePath: local, type: "code" })

    const a = createTabStore()
    materialized.set("card-json", local)
    const aFirst = a.openTab(uriCard)
    const aSecond = a.openTab(pathCard)

    const b = createTabStore()
    const bFirst = b.openTab(pathCard)
    const bSecond = b.openTab(uriCard)

    expect(a.tabs()).toHaveLength(1)
    expect(b.tabs()).toHaveLength(1)
    // 各自都收敛到「先开的那个」
    expect(aSecond).toBe(aFirst)
    expect(aFirst).toBe("card-json")
    expect(bSecond).toBe(bFirst)
    expect(bFirst).toBe("fm-uuid")
  })

  it("同一 uri、不同 type,落盘前也只有 1 个 tab", () => {
    const store = createTabStore()
    const first = store.openTab(card({ id: "card-a", source: "uri", uri: "https://mcp/m.json", type: "json" }))
    const second = store.openTab(card({ id: "card-b", source: "uri", uri: "https://mcp/m.json", type: "code" }))

    expect(second).toBe(first)
    expect(store.tabs()).toHaveLength(1)
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

  it("uri 卡未落盘 → 不补 filePath,退回 uri 去重", () => {
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

// V7:pending 卡以 card.id 开 tab(临时身份),落盘完成后由 bindLocalPath 绑定磁盘路径(§6.2)。
describe("bindLocalPath 身份转正", () => {
  beforeEach(() => materialized.clear())

  it("pending 期间开的 tab,落盘后补上 filePath(tab 数不变)", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/big.xlsx"

    const id = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/big.xlsx" }))
    expect(store.tabs()[0]?.filePath).toBeUndefined()

    store.bindLocalPath("card-1", local)

    expect(store.tabs()).toHaveLength(1)
    expect(store.tabs()[0]?.id).toBe(id)
    expect(store.tabs()[0]?.filePath).toBe(local)
    expect(store.tabs()[0]?.source).toBe("uri") // 身份转正不改 source(渲染路由按 source 判定)
  })

  it("落盘期间用户又从文件管理开了同一文件 → 合并为 1 个 tab,保留先开的那个", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/big.xlsx"

    // t0:pending 卡先点开(临时身份 card-1)
    const tempId = store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/big.xlsx", type: "json" }))
    // t1:下载还没完,用户从文件管理打开了同一个文件 —— 此时注册表还没值,认不出是同一份,于是双开
    store.openTab(card({ id: "fm-uuid", source: "path", filePath: local, type: "code" }))
    expect(store.tabs()).toHaveLength(2)

    // t2:落盘完成,身份转正 → 合并
    store.bindLocalPath("card-1", local)

    expect(store.tabs()).toHaveLength(1)
    expect(store.tabs()[0]?.id).toBe(tempId) // 先开者胜
    expect(store.tabs()[0]?.filePath).toBe(local)
  })

  it("合并时被关掉的那个是激活 tab → 激活转移到保留的那个(不留空白右栏)", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/big.xlsx"

    store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/big.xlsx" }))
    const fmId = store.openTab(card({ id: "fm-uuid", source: "path", filePath: local }))
    expect(store.activeId()).toBe(fmId) // 后开的是激活态

    store.bindLocalPath("card-1", local)

    expect(store.activeId()).toBe("card-1")
    expect(store.tabs().some((t) => t.id === store.activeId())).toBe(true)
  })

  it("用户在落盘完成前关掉了 tab → 绑定不复活它", () => {
    const store = createTabStore()
    store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/big.xlsx" }))
    store.closeTab("card-1")
    expect(store.tabs()).toHaveLength(0)

    store.bindLocalPath("card-1", "/proj/insight/ses_1/outputs/big.xlsx")

    expect(store.tabs()).toHaveLength(0)
  })

  it("从未点开过的卡片落盘 → 不凭空造 tab", () => {
    const store = createTabStore()
    store.bindLocalPath("card-never-opened", "/proj/insight/ses_1/outputs/x.json")
    expect(store.tabs()).toHaveLength(0)
  })

  it("重复绑定同一路径幂等", () => {
    const store = createTabStore()
    const local = "/proj/insight/ses_1/outputs/big.xlsx"
    store.openTab(card({ id: "card-1", source: "uri", uri: "https://mcp/big.xlsx" }))

    store.bindLocalPath("card-1", local)
    const after = store.tabs()[0]
    store.bindLocalPath("card-1", local)

    expect(store.tabs()).toHaveLength(1)
    expect(store.tabs()[0]).toBe(after) // 未产生新对象,不触发无谓重渲染
  })
})
