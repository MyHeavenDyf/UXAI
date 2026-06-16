// SPEC-INS-011 §9.6:错误信标纯函数单测(localStorage 环形 / 格式化 / recordError 归一化)。
import { beforeEach, describe, expect, test } from "bun:test"
import { formatBeacons, readBeacons, recordBeacon, recordError, setBeaconContext } from "./error-beacon"

const KEY = "octo:insight:error-beacons"

beforeEach(() => {
  localStorage.removeItem(KEY)
  setBeaconContext({ directory: undefined, sessionID: undefined })
})

describe("error-beacon localStorage 环形", () => {
  test("recordBeacon 写入并能 readBeacons 读回", () => {
    recordBeacon({ type: "http", method: "GET", url: "/x", status: 400, body: "boom" })
    const all = readBeacons()
    expect(all.length).toBe(1)
    expect(all[0].status).toBe(400)
    expect(all[0].body).toBe("boom")
    expect(typeof all[0].ts).toBe("number")
  })

  test("超过 5 条只保留最近 5 条(丢最旧)", () => {
    for (let i = 0; i < 8; i++) recordBeacon({ type: "http", status: 400, url: `/r${i}` })
    const all = readBeacons()
    expect(all.length).toBe(5)
    expect(all[0].url).toBe("/r3") // 0,1,2 被丢
    expect(all[4].url).toBe("/r7")
  })

  test("setBeaconContext 给每条标当时 directory/session", () => {
    setBeaconContext({ directory: "/proj", sessionID: "ses_1" })
    recordBeacon({ type: "uncaught", message: "x" })
    const [b] = readBeacons()
    expect(b.directory).toBe("/proj")
    expect(b.sessionID).toBe("ses_1")
  })

  test("localStorage 损坏时 readBeacons 返回空数组(不抛)", () => {
    localStorage.setItem(KEY, "{not json")
    expect(readBeacons()).toEqual([])
  })
})

describe("recordError 归一化", () => {
  test("Error 对象取 message + stack", () => {
    recordError("boundary", new Error("kaboom"))
    const [b] = readBeacons()
    expect(b.type).toBe("boundary")
    expect(b.message).toBe("kaboom")
    expect(b.stack).toContain("kaboom")
  })

  test("字符串错误 + 无 stack", () => {
    recordError("uncaught", "plain string error")
    const [b] = readBeacons()
    expect(b.message).toBe("plain string error")
    expect(b.stack).toBeUndefined()
  })
})

describe("formatBeacons 面向 Claude 的纯文本", () => {
  test("无记录给出占位", () => {
    expect(formatBeacons([])).toContain("无记录")
  })

  test("HTTP 条目含状态码 + 响应体", () => {
    const text = formatBeacons([
      { ts: Date.now(), type: "http", method: "POST", url: "/session", status: 400, body: `{"error":"bad union"}`, directory: "/proj", sessionID: "ses_1" },
    ])
    expect(text).toContain("HTTP 400")
    expect(text).toContain("POST /session")
    expect(text).toContain("响应体:")
    expect(text).toContain("bad union")
    expect(text).toContain("dir=/proj")
    expect(text).toContain("session=ses_1")
  })

  test("异常条目含 message + 缩进 stack", () => {
    const text = formatBeacons([
      { ts: Date.now(), type: "uncaught", message: "TypeError x", stack: "at a\nat b" },
    ])
    expect(text).toContain("未捕获异常: TypeError x")
    expect(text).toContain("    at a")
  })
})
