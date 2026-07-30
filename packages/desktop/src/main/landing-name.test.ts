import { describe, expect, test } from "bun:test"

import { landingName, LANDING_NAME_REJECTED } from "./landing-name"

// SPEC-INS-026 §11.1 V1–V3。
// 平台显式传参:V1/V2 的「逐字保留」只在非 Windows 成立,不能让本机 platform 决定断言含义。

describe("landingName 逐字保留(V1)", () => {
  test("括号不再变 _", () => {
    expect(landingName("林(2).json", "darwin")).toBe("林(2).json")
  })

  test("空格不再变 _", () => {
    expect(landingName("我的 报告 v2.md", "darwin")).toBe("我的 报告 v2.md")
  })

  test("linux 同样逐字保留", () => {
    expect(landingName("A B(1) [终稿].md", "linux")).toBe("A B(1) [终稿].md")
  })

  test("主名不再截 100 字符", () => {
    const stem = "长".repeat(120) // 120 字符 = 360 字节,超 255 字节上限
    const out = landingName(`${stem}.md`, "darwin")
    expect(out.endsWith(".md")).toBe(true)
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(255)
    // 旧规则会截到 100 字符;新规则按字节截,255-3 字节 = 84 个三字节汉字
    expect(out.slice(0, -3).length).toBe(84)
  })

  test("未超长的长名一字不动", () => {
    const name = `${"a".repeat(200)}.md`
    expect(landingName(name, "darwin")).toBe(name)
  })
})

describe("landingName 拒绝(V2)", () => {
  test("含 / 抛错", () => {
    expect(() => landingName("a/b.json", "darwin")).toThrow(LANDING_NAME_REJECTED)
  })

  test("含 \\ 抛错", () => {
    expect(() => landingName("a\\b.json", "darwin")).toThrow(LANDING_NAME_REJECTED)
  })

  test("含 NUL 抛错", () => {
    expect(() => landingName("a\0b.json", "darwin")).toThrow(LANDING_NAME_REJECTED)
  })

  test(".. 抛错", () => {
    expect(() => landingName("..", "darwin")).toThrow(LANDING_NAME_REJECTED)
  })

  test(". 抛错", () => {
    expect(() => landingName(".", "darwin")).toThrow(LANDING_NAME_REJECTED)
  })

  test("空名 / 纯空白抛错", () => {
    expect(() => landingName("", "darwin")).toThrow(LANDING_NAME_REJECTED)
    expect(() => landingName("   ", "darwin")).toThrow(LANDING_NAME_REJECTED)
  })

  test("Windows 下路径穿越同样拒绝,不因分支处理而漏掉", () => {
    expect(() => landingName("../x.json", "win32")).toThrow(LANDING_NAME_REJECTED)
    expect(() => landingName("..", "win32")).toThrow(LANDING_NAME_REJECTED)
  })
})

describe("landingName Windows 分支(V3)", () => {
  test("非法字符替换为 _", () => {
    expect(landingName("a:b.json", "win32")).toBe("a_b.json")
    expect(landingName('a<b>c|d?e*f".txt', "win32")).toBe("a_b_c_d_e_f_.txt")
  })

  test("保留名不原样落盘", () => {
    expect(landingName("CON.txt", "win32")).not.toBe("CON.txt")
    expect(landingName("CON.txt", "win32")).toBe("CON_.txt")
    expect(landingName("nul", "win32")).toBe("nul_")
    expect(landingName("COM9.md", "win32")).toBe("COM9_.md")
  })

  test("保留名前缀不误伤", () => {
    expect(landingName("CONSOLE.txt", "win32")).toBe("CONSOLE.txt")
    expect(landingName("COM10.md", "win32")).toBe("COM10.md")
  })

  test("去掉尾部 . 与空格", () => {
    expect(landingName("report.", "win32")).toBe("report")
    expect(landingName("report ", "win32")).toBe("report")
  })

  test("非 Windows 不做这些替换", () => {
    expect(landingName("a:b.json", "darwin")).toBe("a:b.json")
    expect(landingName("CON.txt", "darwin")).toBe("CON.txt")
    expect(landingName("report.", "darwin")).toBe("report.")
  })
})

describe("landingName 超长截断保扩展名", () => {
  test("ASCII 主名截到上限且保住扩展名", () => {
    const out = landingName(`${"a".repeat(400)}.json`, "darwin")
    expect(out.endsWith(".json")).toBe(true)
    expect(Buffer.byteLength(out, "utf8")).toBe(255)
  })

  test("不切断多字节字符", () => {
    const out = landingName(`${"报".repeat(200)}.md`, "darwin")
    expect(out).not.toContain("�")
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(255)
  })

  test("无扩展名整体截断", () => {
    const out = landingName("z".repeat(400), "darwin")
    expect(Buffer.byteLength(out, "utf8")).toBe(255)
  })

  test("病态超长扩展名放弃保扩展名,仍不超上限", () => {
    const out = landingName(`a.${"e".repeat(400)}`, "darwin")
    expect(Buffer.byteLength(out, "utf8")).toBe(255)
  })
})
