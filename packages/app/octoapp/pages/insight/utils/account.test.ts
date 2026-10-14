import { afterEach, describe, expect, test } from "bun:test"
import { currentUserId } from "./account"

// SPEC-INS-033:userId 取自 localStorage.userInfo.userId,trim 后为空即 undefined,不做兜底。
afterEach(() => localStorage.removeItem("userInfo"))

describe("currentUserId", () => {
  test("读出 userInfo.userId 并 trim", () => {
    localStorage.setItem("userInfo", JSON.stringify({ account: "c60050492", userId: "  uuid~bDYwMDYyNjUw " }))
    expect(currentUserId()).toBe("uuid~bDYwMDYyNjUw")
  })

  test("缺 userInfo / 缺字段 / 空串 / 非字符串 / 坏 JSON 一律 undefined", () => {
    expect(currentUserId()).toBeUndefined()
    localStorage.setItem("userInfo", JSON.stringify({ account: "c60050492" }))
    expect(currentUserId()).toBeUndefined()
    localStorage.setItem("userInfo", JSON.stringify({ userId: "   " }))
    expect(currentUserId()).toBeUndefined()
    localStorage.setItem("userInfo", JSON.stringify({ userId: 123 }))
    expect(currentUserId()).toBeUndefined()
    localStorage.setItem("userInfo", "{not json")
    expect(currentUserId()).toBeUndefined()
  })
})
