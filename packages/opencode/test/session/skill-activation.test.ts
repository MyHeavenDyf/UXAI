import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

// SPEC-INS-029：extra.skills 是前端自由透传字段（Record<string, unknown>），服务端据此发 skill.used。
// 上报是旁路观测，任何脏输入都必须静默降级为「不发事件」，绝不能抛错阻断本次发送。
describe("readActivatedSkills (SPEC-INS-029)", () => {
  const read = SessionPrompt.readActivatedSkills

  test("读出合法技能名", () => {
    expect(read({ skills: ["interview-analysis", "persona"] })).toEqual(["interview-analysis", "persona"])
  })

  test("无 extra / 无 skills 键 → 空", () => {
    expect(read(undefined)).toEqual([])
    expect(read({})).toEqual([])
    expect(read({ other: "x" })).toEqual([])
  })

  test("skills 非数组 → 空，不抛错", () => {
    expect(read({ skills: "interview-analysis" })).toEqual([])
    expect(read({ skills: 123 })).toEqual([])
    expect(read({ skills: null })).toEqual([])
    expect(read({ skills: { name: "x" } })).toEqual([])
  })

  test("过滤非字符串 / 空串元素，保留其余", () => {
    expect(read({ skills: ["ok", 123, null, "", undefined, "also-ok"] })).toEqual(["ok", "also-ok"])
  })

  test("空数组 → 空（不发事件）", () => {
    expect(read({ skills: [] })).toEqual([])
  })

  test("与 studio 等其他 extra 字段共存不互相干扰", () => {
    expect(read({ skipPromptRefine: true, skills: ["persona"] })).toEqual(["persona"])
  })
})
