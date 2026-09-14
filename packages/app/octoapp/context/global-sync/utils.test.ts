import { describe, expect, test } from "bun:test"
import type { Agent, Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { directoryKey, normalizeAgentList, normalizeProviderList, replaceProviderList } from "./utils"

const agent = (name = "build") =>
  ({
    name,
    mode: "primary",
    permission: {},
    options: {},
  }) as Agent

describe("normalizeAgentList", () => {
  test("keeps array payloads", () => {
    expect(normalizeAgentList([agent("build"), agent("docs")])).toEqual([agent("build"), agent("docs")])
  })

  test("wraps a single agent payload", () => {
    expect(normalizeAgentList(agent("docs"))).toEqual([agent("docs")])
  })

  test("extracts agents from keyed objects", () => {
    expect(
      normalizeAgentList({
        build: agent("build"),
        docs: agent("docs"),
      }),
    ).toEqual([agent("build"), agent("docs")])
  })

  test("drops invalid payloads", () => {
    expect(normalizeAgentList({ name: "AbortError" })).toEqual([])
    expect(normalizeAgentList([{ name: "build" }, agent("docs")])).toEqual([agent("docs")])
  })
})

describe("directoryKey", () => {
  test("normalizes slashes", () => {
    expect(String(directoryKey("C:\\Repos\\sst\\opencode"))).toBe("C:/Repos/sst/opencode")
    expect(String(directoryKey("C:/Repos/sst/opencode"))).toBe("C:/Repos/sst/opencode")
  })

  test("preserves backslashes in posix paths", () => {
    expect(String(directoryKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("trims trailing slashes without breaking roots", () => {
    expect(String(directoryKey("C:/Repos/sst/opencode/"))).toBe("C:/Repos/sst/opencode")
    expect(String(directoryKey("C:/"))).toBe("C:/")
    expect(String(directoryKey("/"))).toBe("/")
  })
})

describe("replaceProviderList", () => {
  test("replaces snapshot providers and keeps unrelated configured providers", () => {
    const provider = (id: string, models: Provider["models"] = {}) =>
      ({ id, name: id, source: "api", env: [], options: {}, models }) as Provider
    const current = {
      all: [
        provider("w3", { old: { id: "old" } } as unknown as Provider["models"]),
        { ...provider("custom"), source: "config" as const },
        provider("snapshot-only"),
      ],
      connected: ["w3", "custom", "snapshot-only"],
      default: { w3: "old" },
    } satisfies ProviderListResponse
    const result = replaceProviderList(current, [
      provider("w3", { remote: { id: "remote" } } as unknown as Provider["models"]),
      provider("xiaomi"),
    ])

    expect(result.all.map((item) => item.id)).toEqual(["w3", "xiaomi", "custom"])
    expect(Object.keys(result.all[0].models)).toEqual(["remote"])
    expect(result.connected).toEqual(["w3", "xiaomi", "custom"])
    expect(result.default).toEqual({ w3: "remote" })
  })

  test("does not preserve removed configured providers", () => {
    const provider = (id: string, source: Provider["source"] = "config") =>
      ({ id, name: id, source, env: [], options: {}, models: {} }) as Provider
    const current = {
      all: [provider("opencode"), provider("bpit"), provider("custom")],
      connected: ["opencode", "bpit", "custom"],
      default: {},
    } satisfies ProviderListResponse

    expect(replaceProviderList(current, []).all.map((item) => item.id)).toEqual(["custom"])
  })
})

describe("normalizeProviderList", () => {
  test("removes legacy providers from initial server data", () => {
    const provider = (id: string) => ({ id, name: id, source: "remote", env: [], options: {}, models: {} }) as Provider
    const result = normalizeProviderList({
      all: [provider("opencode"), provider("bpit"), provider("w3")],
      connected: ["opencode", "bpit", "w3"],
      default: { opencode: "old", bpit: "old", w3: "current" },
    })

    expect(result.all.map((item) => item.id)).toEqual(["w3"])
    expect(result.connected).toEqual(["w3"])
    expect(result.default).toEqual({ w3: "current" })
  })
})
