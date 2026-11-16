import { describe, expect, test } from "bun:test"
import { boardConnectionError, boardReferences, type BoardCard } from "./studio-board-state"

const cards: BoardCard[] = [
  { id: "a", title: "图片 01", prompt: "山景", status: "succeeded", progress: 100, image: "/a.svg" },
  { id: "b", title: "图片 02", prompt: "静物", status: "succeeded", progress: 100, image: "/b.svg" },
  { id: "c", title: "图片 03", prompt: "", status: "draft", progress: 0 },
]

describe("board demo references", () => {
  test("only generated images can connect to drafts; self and duplicate connections are rejected", () => {
    expect(boardConnectionError(cards, [], "a", "c")).toBeUndefined()
    expect(boardConnectionError(cards, [], "c", "a")).toBeDefined()
    expect(boardConnectionError(cards, [], "a", "a")).toBeDefined()
    expect(boardConnectionError(cards, [], "a", "b")).toBeDefined()
    expect(boardConnectionError(cards, [{ id: "ac", sourceID: "a", targetID: "c" }], "a", "c")).toBeDefined()
  })

  test("rejects a cycle even if inconsistent edge data is supplied", () => {
    expect(boardConnectionError(cards, [{ id: "ca", sourceID: "c", targetID: "a" }], "a", "c")).toBe("不能创建循环连接")
  })

  test("resolves connected images in connection order and removes missing sources", () => {
    const edges = [
      { id: "bc", sourceID: "b", targetID: "c" },
      { id: "ac", sourceID: "a", targetID: "c" },
    ]
    expect(boardReferences(cards, edges, "c").map((reference) => reference.image)).toEqual(["/b.svg", "/a.svg"])
    expect(
      boardReferences(
        cards.filter((card) => card.id !== "b"),
        edges,
        "c",
      ).map((reference) => reference.image),
    ).toEqual(["/a.svg"])
  })

  test("submitted references remain available when the source is removed or changes", () => {
    const submitted = {
      ...cards[2],
      status: "succeeded" as const,
      inputs: boardReferences(cards, [{ id: "ac", sourceID: "a", targetID: "c" }], "c"),
    }
    expect(boardReferences([submitted], [], "c")).toEqual([{ sourceID: "a", title: "图片 01", image: "/a.svg" }])
    expect(boardReferences([{ ...cards[0], image: "/changed.svg" }, submitted], [], "c")[0].image).toBe("/a.svg")
  })
})
