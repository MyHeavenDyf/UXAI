import { describe, expect, test } from "bun:test"
import { archiveFileSizeError } from "./archive-size"

// EDM 文件归档大小区间 1B~4GiB 的边界守卫。上下界各测「界内 / 界上 / 界外」,
// 避免以后把 < 写成 <=、或把 4GiB(1024³)误改成十进制 4GB(10⁹,差 7.4%)时静默放行。

const GiB = 1024 * 1024 * 1024

describe("archiveFileSizeError 下限", () => {
  test("0 字节(空文件)被拒", () => {
    expect(archiveFileSizeError(0)).toBe("仅支持 1B~4GB 的文件")
  })

  test("1 字节(下限本身)通过", () => {
    expect(archiveFileSizeError(1)).toBeNull()
  })
})

describe("archiveFileSizeError 上限", () => {
  test("4GiB(上限本身)通过", () => {
    expect(archiveFileSizeError(4 * GiB)).toBeNull()
  })

  test("4GiB + 1 被拒", () => {
    expect(archiveFileSizeError(4 * GiB + 1)).toBe("仅支持 1B~4GB 的文件")
  })

  test("上限是 1024 进制而非十进制:4×10⁹ 仍在界内", () => {
    // 若有人把常量改成十进制 4e9,这条会挂
    expect(archiveFileSizeError(4_000_000_000)).toBeNull()
  })
})

describe("archiveFileSizeError 缺值", () => {
  test("size 为 undefined(uri 源 tab 无 size)不前置置灰,交中央守卫兜底", () => {
    expect(archiveFileSizeError(undefined)).toBeNull()
  })
})
