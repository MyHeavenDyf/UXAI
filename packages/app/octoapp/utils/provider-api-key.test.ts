import { expect, test } from "bun:test"
import { isProviderApiKeyMissing } from "./provider-api-key"

test("requires a configured key and never treats other credentials as a key", () => {
  expect(isProviderApiKeyMissing({ options: { requires_api_key: true } })).toBe(true)
  expect(isProviderApiKeyMissing({ options: { requires_api_key: true, api_key_configured: false } })).toBe(true)
  expect(isProviderApiKeyMissing({ options: { requires_api_key: true, api_key_configured: true } })).toBe(false)
  expect(isProviderApiKeyMissing({ options: {} })).toBe(false)
  expect(isProviderApiKeyMissing()).toBe(false)
})
