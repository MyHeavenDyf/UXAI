import { describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { ConfigMarkdown } from "../../src/config/markdown"
import { Ripgrep } from "../../src/file/ripgrep"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { StudioSkillPolicy } from "../../src/studio/studio-skill-policy"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

describe("Studio skill policy", () => {
  test.each([
    ["/config/octo/sessions", "/config/octo", true],
    ["/config/octo/sessions/", "/config/octo/", true],
    ["/config/octo/./sessions", "/config/octo", true],
    ["/project/sessions", "/config/octo", false],
    ["/config/octo/sessions/project", "/config/octo", false],
    ["/config/octo/sessions-other", "/config/octo", false],
    ["/config/octo", "/config/octo", false],
    ["C:\\Users\\Test\\.config\\octo\\sessions", "C:\\Users\\Test\\.config\\octo", true],
    ["c:/users/test/.config/OCTO/sessions/", "C:\\Users\\Test\\.config\\octo", true],
    ["C:\\project\\sessions", "C:\\Users\\Test\\.config\\octo", false],
    ["D:\\Users\\Test\\.config\\octo\\sessions", "C:\\Users\\Test\\.config\\octo", false],
    ["\\\\server\\share\\octo\\sessions", "\\\\SERVER\\share\\octo", true],
  ])("matches only the Studio directory: %s", (directory, octoConfig, disabled) => {
    expect(StudioSkillPolicy.disabled(directory, octoConfig)).toBe(disabled)
  })

  it.live(
    "skips discovery and parsing for Studio, including after refresh, while projects retain skills",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const octoConfig = path.join(dir, "octo")
        const studio = path.join(octoConfig, "sessions")
        const project = path.join(dir, "project", "sessions")
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(
              path.join(octoConfig, "skill", "global-skill", "SKILL.md"),
              "---\nname: global-skill\ndescription: Global skill.\n---\nGlobal instructions.\n",
            ),
            Bun.write(
              path.join(studio, ".opencode", "skill", "studio-skill", "SKILL.md"),
              "---\nname: studio-skill\ndescription: Studio skill.\n---\nUnused instructions.\n",
            ),
            Bun.write(
              path.join(project, ".opencode", "skill", "project-skill", "SKILL.md"),
              "---\nname: project-skill\ndescription: Project skill.\n---\nProject instructions.\n",
            ),
          ]),
        )

        const layer = Skill.layer.pipe(
          Layer.provide(Discovery.defaultLayer),
          Layer.provide(Config.defaultLayer),
          Layer.provide(Bus.layer),
          Layer.provide(AppFileSystem.defaultLayer),
          Layer.provide(Global.layerWith({ octoConfig, home: path.join(dir, "home") })),
          Layer.provide(Ripgrep.defaultLayer),
        )

        yield* Effect.gen(function* () {
          const skill = yield* Skill.Service
          // These spies call through to the actual filesystem implementation.
          const scans = yield* Effect.acquireRelease(
            Effect.sync(() => spyOn(Glob, "scan")),
            (spy) => Effect.sync(() => spy.mockRestore()),
          )
          const parses = yield* Effect.acquireRelease(
            Effect.sync(() => spyOn(ConfigMarkdown, "parse")),
            (spy) => Effect.sync(() => spy.mockRestore()),
          )

          const checkStudio = Effect.gen(function* () {
            expect(yield* skill.dirs()).toEqual([])
            expect(yield* skill.all()).toEqual([])
            expect(yield* skill.get("global-skill")).toBeUndefined()
            expect(yield* skill.getMany(["global-skill", "studio-skill"])).toEqual([])
            expect(
              yield* skill.available({ name: "octo_studio", mode: "primary", permission: [], options: {} }),
            ).toEqual([])
          }).pipe(provideInstance(studio))

          yield* checkStudio
          expect(scans).not.toHaveBeenCalled()
          expect(parses).not.toHaveBeenCalled()

          yield* Effect.gen(function* () {
            expect((yield* skill.all()).map((item) => item.name)).toEqual(
              expect.arrayContaining(["global-skill", "project-skill"]),
            )
            expect(yield* skill.dirs()).toContain(path.join(octoConfig, "skill", "global-skill"))
          }).pipe(provideInstance(project))
          expect(scans).toHaveBeenCalled()
          expect(parses).toHaveBeenCalled()

          const scanCount = scans.mock.calls.length
          const parseCount = parses.mock.calls.length
          yield* skill.refresh()
          yield* checkStudio
          expect(scans.mock.calls.length).toBe(scanCount)
          expect(parses.mock.calls.length).toBe(parseCount)
        }).pipe(Effect.provide(layer))
      }),
    ),
  )
})
