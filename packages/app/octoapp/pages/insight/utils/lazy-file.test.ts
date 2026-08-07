import { describe, expect, test } from "bun:test"
import { makeLazyFile, shouldUseLazyFile } from "./lazy-file"

// LazyFile 契约守卫:过 instanceof File / DataTransfer.items.add 内部槽校验是关键,
// size getter 与 slice 返回的 Blob 其 arrayBuffer 按需拉字节是流式上传的核心。
// 任一退化(如 size 读到 0、slice 返回非 Blob、arrayBuffer 物化整份)即回归原 bug。

const MiB = 1024 * 1024

describe("makeLazyFile 身份", () => {
  test("instanceof File 通过(过 DataTransfer.items.add 内部槽校验)", () => {
    const f = makeLazyFile({ size: 2_500_000_000, name: "big.zip", readRange: async () => new ArrayBuffer(0) })
    expect(f instanceof File).toBe(true)
  })

  test("size 走真实大小,而非底层空 ByteSequence 的 0", () => {
    const f = makeLazyFile({ size: 2_500_000_000, name: "big.zip", readRange: async () => new ArrayBuffer(0) })
    expect(f.size).toBe(2_500_000_000)
  })

  test("name / type / lastModified 透传", () => {
    const f = makeLazyFile({
      size: 100,
      name: "a.zip",
      mime: "application/zip",
      lastModified: 1700000000000,
      readRange: async () => new ArrayBuffer(0),
    })
    expect(f.name).toBe("a.zip")
    expect(f.type).toBe("application/zip")
    expect(f.lastModified).toBe(1700000000000)
  })
})

describe("makeLazyFile slice 流式读", () => {
  test("slice 返回 instanceof Blob(过 SDK instanceof 校验)", () => {
    const f = makeLazyFile({ size: 100, name: "a", readRange: async () => new ArrayBuffer(0) })
    expect(f.slice(0, 10) instanceof Blob).toBe(true)
  })

  test("slice 出的 Blob.size 是区间长度", () => {
    const f = makeLazyFile({ size: 100, name: "a", readRange: async () => new ArrayBuffer(0) })
    expect(f.slice(10, 30).size).toBe(20)
  })

  test("arrayBuffer 调 readRange(start, end) 拉对应区间,不物化整份", async () => {
    let called: { s: number; e: number } | null = null
    const f = makeLazyFile({
      size: 2_500_000_000,
      name: "big.zip",
      readRange: async (s, e) => {
        called = { s, e }
        const buf = new ArrayBuffer(e - s)
        return buf
      },
    })
    const blob = f.slice(1_000_000, 1_010_000)
    const buf = await blob.arrayBuffer()
    expect(called!).toEqual({ s: 1_000_000, e: 1_010_000 })
    expect(buf.byteLength).toBe(10_000)
  })

  test("arrayBuffer 内部分片拼接:readRange 单次截断(模拟 IPC 16MB 上限),拼出完整 slice", async () => {
    // 模拟 IPC 静默截断:readRange 返回 min(请求长度, 16MB) 字节
    const calls: Array<{ s: number; len: number }> = []
    const f = makeLazyFile({
      size: 100 * 1024 * 1024,  // 100MB 文件
      name: "big.zip",
      readRange: async (s, e) => {
        const IPC_CAP = 16 * 1024 * 1024
        const actual = Math.min(e - s, IPC_CAP)
        calls.push({ s, len: actual })
        // 填充可识别字节:s 处放 s & 0xff
        const buf = new Uint8Array(actual)
        for (let i = 0; i < actual; i++) buf[i] = (s + i) & 0xff
        return buf.buffer
      },
    })
    // 切 50MB slice(>16MB IPC 上限),arrayBuffer 必须分片拼出完整 50MB
    const blob = f.slice(0, 50 * 1024 * 1024)
    const buf = await blob.arrayBuffer()
    expect(buf.byteLength).toBe(50 * 1024 * 1024)
    // 多次 readRange 调用(每次 ≤8MB LazyFile 内部分片)
    expect(calls.length).toBeGreaterThan(1)
    // 字节正确性:第 i 字节应为 i & 0xff(未截断)
    const view = new Uint8Array(buf)
    for (let i = 0; i < view.length; i += 1024 * 1024) {
      expect(view[i]).toBe(i & 0xff)
    }
  })

  test("arrayBuffer 超 256MB 守卫:抛错防渲染端 OOM", async () => {
    const f = makeLazyFile({
      size: 500 * 1024 * 1024,
      name: "big.zip",
      readRange: async () => new ArrayBuffer(0),
    })
    expect(f.slice(0, 300 * 1024 * 1024).arrayBuffer()).rejects.toThrow(/too large/)
  })

  test("slice 越界自动夹到 [0, size]", () => {
    const f = makeLazyFile({ size: 100, name: "a", readRange: async () => new ArrayBuffer(0) })
    expect(f.slice(-10, 200).size).toBe(100)
    expect(f.slice(50, 200).size).toBe(50)
  })
})

describe("makeLazyFile 直读守卫", () => {
  test("file.arrayBuffer() 抛错,逼 SDK 走 slice 分片(避免静默空文件)", async () => {
    const f = makeLazyFile({ size: 100, name: "a", readRange: async () => new ArrayBuffer(0) })
    expect(f.arrayBuffer()).rejects.toThrow(/slice\(\)/)
  })

  test("file.text() 抛错(同因)", async () => {
    const f = makeLazyFile({ size: 100, name: "a", readRange: async () => new ArrayBuffer(0) })
    expect(f.text()).rejects.toThrow()
  })
})

describe("shouldUseLazyFile 阈值", () => {
  test("256MiB - 1 走原路径(小文件 readFileBuffer 物化)", () => {
    expect(shouldUseLazyFile(256 * MiB - 1)).toBe(false)
  })

  test("256MiB + 1 走 LazyFile(避免物化)", () => {
    expect(shouldUseLazyFile(256 * MiB + 1)).toBe(true)
  })
})
