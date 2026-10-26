import { expect, test } from "bun:test"
import { clearStudioPermissionCache, notifyStudioLoginSuccess, onStudioLoginSuccess, studioPermissionState } from "./studio-permission-store"

test("logout stays idle and login notifies only subscribed Studio pages", () => {
  let calls = 0
  const unsubscribe = onStudioLoginSuccess(() => { calls++ })
  clearStudioPermissionCache()
  expect(calls).toBe(0)
  expect(studioPermissionState.status).toBe("idle")
  notifyStudioLoginSuccess()
  expect(calls).toBe(1)
  unsubscribe()
  notifyStudioLoginSuccess()
  expect(calls).toBe(1)
  expect(studioPermissionState.status).toBe("idle")
})
