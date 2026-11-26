import { expect, test } from "bun:test"
import { isLegacyOpencodeProvider, isProviderApiKeyMissing, saveProviderApiKey } from "./provider-api-key"

test("only non-remote opencode uses legacy provider controls", () => {
  expect(isLegacyOpencodeProvider({ id: "opencode", source: "remote" })).toBe(false)
  expect(isLegacyOpencodeProvider({ id: "bpit", source: "remote" })).toBe(false)
  expect(isLegacyOpencodeProvider({ id: "opencode", source: "config" })).toBe(true)
  expect(isLegacyOpencodeProvider({ id: "opencode", source: "api" })).toBe(true)
})

test.each(["opencode", "bpit", "gateway"])("remote %s saves its key without updating global config", async (id) => {
  const writes: unknown[] = []
  await saveProviderApiKey({
    provider: { id, source: "remote" },
    apiKey: "test-key",
    updateConfig: async (config) => {
      writes.push({ config })
    },
    setAuth: async (auth) => {
      writes.push({ auth })
    },
  })
  expect(writes).toEqual([{ auth: { providerID: id, auth: { type: "api", key: "test-key" } } }])
})

test("local opencode retains config-based key storage", async () => {
  const writes: unknown[] = []
  await saveProviderApiKey({
    provider: { id: "opencode", source: "config" },
    apiKey: "test-key",
    updateConfig: async (config) => {
      writes.push({ config })
    },
    setAuth: async (auth) => {
      writes.push({ auth })
    },
  })
  expect(writes).toEqual([{ config: { provider: { opencode: { options: { apiKey: "test-key" } } } } }])
})

test("other local providers retain auth-based key storage", async () => {
  const writes: unknown[] = []
  await saveProviderApiKey({
    provider: { id: "custom", source: "config" },
    apiKey: "test-key",
    updateConfig: async (config) => {
      writes.push({ config })
    },
    setAuth: async (auth) => {
      writes.push({ auth })
    },
  })
  expect(writes).toEqual([{ auth: { providerID: "custom", auth: { type: "api", key: "test-key" } } }])
})

test("requires a configured key and never treats other credentials as a key", () => {
  expect(isProviderApiKeyMissing({ options: { requires_api_key: true } })).toBe(true)
  expect(isProviderApiKeyMissing({ options: { requires_api_key: true, api_key_configured: false } })).toBe(true)
  expect(isProviderApiKeyMissing({ options: { requires_api_key: true, api_key_configured: true } })).toBe(false)
  expect(isProviderApiKeyMissing({ options: {} })).toBe(false)
  expect(isProviderApiKeyMissing()).toBe(false)
})
