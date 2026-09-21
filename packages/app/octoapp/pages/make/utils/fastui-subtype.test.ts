/**
 * fastui 预览卡片的独立 subtype(SPEC-DES-005)。
 *
 * 判据:fastui tab 在 url 的能力之上只多开分辨率切换;url(所有 http(s) 外链 tab)的能力与
 * 按钮回到通用形态,不再带 fastui 专属的导出按钮;导出按钮只认 `fastui://` 身份。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-subtype.test.ts(在 packages/app 下)
 */
import { afterEach, describe, expect, test } from "bun:test"

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
}

describe("能力表", () => {
  test("fastui = url + 分辨率切换", () => {
    expect(getSubtypeConfig("fastui").features).toEqual({ ...URL_FEATURES, viewport: true })
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

describe("导出代码包按钮", () => {
  const exportButton = () => {
    const btn = getSubtypeHandler("fastui")?.components?.actionBar?.extraButtons?.find((b) => b.id === "fastui-export-zip")
    if (!btn) throw new Error("fastui handler 缺少导出按钮")
    return btn
  }

  const ctxFor = (filePath: string, sessionId: string): SubtypeHandlerContext =>
    ({
      tab: { id: "t", title: "t", type: "html", subtype: "fastui", content: "", filePath },
      sdkDirectory: "/proj",
      sessionId,
    }) as unknown as SubtypeHandlerContext

  const visible = (ctx: SubtypeHandlerContext) => {
    const v = exportButton().visible
    return typeof v === "function" ? v(ctx) : !!v
  }

  const setFileExists = (fn?: (p: string) => Promise<boolean>) => {
    ;(window as unknown as { api?: unknown }).api = fn ? { fileExists: fn } : undefined
  }

  afterEach(() => setFileExists(undefined))

  test("fastui:// 卡片在 fastui 会话里显示(会话判据异步探测后生效)", async () => {
    const seen: string[] = []
    setFileExists(async (p) => {
      seen.push(p)
      return true
    })
    const ctx = ctxFor("fastui://user-page", "s-visible")
    expect(visible(ctx)).toBe(false) // 首次触发探测
    await new Promise((r) => setTimeout(r, 0))
    expect(visible(ctx)).toBe(true)
    expect(seen).toEqual(["/proj/.octo/s-visible/.octo-fastui.json"])
  })

  test("旧版卡片转来的 fastui://(产物名为空)同样适用", async () => {
    setFileExists(async () => true)
    const ctx = ctxFor("fastui://", "s-legacy")
    visible(ctx)
    await new Promise((r) => setTimeout(r, 0))
    expect(visible(ctx)).toBe(true)
  })

  test("非 fastui 会话不显示", async () => {
    setFileExists(async () => false)
    const ctx = ctxFor("fastui://user-page", "s-plain")
    visible(ctx)
    await new Promise((r) => setTimeout(r, 0))
    expect(visible(ctx)).toBe(false)
  })

  test("只认 fastui:// 身份:裸 loopback 地址不显示,也不去探测", async () => {
    let probed = false
    setFileExists(async () => {
      probed = true
      return true
    })
    const ctx = ctxFor("http://127.0.0.1:8081", "s-loopback")
    expect(visible(ctx)).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(visible(ctx)).toBe(false)
    expect(probed).toBe(false)
  })
})
