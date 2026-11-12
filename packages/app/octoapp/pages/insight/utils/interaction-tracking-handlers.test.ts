import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "typescript"
import { createEffect, createRoot } from "solid-js"
import { TaskStore } from "../../../context/task"
import type { UploadCallbacks, UploadFinishItem } from "../../../edmFileServices/file-service"
import { beginInsightOperation, uploadStatus } from "./interaction-tracking"
import { archiveFileSizeError } from "./archive-size"

// Execute the actual nested handler, without mounting unrelated UI or duplicating
// its business branches. Only desktop/network boundaries are supplied by tests.
function handler<T>(file: string, name: string, dependencies: Record<string, unknown>): T {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.FunctionDeclaration | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found) throw new Error(`Handler not found: ${name}`)
  const code = ts.transpileModule(found.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return new Function(...Object.keys(dependencies), `${code}; return ${name}`)(...Object.values(dependencies)) as T
}

function telemetry() {
  const events: Array<{ name: string; fields: Record<string, unknown> }> = []
  return {
    events,
    beginInsightOperation: (name: Parameters<typeof beginInsightOperation>[0], fields: Parameters<typeof beginInsightOperation>[1]) =>
      beginInsightOperation(name, fields, (name, fields) => { events.push({ name, fields: fields ?? {} }) }),
  }
}

