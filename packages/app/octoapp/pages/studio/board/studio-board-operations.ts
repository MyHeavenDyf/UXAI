import { createStore, produce, reconcile } from "solid-js/store"

export type BoardOperation = "creating" | "uploading" | "cancelling" | "rebooting" | "unknown"

export function createBoardOperations() {
  const [state, setState] = createStore<Record<string, BoardOperation>>({})
  return {
    state,
    busy: () => Object.keys(state).length > 0,
    start: (cardID: string, operation: BoardOperation) => setState(cardID, operation),
    finish: (cardID: string) =>
      setState(
        produce((draft) => {
          delete draft[cardID]
        }),
      ),
    clear: () => setState(reconcile({})),
  }
}
