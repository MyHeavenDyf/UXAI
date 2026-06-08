import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { createGeneration, getGeneration } from "@/studio/studio-service"
import { fetchPromptTags } from "@/tool/internel_image_generate"
import { errors } from "../../error"

const StudioGenerationInput = z.object({
  sessionID: z.string().optional(),
  capability: z.enum([
    "image.generate",
    "video.generate",
    "image.upscale",
    "image.cutout",
    "image.inpaint",
    "image.outpaint",
    "image.fusion",
  ]),
  prompt: z.string().min(1),
  styleModel: z.string().optional(),
  aspectRatio: z.string().optional(),
  count: z.number().int().min(1).max(4).optional(),
  imageTool: z.enum(["jimeng", "internel"]).optional(),
  referenceImages: z.array(z.string()).optional(),
  sourceImage: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})

export const STUDIO_MATERIALS = [
  {
    category: "人物",
    subcategories: [
      { label: "身份", tags: ["女人", "男人", "科学家", "运动员", "职场女性", "学生", "老师", "诗人", "黑客"] },
      { label: "身材", tags: ["苗条", "健壮", "丰满", "纤细", "高挑", "娇小"] },
    ],
  },
  {
    category: "服饰",
    subcategories: [
      { label: "风格", tags: ["休闲", "正式", "运动", "复古", "时尚", "街头", "优雅", "朋克"] },
      { label: "颜色", tags: ["红色", "蓝色", "黑色", "白色", "米白", "深色", "浅色", "彩色"] },
    ],
  },
  {
    category: "表情动作",
    subcategories: [
      { label: "表情", tags: ["微笑", "大笑", "严肃", "思考", "惊讶", "开心", "忧郁", "自信"] },
      { label: "动作", tags: ["站立", "坐着", "奔跑", "舞蹈", "跳跃", "拥抱", "回眸"] },
    ],
  },
  {
    category: "画面",
    subcategories: [
      { label: "构图", tags: ["全身", "半身", "特写", "俯视", "仰视", "侧面", "背影"] },
      { label: "风格", tags: ["写实", "插画", "油画", "水彩", "素描", "动漫", "摄影"] },
    ],
  },
  {
    category: "物体",
    subcategories: [
      { label: "类型", tags: ["花朵", "书本", "乐器", "食物", "科技", "植物", "宠物"] },
      { label: "材质", tags: ["金属", "木质", "玻璃", "布料", "皮革", "陶瓷"] },
    ],
  },
  {
    category: "环境",
    subcategories: [
      { label: "场景", tags: ["室内", "户外", "城市", "自然", "海边", "森林", "山间", "街道"] },
      { label: "时间", tags: ["白天", "夜晚", "黎明", "黄昏", "午后", "深夜"] },
    ],
  },
]

export const StudioRoutes = lazy(() =>
  new Hono()
    .get(
      "/prompt-tags",
      describeRoute({
        summary: "Get prompt tags",
        description: "Returns prompt tag categories from the internal image API.",
        operationId: "studio.prompt-tags.list",
        responses: {
          200: {
            description: "Prompt tags list",
            content: { "application/json": { schema: resolver(z.unknown()) } },
          },
          ...errors(502),
        },
      }),
      async (c) => {
        const data = await fetchPromptTags()
        return c.json(data)
      },
    )
    .get(
      "/materials",
      describeRoute({
        summary: "Get Studio material categories",
        description: "Returns the list of material categories with model associations and bilingual tags.",
        operationId: "studio.materials.list",
        responses: {
          200: {
            description: "Studio materials list",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
        },
      }),
      (c) => c.json(STUDIO_MATERIALS),
    )
    .post(
    "/generations",
    describeRoute({
      summary: "Create Studio image generation",
      description: "Generate images using the built-in Studio image generation tool.",
      operationId: "studio.generations.create",
      responses: {
        202: {
          description: "Studio generation accepted",
          content: {
            "application/json": {
              schema: resolver(z.unknown()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", StudioGenerationInput),
    async (c) => {
      const input = c.req.valid("json")
      console.log("[studio.route] POST /studio/generations", {
        sessionID: input.sessionID,
        capability: input.capability,
        prompt: input.prompt,
        styleModel: input.styleModel,
        aspectRatio: input.aspectRatio,
        count: input.count,
        imageTool: input.imageTool,
        referenceImageCount: input.referenceImages?.length ?? 0,
        hasSourceImage: Boolean(input.sourceImage),
      })
      return c.json(await createGeneration(input), 202)
    },
  )
  .get("/generations/:generationID", async (c) => c.json(await getGeneration(c.req.param("generationID")))),
)
