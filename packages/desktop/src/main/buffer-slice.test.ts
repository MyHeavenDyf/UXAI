import { describe, expect, test } from "bun:test"

import { toExactArrayBuffer } from "./buffer-slice"

// Node Buffer 池化陷阱的回归守卫:空文件不夹 64KB 池、小文件不夹残留、大文件不复制。

describe("toExactArrayBuffer 空文件", () => {
  test("0 字节 Buffer 返回 0 字节 ArrayBuffer", () => {
    const buf = Buffer.alloc(0)
    const out = toExactArrayBuffer(buf)
    expect(out.byteLength).toBe(0)
  })
})

describe("toExactArrayBuffer 池化小文件", () => {
  test("Buffer.from('ab') 不夹池内残留", () => {
    const buf = Buffer.from("ab")
    const out = toExactArrayBuffer(buf)
    expect(out.byteLength).toBe(2)
    expect(new TextDecoder().decode(out)).toBe("ab")
  })

  test("池内偏移 Buffer 只返回 [offset, offset+len) 切片", () => {
    // 在一个大 Buffer 上切片,模拟池内偏移分配
    const pool = Buffer.alloc(8192, 0)
    const sub = pool.subarray(100, 105) // byteOffset=100, byteLength=5
    const out = toExactArrayBuffer(sub as Buffer)
    expect(out.byteLength).toBe(5)
  })
})

describe("toExactArrayBuffer 非池化大文件", () => {
  test("≥4KB Buffer 直接返回原 buffer,不复制", () => {
    const buf = Buffer.alloc(8192, 65) // 'A'
    const out = toExactArrayBuffer(buf)
    // 非池化:byteOffset===0 && byteLength===buffer.byteLength → 返回同一引用
    expect(out).toBe(buf.buffer)
    expect(out.byteLength).toBe(8192)
  })
})
