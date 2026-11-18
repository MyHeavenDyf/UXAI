export type StudioStyleModelConfig = {
  id: string
  label: string
  aliases: string[]
  requiresSeedreamPermission?: boolean
}

// This is the only list of models currently offered by Studio.
export const STUDIO_STYLE_MODEL_CONFIG: StudioStyleModelConfig[] = [
  { id: "seedream-5-pro", label: "Seedream 5.0 Pro", aliases: [], requiresSeedreamPermission: true },
  { id: "qwen", label: "千问", aliases: ["Qwen-Image"] },
  { id: "bd-icon", label: "BDIcon", aliases: ["DBID"] },
  { id: "portrait", label: "质感人像", aliases: ["质感人物"] },
  { id: "developer", label: "开发者人物形象", aliases: [] },
  { id: "xiaoyi", label: "小艺agent", aliases: [] },
  { id: "smart-3d", label: "智慧3D", aliases: [] },
  { id: "abstract", label: "抽象几何背景", aliases: [] },
  { id: "yunbao", label: "云宝", aliases: [] },
  { id: "hdesign", label: "H Design 3D", aliases: ["HDesign"] },
  { id: "hongmeng", label: "鸿蒙插画", aliases: [] },
  { id: "hdesign-illustration", label: "H Design插画", aliases: [] },
  { id: "3d-abstract", label: "3D抽象元素", aliases: [] },
]

// Identity metadata for historical display; this never makes a model available.
const legacyModels = [{ id: "seedream-5-lite", label: "Seedream 5.0 Lite", aliases: [], requiresSeedreamPermission: true }]

export function findStudioStyleModel(value?: string, models: readonly StudioStyleModelConfig[] = STUDIO_STYLE_MODEL_CONFIG) {
  return models.find((model) => [model.id, model.label, ...model.aliases].some((alias) => alias.toLowerCase() === value?.trim().toLowerCase()))
}

export function studioStyleModelIdentity(value?: string) {
  return findStudioStyleModel(value) ?? findStudioStyleModel(value, legacyModels)
}

export function studioModelUnavailableMessage(value?: string, models: readonly StudioStyleModelConfig[] = STUDIO_STYLE_MODEL_CONFIG) {
  if (!value?.trim()) return "无法确认该历史任务使用的模型，请选择模型后重新创建任务。"
  if (findStudioStyleModel(value, models)) return
  return `${studioStyleModelIdentity(value)?.label ?? value} 模型已下架或不可用，请选择其他模型。`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function routedStyleModel(input: { request?: unknown; taskType?: string; task_type?: string; model?: string }) {
  const request = record(input.request)
  const task = record(request.task)
  const provider = record(task.request ?? request)
  const body = record(provider.body ?? provider)
  const taskType = string(body.task_type) ?? string(body.taskType) ?? input.taskType ?? input.task_type ?? string(task.model) ?? input.model
  if (taskType === "txt2img_jimeng") return "seedream-5-lite"
  if (taskType === "txt2img_jimeng_v2") return "seedream-5-pro"
}

// Read persisted provider metadata only. Prompt text never supplies execution settings.
export function historicalStudioStyleModel(input: {
  capability: string
  styleModel?: string
  model?: string
  taskType?: string
  task_type?: string
  request?: unknown
}) {
  if (input.capability !== "image.generate" && input.capability !== "image.fusion") return
  const request = record(input.request)
  const task = record(request.task)
  const provider = record(task.request ?? request)
  const body = record(provider.body ?? provider)
  const saved = string(input.styleModel) ?? string(record(request.input).styleModel) ?? string(record(task.input).styleModel)
  if (saved) return studioStyleModelIdentity(saved)?.id ?? saved
  const tag = string(record(body.args).tag_name)
  if (tag) return studioStyleModelIdentity(tag)?.id ?? tag
  const routed = routedStyleModel(input)
  if (routed) return routed
  const model = string(task.model) ?? input.model
  if (["internel", "jimeng", "internel_image_generate", "jimeng_image_generate", "image-generation-tool"].includes(model ?? "") || model?.startsWith("txt2img_")) return
  return studioStyleModelIdentity(model)?.id ?? model
}

export function historicalStudioModelUnavailableMessage(input: Parameters<typeof historicalStudioStyleModel>[0], models: readonly StudioStyleModelConfig[] = STUDIO_STYLE_MODEL_CONFIG) {
  if (input.capability !== "image.generate" && input.capability !== "image.fusion") return
  const routed = routedStyleModel(input)
  const routeError = routed && studioModelUnavailableMessage(routed, models)
  if (routeError) return routeError
  return studioModelUnavailableMessage(historicalStudioStyleModel(input), models)
}
