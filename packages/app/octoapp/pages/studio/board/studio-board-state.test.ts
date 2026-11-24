import { boardFrameSourceCount, recoverBoardDraft } from "@opencode-ai/core/studio-board"
import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import {
  boardConnectionError,
  boardReferences,
  boardMedia,
  boardRebootable,
  boardCardSize,
  boardWheelZoom,
  boardDocumentJSON,
  boardDocumentSnapshot,
  boardCanGenerate,
  emptyBoard,
  newBoardCard,
  type BoardResults,
} from "./studio-board-state"

test("card geometry preserves the actual media ratio with a bounded longest side", () => {
  expect(boardCardSize()).toEqual({ width: 304, height: 330 })
  expect(boardCardSize(1200, 800)).toEqual({ width: 304, height: 230 })
  expect(boardCardSize(800, 1200)).toEqual({ width: 204, height: 330 })
  expect(boardCardSize(1920, 1080)).toEqual({ width: 304, height: 198.75 })
  expect(boardCardSize(0, 1080)).toEqual({ width: 304, height: 330 })
  expect(boardCardSize(Number.NaN, 1080)).toEqual({ width: 304, height: 330 })
  expect(boardCardSize(undefined, 1080)).toEqual({ width: 304, height: 330 })
})

function fixture() {
  const a = newBoardCard("a", "image")
  const b = newBoardCard("b", "image")
  a.taskLinks = ["t1", "t2"].map((generationID) => ({
    generationID,
    submissionID: generationID,
    visible: true,
    snapshot: { prompt: "旧提示词", settings: { ...a.draft.settings }, references: [] },
  }))
  a.cover = { generationID: "t1", mediaID: "m1" }
  a.currentGenerationID = "t2"
  const results: BoardResults = {
    t1: {
      id: "t1",
      status: "succeeded",
      capability: "image.generate",
      prompt: "旧提示词",
      provider: "internel",
      model: "seedream-5-pro",
      aspectRatio: "1:1",
      images: [{ id: "m1", url: "https://example.test/a.png" }],
      createdAt: 1,
    },
    t2: {
      id: "t2",
      status: "failed",
      capability: "image.generate",
      prompt: "新提示词",
      provider: "internel",
      model: "seedream-5-pro",
      aspectRatio: "1:1",
      taskId: "provider-2",
      images: [],
      createdAt: 2,
    },
  }
  return { document: { ...emptyBoard(), cards: [a, b] }, results, a, b }
}

