import { expect, test } from "bun:test"
import { createBoardOperations } from "./studio-board-operations"

test("finishing a submission removes its lock while preserving other card operations", () => {
  const operations = createBoardOperations()
  operations.start("image", "creating")
  operations.start("video", "rebooting")
  operations.finish("image")
  expect(operations.state.image).toBeUndefined()
  expect(Object.keys(operations.state)).toEqual(["video"])
  expect(operations.busy()).toBe(true)
  operations.finish("video")
  expect(operations.busy()).toBe(false)
})

test("cancel, reboot and status reconciliation release the same card for another submission", () => {
  const operations = createBoardOperations()
  const stages = ["creating", "cancelling", "rebooting", "unknown", "uploading"] as const
  stages.forEach((stage) => {
    operations.start("image", stage)
    expect(operations.state.image).toBe(stage)
    operations.finish("image")
    expect(operations.state.image).toBeUndefined()
    expect(operations.busy()).toBe(false)
  })
})

test("discarding recovered operations clears every stale lock", () => {
  const operations = createBoardOperations()
  operations.start("image", "unknown")
  operations.start("video", "unknown")
  operations.clear()
  expect(Object.keys(operations.state)).toEqual([])
  expect(operations.busy()).toBe(false)
})
