import { expect, test } from "bun:test"
import { STUDIO_STYLE_MODEL_CONFIG, defaultStudioStyleModel } from "../src/studio/model-availability"
import {
  BoardDocument,
  BoardSnapshot,
  BOARD_UPSCALE_PROMPT,
  BOARD_CUTOUT_PROMPT,
  boardEdgeError,
  boardDraftReferences,
  boardGenerationError,
  uniqueBoardReferences,
  emptyBoard,
  newBoardCard,
  recoverBoardDraft,
} from "../src/studio-board"

test.each([
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

test("new cards follow the active configuration while retired drafts remain readable", () => {
  const retired = BoardSnapshot.parse({ prompt: "旧任务", settings: { styleModel: "seedream-5-lite" }, references: [] })
  expect(retired.settings.styleModel).toBe("seedream-5-lite")
  expect(boardGenerationError("image", retired)).toContain("模型已下架或不可用")
  expect(boardGenerationError("video", retired)).toBeUndefined()
  const model = STUDIO_STYLE_MODEL_CONFIG.shift()!
  try {
    expect(newBoardCard("new", "image").draft.settings.styleModel).toBe(defaultStudioStyleModel())
    expect(newBoardCard("new", "image").draft.settings.styleModel).not.toBe(model.id)
    expect(
      STUDIO_STYLE_MODEL_CONFIG.find((model) => model.id === defaultStudioStyleModel(false))
        ?.requiresSeedreamPermission,
    ).not.toBe(true)
    expect(
      boardGenerationError("image", { ...retired, settings: { ...retired.settings, styleModel: model.id } }),
    ).toContain("模型已下架或不可用")
  } finally {
    STUDIO_STYLE_MODEL_CONFIG.unshift(model)
  }
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

test("draft references preserve distinct sources sharing a URL and leave unavailable media handling to the caller", () => {
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
      sourceID: "upload:same",
      generationID: "",
      mediaID: "same",
      title: "same.png",
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

test("reference identity includes source, generation, media and role rather than image URL", () => {
  const reference = {
    sourceID: "a",
    generationID: "task",
    mediaID: "image",
    title: "图片",
    image: "/same.png",
    role: "reference" as const,
  }
  const references = [
    reference,
    { ...reference, sourceID: "b" },
    { ...reference, generationID: "other-task" },
    { ...reference, mediaID: "other-image" },
    { ...reference, role: "firstFrame" as const },
  ]
  expect(uniqueBoardReferences([...references, { ...reference, image: "/refreshed-url.png" }])).toEqual(references)
})

test("video input modes keep inactive material but freeze only active references", () => {
  const card = newBoardCard("video", "video")
  card.draft.settings.videoInputMode = "multi-reference"
  card.draft.assets = [
    { id: "multi", name: "multi.png", url: "/multi.png", role: "reference" },
    { id: "frame", name: "frame.png", url: "/frame.png", role: "firstFrame" },
  ]
  const document = {
    ...emptyBoard(),
    cards: [card],
    draftEdges: [{ id: "inactive", sourceID: "missing", targetID: card.id, role: "lastFrame" as const }],
  }
  expect(
    boardDraftReferences(document, card.id, () => {
      throw new Error("inactive source read")
    }),
  ).toMatchObject([{ role: "reference", image: "/multi.png" }])
  card.draft.settings.videoInputMode = "first-last-frame"
  document.draftEdges = []
  expect(boardDraftReferences(document, card.id, () => undefined)).toMatchObject([
    { role: "firstFrame", image: "/frame.png" },
  ])
  expect(card.draft.assets).toHaveLength(2)
  delete card.draft.settings.videoInputMode
  expect(boardDraftReferences(document, card.id, () => undefined)).toHaveLength(2)
})

test("video references use their own limit and reject material from the wrong mode", () => {
  const snapshot = BoardSnapshot.parse({
    prompt: "视频",
    settings: { styleModel: "portrait", videoInputMode: "multi-reference" },
    references: Array.from({ length: 4 }, (_, index) => ({
      sourceID: `s${index}`,
      generationID: "",
      mediaID: `${index}`,
      title: "参考",
      image: `/image-${index}.png`,
      role: "reference",
    })),
  })
  expect(boardGenerationError("video", snapshot)).toBeUndefined()
  expect(
    boardGenerationError("video", {
      ...snapshot,
      references: [...snapshot.references, { ...snapshot.references[0], image: "/extra.png" }],
    }),
  ).toBe("参考图数量超过模型上限")
  snapshot.settings.videoInputMode = "first-last-frame"
  expect(boardGenerationError("video", snapshot)).toBe("参考图与当前视频输入模式不匹配")
  const frame = { ...snapshot.references[0], role: "firstFrame" as const }
  expect(boardGenerationError("video", { ...snapshot, references: [frame, { ...frame, image: "/second.png" }] })).toBe(
    "每个首尾帧槽位仅支持一张图片",
  )
})

test.each(["image.upscale", "image.cutout", "image.inpaint"] as const)("%s provenance survives parsing and recovery without becoming a live reference", (capability) => {
  const name = capability === "image.upscale" ? "变清晰" : capability === "image.cutout" ? "抠图" : "智能重绘"
  const source = newBoardCard("source", "image")
  source.cover = { generationID: "changed-cover", mediaID: "new-image" }
  const child = newBoardCard("derived", "image")
  child.operation = {
    ...(capability === "image.inpaint" ? {
      capability, generateMode: "erase" as const, brushSize: 40, hasDrawing: true,
      compositeImage: ".octo/session/uploads/composite.png",
    } : capability === "image.upscale" ? { capability, mode: "restoration_8k" as const } : { capability }),
    source: { sourceID: source.id, generationID: "original", mediaID: "original-image", title: "来源", image: "https://example.test/original.png", role: "reference" },
    sourceImage: ".octo/session/uploads/prepared.jpg",
  }
  child.draft.prompt = capability === "image.inpaint" ? "消除涂抹区域内的物体" : capability === "image.upscale" ? BOARD_UPSCALE_PROMPT : BOARD_CUTOUT_PROMPT
  child.draft.settings.styleModel = "seedream-5-lite"
  const document = BoardDocument.parse({
    ...emptyBoard(), cards: [source, child],
    draftEdges: [{ id: "derived-edge", sourceID: source.id, targetID: child.id, role: "reference", purpose: "derivation" }],
  })
  expect(boardDraftReferences(document, child.id, () => "https://example.test/new.png")).toEqual([])
  expect(boardEdgeError({ ...document, draftEdges: [] }, source.id, child.id)).toBe("派生卡片不接受参考图连线")
  expect(recoverBoardDraft(document, structuredClone(document)).draftEdges).toEqual(document.draftEdges)
  expect(document.cards[1].operation).toEqual(child.operation)
  const snapshot = BoardSnapshot.parse({ ...child.draft, references: [], operation: child.operation })
  expect(boardGenerationError("image", snapshot)).toBeUndefined()
  expect(boardGenerationError("video", snapshot)).toBe(`${name}只能生成图片卡片`)
  expect(boardGenerationError("image", { ...snapshot, settings: { ...snapshot.settings, count: 2 } })).toBe(`${name}仅支持单张源图`)
  if (capability !== "image.inpaint")
    expect(boardGenerationError("image", { ...snapshot, prompt: "其他提示词" })).toBe(`${name}任务提示词不一致`)
  if (capability === "image.inpaint") {
    expect(boardGenerationError("image", { ...snapshot, prompt: "修改指定对象" })).toBeUndefined()
    expect(boardGenerationError("image", { ...snapshot, prompt: " " })).toContain("提示词")
    expect(boardGenerationError("image", { ...snapshot, prompt: "字".repeat(2001) })).toContain("2000")
    expect(BoardSnapshot.safeParse({ ...snapshot, operation: { ...child.operation, generateMode: "invalid" } }).success).toBe(false)
    expect(BoardSnapshot.safeParse({ ...snapshot, operation: { ...child.operation, brushSize: 127 } }).success).toBe(false)
    expect(BoardSnapshot.safeParse({ ...snapshot, operation: { ...child.operation, compositeImage: "" } }).success).toBe(false)
  }
  if (capability === "image.upscale")
    expect(BoardSnapshot.safeParse({ ...snapshot, operation: { ...child.operation, mode: "invalid" } }).success).toBe(false)
  if (capability === "image.cutout") expect(snapshot.operation).not.toHaveProperty("mode")
})
