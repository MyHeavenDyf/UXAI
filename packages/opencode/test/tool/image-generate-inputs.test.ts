import { describe, expect, test } from "bun:test"
import { resolveReferenceImages as resolveJimengReferenceImages } from "@/tool/jimeng_image_generate"
import { resolveReferenceImages as resolveInternelReferenceImages } from "@/tool/internel_image_generate"

describe("image generate input filtering", () => {
  test("drops filename-only references for jimeng", () => {
    expect(
      resolveJimengReferenceImages({
        sourceImage: "jimeng-1.png",
        referenceImages: ["https://example.com/cat.png", "cover.png", "data:image/png;base64,AAAA"],
      }),
    ).toEqual(["https://example.com/cat.png", "data:image/png;base64,AAAA"])
  })

  test("drops filename-only references for internel", () => {
    expect(
      resolveInternelReferenceImages({
        sourceImage: "jimeng-1.png",
        referenceImages: ["https://example.com/dog.png", "cover.png", "data:image/png;base64,BBBB"],
      }),
    ).toEqual(["https://example.com/dog.png", "data:image/png;base64,BBBB"])
  })
})
