import { describe, expect, test } from "bun:test"
import {
  STUDIO_ASPECT_RATIOS,
  STUDIO_STYLE_MODELS,
  isSeedreamStyleModel,
  isStyleModelAvailable,
  referenceImageLimit,
  styleModelId,
  styleModelLabel,
  styleModelRequiresSeedreamPermission,
} from "./data"
import { getDefaultDimensions, getStudioImageAreaLimits, getStudioImageDimensionRange, isStudioCustomSizeValid, studioGenerationModelUnavailableMessage } from "./studio-shared"
import { styleTemplateTargetModel } from "./studio-style-template-utils"

describe("Seedream model capabilities", () => {
  test("offers Pro before Qwen and keeps Lite metadata for history", () => {
    expect(STUDIO_STYLE_MODELS.filter((model) => isStyleModelAvailable(model.id)).slice(0, 2).map((model) => model.id)).toEqual(["seedream-5-pro", "qwen"])
    expect(styleModelLabel("seedream-5-lite")).toBe("Seedream 5.0 Lite")
    expect(isStyleModelAvailable("Seedream 5.0 Lite")).toBe(false)
    expect(STUDIO_STYLE_MODELS.some((model) => model.id === "seedream-5-lite")).toBe(false)
    expect(STUDIO_STYLE_MODELS.filter((model) => model.requiresSeedreamPermission !== true).some((model) => isSeedreamStyleModel(model.id))).toBe(false)
  })

  test.each(["seedream-5-pro", "Seedream 5.0 Pro"])("recognizes %s with Lite capabilities", (model) => {
    expect(styleModelId(model)).toBe("seedream-5-pro")
    expect(styleModelLabel(model)).toBe("Seedream 5.0 Pro")
    expect(isSeedreamStyleModel(model)).toBe(true)
    expect(styleModelRequiresSeedreamPermission(model)).toBe(true)
    expect(referenceImageLimit(model)).toBe(4)
  })

  test("preserves existing reference limits and rejects unknown Seedream models", () => {
    expect(referenceImageLimit("seedream-5-lite")).toBe(4)
    expect(referenceImageLimit("qwen")).toBe(3)
    expect(referenceImageLimit("bd-icon")).toBe(1)
    expect(isSeedreamStyleModel("seedream-unknown")).toBe(false)
    expect(isSeedreamStyleModel()).toBe(false)
  })
})

describe("Studio custom dimensions", () => {
  test.each([
    [1280, 720, true],
    [1279, 720, false],
    [2150, 2150, true],
    [2151, 2151, false],
    [3072, 3072, false],
    [3840, 240, true],
    [240, 3840, true],
    [4000, 240, false],
    [240, 4000, false],
    [1280.5, 720, false],
    [NaN, 720, false],
    [Infinity, 720, false],
    [1280, 0, false],
    [-1280, -720, false],
  ])("validates Pro %s × %s as %s", (width, height, valid) => {
    expect(isStudioCustomSizeValid("seedream-5-pro", width, height)).toBe(valid)
    expect(isStudioCustomSizeValid("Seedream 5.0 Pro", width, height)).toBe(valid)
  })

  test("preserves Lite, historical resolution tiers, and ordinary model limits", () => {
    expect(isStudioCustomSizeValid("seedream-5-lite", 1280, 720)).toBe(false)
    expect(isStudioCustomSizeValid("seedream-5-lite", 3072, 3072)).toBe(true)
    expect(getStudioImageAreaLimits("jimeng-3k")).toEqual(getStudioImageAreaLimits("seedream-5-lite"))
    expect(getStudioImageAreaLimits("qwen")).toBeUndefined()
    expect(getStudioImageAreaLimits("hdesign")).toBeUndefined()
    expect(isStudioCustomSizeValid("qwen", 250, 1664)).toBe(true)
    expect(isStudioCustomSizeValid("千问", 250, 1665)).toBe(false)
    expect(isStudioCustomSizeValid("bd-icon", 250, 2500)).toBe(true)
    expect(isStudioCustomSizeValid("bd-icon", 249, 2500)).toBe(false)
    expect(isStudioCustomSizeValid("bd-icon", 250, 2501)).toBe(false)
  })

  test("accepts every existing Seedream preset under both area rules", () => {
    STUDIO_ASPECT_RATIOS.forEach((ratio) => {
      const size = getDefaultDimensions("seedream-5-pro", ratio)!
      expect(size).toEqual(getDefaultDimensions("seedream-5-lite", ratio)!)
      expect(isStudioCustomSizeValid("seedream-5-pro", size.width, size.height)).toBe(true)
      expect(isStudioCustomSizeValid("seedream-5-lite", size.width, size.height)).toBe(true)
    })
  })

  test("calculates feasible integer ranges including area and ratio boundaries", () => {
    expect(getStudioImageDimensionRange("seedream-5-pro", 1280)).toEqual({ min: 720, max: 3612 })
    expect(isStudioCustomSizeValid("seedream-5-pro", 1280, 3612)).toBe(true)
    expect(isStudioCustomSizeValid("seedream-5-pro", 1280, 3613)).toBe(false)
    expect(getStudioImageDimensionRange("seedream-5-pro", 240)).toEqual({ min: 3840, max: 3840 })
    expect(getStudioImageDimensionRange("seedream-5-pro", 200)).toEqual({ min: 4608, max: 3200 })
    expect(getStudioImageDimensionRange("seedream-5-pro", 0)).toBeUndefined()
    expect(getStudioImageDimensionRange("seedream-5-pro", Number.MAX_SAFE_INTEGER + 1)).toBeUndefined()
    expect(getStudioImageDimensionRange("qwen", 1280)).toBeUndefined()
  })
})

