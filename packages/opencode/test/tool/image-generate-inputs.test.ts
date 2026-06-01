import { describe, expect, test } from "bun:test"
import { resolveReferenceImages as resolveJimengReferenceImages } from "@/tool/jimeng_image_generate"
import {
  extractInternalImages,
  getInternalStyleConfig,
  getTargetSizeForAspectRatio,
  getTaskType,
  resolveReferenceImages as resolveInternelReferenceImages,
} from "@/tool/internel_image_generate"

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

  test("extracts internal results_v2 output images", () => {
    expect(
      extractInternalImages({
        resp_code: 200,
        result: {
          status: 2,
          progress: 100,
          results_v2: [
            {
              output: {
                image: "https://example.com/internal.png",
              },
            },
          ],
        },
      }),
    ).toEqual(["https://example.com/internal.png"])
  })

  test("prefers internal clean background outputs for cutout", () => {
    expect(
      extractInternalImages({
        resp_code: 200,
        result: {
          status: 2,
          progress: 100,
          results_clean_bg: ["https://example.com/clean.png"],
          results_v2: [
            {
              output: {
                image: "https://example.com/original.png",
                clean_bg: "https://example.com/v2-clean.png",
              },
            },
          ],
        },
      }),
    ).toEqual(["https://example.com/clean.png", "https://example.com/v2-clean.png"])
  })

  test("keeps internal image generation on txt2img task type by default", () => {
    expect(getTaskType({ generationMode: "img2img" })).toBe("txt2img_qwen")
  })

  test("maps internal style models to create_task config", () => {
    expect(
      [
        "千问",
        "BDIcon",
        "质感人像",
        "开发者人物形象",
        "小艺agent",
        "智慧3D",
        "抽象几何背景",
        "云宝",
        "H Design 3D",
        "鸿蒙插画",
        "H Design插画",
        "3D抽象元素",
      ].map((styleModel) => ({
        styleModel,
        loras: getInternalStyleConfig(styleModel).loras,
      })),
    ).toEqual([
      { styleModel: "千问", loras: [] },
      { styleModel: "BDIcon", loras: [{ name: "F.1_BDicon", weight: 0.8 }] },
      { styleModel: "质感人像", loras: [{ name: "F.1_textured_portrait", weight: 0.8 }] },
      { styleModel: "开发者人物形象", loras: [{ name: "F.1_hwc3dcharacter_latest", weight: "0.8" }] },
      { styleModel: "小艺agent", loras: [{ name: "F.1_xiaoyi_agent", weight: 0.85 }] },
      { styleModel: "智慧3D", loras: [{ name: "F.1_intelligent3d", weight: 1 }] },
      { styleModel: "抽象几何背景", loras: [{ name: "F.1_abstract_wallpaper", weight: 1 }] },
      { styleModel: "云宝", loras: [{ name: "yunbao", weight: 1 }] },
      { styleModel: "H Design 3D", loras: [{ name: "F.1_hdesign_3d", weight: 1 }] },
      { styleModel: "鸿蒙插画", loras: [{ name: "F.1_harmonyOSIllustration", weight: 1 }] },
      { styleModel: "H Design插画", loras: [{ name: "F.1_hdesign", weight: 1 }] },
      { styleModel: "3D抽象元素", loras: [{ name: "F.1_hwcbanner", weight: 0.8 }] },
    ])
  })

  test("maps studio aspect ratio settings to target size", () => {
    expect(getTargetSizeForAspectRatio({ width: 1024, height: 1024 }, "1:1")).toEqual({ width: 1024, height: 1024 })
    expect(getTargetSizeForAspectRatio({ width: 1024, height: 1024 }, "3:4")).toEqual({ width: 768, height: 1024 })
    expect(getTargetSizeForAspectRatio({ width: 1024, height: 1024 }, "16:9")).toEqual({ width: 1024, height: 576 })
    expect(getTargetSizeForAspectRatio({ width: 1280, height: 1280 }, "3:4")).toEqual({ width: 960, height: 1280 })
  })
})
