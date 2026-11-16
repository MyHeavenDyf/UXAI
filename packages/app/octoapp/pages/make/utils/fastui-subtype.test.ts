/**
 * fastui 预览卡片的独立 subtype(SPEC-DES-005)。
 *
 * 判据:fastui tab 在 url 的能力之上多开分辨率切换、下载(SPEC-DES-007 §8)与归档(§7);url(所有
 * http(s) 外链 tab)的能力与按钮保持通用形态;下载只认 `fastui://` 身份,走标准下载入口;
 * 自定义归档上传只有 fastui 有,其他 subtype 仍走默认归档。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-subtype.test.ts(在 packages/app 下)
 */
import { afterEach, describe, expect, test } from "bun:test"

import { DownloadCancelledError } from "../subtype-handlers/default"

import { getSubtypeConfig, SUBTYPE_CONFIG } from "./subtype-config"
import { getSubtypeHandler } from "./subtype-registry"
import type { SubtypeHandlerContext } from "../subtype-handlers/types"

type Features = (typeof SUBTYPE_CONFIG)["url"]["features"]

// url 的能力表是既有行为,这里钉死,防止改 fastui 时顺手动了它
const URL_FEATURES: Features = {
  refresh: true,
  modeToggle: false,
  viewport: false,
  localEdit: false,
  modelEdit: false,
  drawEdit: false,
  canvasEdit: false,
  comment: false,
  archive: false,
  history: false,
  download: false,
  fullscreen: true,
  assessment: false,
}

describe("能力表", () => {
  test("fastui = url + 分辨率切换 + 下载 + 归档", () => {
    expect(getSubtypeConfig("fastui").features).toEqual({
      ...URL_FEATURES,
      viewport: true,
      download: true,
      archive: { enabled: true, editOnly: true },
    })
  })

  test("url 保持原样", () => {
    expect(getSubtypeConfig("url").features).toEqual(URL_FEATURES)
  })

  test("fastui 有独立条目,不会回落到 _default", () => {
    expect(SUBTYPE_CONFIG.fastui).toBeDefined()
    expect(getSubtypeConfig("fastui")).not.toBe(SUBTYPE_CONFIG._default)
  })
})

describe("handler 注册", () => {
  test("fastui 注册在自己的名字下", () => {
    expect(getSubtypeHandler("fastui")?.name).toBe("fastui")
  })

  test("url 不再挂任何额外按钮", () => {
    const url = getSubtypeHandler("url")
    expect(url?.name).toBe("url")
    expect(url?.components?.actionBar?.extraButtons ?? []).toHaveLength(0)
  })
})

describe("下载(SPEC-DES-007 §8:导出代码包走标准下载入口)", () => {
  const handler = () => {
    const h = getSubtypeHandler("fastui")
    if (!h?.handleDownload || !h.isDownloadBusy) throw new Error("fastui handler 缺少 handleDownload / isDownloadBusy")
    return h as Required<Pick<typeof h, "handleDownload" | "isDownloadBusy">> & typeof h
  }

  const ctxFor = (filePath: string, sessionId = "s1"): SubtypeHandlerContext =>
    ({
      tab: { id: "t", title: "t", type: "html", subtype: "fastui", content: "", filePath },
      sdkDirectory: "/proj",
      sessionId,
      tracker: { interaction: () => {} },
    }) as unknown as SubtypeHandlerContext

  type Target = { workspaceDir: string; sessionId: string; name?: string }
  type ExportResult = { ok: true; zipPath: string; bytes: number } | { ok: false; error: string }
  const setApi = (api?: {
    fastuiExportZip?: (t: Target) => Promise<ExportResult>
    saveFilePicker?: () => Promise<string | null>
    copyFileTo?: (src: string, dest: string) => Promise<void>
  }) => {
    ;(window as unknown as { api?: unknown }).api = api
  }

  afterEach(() => setApi(undefined))

  test("不再挂「导出代码包」自定义按钮", () => {
    expect(getSubtypeHandler("fastui")?.components?.actionBar?.extraButtons ?? []).toHaveLength(0)
  })

  test("按卡片目标(工作区, 会话, 产物名)导出,并拷到用户选的位置", async () => {
    const exported: Target[] = []
    const copied: [string, string][] = []
    setApi({
      fastuiExportZip: async (t) => {
        exported.push(t)
        return { ok: true, zipPath: "/tmp/out/user-page.zip", bytes: 2048 }
      },
      saveFilePicker: async () => "/Users/me/user-page.zip",
      copyFileTo: async (src, dest) => {
        copied.push([src, dest])
      },
    })
    expect(await handler().handleDownload(ctxFor("fastui://user-page"))).toBe(true)
    expect(exported).toEqual([{ workspaceDir: "/proj", sessionId: "s1", name: "user-page" }])
    expect(copied).toEqual([["/tmp/out/user-page.zip", "/Users/me/user-page.zip"]])
  })

  test("取消保存对话框:抛 DownloadCancelledError,不拷文件", async () => {
    let copied = false
    setApi({
      fastuiExportZip: async () => ({ ok: true, zipPath: "/tmp/out/a.zip", bytes: 1 }),
      saveFilePicker: async () => null,
      copyFileTo: async () => {
        copied = true
      },
    })
    await expect(handler().handleDownload(ctxFor("fastui://a"))).rejects.toBeInstanceOf(DownloadCancelledError)
    expect(copied).toBe(false)
  })

  test("打包失败:抛出主进程给的原因(由 action bar 统一提示「下载失败」)", async () => {
    setApi({
      fastuiExportZip: async () => ({ ok: false, error: "找不到工程" }),
      saveFilePicker: async () => "/x.zip",
      copyFileTo: async () => {},
    })
    await expect(handler().handleDownload(ctxFor("fastui://a"))).rejects.toThrow("找不到工程")
  })

  test("只认 fastui:// 身份:裸 loopback 地址报错,不去打包", async () => {
    let called = false
    setApi({
      fastuiExportZip: async () => {
        called = true
        return { ok: true, zipPath: "/x.zip", bytes: 1 }
      },
      saveFilePicker: async () => "/x.zip",
      copyFileTo: async () => {},
    })
    await expect(handler().handleDownload(ctxFor("http://127.0.0.1:8081"))).rejects.toThrow("未找到预览工程")
    expect(called).toBe(false)
  })

  test("打包期间 busy(全局锁,任何 fastui tab 都判忙),结束后释放", async () => {
    let release!: () => void
    setApi({
      fastuiExportZip: () =>
        new Promise((r) => {
          release = () => r({ ok: true, zipPath: "/x.zip", bytes: 1 })
        }),
      saveFilePicker: async () => "/y.zip",
      copyFileTo: async () => {},
    })
    const h = handler()
    expect(h.isDownloadBusy(ctxFor("fastui://a"))).toBe(false)
    const running = h.handleDownload(ctxFor("fastui://a"))
    expect(h.isDownloadBusy(ctxFor("fastui://b", "s2"))).toBe(true)
    release()
    await running
    expect(h.isDownloadBusy(ctxFor("fastui://a"))).toBe(false)
  })
})

