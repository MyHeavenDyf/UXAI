import { describe, expect, test } from "bun:test"
import { Project } from "@/project/project"
import * as Log from "@opencode-ai/core/util/log"
import path from "node:path"
import { $ } from "bun"
import { tmpdir } from "../fixture/fixture"
import { Effect } from "effect"

Log.init({ print: false })

function run<A>(fn: (svc: Project.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Project.Service
      return yield* fn(svc)
    }).pipe(Effect.provide(Project.defaultLayer)),
  )
}

// 路径哈希方案的身份共享语义:同仓库的子目录与 linked worktree 必须共享同一
// projectID,否则同一仓库会被拆成多个项目(会话/记忆/工作区关联全部断裂)。
describe("project scope sharing", () => {
  test("同一仓库的子目录与仓库根共享同一 projectID", async () => {
    await using tmp = await tmpdir({ git: true })
    const sub = path.join(tmp.path, "packages", "sub")
    await $`mkdir -p ${sub}`.quiet()
    const root = await run((svc) => svc.fromDirectory(tmp.path))
    const dir = await run((svc) => svc.fromDirectory(sub))
    expect(dir.project.id).toBe(root.project.id)
  })

  test("linked worktree 与主仓共享同一 projectID", async () => {
    await using tmp = await tmpdir({ git: true })
    const wt = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-wt2")
    await $`git worktree add ${wt}`.cwd(tmp.path).quiet().nothrow()
    try {
      const root = await run((svc) => svc.fromDirectory(tmp.path))
      const other = await run((svc) => svc.fromDirectory(wt))
      expect(other.project.id).toBe(root.project.id)
    } finally {
      await $`git worktree remove --force ${wt}`.cwd(tmp.path).quiet().nothrow()
    }
  })

  test("不同目录(非 git)派生不同 projectID", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir()
    const a = await run((svc) => svc.fromDirectory(tmp.path))
    const b = await run((svc) => svc.fromDirectory(other.path))
    expect(a.project.id).not.toBe(b.project.id)
  })
})
