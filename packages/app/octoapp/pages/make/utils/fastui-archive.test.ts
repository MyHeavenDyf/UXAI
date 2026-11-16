/**
 * fastui 源码 zip 归档(SPEC-DES-007 §7)。
 *
 * EDM 上传与交付件接口是网络调用,这里 mock 掉,只测本模块的编排:打包(与下载共用锁)→ 读盘 →
 * 大小校验 → 取交付件类型 → 上传(任务中心)→ 登记交付件 → 成功弹窗的路径与查看链接。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-archive.test.ts(在 packages/app 下)
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

type UploadCallbacks = {
  onInit?: (taskId: string, files: { name: string; size: number }[]) => void
  onFinish?: (taskId: string, files: { name: string; size: number; docId: string; version: string }[]) => void
  onError?: (taskId: string, errors: { message?: string }) => void
}

let activity: { deliverableType: number } | null
let deliverableResult: { id: number }[] | null
let deliverableCalls: unknown[]
let uploadedNames: string[]
/** 决定 EdmUtil.upload 的回调怎么走 */
let uploadBehavior: (cb: UploadCallbacks, files: File[]) => void

mock.module("@/network/pipelineRequest", () => ({
  getActivityByTeam: async () => activity,
  uploadDeliverable: async (body: unknown) => {
    deliverableCalls.push(body)
    return deliverableResult
  },
}))
mock.module("@/utils/edmUtil", () => ({
  EdmUtil: {
    upload: (list: FileList, cb: UploadCallbacks) => {
      const files = Array.from(list)
      uploadedNames = files.map((f) => f.name)
      uploadBehavior(cb, files)
    },
  },
}))

const { archiveFastuiZip, archiveSizeError, deliverableViewUrl } = await import("./fastui-archive")
const { exportFastuiZip, isExportingAny } = await import("./fastui-export")
const { TaskStore } = await import("@/context/task")

const target = { workspaceDir: "/proj", sessionId: "s1", name: "alpha" }
const data = {
  spaceType: "project",
  productName: "产品A",
  versionDeliveryName: "V1",
  folderName: "设计稿",
  folderId: 7,
  teamId: 7,
  isOverwrite: false,
  existingDeliverables: [],
} as never

const succeed: typeof uploadBehavior = (cb, files) => {
  cb.onInit?.("task1", files)
  cb.onFinish?.("task1", files.map((f) => ({ name: f.name, size: f.size, docId: "doc1", version: "1" })))
}

let exported: unknown[]
const setApi = (api: Record<string, unknown> | undefined) => {
  ;(window as unknown as { api?: unknown }).api = api
}
const okApi = (bytes = 3) => ({
  fastuiExportZip: async (t: unknown) => {
    exported.push(t)
    return { ok: true, zipPath: "/proj/.octo/s1/outputs/alpha/.octo-fastui/export/alpha.zip", bytes }
  },
  readFileBuffer: async () => new Uint8Array(bytes).buffer,
})

beforeEach(() => {
  activity = { deliverableType: 42 }
  deliverableResult = [{ id: 123 }]
  deliverableCalls = []
  uploadedNames = []
  exported = []
  uploadBehavior = succeed
  setApi(okApi())
})
afterEach(() => {
  setApi(undefined)
  for (const item of TaskStore.items()) TaskStore.remove(item)
})

describe("archiveFastuiZip", () => {
  test("成功:按卡片目标打包,以产物名 zip 上传,登记交付件,返回路径与 /p/<id> 链接", async () => {
    const result = await archiveFastuiZip(target, data)
    expect(exported).toEqual([target])
    expect(uploadedNames).toEqual(["alpha.zip"])
    expect(deliverableCalls).toEqual([
      { typeId: 42, files: [{ docName: "alpha.zip", docId: "doc1", docVersion: "1", docSize: 3 }], teamId: 7 },
    ])
    expect(result?.viewUrl?.endsWith("/p/123")).toBe(true)
    expect(result?.path).toContain("设计稿")
  })

  test("上传完成后释放打包锁(上传期间不占锁)", async () => {
    let finishLater!: () => void
    uploadBehavior = (cb, files) => {
      cb.onInit?.("task1", files)
      finishLater = () => succeed(cb, files)
    }
    const running = archiveFastuiZip(target, data)
    await new Promise((r) => setTimeout(r, 0))
    expect(isExportingAny()).toBe(false)
    finishLater()
    expect(await running).not.toBeNull()
  })

  test("下载打包中:归档不再并发打包,返回 null", async () => {
    let release!: () => void
    setApi({
      ...okApi(),
      fastuiExportZip: (t: unknown) =>
        new Promise((r) => {
          exported.push(t)
          release = () => r({ ok: true, zipPath: "/x/alpha.zip", bytes: 1 })
        }),
      saveFilePicker: async () => "/dest.zip",
      copyFileTo: async () => {},
    })
    const downloading = exportFastuiZip(target)
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(exported).toHaveLength(1)
    release()
    await downloading
  })

  test("打包失败:返回 null,不上传", async () => {
    setApi({ ...okApi(), fastuiExportZip: async () => ({ ok: false, error: "找不到工程" }) })
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(uploadedNames).toEqual([])
  })

  test("读不到 zip:返回 null,不上传", async () => {
    setApi({ ...okApi(), readFileBuffer: async () => null })
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(uploadedNames).toEqual([])
  })

  test("空 zip(0 字节)被大小校验拦下,不上传", async () => {
    setApi(okApi(0))
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(uploadedNames).toEqual([])
  })

  test("取不到交付件类型:返回 null,不上传", async () => {
    activity = null
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(uploadedNames).toEqual([])
  })

  test("用户在任务中心取消:不登记交付件,返回 null", async () => {
    uploadBehavior = (cb, files) => {
      cb.onInit?.("task1", files)
      const item = TaskStore.items().find((i) => i.key === "task1-0")!
      TaskStore.cancel(item)
      cb.onFinish?.("task1", files.map((f) => ({ name: f.name, size: f.size, docId: "doc1", version: "1" })))
    }
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(deliverableCalls).toEqual([])
  })

  test("上传出错:返回 null,任务标为失败", async () => {
    uploadBehavior = (cb, files) => {
      cb.onInit?.("task1", files)
      cb.onError?.("task1", { message: "网络错误" })
    }
    expect(await archiveFastuiZip(target, data)).toBeNull()
    expect(TaskStore.items().find((i) => i.key === "task1-0")?.status).toBe("error")
    expect(deliverableCalls).toEqual([])
  })

  test("登记交付件失败(接口返回 null):返回 null", async () => {
    deliverableResult = null
    expect(await archiveFastuiZip(target, data)).toBeNull()
  })
})

describe("辅助规则", () => {
  test("大小区间 1B~4GiB", () => {
    expect(archiveSizeError(0)).not.toBeNull()
    expect(archiveSizeError(1)).toBeNull()
    expect(archiveSizeError(4 * 1024 ** 3)).toBeNull()
    expect(archiveSizeError(4 * 1024 ** 3 + 1)).not.toBeNull()
  })

  test("查看链接:id > 0 才有", () => {
    expect(deliverableViewUrl(123)?.endsWith("/p/123")).toBe(true)
    expect(deliverableViewUrl(0)).toBeUndefined()
  })
})
