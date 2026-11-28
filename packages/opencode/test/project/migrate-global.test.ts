import { describe, expect, test } from "bun:test"
import { Project } from "@/project/project"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import path from "node:path"
import { SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
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

function uid() {
  return SessionID.make(crypto.randomUUID())
}

function seed(opts: { id: SessionID; dir: string; project: ProjectID; rowWorktree?: string }) {
  const now = Date.now()
  // FK: session.project_id 必须存在于 project 表,先 upsert
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({ id: opts.project, worktree: opts.rowWorktree ?? opts.dir, sandboxes: [] })
      .onConflictDoNothing()
      .run(),
  )
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: opts.project,
        slug: opts.id,
        directory: opts.dir,
        title: "test",
        version: "0.0.0-test",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function ensureGlobal() {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectID.global,
        worktree: "/",
        time_created: Date.now(),
        time_updated: Date.now(),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

describe("migrateFromGlobal", () => {
  test("migrates global sessions on first project creation", async () => {
    // 路径哈希方案:同一目录始终同一个 projectID(不因 git commit 出现而变),
    // 老 global 会话在首次解析时被迁移到正确的路径哈希 ID
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()
    await $`git config user.name "Test"`.cwd(tmp.path).quiet()
    await $`git config user.email "test@opencode.test"`.cwd(tmp.path).quiet()
    await $`git config commit.gpgsign false`.cwd(tmp.path).quiet()
    const { project: pre } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(pre.id).not.toBe(ProjectID.global)

    // 2. Seed a session under "global" with matching directory (旧版遗留)
    const id = uid()
    seed({ id, dir: tmp.path, project: ProjectID.global })

    const { project: real } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(real.id).toBe(pre.id) // 同目录 ID 稳定

    // 3. The session should have been migrated to the correct path-hash ID
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    expect(row!.project_id).toBe(real.id)
  })

  test("migrates global sessions even when project row already exists", async () => {
    // 1. Create a repo with a commit — real project ID created immediately
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(ProjectID.global)

    // 2. Ensure "global" project row exists (as it would from a prior no-git session)
    ensureGlobal()

    // 3. Seed a session under "global" with matching directory.
    //    This simulates a session created before git init that wasn't
    //    present when the real project row was first created.
    const id = uid()
    seed({ id, dir: tmp.path, project: ProjectID.global })

    // 4. Call fromDirectory again — project row already exists,
    //    so the current code skips migration entirely. This is the bug.
    await run((svc) => svc.fromDirectory(tmp.path))

    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    expect(row!.project_id).toBe(project.id)
  })

  test("does not claim sessions with empty directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(ProjectID.global)

    ensureGlobal()

    // Legacy sessions may lack a directory value.
    // Without a matching origin directory, they should remain global.
    const id = uid()
    seed({ id, dir: "", project: ProjectID.global })

    await run((svc) => svc.fromDirectory(tmp.path))

    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    expect(row!.project_id).toBe(ProjectID.global)
  })

  test("does not steal sessions from unrelated directories", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(ProjectID.global)

    ensureGlobal()

    // Seed a session under "global" but for a DIFFERENT directory
    const id = uid()
    seed({ id, dir: "/some/other/dir", project: ProjectID.global })

    await run((svc) => svc.fromDirectory(tmp.path))

    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row).toBeDefined()
    // Should remain under "global" — not stolen
    expect(row!.project_id).toBe(ProjectID.global)
  })

  test("migrates non-git global sessions by exact directory match", async () => {
    // 旧版非 git 会话全在 global 桶;非 git 目录 worktree 是 "/" 哨兵,
    // 迁移必须按打开目录精确认领,而不是依赖 worktree
    await using tmp = await tmpdir() // 无 git
    const id = uid()
    seed({ id, dir: tmp.path, project: ProjectID.global })

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row!.project_id).toBe(project.id)
  })

  test("migrates legacy git root-commit project sessions to the path-hash id", async () => {
    // 更早的方案:git 仓库 projectID = 首个 root commit 哈希;路径哈希方案下
    // 这些旧 ID 会话需要按 directory 归位到新 ID
    await using tmp = await tmpdir({ git: true })
    const revList = await $`git rev-list --max-parents=0 HEAD`.cwd(tmp.path).quiet()
    const legacyID = ProjectID.make(String(revList.stdout).trim().split("\n").toSorted()[0])
    const id = uid()
    seed({ id, dir: tmp.path, project: legacyID })

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(legacyID)
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row!.project_id).toBe(project.id)
  })

  test("migrates legacy sessions in repo subdirectories along with the worktree", async () => {
    // 旧方案下子目录会话与仓库根共享同一 projectID,前缀迁移必须覆盖它们
    await using tmp = await tmpdir({ git: true })
    const sub = path.join(tmp.path, "packages", "sub")
    await $`mkdir -p ${sub}`.quiet()
    const revList = await $`git rev-list --max-parents=0 HEAD`.cwd(tmp.path).quiet()
    const legacyID = ProjectID.make(String(revList.stdout).trim().split("\n").toSorted()[0])
    const id = uid()
    // 旧方案下 project 行的 worktree 恒为仓库根(即使会话在子目录创建)
    seed({ id, dir: sub, project: legacyID, rowWorktree: tmp.path })

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row!.project_id).toBe(project.id)
  })

  test("does not steal nested-repo sessions into the parent project", async () => {
    // 主仓内的嵌套仓库有自己的 projectID(哈希嵌套仓根),父项目解析时不得误领
    await using tmp = await tmpdir({ git: true })
    const nested = path.join(tmp.path, "nested-repo")
    await $`mkdir -p ${nested}`.quiet()
    await $`git init`.cwd(nested).quiet()
    const nestedProject = await run((svc) => svc.fromDirectory(nested))

    const id = uid()
    seed({ id, dir: nested, project: nestedProject.project.id })

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(nestedProject.project.id)
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    expect(row!.project_id).toBe(nestedProject.project.id)
  })

  test("adopts legacy project fields and workspace rows, idempotently", async () => {
    await using tmp = await tmpdir({ git: true })
    const revList = await $`git rev-list --max-parents=0 HEAD`.cwd(tmp.path).quiet()
    const legacyID = ProjectID.make(String(revList.stdout).trim().split("\n").toSorted()[0])

    // 旧 project 行:带名称/图标/命令/初始化时间,名下挂一个 workspace
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: legacyID,
          worktree: tmp.path,
          sandboxes: [],
          name: "旧项目名",
          icon_url: "data:image/png;base64,aXh4",
          commands: { start: "pnpm dev" },
          time_initialized: 123,
        })
        .onConflictDoNothing()
        .run(),
    )
    const wsID = "wrk_legacy_001" as never
    Database.use((db) =>
      db
        .insert(WorkspaceTable)
        .values({ id: wsID, type: "local", name: "关联工作区", directory: tmp.path, project_id: legacyID })
        .onConflictDoNothing()
        .run(),
    )
    const legacySession = uid()
    seed({ id: legacySession, dir: tmp.path, project: legacyID, rowWorktree: tmp.path })

    const { project } = await run((svc) => svc.fromDirectory(tmp.path))
    expect(project.id).not.toBe(legacyID)
    // 项目级字段认领到新行
    expect(project.name).toBe("旧项目名")
    expect(project.icon?.url).toBe("data:image/png;base64,aXh4")
    expect(project.commands).toEqual({ start: "pnpm dev" })
    expect(project.time.initialized).toBe(123)
    // workspace 引用与旧会话一并归位
    expect(Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, wsID)).get())!.project_id).toBe(project.id)
    expect(Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, legacySession)).get())!.project_id).toBe(project.id)

    // 幂等:认领不覆盖后续用户修改
    Database.use((db) =>
      db.update(ProjectTable).set({ name: "用户改名" }).where(eq(ProjectTable.id, project.id)).run(),
    )
    await run((svc) => svc.fromDirectory(tmp.path))
    const again = await run((svc) => svc.fromDirectory(tmp.path))
    expect(again.project.name).toBe("用户改名")
  })
})
