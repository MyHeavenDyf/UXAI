// LLM 实际输出 { layout_planner: { rootId, elements, slots, camera, lights, scene } }
// 代码用 plannerJson.layout_planner ?? plannerJson 提取
// schema 校验 LLM 原始输出格式
const schema = {
  type: "object",
  properties: {
    layout_planner: {
      type: "object",
      properties: {
        rootId: { type: "string" },
        elements: {
          type: "array",
          items: { type: "object" },
        },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section_id: { type: "string" },
              element_id: { type: "string" },
              id_prefix: { type: "string" },
              zone_description: { type: "string" },
              object_count_hint: { type: "number" },
            },
            required: ["section_id", "element_id", "id_prefix"],
          },
        },
        camera: { type: "object" },
        lights: { type: "array", items: { type: "object" } },
        scene: { type: "object" },
      },
      required: ["rootId", "elements", "slots"],
    },
  },
  required: ["layout_planner"],
}

export const SCENE_PLANNER_CREATE_FORMAT = {
  type: "json_schema" as const,
  schema,
}
