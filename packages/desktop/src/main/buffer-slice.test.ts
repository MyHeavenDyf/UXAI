import { describe, expect, test } from "bun:test"

import { toExactArrayBuffer } from "./buffer-slice"

// read-file-buffer 的字节精确性守卫。
//
// 用例手工构造 Buffer 视图,不依赖运行时的分配行为(bun / node、fs/promises / fs.sync 各不相同,
// 见 buffer-slice.ts 顶部实测表),并用 0xff 填充,让退化实现(return buf.buffer)返回可见垃圾,
// 从而在任意运行体都能挂掉。两种真实来源各一条:
//   · 空文件:fs/promises.readFile 走分块读取 → len=0 挂在 65536 的读缓冲上(本次 bug 的形态)
//   · 池内偏移:Buffer.from / readFileSync 的小分配 → byteOffset 非 0,挂在 8192 内部池上

describe("toExactArrayBuffer 视图不等于底层 buffer", () => {
  test("空文件形态:0 长度视图挂在 64KB 读缓冲上,只返回 0 字节", () => {
    const readBuffer = Buffer.alloc(65536, 0xff)
    const out = toExactArrayBuffer(readBuffer.subarray(0, 0) as Buffer)
    expect(out.byteLength).toBe(0)
  })

  test("池内偏移形态:只取 [offset, offset+len),内容正确、不夹 0xff 残留", () => {
    const pool = Buffer.alloc(8192, 0xff)
    pool.write("ab", 100)
    const out = toExactArrayBuffer(pool.subarray(100, 102) as Buffer)
    expect(out.byteLength).toBe(2)
    expect(new TextDecoder().decode(out)).toBe("ab")
  })
})

describe("toExactArrayBuffer 视图已精确", () => {
  test("byteOffset=0 且占满 buffer(生产路径下所有非空文件)直接返回原引用,不复制", () => {
    const buf = Buffer.alloc(8192, 65)
    expect(toExactArrayBuffer(buf)).toBe(buf.buffer)
    expect(buf.buffer.byteLength).toBe(8192)
  })
})
