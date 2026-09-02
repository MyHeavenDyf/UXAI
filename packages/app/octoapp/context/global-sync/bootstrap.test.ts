import { describe, expect, test } from "bun:test"
import type { OpencodeClient, Path, Project, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { QueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { bootstrapDirectory, isBootstrapRecent } from "./bootstrap"
import type { State, VcsCache } from "./types"

describe("global sync bootstrap", () => {
  test("treats initial and active bootstrap windows as recent", () => {
    expect(isBootstrapRecent({ booting: false, bootedAt: 0, now: 10_000 })).toBe(true)
    expect(isBootstrapRecent({ booting: true, bootedAt: 1_000, now: 10_000 })).toBe(true)
    expect(isBootstrapRecent({ booting: false, bootedAt: 9_000, now: 10_000 })).toBe(true)
    expect(isBootstrapRecent({ booting: false, bootedAt: 1_000, now: 10_000 })).toBe(false)
  })

  test("waits for directory requests before completing", async () => {
    const directory = "/tmp/octo-bootstrap-test"
    const provider = { all: [], connected: [], default: {} } as ProviderListResponse
    const path = { directory } as Path
    const project = { id: "project", worktree: directory } as Project
    const [store, setStore] = createStore<State>({
      status: "loading",
      agent: [],
      command: [],
      project: "",
      projectMeta: undefined,
      icon: undefined,
      provider_ready: true,
      provider,
      config: {},
      path,
      session: [],
      sessionTotal: 0,
      session_status: {},
      session_diff: {},
      todo: {},
      permission: {},
      question: {},
      mcp_ready: true,
      mcp: {},
      lsp_ready: true,
      lsp: [],
      vcs: undefined,
      limit: 5,
      message: {},
      part: {},
    })
    const [vcs, setVcs] = createStore({ value: undefined })
    const sdk = {
      app: { agents: async () => ({ data: [] }) },
      config: { get: async () => ({ data: {} }) },
      session: { status: async () => ({ data: {} }) },
      vcs: { get: async () => ({ data: undefined }) },
      command: { list: async () => ({ data: [] }) },
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => ({ data: [] }) },
      mcp: { status: async () => ({ data: {} }) },
      provider: { list: async () => ({ data: provider }) },
    } as unknown as OpencodeClient
    let release = () => {}
    const sessions = new Promise<void>((resolve) => {
      release = resolve
    })
    let completed = false
    const bootstrap = bootstrapDirectory({
      directory,
      sdk,
      store,
      setStore,
      vcsCache: { store: vcs, setStore: setVcs, ready: () => true } as VcsCache,
      loadSessions: () => sessions,
      translate: (key) => key,
      global: { config: {}, path, project: [project], provider },
      queryClient: new QueryClient(),
    }).then(() => {
      completed = true
    })

    await Bun.sleep(75)
    expect(completed).toBe(false)
    expect(store.status).toBe("partial")

    release()
    await bootstrap
    expect(completed).toBe(true)
    expect(store.status).toBe("complete")
  })
})
