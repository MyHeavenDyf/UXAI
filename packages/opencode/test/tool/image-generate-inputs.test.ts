import { describe, expect, test } from "bun:test"
import { resolveReferenceImages as resolveJimengReferenceImages } from "@/tool/jimeng_image_generate"
import {
  createInternalGeneration,
  createTaskFailureMessage,
  extractInternalImages,
  getInternalStyleConfig,
  getInternalTargetSize,
  getTargetSizeForAspectRatio,
  getTaskType,
  isCancelTaskSuccess,
  queryTaskFailureMessage,
  resolveReferenceImages as resolveInternelReferenceImages,
} from "@/tool/internel_image_generate"
import type { ImageGenerateInput } from "@/studio/image-provider"

describe("internal image create task failures", () => {
  test("maps concurrent task limit to a fixed message", () => {
    expect(createTaskFailureMessage({ resp_code: 5004, resp_msg: "ignored" })).toBe(
      "最多支持同时进行3个生成任务",
    )
  })

  test("uses resp_msg for 5009", () => {
    expect(createTaskFailureMessage({ resp_code: 5009, resp_msg: "当前账号不可用" })).toBe("当前账号不可用")
  })

  test("uses the generic message for empty 5009 and other failures", () => {
    expect(createTaskFailureMessage({ resp_code: 5009, resp_msg: " " })).toBe(
      "任务创建失败，请检查网络或稍后再试",
    )
    expect(createTaskFailureMessage({ resp_code: 5010, resp_msg: "内部详情" })).toBe(
      "任务创建失败，请检查网络或稍后再试",
    )
    expect(createTaskFailureMessage()).toBe("任务创建失败，请检查网络或稍后再试")
  })
})

describe("Seedream provider request", () => {
  test("sends Pro task types through the full creation path without changing Lite or editing", async () => {
    const requests: unknown[] = []
    using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === "/create_task") {
          requests.push(await request.json())
          return Response.json({ resp_code: 200, task_id: `seedream-test-${requests.length}` })
        }
        return Response.json({ resp_code: 200, result: [] })
      },
    })
    const previous = {
      IMAGE_CREATE_TASK_URL: process.env.IMAGE_CREATE_TASK_URL,
      IMAGE_GET_HISTORY_URL: process.env.IMAGE_GET_HISTORY_URL,
    }
    using environment = {
      [Symbol.dispose]() {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) {
            delete process.env[key]
            return
          }
          process.env[key] = value
        })
      },
    }
    process.env.IMAGE_CREATE_TASK_URL = new URL("/create_task", server.url).href
    process.env.IMAGE_GET_HISTORY_URL = new URL("/get_history", server.url).href

    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
    const inputs = [
      {
        capability: "image.generate",
        prompt: "Pro custom dimensions",
        styleModel: "seedream-5-pro",
        extra: { width: 1280, height: 720, taskType: "txt2img_jimeng" },
      },
      {
        capability: "image.generate",
        prompt: "Pro reference images",
        styleModel: "Seedream 5.0 Pro",
        aspectRatio: "3:4",
        count: 4,
        referenceImages: [image, image, image, image],
      },
      {
        capability: "image.generate",
        prompt: "Pro template",
        styleModel: "seedream-5-pro",
        aspectRatio: "1:1",
        extra: { taskType: "txt2img_qwen", template: { id: "template-test", prompt: { custom: "a cat" } } },
      },
      { capability: "image.generate", prompt: "Lite generation", styleModel: "seedream-5-lite", aspectRatio: "1:1" },
      { capability: "image.cutout", prompt: "Pro editing", styleModel: "seedream-5-pro", sourceImage: image },
    ] satisfies ImageGenerateInput[]
    const tasks = await Promise.all(inputs.map((input) => createInternalGeneration({
      ...input,
      extra: { ...input.extra, userIdx: "seedream-test-user" },
    })))

    expect(tasks.map((task) => task.model)).toEqual([
      "txt2img_jimeng_v2", "txt2img_jimeng_v2", "txt2img_jimeng_v2", "txt2img_jimeng", "remove_bg",
    ])
    expect(requests).toHaveLength(5)
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        task_type: "txt2img_jimeng_v2",
        args: expect.objectContaining({
          customer_prompt: "Pro custom dimensions",
          tag_name: "Seedream 5.0 Pro",
          target_size: { width: 1280, height: 720 },
        }),
      }),
      expect.objectContaining({
        task_type: "txt2img_jimeng_v2",
        args: expect.objectContaining({
          customer_prompt: "Pro reference images",
          target_size: { width: 1728, height: 2304 },
          num_image: 4,
          ref_img_list: Array.from({ length: 4 }, () => ({ ref_type: "kontext", image_base64: image })),
        }),
      }),
      expect.objectContaining({
        task_type: "txt2img_jimeng_v2",
        args: expect.objectContaining({
          customer_prompt: "Pro template",
          target_size: { width: 2048, height: 2048 },
          template: { id: "template-test", prompt: { custom: "a cat" } },
        }),
      }),
      expect.objectContaining({
        task_type: "txt2img_jimeng",
        args: expect.objectContaining({ customer_prompt: "Lite generation" }),
      }),
      expect.objectContaining({ task_type: "remove_bg" }),
    ]))
  })
})

describe("internal image query task failures", () => {
  test("uses the provider result error message", () => {
    expect(queryTaskFailureMessage({
      result: { status: 3, error_message: " 内容审核未通过 " },
    })).toBe("内容审核未通过")
  })

  test("uses a friendly fallback for missing or empty provider messages", () => {
    expect(queryTaskFailureMessage({ result: { status: 3 } })).toBe("生成任务失败")
    expect(queryTaskFailureMessage({ result: { status: 3, error_message: "  " } })).toBe("生成任务失败")
    expect(queryTaskFailureMessage({ result: { status: 3, error_message: null } })).toBe("生成任务失败")
  })
})

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
        "Seedream 5.0 Pro",
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
      { styleModel: "Seedream 5.0 Pro", taskType: "txt2img_jimeng_v2", target: "flux1-dev", loras: [] },
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

  test.each(["Seedream 5.0 Lite", "seedream-5-pro", "Seedream 5.0 Pro"])("maps %s aspect ratios to model-specific target sizes", (model) => {
    expect(
      (["1:1", "2:3", "3:4", "9:16", "3:2", "4:3", "16:9"] as const)
        .map((aspectRatio) => getInternalTargetSize(model, aspectRatio)),
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

  test.each(["seedream-5-pro", "Seedream 5.0 Pro", " SEEDREAM-5-PRO "])("keeps %s on its required task type", (styleModel) => {
    expect(getInternalStyleConfig(styleModel).tagName).toBe("Seedream 5.0 Pro")
    expect(getInternalTargetSize(styleModel)).toEqual({ width: 2048, height: 2048 })
    expect(getTaskType({ generationMode: "txt2img", styleModel, taskType: "txt2img_jimeng" })).toBe("txt2img_jimeng_v2")
    expect(getTaskType({ generationMode: "txt2img", styleModel, taskType: "txt2img_qwen" })).toBe("txt2img_jimeng_v2")
  })

  test("preserves non-Pro task type overrides", () => {
    expect(getTaskType({ generationMode: "txt2img", styleModel: "seedream-5-lite", taskType: "custom_task" })).toBe("custom_task")
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
