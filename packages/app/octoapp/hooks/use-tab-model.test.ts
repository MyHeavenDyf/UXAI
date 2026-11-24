import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("historical session model is inherited by a new conversation without enabling hidden models", () => {
  // Isolate context replacements and use Solid's browser runtime for reactive effects.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--conditions=browser",
      "-e",
      `
        import { mock } from "bun:test"
        import { createRoot } from "solid-js"
        import { createStore } from "solid-js/store"
        import { createModelSelection } from ${JSON.stringify(fileURLToPath(new URL("../context/model-selection.ts", import.meta.url)))}

        const a = { providerID: "provider", modelID: "a" }
        const b = { providerID: "provider", modelID: "b" }
        const hidden = { providerID: "provider", modelID: "hidden" }
        const models = new Map([a, b, hidden].map((key) => [key.modelID, {
          id: key.modelID,
          provider: { id: key.providerID },
        }]))
        const visibility = new Map([["a", true], ["b", true], ["hidden", false]])
        const changes = []
        const [state, setState] = createStore({ session: "history", model: "a" })
        const local = {
          model: {
            current: () => visibility.get(state.model) ? models.get(state.model) : models.get("b"),
            set: createModelSelection({
              select(key) { setState("model", key?.modelID) },
              setVisibility(key, visible) {
                visibility.set(key.modelID, visible)
                changes.push(key.modelID)
              },
              pushRecent() {},
            }),
          },
        }
        const storage = new Map()
        globalThis.localStorage = {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        }
        const key = "octo:tab-model:insight:/project"
        localStorage.setItem(key, JSON.stringify(a))
        mock.module("@/context/local", () => ({ useLocal: () => local }))
        mock.module("@/context/sdk", () => ({ useSDK: () => ({ directory: "/project" }) }))
        mock.module("@solidjs/router", () => ({ useParams: () => ({ get id() { return state.session } }) }))
        const { useTabModel } = await import(${JSON.stringify(fileURLToPath(new URL("./use-tab-model.ts", import.meta.url)))})

        const dispose = createRoot((dispose) => {
          useTabModel("insight")
          return dispose
        })
        local.model.set(b, { recent: true })
        const afterRestore = JSON.parse(localStorage.getItem(key))
        setState("session", undefined)
        const newConversation = local.model.current()?.id
        setState("session", "hidden-history")
        local.model.set(hidden, { recent: true })
        const hiddenVisible = visibility.get("hidden")
        local.model.set(a, { recent: true, enable: true })
        const afterManualSelection = JSON.parse(localStorage.getItem(key))
        dispose()
        console.log(JSON.stringify({ afterRestore, newConversation, hiddenVisible, changes, afterManualSelection }))
      `,
    ],
    { cwd: fileURLToPath(new URL("../../", import.meta.url)) },
  )

  expect(result.exitCode).toBe(0)
  expect(result.stderr.toString()).toBe("")
  expect(JSON.parse(result.stdout.toString())).toEqual({
    afterRestore: { providerID: "provider", modelID: "b" },
    newConversation: "b",
    hiddenVisible: false,
    changes: ["a"],
    afterManualSelection: { providerID: "provider", modelID: "a" },
  })
})
