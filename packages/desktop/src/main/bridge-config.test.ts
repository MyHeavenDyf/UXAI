import { describe, expect, test } from "bun:test"

import { getBridgeConfigForSubtype } from "./bridge-config"
import { extractSubtypeFromFilename } from "@opencode-ai/core/subtype-extractor"

// 防漂移断言：desktop 的 SUBTYPE_CONFIG 是渲染端
// packages/app/octoapp/pages/make/utils/subtype-config.ts 的手工副本。
// 缺条目会静默回退 _default——向渲染端已关闭编辑功能的产物（如 index.3d.html）
// 注入永不激活的 edit/modelEdit/resourceCollector bridge，且没有任何报错。
// 本文件把这些条目的注入集合锁死，配置被改坏时测试立即红。

describe("subtype 提取（文件名约定）", () => {
  test("index.3d.html → '3d'（与 index.gts.html → 'gts' 同一约定）", () => {
    expect(extractSubtypeFromFilename("index.3d.html")).toBe("3d")
    expect(extractSubtypeFromFilename("index.gts.html")).toBe("gts")
  })
})

describe("bridge 注入按 subtype 门控", () => {
  test("'3d'：编辑类 bridge 全关，保留标注/快照/基础 bridge", () => {
    const cfg = getBridgeConfigForSubtype("3d")
    expect(cfg.injectEdit).toBe(false) // 3D 元素非 DOM 组件，编辑器内置 iframe
    expect(cfg.injectEditStyle).toBe(false)
    expect(cfg.injectModelEdit).toBe(false)
    expect(cfg.injectResourceCollector).toBe(false) // 画布编辑关闭
    expect(cfg.injectComment).toBe(true) // comment feature 开启（标注）
    expect(cfg.injectSnapshot).toBe(true) // archive 开启，归档截图依赖
    expect(cfg.injectSandbox).toBe(true) // 基础 bridge 恒注入
    expect(cfg.injectAnnotate).toBe(true)
  })

  test("prototype：不注入 modelEdit bridge", () => {
    expect(getBridgeConfigForSubtype("prototype").injectModelEdit).toBe(false)
  })

  test("fastui：编辑/标注 bridge 全关（跨域 dev server，不经 local://，条目 inert 纯对齐）", () => {
    const cfg = getBridgeConfigForSubtype("fastui")
    expect(cfg.injectEdit).toBe(false)
    expect(cfg.injectModelEdit).toBe(false)
    expect(cfg.injectComment).toBe(false)
    expect(cfg.injectSnapshot).toBe(true) // archive 开启
  })

  test("未知/缺省 subtype 回退 _default（编辑 bridge 开启）", () => {
    expect(getBridgeConfigForSubtype("unknown-xyz").injectEdit).toBe(true)
    expect(getBridgeConfigForSubtype(undefined).injectEdit).toBe(true)
  })
})
