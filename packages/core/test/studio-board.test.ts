import { expect, test } from "bun:test"
import {
  BoardSnapshot,
  boardDraftReferences,
  boardGenerationError,
  emptyBoard,
  newBoardCard,
} from "../src/studio-board"

test.each([
  { model: "seedream-5-lite", limit: 4 },
  { model: "seedream-5-pro", limit: 4 },
  { model: "qwen", limit: 3 },
  { model: "portrait", limit: 1 },
])("$model permits references up to its limit and rejects an additional image", ({ model, limit }) => {
  const snapshot = BoardSnapshot.parse({
    prompt: "生成图片",
    settings: { styleModel: model },
    references: Array.from({ length: limit }, (_, index) => ({
      sourceID: `source-${index}`,
      generationID: "task",
      mediaID: `image-${index}`,
      title: "参考图",
      image: `https://example.test/${index}.png`,
    })),
  })
  expect(boardGenerationError("image", snapshot)).toBeUndefined()
  snapshot.references.push({ ...snapshot.references[0], mediaID: "extra", image: "https://example.test/extra.png" })
  expect(boardGenerationError("image", snapshot)).toBe("参考图数量超过模型上限")
})

test("video frame and 4K rules allow valid snapshots and keep image rules independent", () => {
  const snapshot = BoardSnapshot.parse({
    prompt: "镜头缓慢推进",
    settings: {},
    references: [
      {
        sourceID: "source",
        generationID: "task",
        mediaID: "image",
        title: "尾帧",
        image: "https://example.test/last.png",
        role: "lastFrame",
      },
    ],
  })
  expect(boardGenerationError("video", snapshot)).toBe("请先添加首帧图片")
  snapshot.references.push({ ...snapshot.references[0], mediaID: "first", role: "firstFrame" })
  expect(boardGenerationError("video", snapshot)).toBeUndefined()
  snapshot.settings.quality = "4k"
  snapshot.settings.count = 2
  expect(boardGenerationError("video", snapshot)).toBe("4K 视频仅支持一次生成一份")
  expect(boardGenerationError("image", { ...snapshot, references: [] })).toBeUndefined()
  snapshot.settings.count = 1
  expect(boardGenerationError("video", snapshot)).toBeUndefined()
  expect(boardGenerationError("video", { ...snapshot, prompt: "  " })).toBe("请输入提示词")
})

test("draft references preserve ordering and role deduplication, and leave unavailable media handling to the caller", () => {
  const source = newBoardCard("source", "image")
  source.cover = { generationID: "task", mediaID: "image" }
  const target = newBoardCard("target", "video")
  target.draft.assets = [
    { id: "same", name: "same.png", url: "https://example.test/source.png", role: "reference" },
    { id: "frame", name: "frame.png", url: "https://example.test/source.png", role: "firstFrame" },
  ]
  const document = {
    ...emptyBoard(),
    cards: [source, target],
    draftEdges: [{ id: "edge", sourceID: source.id, targetID: target.id, role: "reference" as const }],
  }
  const references = boardDraftReferences(document, target.id, () => "https://example.test/source.png")
  expect(references).toEqual([
    {
      sourceID: source.id,
      generationID: "task",
      mediaID: "image",
      title: source.title,
      image: "https://example.test/source.png",
      role: "reference",
    },
    {
      sourceID: "upload:frame",
      generationID: "",
      mediaID: "frame",
      title: "frame.png",
      image: "https://example.test/source.png",
      role: "firstFrame",
    },
  ])
  expect(boardDraftReferences(document, target.id, () => undefined).map((ref) => ref.sourceID)).toEqual([
    "upload:same",
    "upload:frame",
  ])
  expect(() =>
    boardDraftReferences(document, target.id, () => {
      throw new Error("引用媒体不可用")
    }),
  ).toThrow("引用媒体不可用")
  source.cover.mediaID = "new-image"
  expect(references[0].mediaID).toBe("image")
})
