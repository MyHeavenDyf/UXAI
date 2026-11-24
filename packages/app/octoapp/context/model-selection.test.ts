import { describe, expect, test } from "bun:test"
import { createModelSelection } from "./model-selection"
import type { ModelKey } from "./local"

const a = { providerID: "provider", modelID: "a" }
const b = { providerID: "provider", modelID: "b" }

function selection() {
  const visibility = new Map([
    [a.modelID, true],
    [b.modelID, true],
  ])
  const selected: Array<ModelKey | undefined> = []
  const recent: ModelKey[] = []
  const changes: ModelKey[] = []
  const set = createModelSelection({
    select(item) {
      selected.push(item)
    },
    setVisibility(item, visible) {
      visibility.set(item.modelID, visible)
      changes.push(item)
    },
    pushRecent(item) {
      recent.push(item)
    },
  })
  return { set, visibility, selected, recent, changes }
}

describe("model selection visibility", () => {
  test("switching back to a session does not re-enable its disabled historical model", () => {
    const state = selection()
    state.set(a, { recent: true })
    state.set(b, { recent: true })
    state.visibility.set(a.modelID, false)

    state.set(a, { recent: true })

    expect(state.visibility.get(a.modelID)).toBe(false)
    expect(state.visibility.get(b.modelID)).toBe(true)
    expect(state.selected).toEqual([a, b, a])
    expect(state.recent).toEqual([a, b, a])
    expect(state.changes).toEqual([])
  })

  test("restoring a tab/default model does not change visibility", () => {
    const state = selection()
    state.visibility.set(a.modelID, false)

    state.set(a)

    expect(state.visibility.get(a.modelID)).toBe(false)
    expect(state.selected).toEqual([a])
    expect(state.recent).toEqual([])
    expect(state.changes).toEqual([])
  })

  test("explicit user selection can enable a model and update recents", () => {
    const state = selection()
    state.visibility.set(a.modelID, false)

    state.set(a, { enable: true, recent: true })

    expect(state.visibility.get(a.modelID)).toBe(true)
    expect(state.selected).toEqual([a])
    expect(state.recent).toEqual([a])
    expect(state.changes).toEqual([a])
  })

  test("explicit model cycling enables a model without adding a recent entry", () => {
    const state = selection()
    state.visibility.set(a.modelID, false)

    state.set(a, { enable: true })

    expect(state.visibility.get(a.modelID)).toBe(true)
    expect(state.recent).toEqual([])
  })

  test("clearing the selection does not change model visibility or recents", () => {
    const state = selection()

    state.set(undefined, { enable: true, recent: true })

    expect(state.selected).toEqual([undefined])
    expect(state.recent).toEqual([])
    expect(state.changes).toEqual([])
  })
})
