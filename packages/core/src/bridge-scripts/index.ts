// Bridge Scripts Module - Shared HTML injection scripts for artifact preview
// Used by both frontend (srcdoc-builder) and Electron (local:// protocol)

export * from "./constants"
export * from "./inject"
export { annotateElementsWithIds as annotateElementsWithIdsBrowser } from "./annotate-browser"

export * as BridgeScripts from "./index"