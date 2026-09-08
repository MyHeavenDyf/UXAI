import { describe, expect, test } from "bun:test"
import { runSceneGate, type ConsoleEntry } from "./scene-gate"

// ── runSceneGate：渐进读 console buffer（P0.13）──
// 报错秒回 FAIL / 无错 settleMs 内判 PASS / 慢报错 timeoutMs 内仍抓到。
// 用短 settleMs/timeoutMs 保持测试快（真实调用 settleMs=3000 / timeoutMs=12000）。
describe("runSceneGate", () => {
  test("无报错 → settleMs 内判 PASS（不拖到 timeoutMs）", async () => {
    const start = Date.now()
    const res = await runSceneGate({
      plan: null,
      sceneData: null,
      settleMs: 400,
      timeoutMs: 3000,
      readConsoleBuffer: () => [],
    })
    const elapsed = Date.now() - start
    expect(res.passed).toBe(true)
    expect(res.findings).toEqual([])
    // settleMs≈400ms，不拖到 timeoutMs=3000
    expect(elapsed).toBeLessThan(1500)
  })

  test("首帧就有 error → 秒回 FAIL", async () => {
    const start = Date.now()
    const res = await runSceneGate({
      plan: null,
      sceneData: null,
      settleMs: 400,
      timeoutMs: 3000,
      readConsoleBuffer: () => [
        { level: "error", message: "inner.rect is not a function" },
      ],
    })
    const elapsed = Date.now() - start
    expect(res.passed).toBe(false)
    expect(res.findings.length).toBeGreaterThanOrEqual(1)
    expect(res.findings[0].message).toContain("inner.rect")
    expect(res.findings[0].level).toBe("error")
    expect(elapsed).toBeLessThan(200)
  })

  test("settleMs 内进 buffer 的报错 → 抓到（不等满 settleMs）", async () => {
    const t0 = Date.now()
    const buffer: ConsoleEntry[] = []
    // 200ms 后塞一个 error（在 settleMs=600 内，但首帧 buffer 为空）
    setTimeout(() => {
      buffer.push({ level: "error", message: "in-window handler error" })
    }, 200)
    const res = await runSceneGate({
      plan: null,
      sceneData: null,
      settleMs: 600,
      timeoutMs: 3000,
      readConsoleBuffer: () => [...buffer],
    })
    const elapsed = Date.now() - t0
    expect(res.passed).toBe(false)
    expect(res.findings.some((f) => f.message === "in-window handler error")).toBe(true)
    // 报错 200ms 发生 → 下一轮 ~500ms 轮询抓到（首帧 buffer 为空，先 sleep 500 再读）
    expect(elapsed).toBeLessThan(1200)
  })

  test("fatal（SCENE_ERROR）→ 判 FAIL 且 code=scene-build-error", async () => {
    const res = await runSceneGate({
      plan: null,
      sceneData: null,
      settleMs: 400,
      timeoutMs: 3000,
      readConsoleBuffer: () => [
        { level: "error", message: "scene build failed", fatal: true },
      ],
    })
    expect(res.passed).toBe(false)
    expect(res.findings[0].code).toBe("scene-build-error")
  })

  test("warn 但无 error → 判 PASS（warn 不挡）", async () => {
    const res = await runSceneGate({
      plan: null,
      sceneData: null,
      settleMs: 400,
      timeoutMs: 3000,
      readConsoleBuffer: () => [
        { level: "warn", message: "deprecation warning" },
      ],
    })
    expect(res.passed).toBe(true)
    expect(res.findings.length).toBe(1)
    expect(res.findings[0].level).toBe("warn")
  })

  test("报错在 settleMs 之前进 buffer → 秒回（不等满 settleMs）", async () => {
    const buffer: ConsoleEntry[] = []
    setTimeout(() => {
      buffer.push({ level: "error", message: "early error" })
    }, 100)
    const start = Date.now()
    const res = await runSceneGate({
      plan: null,
      sceneData: null,
      settleMs: 2000,
      timeoutMs: 5000,
      readConsoleBuffer: () => [...buffer],
    })
    const elapsed = Date.now() - start
    expect(res.passed).toBe(false)
    // 报错 100ms 发生 → 下一轮 ~500ms 轮询抓到（首帧 buffer 为空，先 sleep 500 再读）
    expect(elapsed).toBeLessThan(1200)
  })
})
