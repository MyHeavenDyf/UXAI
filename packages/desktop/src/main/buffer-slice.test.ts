import { describe, expect, test } from "bun:test"

import { toExactArrayBuffer } from "./buffer-slice"

// Node Buffer 池化陷阱的回归守卫。
//
// 测试不依赖运行时池化行为(bun 不池化、node 对 <4KB 池化到 8192 字节共享池),而是手工构造
// 「池内偏移视图」模拟 readFile 拿到的小文件 / 空文件分布,并用 0xff 填充,让退化实现
// (return buf.buffer)返回 8192 字节可见垃圾,从而在任意运行体都能挂掉。

describe("toExactArrayBuffer 池化视图", () => {
  test("0 长度视图挂在池上:只返回 0 字节(不夹整池)", () => {
    const pool = Buffer.alloc(8192, 0xff)
    const out = toExactArrayBuffer(pool.subarray(0, 0) as Buffer)
    expect(out.byteLength).toBe(0)
  })

  test("池内偏移只取 [offset, offset+len),内容正确、不夹 0xff 残留", () => {
    const pool = Buffer.alloc(8192, 0xff)
    pool.write("ab", 100)
    const out = toExactArrayBuffer(pool.subarray(100, 102) as Buffer)
    expect(out.byteLength).toBe(2)
    expect(new TextDecoder().decode(out)).toBe("ab")
  })
})

describe("toExactArrayBuffer 非池化大文件", () => {
  test("≥4KB(byteOffset=0 且占满 buffer)直接返回原引用,不复制", () => {
    const buf = Buffer.alloc(8192, 65)
    // 非池化:byteOffset===0 && byteLength===buffer.byteLength → 返回同一引用
    expect(toExactArrayBuffer(buf)).toBe(buf.buffer)
    expect(buf.buffer.byteLength).toBe(8192)
  })
})