describe("Studio style template model selection", () => {
  test.each(["seedream-5-pro", "Seedream 5.0 Pro"])("preserves %s only with permission", (model) => {
    expect(styleTemplateTargetModel(true, model)).toBe(styleModelId(model)!)
    expect(styleTemplateTargetModel(false, model)).toBe("qwen")
  })

  test.each(["seedream-5-lite", "Seedream 5.0 Lite", "removed-style"])("does not silently replace unavailable %s for templates", (model) => {
    expect(styleTemplateTargetModel(true, model)).toBeUndefined()
    expect(styleTemplateTargetModel(false, model)).toBeUndefined()
  })

  test("preserves Qwen and defaults new templates to Pro with permission", () => {
    expect(styleTemplateTargetModel(true, "qwen")).toBe("qwen")
    expect(styleTemplateTargetModel(false, "千问")).toBe("qwen")
    expect(styleTemplateTargetModel(true, "bd-icon")).toBe("seedream-5-pro")
    expect(styleTemplateTargetModel(false, "bd-icon")).toBe("qwen")
  })
})

describe("Studio retired task models", () => {
  test.each([
    { model: "internel", styleModel: "seedream-5-lite" },
    { model: "Seedream 5.0 Lite" },
    { model: "internel", request: { input: { styleModel: "seedream-5-lite" } } },
    { model: " SEEDREAM-5-LITE " },
  ])("blocks historical model fields without changing the task: %j", (result) => {
    const before = structuredClone(result)
    expect(studioGenerationModelUnavailableMessage({ ...result, capability: "image.generate" })).toBe("Seedream 5.0 Lite 模型已下架或不可用，请选择其他模型。")
    expect(result).toEqual(before)
  })

  test.each(["seedream-5-pro", "Seedream 5.0 Pro", "qwen", "t2v_seedance"])("leaves %s available", (model) => {
    expect(studioGenerationModelUnavailableMessage({ model, capability: model === "t2v_seedance" ? "video.generate" : "image.generate" })).toBeUndefined()
  })

  test("recognizes Lite provider tasks without a saved styleModel", () => {
    expect(studioGenerationModelUnavailableMessage({
      capability: "image.generate", model: "txt2img_jimeng",
      request: { input: { prompt: "旧任务" }, task: { request: { task_type: "txt2img_jimeng" } } },
    })).toContain("模型已下架或不可用")
  })

  test("blocks any unconfigured style instead of restoring it as the current model", () => {
    expect(studioGenerationModelUnavailableMessage({
      capability: "image.generate", model: "txt2img_v2_performance", styleModel: "removed-style",
    })).toContain("模型已下架或不可用")
  })

  test("does not fall back to the current model when a historical image model is unknown", () => {
    expect(studioGenerationModelUnavailableMessage({
      capability: "image.generate", model: "internel", request: { input: { prompt: "风格模型：Seedream 5.0 Lite" } },
    })).toContain("无法确认该历史任务使用的模型")
  })

  test.each(["image.upscale", "image.cutout", "image.inpaint", "image.outpaint"] as const)("does not retire %s based on unused style metadata", (capability) => {
    expect(studioGenerationModelUnavailableMessage({
      capability, model: "magnify", request: { input: { styleModel: "seedream-5-lite" } },
    })).toBeUndefined()
  })
})
