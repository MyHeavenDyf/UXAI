import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import path from "node:path"
import { mkdir, writeFile, readFile, symlink, open } from "node:fs/promises"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { observe, withFiles } from "../../src/tracking/scripts"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/fixture"

const it = testEffect(CrossSpawnSpawner.defaultLayer)
const setup = Effect.gen(function* () {
  const directory = yield* tmpdirScoped()
  const outputs = path.join(directory, ".octo", "session", "outputs")
  const uploads = path.join(directory, ".octo", "session", "uploads")
  yield* Effect.promise(() => Promise.all([mkdir(outputs, { recursive: true }), mkdir(uploads, { recursive: true })]))
  return { directory, outputs, uploads, sessionID: "session", abort: AbortSignal.any([]) }
})
const write = (files: string[], content: string, exit: number | null = 0) =>
  Effect.promise(async () => {
    await Promise.all(files.map((file) => writeFile(file, content)))
    return { metadata: { exit }, output: "done" }
  })

it.live("declared outputs create, uploaded files edit, identical bytes do not count", () =>
  Effect.gen(function* () {
    const input = yield* setup
    const created = ["report.xlsx", "report.pdf", "report.docx"].map((name) => path.join(input.outputs, name))
    const edited = path.join(input.uploads, "乱码.txt")
    yield* Effect.promise(() => writeFile(edited, "11111"))
    const result = yield* observe(
      { ...input, files: [...created, edited, created[0]] },
      write([...created, edited], "12345"),
    )
    expect(result.metadata.artifactScript.files.map((file) => file.operation).sort()).toEqual([
      "edit",
      "write",
      "write",
      "write",
    ])
    expect(result.metadata.artifactScript.reason).toBe("script-enqueued")
    const unchanged = yield* observe({ ...input, files: [...created, edited] }, write([...created, edited], "12345"))
    expect(unchanged.metadata.artifactScript.reason).toBe("script-no-change")
    expect(unchanged.metadata.artifactScript.files.every((file) => !file.operation)).toBe(true)
  }),
)

it.live("failed, timeout and cancelled commands never count files left behind", () =>
  Effect.gen(function* () {
    const input = yield* setup
    for (const exit of [1, null, 0]) {
      const controller = new AbortController()
      const file = path.join(input.outputs, `left-${exit}.pdf`)
      const command = write([file], "partial", exit).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (exit === 0) controller.abort()
          }),
        ),
      )
      const result = yield* observe({ ...input, files: [file], abort: controller.signal }, command)
      expect(result.metadata.artifactScript.files[0].reason).toBe("script-not-successful")
      expect(result.metadata.artifactScript.files[0].operation).toBeUndefined()
    }
  }),
)

it.live("undeclared, outside, missing, directories and oversized files do not become events", () =>
  Effect.gen(function* () {
    const input = yield* setup
    const outside = path.join(input.directory, "manual.txt")
    const missing = path.join(input.outputs, "missing.pdf")
    const large = path.join(input.outputs, "large.pdf")
    yield* Effect.promise(async () => {
      const handle = await open(large, "w")
      await handle.truncate(64 * 1024 * 1024 + 1)
      await handle.close()
    })
    const result = yield* observe(
      { ...input, files: [outside, missing, input.outputs, large] },
      write([outside], "changed"),
    )
    expect(result.metadata.artifactScript.files.every((file) => !file.operation)).toBe(true)
    expect(result.metadata.artifactScript.files.find((file) => file.path.endsWith("large.pdf"))?.before).toEqual({
      kind: "unverified",
      reason: "size-limit",
    })
    const omitted = yield* observe({ ...input, files: [] }, write([missing], "created"))
    expect(omitted.metadata.artifactScript.reason).toBe("script-no-targets")
    const excessive = yield* observe(
      { ...input, files: Array.from({ length: 33 }, (_, i) => path.join(input.outputs, `${i}.txt`)) },
      write([missing], "edited"),
    )
    expect(excessive.metadata.artifactScript.reason).toBe("script-target-limit")
    expect(yield* Effect.promise(() => readFile(missing, "utf8"))).toBe("edited")
  }),
)

it.live("junction escapes are diagnostic only", () =>
  Effect.gen(function* () {
    const input = yield* setup
    const outside = path.join(input.directory, "outside")
    yield* Effect.promise(() => mkdir(outside))
    yield* Effect.promise(() =>
      symlink(outside, path.join(input.outputs, "link"), process.platform === "win32" ? "junction" : "dir"),
    )
    const file = path.join(input.outputs, "link", "report.txt")
    const result = yield* observe({ ...input, files: [file] }, write([file], "changed"))
    expect(result.metadata.artifactScript.files[0].before).toEqual({
      kind: "unverified",
      reason: "symlink-outside-session-files",
    })
    expect(result.metadata.artifactScript.files[0].operation).toBeUndefined()
  }),
)

it.live("overlapping targets serialize before snapshots, including reversed multi-file order", () =>
  Effect.gen(function* () {
    const input = yield* setup
    const files = [path.join(input.outputs, "one.txt"), path.join(input.outputs, "two.txt")]
    const results = yield* Effect.all(
      [
        observe({ ...input, files }, write(files, "first")),
        observe({ ...input, files: [...files].reverse() }, write(files, "second")),
      ],
      { concurrency: "unbounded" },
    )
    expect(
      results.flatMap((result) => result.metadata.artifactScript.files.map((file) => file.operation)).sort(),
    ).toEqual(["edit", "edit", "write", "write"])
  }),
)

it.live("unrelated files run concurrently and interrupted lock waiters do not leak permits", () =>
  Effect.gen(function* () {
    const input = yield* setup
    const first = path.join(input.outputs, "one.txt")
    const second = path.join(input.outputs, "two.txt")
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const holder = yield* withFiles(
      [first],
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
      }),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    const waiter = yield* withFiles([first], Effect.die("cancelled waiter must not execute")).pipe(Effect.forkScoped)
    yield* withFiles([second], write([second], "parallel"))
    yield* Fiber.interrupt(waiter)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(holder)
    yield* withFiles([first], write([first], "unlocked"))
    expect(yield* Effect.promise(() => readFile(first, "utf8"))).toBe("unlocked")
  }),
)
