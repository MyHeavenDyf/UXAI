import { describe, expect, test } from "bun:test"
import type { Agent, Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { directoryKey, normalizeAgentList, replaceProviderList } from "./utils"

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
        provider("opencode", { old: { id: "old" } } as unknown as Provider["models"]),
        { ...provider("custom"), source: "config" as const },
        provider("snapshot-only"),
      ],
      connected: ["opencode", "custom", "snapshot-only"],
      default: { opencode: "old" },
    } satisfies ProviderListResponse
    const result = replaceProviderList(current, [
      provider("opencode", { remote: { id: "remote" } } as unknown as Provider["models"]),
      provider("bpit"),
    ])

    expect(result.all.map((item) => item.id)).toEqual(["opencode", "bpit", "custom"])
    expect(Object.keys(result.all[0].models)).toEqual(["remote"])
    expect(result.connected).toEqual(["opencode", "bpit", "custom"])
    expect(result.default).toEqual({ opencode: "remote" })
  })
})