describe("board task and draft boundaries", () => {
  test("image and video permissions are independent", () => {
    const image = newBoardCard("image", "image")
    const video = newBoardCard("video", "video")
    const permission = { status: "ready", seedream: false, video: true }
    expect(boardCanGenerate(video, permission)).toBe(true)
    expect(boardCanGenerate(image, permission)).toBe(false)
    expect(boardCanGenerate(video, { ...permission, video: false, seedream: true })).toBe(false)
    expect(boardCanGenerate(image, { ...permission, seedream: true })).toBe(true)
    expect(boardCanGenerate(video, { ...permission, status: "loading" })).toBe(false)
    image.draft.settings.styleModel = "qwen"
    expect(boardCanGenerate(image, permission)).toBe(true)
  })
  test("save comparisons ignore property insertion order after a task attaches media", () => {
    const card = newBoardCard("image", "image")
    card.currentGenerationID = "task"
    card.cover = { generationID: "task", mediaID: "image" }
    card.preview = card.cover
    const document = { ...emptyBoard(), cards: [card] }
    const saved = {
      ...document,
      cards: [
        { ...newBoardCard("image", "image"), cover: card.cover, preview: card.preview, currentGenerationID: "task" },
      ],
    }
    expect(JSON.stringify(document)).not.toBe(JSON.stringify(saved))
    expect(boardDocumentJSON(document)).toBe(boardDocumentJSON(saved))
  })
  test("document snapshots detach nested drafts, settings and task inputs from the live store", () => {
    const value = fixture()
    const [document, setDocument] = createStore(value.document)
    const snapshot = boardDocumentSnapshot(document)
    setDocument("cards", 0, "draft", "prompt", "保存请求之后的新输入")
    setDocument("cards", 0, "draft", "settings", "count", 2)
    setDocument("cards", 0, "taskLinks", 0, "snapshot", "prompt", "变更后的任务输入")
    expect(snapshot.cards[0].draft.prompt).toBe("")
    expect(snapshot.cards[0].draft.settings.count).toBe(1)
    expect(snapshot.cards[0].taskLinks[0].snapshot.prompt).toBe("旧提示词")
    expect(boardDocumentJSON(document)).not.toBe(boardDocumentJSON(snapshot))
  })
  test("latest failure preserves the previous successful cover and permits a new draft connection", () => {
    const { document, results } = fixture()
    expect(boardConnectionError(document, results, "a", "b")).toBeUndefined()
    expect(boardMedia(document.cards[0], results).map((item) => item.mediaID)).toEqual(["m1"])
  })
  test("rejects self, duplicates, cycles, video outputs and active target edits", () => {
    const { document, results, a, b } = fixture()
    expect(boardConnectionError(document, results, "a", "a")).toBeDefined()
    document.draftEdges.push({ id: "ab", sourceID: "a", targetID: "b", role: "reference" })
    expect(boardConnectionError(document, results, "a", "b")).toBeDefined()
    b.cover = a.cover
    b.taskLinks = a.taskLinks
    expect(boardConnectionError(document, results, "b", "a")).toBe("不能创建循环连接")
    document.draftEdges = []
    a.kind = "video"
    expect(boardConnectionError(document, results, "a", "b")).toBeDefined()
    a.kind = "image"
    b.currentGenerationID = "t2"
    results.t2.status = "running"
    expect(boardConnectionError(document, results, "a", "b")).toBe("请等待目标任务结束后修改引用")
  })
  test("new draft references follow the cover; saved snapshots remain unchanged", () => {
    const { document, results, a } = fixture()
    document.draftEdges.push({ id: "ab", sourceID: "a", targetID: "b", role: "reference" })
    const snapshot = boardReferences(document, "b", results)
    results.t1.images.push({ id: "m2", url: "https://example.test/b.png" })
    a.cover = { generationID: "t1", mediaID: "m2" }
    expect(boardReferences(document, "b", results)[0].mediaID).toBe("m2")
    expect(snapshot[0].mediaID).toBe("m1")
    expect(snapshot[0].image).toBe("https://example.test/a.png")
  })
  test.each(["firstFrame", "lastFrame"] as const)("%s occupancy includes uploads and unresolved edges", (role) => {
    const { document, results, b } = fixture()
    b.kind = "video"
    b.draft.assets.push({ id: "frame", name: "frame.png", url: "/uploads/frame.png", role })
    expect(boardFrameSourceCount(document, b.id, role)).toBe(1)
    expect(boardConnectionError(document, results, "a", b.id, role)).toBe("该帧已有引用，请先移除")
    expect(
      boardConnectionError(document, results, "a", b.id, role === "firstFrame" ? "lastFrame" : "firstFrame"),
    ).toBeUndefined()
    b.draft.assets = []
    document.draftEdges.push({ id: "unloaded", sourceID: "unloaded-source", targetID: b.id, role })
    expect(boardReferences(document, b.id, results)).toEqual([])
    expect(boardFrameSourceCount(document, b.id, role)).toBe(1)
    expect(boardConnectionError(document, results, "a", b.id, role)).toBe("该帧已有引用，请先移除")
    document.draftEdges = []
    expect(boardFrameSourceCount(document, b.id, role)).toBe(0)
    expect(boardConnectionError(document, results, "a", b.id, role)).toBeUndefined()
  })
  test("video connection roles follow the selected input mode", () => {
    const { document, results, b } = fixture()
    b.kind = "video"
    b.draft.settings.videoInputMode = "first-last-frame"
    expect(boardConnectionError(document, results, "a", b.id, "reference")).toContain("输入模式不匹配")
    expect(boardConnectionError(document, results, "a", b.id, "firstFrame")).toBeUndefined()
    b.draft.settings.videoInputMode = "multi-reference"
    expect(boardConnectionError(document, results, "a", b.id, "firstFrame")).toContain("输入模式不匹配")
    expect(boardConnectionError(document, results, "a", b.id, "reference")).toBeUndefined()
  })
  test("only capable provider tasks reboot; cancelled created tasks remain eligible", () => {
    const { results } = fixture()
    expect(boardRebootable(results.t2)).toBe(true)
    expect(boardRebootable({ ...results.t2, rawStatus: 4 })).toBe(true)
    expect(boardRebootable({ ...results.t2, status: "create_failed" })).toBe(false)
    expect(boardRebootable({ ...results.t2, taskId: undefined })).toBe(false)
    expect(boardRebootable({ ...results.t2, provider: "jimeng" })).toBe(false)
    expect(boardRebootable({ ...results.t2, model: "seedream-5-lite" })).toBe(false)
    expect(boardRebootable({ ...results.t2, model: "removed-style" })).toBe(false)
    expect(boardRebootable({ ...results.t2, model: "txt2img_jimeng_v2", request: { input: { styleModel: "seedream-5-lite" } } })).toBe(false)
  })
  test("retired drafts preserve their model and require a new selection before generation", () => {
    const card = newBoardCard("retired", "image")
    card.draft.settings.styleModel = "seedream-5-lite"
    const restored = boardDocumentSnapshot({ ...emptyBoard(), cards: [card] })
    expect(restored.cards[0].draft.settings.styleModel).toBe("seedream-5-lite")
    expect(boardCanGenerate(restored.cards[0], { status: "ready", seedream: true, video: true })).toBe(false)
  })
  test("hidden failure links do not contribute media or remove earlier success", () => {
    const { a, results } = fixture()
    a.taskLinks[1].visible = false
    expect(boardMedia(a, results).map((item) => item.generationID)).toEqual(["t1"])
  })
  test("wheel uses physical distance, respects units and clamps extreme increments", () => {
    expect(boardWheelZoom(1, 0, 0, 800)).toBe(1)
    expect(boardWheelZoom(1, 1, 1, 800)).toBe(boardWheelZoom(1, 16, 0, 800))
    expect(Math.abs(boardWheelZoom(1, 1, 0, 800) - 1)).toBeLessThan(0.002)
    expect(boardWheelZoom(1, 10000, 0, 800)).toBeGreaterThan(0.9)
    expect(boardWheelZoom(0.35, 100, 0, 800)).toBe(0.35)
  })
})

test("recovering an old draft retains authoritative tasks and never resurrects removed cards", () => {
  const source = newBoardCard("source", "image")
  const local = { ...emptyBoard(), cards: [source, newBoardCard("removed", "image"), newBoardCard("new", "image")] }
  local.cards[0].draft.prompt = "本地未保存输入"
  const remoteSource = newBoardCard("source", "image")
  remoteSource.currentGenerationID = "accepted-task"
  remoteSource.taskLinks = [
    {
      generationID: "accepted-task",
      submissionID: "request-1",
      visible: true,
      snapshot: { prompt: "实际提交输入", settings: { ...remoteSource.draft.settings }, references: [] },
    },
  ]
  const restored = recoverBoardDraft({ ...emptyBoard(), cards: [remoteSource], removedCardIDs: ["removed"] }, local)
  expect(restored.cards.map((card) => card.id)).toEqual(["source", "new"])
  expect(restored.cards[0].draft.prompt).toBe("本地未保存输入")
  expect(restored.cards[0].currentGenerationID).toBe("accepted-task")
  expect(restored.cards[0].taskLinks[0].snapshot.prompt).toBe("实际提交输入")
})
