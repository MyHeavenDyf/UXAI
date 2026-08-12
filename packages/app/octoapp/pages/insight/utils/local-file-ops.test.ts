import { describe, expect, it, beforeEach, mock } from "bun:test"

// openFileOrReveal 的 fallback 链依赖桌面端 IPC(shell.openPath / showItemInFolder)与 toast 两个
// 外部边界,单测里只 stub 这两处(同 local-resource.test.ts 的 mock.module 套路),测的是本函数
// 「开文件 → 定位 → 开父目录 → 报错」的真实分支顺序,不复刻其内部逻辑。

// 记录 openPath / showItemInFolder 的调用入参(锁死 fallback 顺序)与 showToast 调用(断言终态文案)。
const toasts: Array<{ title: string; description?: string; variant?: string }> = []
const opens: string[] = []
const reveals: string[] = []

// 每条用例前重新装配:openPath/showItemInFolder 的返回行为、是否提供该能力。
let openPathImpl: ((p: string) => Promise<unknown>) | undefined
let showItemImpl: ((p: string) => Promise<{ ok: boolean; reason?: "not-found" }>) | undefined
let hasOpenPath = true
let hasShowItem = true

mock.module("../lib/electron-api", () => ({
  getDesktopApi: () => {
    const api: Record<string, unknown> = {}
    if (hasOpenPath)
      api.openPath = (p: string) => {
        opens.push(p)
        return openPathImpl ? openPathImpl(p) : Promise.resolve("")
      }
    if (hasShowItem)
      api.showItemInFolder = (p: string) => {
        reveals.push(p)
        return showItemImpl ? showItemImpl(p) : Promise.resolve({ ok: true })
      }
    return api
  },
}))
mock.module("@opencode-ai/ui/toast", () => ({
  showToast: (t: { title: string; description?: string; variant?: string }) => {
    toasts.push(t)
    return 0
  },
}))

const { openFileOrReveal, OPEN_OR_REVEAL_FAILED_HINT } = await import("./local-file-ops")

const FILE = "/proj/interviews/user1.docx"
const DIR = "/proj/interviews"

describe("openFileOrReveal fallback 链", () => {
  beforeEach(() => {
    toasts.length = 0
    opens.length = 0
    reveals.length = 0
    openPathImpl = undefined
    showItemImpl = undefined
    hasOpenPath = true
    hasShowItem = true
  })

  it("文件能打开 → 不触发 reveal / toast", async () => {
    openPathImpl = async () => "" // shell.openPath 成功 = 空串
    await openFileOrReveal(FILE, DIR)

    expect(opens).toEqual([FILE])
    expect(reveals).toHaveLength(0)
    expect(toasts).toHaveLength(0)
  })

  it("open 失败 + 文件在 → showItemInFolder 定位,不弹 toast", async () => {
    openPathImpl = async () => "no default app" // 非空 = 失败
    showItemImpl = async () => ({ ok: true }) // 文件存在 → 定位成功
    await openFileOrReveal(FILE, DIR)

    expect(opens).toEqual([FILE])
    expect(reveals).toEqual([FILE])
    expect(toasts).toHaveLength(0)
  })

  it("open 失败 + 文件不在 + 父目录能开 → 开父目录,不弹 toast", async () => {
    let n = 0
    openPathImpl = async () => (n++ === 0 ? "not found" : "") // 第一次(文件)失败、第二次(父目录)成功
    showItemImpl = async () => ({ ok: false, reason: "not-found" })
    await openFileOrReveal(FILE, DIR)

    expect(opens).toEqual([FILE, DIR]) // 先开文件,再开父目录
    expect(reveals).toEqual([FILE])
    expect(toasts).toHaveLength(0)
  })

  it("三步全败 → 弹终态 toast(用 OPEN_OR_REVEAL_FAILED_HINT)", async () => {
    openPathImpl = async () => "error" // 文件 + 父目录都开不了
    showItemImpl = async () => ({ ok: false, reason: "not-found" })
    await openFileOrReveal(FILE, DIR)

    expect(opens).toEqual([FILE, DIR])
    expect(reveals).toEqual([FILE])
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toBe("无法打开文件")
    expect(toasts[0].description).toBe(OPEN_OR_REVEAL_FAILED_HINT)
  })

  it("openPath reject(IPC 异常)归一为失败 → 走 reveal 兜底", async () => {
    openPathImpl = async () => {
      throw new Error("ipc reject")
    }
    showItemImpl = async () => ({ ok: true })
    await openFileOrReveal(FILE, DIR)

    expect(reveals).toEqual([FILE])
    expect(toasts).toHaveLength(0)
  })

  it("未传 parentDir → 从文件路径推父目录兜底(开父目录成功)", async () => {
    let n = 0
    openPathImpl = async () => (n++ === 0 ? "not found" : "")
    showItemImpl = async () => ({ ok: false, reason: "not-found" })
    await openFileOrReveal(FILE) // 不传 parentDir

    // 推出的父目录 = "/proj/interviews" == DIR
    expect(opens).toEqual([FILE, DIR])
    expect(toasts).toHaveLength(0)
  })

  it("openPath 不可用(非桌面端)→ 弹「桌面端能力缺失」toast", async () => {
    hasOpenPath = false
    await openFileOrReveal(FILE, DIR)

    expect(opens).toHaveLength(0)
    expect(reveals).toHaveLength(0)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toBe("桌面端能力缺失")
  })
})
