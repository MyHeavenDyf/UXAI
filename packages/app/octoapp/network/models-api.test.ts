import { beforeEach, describe, expect, test } from "bun:test"
import { modelsApiHeaders } from "./models-api"

describe("models API request headers", () => {
  beforeEach(() => localStorage.clear())

  test("includes the account from userInfo", () => {
    localStorage.setItem("userInfo", JSON.stringify({ account: " j60099994 " }))

    expect(modelsApiHeaders().w3Account).toBe("j60099994")
  })

  test("omits the account when userInfo is invalid", () => {
    localStorage.setItem("userInfo", "invalid JSON")

    expect(modelsApiHeaders()).not.toHaveProperty("w3Account")
  })

})
