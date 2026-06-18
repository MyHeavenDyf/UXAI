import { describe, expect, test } from "bun:test"
import { resolveReferenceImages as resolveJimengReferenceImages } from "@/tool/jimeng_image_generate"
import {
  extractInternalImages,
  getInternalStyleConfig,
  getInternalTargetSize,
  getTargetSizeForAspectRatio,
  getTaskType,
  isCancelTaskSuccess,
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
        "Seedream 5.0 Lite",
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
        taskType: getInternalStyleConfig(styleModel).taskType,
        target: getInternalStyleConfig(styleModel).target,
        loras: getInternalStyleConfig(styleModel).loras,
      })),
    ).toEqual([
      { styleModel: "Seedream 5.0 Lite", taskType: "txt2img_jimeng", target: "flux1-dev", loras: [] },
      { styleModel: "千问", taskType: "txt2img_qwen", target: "flux1-dev", loras: [] },
      { styleModel: "BDIcon", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_BDicon", weight: 0.8 }] },
      { styleModel: "质感人像", taskType: "txt2img_v2_performance", target: "flux1-krea-dev-fp8", loras: [{ name: "F.1_textured_portrait", weight: 0.8 }] },
      { styleModel: "开发者人物形象", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_hwc3dcharacter_latest", weight: "0.8" }] },
      { styleModel: "小艺agent", taskType: "txt2img_qwen", target: "flux1-dev", loras: [{ name: "F.1_xiaoyi_agent", weight: 0.85 }] },
      { styleModel: "智慧3D", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_intelligent3d", weight: 1 }] },
      { styleModel: "抽象几何背景", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_abstract_wallpaper", weight: 1 }] },
      { styleModel: "云宝", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "yunbao", weight: 1 }] },
      { styleModel: "H Design 3D", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_hdesign_3d", weight: 1 }] },
      { styleModel: "鸿蒙插画", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_harmonyOSIllustration", weight: 1 }] },
      { styleModel: "H Design插画", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_hdesign", weight: 1 }] },
      { styleModel: "3D抽象元素", taskType: "txt2img_v2_performance", target: "flux1-dev", loras: [{ name: "F.1_hwcbanner", weight: 0.8 }] },
    ])
  })

  test("maps studio aspect ratio settings to target size", () => {
    expect(getTargetSizeForAspectRatio({ width: 1024, height: 1024 }, "1:1")).toEqual({ width: 1024, height: 1024 })
    expect(getTargetSizeForAspectRatio({ width: 1024, height: 1024 }, "3:4")).toEqual({ width: 768, height: 1024 })
    expect(getTargetSizeForAspectRatio({ width: 1024, height: 1024 }, "16:9")).toEqual({ width: 1024, height: 576 })
    expect(getTargetSizeForAspectRatio({ width: 1280, height: 1280 }, "3:4")).toEqual({ width: 960, height: 1280 })
  })

  test("maps Seedream aspect ratios to model-specific target sizes", () => {
    expect(
      (["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9"] as const)
        .map((aspectRatio) => getInternalTargetSize("Seedream 5.0 Lite", aspectRatio)),
    ).toEqual([
      { width: 2048, height: 2048 },
      { width: 1664, height: 2496 },
      { width: 1728, height: 2304 },
      { width: 1600, height: 2848 },
      { width: 2496, height: 1664 },
      { width: 2304, height: 1728 },
      { width: 2848, height: 1600 },
    ])
    expect(getInternalTargetSize("千问", "1:1")).toEqual({ width: 1024, height: 1024 })
  })

  test("accepts cancellation only when the provider confirms success", () => {
    expect(isCancelTaskSuccess({ resp_code: 200, resp_msg: "success", result: true })).toBe(true)
    expect(isCancelTaskSuccess({ resp_code: 200, resp_msg: "not cancelled", result: false })).toBe(false)
    expect(isCancelTaskSuccess({ resp_code: 500, resp_msg: "failed", result: true })).toBe(false)
  })

  test("rejects incomplete cancellation responses", () => {
    expect(isCancelTaskSuccess({})).toBe(false)
    expect(isCancelTaskSuccess({ resp_code: 200 })).toBe(false)
    expect(isCancelTaskSuccess({ result: true })).toBe(false)
  })
})