describe("归档(SPEC-DES-007 §7:只归档源码 zip,走自定义归档上传)", () => {
  test("fastui 有 archiveUpload,且不列已有交付件", () => {
    const upload = getSubtypeHandler("fastui")?.archiveUpload
    expect(upload).toBeDefined()
    expect(upload?.showDeliverables).toBe(false)
  })

  // 隔离:html-renderer 只在 handler 带 archiveUpload 时改走自定义上传。这里钉死除 fastui 外没有
  // 任何 subtype 带它 —— 包括 _default:handler 普遍 `...defaultHandler` 继承,加在那里会全体生效
  test("其他 subtype(含回落到 _default 的)都没有 archiveUpload,仍走默认归档", () => {
    const others = Object.keys(SUBTYPE_CONFIG).filter((k) => k !== "fastui")
    expect(others).toContain("_default")
    for (const subtype of others) {
      expect({ subtype, has: !!getSubtypeHandler(subtype)?.archiveUpload }).toEqual({ subtype, has: false })
    }
  })

  test("只认 fastui:// 身份:裸 loopback 地址返回 null,不去打包", async () => {
    let called = false
    ;(window as unknown as { api?: unknown }).api = {
      fastuiExportZip: async () => {
        called = true
        return { ok: true, zipPath: "/x.zip", bytes: 1 }
      },
    }
    const ctx = {
      tab: { id: "t", title: "t", type: "html", subtype: "fastui", content: "", filePath: "http://127.0.0.1:8081" },
      sdkDirectory: "/proj",
      sessionId: "s1",
      showOctoToast: () => {},
      tracker: { interaction: () => {} },
    } as unknown as SubtypeHandlerContext
    const upload = getSubtypeHandler("fastui")!.archiveUpload!
    expect(await upload.onConfirm(ctx, {} as never)).toBeNull()
    expect(called).toBe(false)
    ;(window as unknown as { api?: unknown }).api = undefined
  })
})

describe("absoluteLinkPath(SPEC-DES-008 §3.8 补预览卡片时把文件卡片的路径转成绝对路径)", () => {
  test("Windows 绝对路径:反斜杠转正斜杠", async () => {
    const { absoluteLinkPath } = await import("./fastui-export")
    expect(absoluteLinkPath("C:\\ws\\dash\\packages\\portal\\src\\views\\index.vue", "C:\\ws")).toBe(
      "C:/ws/dash/packages/portal/src/views/index.vue",
    )
  })
  test("相对路径:相对工作区拼接", async () => {
    const { absoluteLinkPath } = await import("./fastui-export")
    expect(absoluteLinkPath("dash/packages/portal/src/views/index.vue", "C:\\ws\\")).toBe("C:/ws/dash/packages/portal/src/views/index.vue")
  })
  test("Unix 绝对路径:原样归一", async () => {
    const { absoluteLinkPath } = await import("./fastui-export")
    expect(absoluteLinkPath(" /Users/a//ws/dash/index.vue ", "/Users/a/ws")).toBe("/Users/a/ws/dash/index.vue")
  })
})
