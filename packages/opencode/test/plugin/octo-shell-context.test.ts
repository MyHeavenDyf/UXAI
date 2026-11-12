import { describe, expect, test } from "bun:test"
import { OctoShellContextPlugin } from "../../src/agent/octo-shell-context"

// SPEC-DES-008 §3.3:shell 调用注入根会话 id 与工作区目录,供 fastui skill 定位工程。

type EnvHook = (input: { cwd: string; sessionID?: string; callID?: string }, output: { env: Record<string, string> }) => Promise<void>

type Row = { directory?: string; parentID?: string }

// 每个用例用独立 id 前缀,避免插件模块级缓存串场
let seq = 0
const uid = (name: string) => `ses_${name}_${++seq}`

async function envHook(rows: Record<string, Row>, opts: { directory?: string; failGet?: boolean } = {}) {
  const client = {
    session: {
      get: async ({ path: p }: { path: { id: string } }) => {
        if (opts.failGet) throw new Error("boom")
        return { data: rows[p.id] }
      },
    },
  }
  const h = await OctoShellContextPlugin({ client, directory: opts.directory ?? "/instance" } as never)
  return h["shell.env"] as unknown as EnvHook
}

async function run(hook: EnvHook, sessionID?: string) {
  const output = { env: {} as Record<string, string> }
  await hook({ cwd: "/anywhere", sessionID, callID: "c1" }, output)
  return output.env
}

describe("octo-shell-context", () => {
  test("根会话直接调用:注入自身 id 与它的 directory", async () => {
    const root = uid("root")
    const hook = await envHook({ [root]: { directory: "/ws/a" } })
    expect(await run(hook, root)).toEqual({ OCTO_SESSION_ID: root, OCTO_WORKSPACE_DIR: "/ws/a" })
  })

  test("子会话调用:注入的是根会话 id 与根会话的 directory", async () => {
    const root = uid("root")
    const mid = uid("mid")
    const child = uid("child")
    const hook = await envHook({
      [root]: { directory: "/ws/root" },
      [mid]: { directory: "/ws/mid", parentID: root },
      [child]: { directory: "/ws/child", parentID: mid },
    })
    expect(await run(hook, child)).toEqual({ OCTO_SESSION_ID: root, OCTO_WORKSPACE_DIR: "/ws/root" })
  })

  test("parentID 成环:不无限上溯,按当前会话处理", async () => {
    const a = uid("a")
    const b = uid("b")
    const hook = await envHook({ [a]: { directory: "/ws/a", parentID: b }, [b]: { directory: "/ws/b", parentID: a } })
    expect(await run(hook, a)).toEqual({ OCTO_SESSION_ID: a, OCTO_WORKSPACE_DIR: "/ws/a" })
  })

  test("session.get 失败:仍注入当前会话 id,工作区退回 instance 目录", async () => {
    const s = uid("s")
    const hook = await envHook({}, { failGet: true, directory: "/instance/dir" })
    expect(await run(hook, s)).toEqual({ OCTO_SESSION_ID: s, OCTO_WORKSPACE_DIR: "/instance/dir" })
  })

  test("没有 sessionID(PTY 等非会话调用):什么都不注入", async () => {
    const hook = await envHook({})
    expect(await run(hook, undefined)).toEqual({})
  })
})