const roots: string[] = []
afterEach(async () => {
  for (const item of [...TaskStore.items()]) TaskStore.remove(item)
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("Markdown real disk save reports success; missing path/IPC and rejection report failure without content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "insight-tracking-"))
  roots.push(directory)
  const path = join(directory, "report.md")
  const captured = telemetry()
  const dependencies = {
    ...captured,
    params: { id: "original" }, props: { tab: { source: "path" } }, targetPath: path,
    getDesktopApi: () => ({ writeFile }), setSaveState: () => {}, setSaveError: () => {}, showToast: () => {},
    console: { log() {}, error() {} },
  }
  const save = handler<(value: string) => Promise<void>>("../components/markdown-editor/index.tsx", "doSave", dependencies)
  await save("private document")
  expect(await readFile(path, "utf8")).toBe("private document")
  for (const overrides of [
    { targetPath: "" },
    { getDesktopApi: () => ({}) },
    { getDesktopApi: () => ({ writeFile: async () => { throw new Error("private error") } }) },
  ]) await handler<(value: string) => Promise<void>>("../components/markdown-editor/index.tsx", "doSave", { ...dependencies, ...overrides })("private document")
  expect(captured.events.filter((event) => event.name.endsWith("-result")).map((event) => event.fields.status)).toEqual(["success", "failure", "failure", "failure"])
  expect(JSON.stringify(captured.events)).not.toContain("private")
  expect(JSON.stringify(captured.events)).not.toContain(path)
})

test("file upload emits one successful result even if UI refresh subsequently fails, and records validation rejection", async () => {
  const captured = telemetry()
  const upload = handler<(file: File) => Promise<void>>("../components/file-manager/index.tsx", "uploadSingleFile", {
    ...captured, props: { sessionId: "original" }, checkExternalFile: (file: File) => file.name !== "rejected",
    fileStore: { isTopLevel: () => true }, store: () => ({ currentPath: "" }), tryStreamUpload: async () => true,
    showToast: () => {}, refresh: async () => { throw new Error("refresh only") },
  })
  await upload(new File(["hello"], "allowed.txt"))
  await upload(new File(["hello"], "rejected"))
  expect(captured.events.filter((event) => event.name.endsWith("-result")).map((event) => event.fields.status)).toEqual(["success", "failure"])
})

test("delete records API success before UI callbacks and classifies partial and failed batch results", async () => {
  const captured = telemetry()
  const dependencies = {
    ...captured, uploadStatus, props: { sessionId: "original", onCloseTabsByPath: () => { throw new Error("UI only") } },
    sdk: { url: "", directory: "" }, fileStore: { deleteFile: () => {}, clearSelection: () => {} }, showToast: () => {},
    deleteInsightFile: async () => {}, deleteInsightBatch: async () => ({ deleted: 1 }),
  }
  await handler<(file: { path: string }) => Promise<void>>("../components/file-manager/index.tsx", "doDelete", dependencies)({ path: "private.txt" })
  await handler<(paths: string[]) => Promise<void>>("../components/file-manager/index.tsx", "doBatchDelete", dependencies)(["a", "b"])
  await handler<(paths: string[]) => Promise<void>>("../components/file-manager/index.tsx", "doBatchDelete", {
    ...dependencies, deleteInsightBatch: async () => { throw new Error("private error") },
  })(["a"])
  expect(captured.events.filter((event) => event.name.endsWith("-result")).map((event) => event.fields.status)).toEqual(["success", "partial", "failure"])
  expect(JSON.stringify(captured.events)).not.toContain("private")
})

const finishFile: UploadFinishItem = {
  cacheSign: "", progress: 100, name: "report.txt", size: 1, docId: "doc", version: "1",
  file: { index: 0, cacheSign: "", progress: 100, docId: "doc", version: "1", status: { statusCode: 0, message: "" } },
}

function archive(deliver: () => Promise<unknown> = async () => [{ id: 1 }], activity: unknown = { deliverableType: 1 }) {
  const captured = telemetry()
  let callbacks: UploadCallbacks | undefined
  const run = handler<(target: { sessionId: string; getFile: () => Promise<File | null> }, data: { teamId: number }) => Promise<void>>(
    "../components/archive-flow.tsx", "runArchiveFileTask", {
      ...captured, createRoot, createEffect, TaskStore, archiveFileSizeError,
      getActivityByTeam: async () => activity, uploadDeliverable: deliver,
      EdmUtil: { upload: (_files: FileList, value: UploadCallbacks) => { callbacks = value } },
      DataTransfer, showToast: () => {}, buildDeliverableViewUrl: () => "https://example.test", buildSuccessPath: () => "",
    },
  )
  return { ...captured, run, callbacks: () => callbacks! }
}

test("archive records missing file, zero bytes and missing activity as failures", async () => {
  for (const file of [null, new File([], "empty")]) {
    const attempt = archive()
    await attempt.run({ sessionId: "original", getFile: async () => file }, { teamId: 1 })
    expect(attempt.events.at(-1)?.fields.status).toBe("failure")
    expect(attempt.callbacks()).toBeUndefined()
  }
  const attempt = archive(undefined, null)
  await attempt.run({ sessionId: "original", getFile: async () => new File(["x"], "report.txt") }, { teamId: 1 })
  expect(attempt.events.at(-1)?.fields).toMatchObject({ status: "failure", reason: "activity" })
  expect(attempt.callbacks()).toBeUndefined()
})

test("folder upload reports filtered files as partial in streaming and fallback paths", async () => {
  for (const streaming of [true, false]) {
    const captured = telemetry()
    const upload = handler<(files: File[]) => Promise<void>>("../components/file-manager/index.tsx", "handleFolderUpload", {
      ...captured, uploadStatus, props: { sessionId: "original" },
      fileStore: { isTopLevel: () => true }, store: () => ({ currentPath: "" }),
      checkExternalFile: (file: File) => file.name !== "rejected",
      tryStreamFolderUpload: async () => streaming ? { okCount: 1, finalFolderName: "folder", errors: [] } : null,
      sdk: { url: "", directory: "" }, readFileAsBase64: async () => "eA==",
      uploadInsightFolder: async () => ({ name: "folder", fileCount: 1 }),
      showFolderUploadResult: () => {}, showToast: () => {}, refresh: async () => {},
    })
    const files = ["allowed", "rejected"].map((name) => Object.assign(new File(["x"], name), { webkitRelativePath: `folder/${name}` }))
    await upload(files)
    expect(captured.events.at(-1)?.fields).toMatchObject({ status: "partial", count: 2, successCount: 1, rejectedCount: 1 })
  }
})

test("archive transport completion is not success until deliverable creation succeeds", async () => {
  const attempt = archive(async () => [])
  await attempt.run({ sessionId: "original", getFile: async () => new File(["x"], "report.txt") }, { teamId: 1 })
  expect(attempt.events.map((event) => event.name)).toEqual(["archive-start"])
  attempt.callbacks().onFinish?.("task", [finishFile])
  await Promise.resolve()
  expect(attempt.events.at(-1)?.fields).toMatchObject({ status: "failure", reason: "deliverable" })
})

test("archive observes real TaskStore cancellation without waiting for a late upload callback", async () => {
  const attempt = archive()
  await attempt.run({ sessionId: "original", getFile: async () => new File(["x"], "report.txt") }, { teamId: 1 })
  attempt.callbacks().onInit?.("cancel-task", [{ index: 0, cacheSign: "", progress: 0, name: "report.txt", size: 1, lstatus: { statusCode: 0, message: "" } }])
  TaskStore.cancel(TaskStore.items()[0])
  expect(attempt.events.at(-1)?.fields.status).toBe("cancelled")
  attempt.callbacks().onFinish?.("cancel-task", [finishFile])
  attempt.callbacks().onError?.("cancel-task", { status: 500, message: "late error" })
  expect(attempt.events.filter((event) => event.name === "archive-result")).toHaveLength(1)
})

test("archive reports success only after successful deliverable creation", async () => {
  const attempt = archive()
  await attempt.run({ sessionId: "original", getFile: async () => new File(["x"], "report.txt") }, { teamId: 1 })
  attempt.callbacks().onFinish?.("task", [finishFile])
  await Promise.resolve()
  expect(attempt.events.at(-1)?.fields).toMatchObject({ status: "success", destination: "cloud" })
})
