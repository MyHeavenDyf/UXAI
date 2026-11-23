import { expect, test } from "bun:test"
import { STUDIO_STYLE_MODEL_CONFIG, findStudioStyleModel, historicalStudioModelUnavailableMessage, historicalStudioStyleModel, studioModelUnavailableMessage } from "../../src/studio/model-availability"

test.each(["seedream-5-pro", "qwen", "bd-icon"])("removing %s from the active configuration makes its historical tasks unavailable", (id) => {
  const models = STUDIO_STYLE_MODEL_CONFIG.filter((model) => model.id !== id)
  expect(findStudioStyleModel(id, models)).toBeUndefined()
  expect(studioModelUnavailableMessage(id, models)).toContain("模型已下架或不可用")
  expect(historicalStudioModelUnavailableMessage({ capability: "image.generate", styleModel: id }, models)).toContain("模型已下架或不可用")
})

test("a model is available exactly when its identity is present in the active configuration", () => {
  const model = { id: "new-style", label: "新模型", aliases: ["new-style-alias"] }
  expect(findStudioStyleModel(model.id)).toBeUndefined()
  expect(studioModelUnavailableMessage(model.label)).toContain("模型已下架或不可用")
  expect(findStudioStyleModel(model.aliases[0], [...STUDIO_STYLE_MODEL_CONFIG, model])).toEqual(model)
  expect(studioModelUnavailableMessage(model.label, [...STUDIO_STYLE_MODEL_CONFIG, model])).toBeUndefined()
})

test.each([
  { model: "txt2img_jimeng" },
  { taskType: "txt2img_jimeng" },
  { request: { task: { model: "txt2img_jimeng" } } },
  { request: { task: { model: "Seedream 5.0 Lite" } } },
  { taskType: "txt2img_jimeng", request: { task: { model: "internel" } } },
  { request: { task: { request: { task_type: "txt2img_jimeng" } } } },
  { request: { body: { task_type: "txt2img_jimeng" } } },
  { request: { task: { request: { body: { args: { tag_name: "Seedream 5.0 Lite" } } } } } },
  { request: { input: { styleModel: "seedream-5-lite" } } },
])("identifies retired historical provider metadata: %j", (input) => {
  expect(historicalStudioModelUnavailableMessage({ ...input, capability: "image.generate" })).toContain("模型已下架或不可用")
})

test("never replaces the saved style model with a provider type or current default", () => {
  expect(historicalStudioStyleModel({
    capability: "image.generate", styleModel: "seedream-5-lite",
    request: { task: { request: { task_type: "txt2img_jimeng_v2" } } },
  })).toBe("seedream-5-lite")
  expect(historicalStudioModelUnavailableMessage({
    capability: "image.generate", styleModel: "removed-style", model: "txt2img_jimeng_v2",
  })).toContain("模型已下架或不可用")
  expect(historicalStudioStyleModel({
    capability: "image.generate", request: { body: { args: { tag_name: "Qwen-Image" } } },
  })).toBe("qwen")
})

test("a shared task type cannot identify a missing style model", () => {
  expect(historicalStudioStyleModel({ capability: "image.generate", model: "txt2img_v2_performance" })).toBeUndefined()
  expect(historicalStudioModelUnavailableMessage({ capability: "image.generate", model: "txt2img_v2_performance" })).toContain("无法确认")
})

test.each(["image.upscale", "image.cutout", "image.inpaint", "image.outpaint", "video.generate"])("ignores unused Lite fields for %s", (capability) => {
  expect(historicalStudioModelUnavailableMessage({
    capability, styleModel: "seedream-5-lite", request: { input: { styleModel: "Seedream 5.0 Lite" } },
  })).toBeUndefined()
})

test("does not parse historical prompt text as model configuration", () => {
  expect(historicalStudioStyleModel({
    capability: "image.generate", request: { input: { prompt: "风格模型：Seedream 5.0 Lite" } },
  })).toBeUndefined()
})
