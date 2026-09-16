/**
 * 预览归属判定（SPEC-DES-004 §4.1）。
 *
 * 重心在**不该认作自己人**那一侧：认错的后果是确定地把另一个工程的页面挂出来，
 * 比「起不来」严重得多。
 */
import { describe, expect, test } from "bun:test"

import { resolveOwnership, type OwnershipEntry } from "./fastui-devserver"

const A = "/w/a/.octo/s1"
const B = "/w/b/.octo/s2"
const entry = (sessionDir: string, projectDir: string, port: number): OwnershipEntry => ({
  sessionDir,
  projectDir,
  port,
})

describe("resolveOwnership", () => {
  test("同一会话同一工程、端口对得上 → self", () => {
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/app", 8081)],
      sessionDir: A,
      port: 8081,
      projectName: "app",
      portIsFree: false,
    })
    expect(r.owner).toBe("self")
  })

  test("端口被另一个会话占着 → other，并带上本工程真正在听的端口", () => {
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/app", 8082), entry(B, "/w/b/.octo/s2/outputs/app", 8081)],
      sessionDir: A,
      port: 8081,
      projectName: "app",
      portIsFree: false,
    })
    expect(r).toEqual({ owner: "other", port: 8081, actualPort: 8082 })
  })

  test("同一会话的【另一个产物工程】占着这个端口 → 也是 other，不能认作自己人", () => {
    // 一个对话里 new-session --name 换过值：两个工程共存，卡片各指一个
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/beta", 8081)],
      sessionDir: A,
      port: 8081,
      projectName: "alpha",
      portIsFree: false,
    })
    expect(r.owner).toBe("other")
  })

  test("卡片指向的工程没在跑，另一个工程在跑 → 不回 actualPort（否则会切到别的工程上去）", () => {
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/beta", 8082)],
      sessionDir: A,
      port: 8081,
      projectName: "alpha",
      portIsFree: true,
    })
    expect(r).toEqual({ owner: "none", port: 8081, actualPort: undefined })
  })

  test("本工程换了端口 → none + actualPort，前端据此自愈", () => {
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/app", 8085)],
      sessionDir: A,
      port: 8081,
      projectName: "app",
      portIsFree: true,
    })
    expect(r).toEqual({ owner: "none", port: 8081, actualPort: 8085 })
  })

  test("拿不到产物名（老卡片）且本会话只有一个工程在跑 → 按会话认，允许自愈", () => {
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/app", 8085)],
      sessionDir: A,
      port: 8081,
      portIsFree: true,
    })
    expect(r).toEqual({ owner: "none", port: 8081, actualPort: 8085 })
  })

  test("拿不到产物名且本会话有多个工程在跑 → 有歧义，不回 actualPort", () => {
    const r = resolveOwnership({
      entries: [entry(A, "/w/a/.octo/s1/outputs/alpha", 8085), entry(A, "/w/a/.octo/s1/outputs/beta", 8086)],
      sessionDir: A,
      port: 8081,
      portIsFree: true,
    })
    expect(r.actualPort).toBeUndefined()
  })

  test("谁都没在跑、端口上却有人在听 → unknown（降级路径起的，无从判定）", () => {
    const r = resolveOwnership({ entries: [], sessionDir: A, port: 8081, projectName: "app", portIsFree: false })
    expect(r.owner).toBe("unknown")
  })

  test("谁都没在跑、端口也空着 → none", () => {
    const r = resolveOwnership({ entries: [], sessionDir: A, port: 8081, projectName: "app", portIsFree: true })
    expect(r).toEqual({ owner: "none", port: 8081, actualPort: undefined })
  })
})
